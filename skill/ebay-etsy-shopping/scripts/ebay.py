#!/usr/bin/env python3
"""Search eBay and read eBay listings without an API key.

  python3 ebay.py search "nintendo switch oled" --max 250 --condition used --free-shipping
  python3 ebay.py search "pyrex 401 bowl" --sold            # what things actually sold for
  python3 ebay.py item https://www.ebay.com/itm/1234567890
  python3 ebay.py url "lego 10497" --sort price_low         # just build the link, no fetch
"""

from __future__ import annotations

import argparse
import re
import sys
from urllib.parse import urlencode

from common import (
    FetchError, clean, emit, fail, fetch, first_in_class, group_by_class, json_ld, of_type,
    segments, strip_html, walk,
)

CONDITIONS = {
    "new": "1000",
    "open_box": "1500",
    "refurbished": "2000|2010|2020|2030|2500",
    "used": "3000",
    "for_parts": "7000",
}
SORTS = {"best": "12", "price_low": "15", "price_high": "16", "newest": "10", "ending": "1", "distance": "7"}
LOCATIONS = {"domestic": "1", "north_america": "2", "worldwide": "3"}

NETWORK_HELP = (
    "Code execution can't reach eBay. Tell the user once that direct search needs claude.ai "
    "Settings > Capabilities > 'Allow network egress' with ebay.com added to the allowed domains "
    "(or 'All domains'). Meanwhile use the web_search fallback in SKILL.md and give the user the url above."
)
BLOCKED_HELP = (
    "eBay showed a bot-check to this request. Do not retry in a loop. Use the web_search fallback in "
    "SKILL.md (e.g. query 'site:ebay.com/itm <keywords>'), then web_fetch promising /itm/ result links. "
    "Give the user the url above so they can open the full results themselves."
)


def build_url(args) -> str:
    p: dict[str, str] = {"_nkw": args.query}
    if args.min is not None:
        p["_udlo"] = f"{args.min:g}"
    if args.max is not None:
        p["_udhi"] = f"{args.max:g}"
    if args.condition:
        codes = []
        for c in args.condition.split(","):
            key = c.strip().lower().replace(" ", "_").replace("-", "_")
            if key not in CONDITIONS:
                sys.exit(f"Unknown condition {c!r}; use: {', '.join(CONDITIONS)}")
            codes.append(CONDITIONS[key])
        p["LH_ItemCondition"] = "|".join(codes)
    if args.bin:
        p["LH_BIN"] = "1"
    if args.auction:
        p["LH_Auction"] = "1"
    if args.best_offer:
        p["LH_BO"] = "1"
    if args.free_shipping:
        p["LH_FS"] = "1"
    if args.sold:
        p["LH_Sold"] = "1"
        p["LH_Complete"] = "1"
    if args.location:
        p["LH_PrefLoc"] = LOCATIONS[args.location]
    if args.sort != "best":
        p["_sop"] = SORTS[args.sort]
    if args.page > 1:
        p["_pgn"] = str(args.page)
    p["_ipg"] = "60" if args.limit <= 60 else "120" if args.limit <= 120 else "240"
    return f"https://www.{args.site}/sch/i.html?{urlencode(p)}"


# ------------------------------------------------------------------ search results

_CARD_START = re.compile(r'<li\b[^>]*class="[^"]*\bs-(?:item|card)\b[^"]*"', re.I)
_ITEM_ID = re.compile(r"/itm/(?:[^\"'/?]+/)?(\d{9,15})")
_PRICE = re.compile(r"(?:US \$|C \$|AU \$|\$|£|€|EUR|GBP)\s?\d")
_NOISE = re.compile(
    r"^(opens in a new window or tab|new listing|sponsored|shop on ebay|or best offer|buy it now|"
    r"best offer accepted|\||·|watch|see more like this|new\s?listing)$",
    re.I,
)
_COND = re.compile(
    r"(?i)^(brand new|new|new \(other\)|new with tags|new without tags|new with box|new without box|"
    r"open box|pre-owned|used|refurbished|certified - refurbished|excellent - refurbished|"
    r"very good - refurbished|good - refurbished|seller refurbished|parts only|for parts or not working)\b"
)


def parse_search(html: str, site: str) -> list[dict]:
    starts = [m.start() for m in _CARD_START.finditer(html)] + [len(html)]
    items, seen = [], set()
    for a, b in zip(starts, starts[1:]):
        chunk = html[a:min(b, a + 40000)]
        m = _ITEM_ID.search(chunk)
        if not m or m.group(1) in seen or m.group(1) == "123456":
            continue  # 123456 is eBay's placeholder "Shop on eBay" card
        seen.add(m.group(1))
        doc = segments(chunk)
        segs = doc.segments
        title_ids = {eid for eid, _ in group_by_class(segs, "__title")}
        price_ids = {eid for eid, _ in group_by_class(segs, "__price")}
        title = _clean_title(first_in_class(segs, "__title"))
        if not title:
            alts = [i.get("alt") for i in doc.images if i.get("alt")]
            title = alts[0] if alts else None
        price = first_in_class(segs, "__price")

        rest = [
            t for t, anc in segs
            if not any(eid in title_ids or eid in price_ids for eid, _ in anc) and not _NOISE.match(t)
        ]
        if not price:
            price = next((t for t in rest if _PRICE.match(t)), None)
        item = {
            "title": title,
            "price": price,
            "item_number": m.group(1),
            "url": f"https://www.{site}/itm/{m.group(1)}",
        }
        other = []
        for t in rest:
            low = t.lower()
            if t == price:
                continue
            if "condition" not in item and _COND.match(t) and len(t) < 60:
                item["condition"] = t.split("·")[0].strip(" ·|")
            elif re.match(r"^sold\s+\w{3}\s+\d", low):
                item["sold_date"] = t[4:].strip()
            elif "delivery" in low or "shipping" in low:
                item.setdefault("shipping", t)
            elif "return" in low:
                item.setdefault("returns", t)
            elif re.match(r"^\d+\s+bids?$", low):
                item["bids"] = int(t.split()[0])
            elif re.search(r"\b\d+[dhm]\b.*left|\bleft$", low):
                item["time_left"] = t
            elif re.search(r"\d{2,3}(\.\d)?%", t):
                item.setdefault("seller", t)
            elif low.startswith(("from ", "located in")):
                item["location"] = t
            elif re.match(r"^\d[\d,]*\+? sold$", low) or "watchers" in low or "watching" in low:
                item.setdefault("popularity", t)
            elif len(t) <= 80 and not t.isdigit() and t not in other and t != title:
                other.append(t)
        if other:
            item["other"] = other[:6]
        items.append(clean(item))
    return items


def _clean_title(t: str | None) -> str | None:
    if not t:
        return None
    t = re.sub(r"(?i)^new listing\s*", "", t)
    t = re.sub(r"(?i)\s*opens in a new window or tab$", "", t)
    return t.strip() or None


def _total(html: str) -> str | None:
    text = re.sub(r"<[^>]+>", " ", html)
    m = re.search(r"([\d,]+\+?)\s+results?\s+for", text, re.I)
    return m.group(1) if m else None


# ------------------------------------------------------------------ item page


def parse_item(html: str) -> dict:
    out: dict = {}
    for block in json_ld(html):
        for obj in walk(block):
            if of_type(obj, "Product") and "name" in obj:
                offers = obj.get("offers") or {}
                if isinstance(offers, list):
                    offers = offers[0] if offers else {}
                brand = obj.get("brand")
                out.update(clean({
                    "title": obj.get("name"),
                    "price": " ".join(str(x) for x in (offers.get("price"), offers.get("priceCurrency")) if x),
                    "condition": str(offers.get("itemCondition") or "").rsplit("/", 1)[-1] or None,
                    "availability": str(offers.get("availability") or "").rsplit("/", 1)[-1] or None,
                    "brand": brand.get("name") if isinstance(brand, dict) else brand,
                    "gtin": obj.get("gtin13") or obj.get("gtin12") or obj.get("gtin"),
                    "mpn": obj.get("mpn"),
                    "image": (obj.get("image") or [None])[0] if isinstance(obj.get("image"), list) else obj.get("image"),
                }))
                break

    doc = segments(html)
    segs = doc.segments
    title = first_in_class(segs, "x-item-title__mainTitle")
    if title:
        out["title"] = title
    price = first_in_class(segs, "x-price-primary")
    if price:
        out["price"] = price
    cond = first_in_class(segs, "x-item-condition-text")
    if cond:
        out["condition"] = cond.split("  ")[0].strip()
    seller = first_in_class(segs, "x-sellercard-atf")
    if seller:
        out["seller"] = seller[:250]
    bids = first_in_class(segs, "x-bid-count")
    if bids:
        out["bids"] = bids
    ends = first_in_class(segs, "x-end-time") or first_in_class(segs, "x-timer")
    if ends:
        out["ends"] = ends[:120]
    qty = first_in_class(segs, "x-quantity")
    if qty:
        out["quantity"] = qty[:150]

    labels = group_by_class(segs, "ux-labels-values__labels")
    values = group_by_class(segs, "ux-labels-values__values")
    merged = sorted([(e, "L", t) for e, t in labels] + [(e, "V", t) for e, t in values])
    details: dict[str, str] = {}
    label = None
    for _, kind, text in merged:
        if kind == "L":
            label = text.rstrip(": ").strip()
        elif label and label not in details:
            details[label] = re.sub(r"\s*(See all condition definitions|Read more|See details).*$", "", text)[:400]
            label = None
    if details:
        out["details"] = details

    for tag in re.findall(r"<iframe\b[^>]*>", html, re.I):
        src = re.search(r'src="([^"]+)"', tag)
        if src and ('id="desc_ifr"' in tag or "ebaydesc.com" in src.group(1)):
            out["description_url"] = src.group(1).replace("&amp;", "&")
            break
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("search", "url"):
        s = sub.add_parser(name)
        s.add_argument("query")
        s.add_argument("--min", type=float)
        s.add_argument("--max", type=float)
        s.add_argument("--condition", help="comma list: " + ",".join(CONDITIONS))
        s.add_argument("--bin", action="store_true", help="Buy It Now only")
        s.add_argument("--auction", action="store_true", help="auctions only")
        s.add_argument("--best-offer", action="store_true")
        s.add_argument("--free-shipping", action="store_true")
        s.add_argument("--sold", action="store_true", help="sold listings (real selling prices)")
        s.add_argument("--location", choices=LOCATIONS)
        s.add_argument("--sort", choices=SORTS, default="best")
        s.add_argument("--page", type=int, default=1)
        s.add_argument("--limit", type=int, default=25, help="max results to print")
        s.add_argument("--site", default="ebay.com", help="e.g. ebay.co.uk, ebay.de, ebay.com.au")
    it = sub.add_parser("item")
    it.add_argument("item", help="item URL or item number")
    it.add_argument("--site", default="ebay.com")
    it.add_argument("--no-description", action="store_true")
    args = ap.parse_args()

    if args.cmd == "url":
        emit({"url": build_url(args)})
        return

    if args.cmd == "search":
        url = build_url(args)
        try:
            html = fetch(url)
        except FetchError as e:
            fail(e, url, NETWORK_HELP if e.kind == "network" else BLOCKED_HELP)
        items = parse_search(html, args.site)
        result = clean({"url": url, "total_results": _total(html), "page": args.page})
        result.update(showing=min(len(items), args.limit), items=items[: args.limit])
        if not items:
            result["note"] = ("No listings parsed. Either nothing matched or eBay changed its page layout; "
                              "try the web_search fallback and give the user the url.")
        emit(result)
        return

    m = re.search(r"/itm/(?:[^/?#]+/)?(\d{9,15})", args.item) or re.fullmatch(r"\s*(\d{9,15})\s*", args.item)
    if not m:
        sys.exit("Give an eBay item URL (…/itm/…) or a 9-15 digit item number.")
    url = f"https://www.{args.site}/itm/{m.group(1)}"
    try:
        html = fetch(url)
    except FetchError as e:
        fail(e, url, NETWORK_HELP if e.kind == "network" else
             "eBay refused the request. Try web_fetch on this url instead, or ask the user to paste the page text.")
    item = {"url": url, **parse_item(html)}
    desc_url = item.pop("description_url", None)
    if desc_url and not args.no_description:
        try:
            item["description"] = strip_html(fetch(desc_url))
        except FetchError:
            item["description_url"] = desc_url
    emit(item)


if __name__ == "__main__":
    main()
