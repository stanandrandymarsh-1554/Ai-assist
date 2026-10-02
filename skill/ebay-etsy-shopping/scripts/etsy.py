#!/usr/bin/env python3
"""Search Etsy and read Etsy listings/shops without an API key.

Etsy often blocks automated requests; when it does this prints ok:false with the
search link and the web_search fallback to use instead.

  python3 etsy.py search "personalized leather wallet" --max 60 --sort top_reviews
  python3 etsy.py listing https://www.etsy.com/uk/listing/123456789/some-title
  python3 etsy.py shop MugMaker
  python3 etsy.py url "ceramic mug" --free-postage                 # just build the link

Defaults to Etsy UK (etsy.com/uk, items that deliver to GB). Use --region us for Etsy US.
"""

from __future__ import annotations

import argparse
import re
import sys
from html import unescape
from urllib.parse import quote, urlencode

from common import FetchError, clean, emit, fail, fetch, json_ld, of_type, segments, strip_html, walk

REGIONS = {"uk": ("/uk", "GB"), "us": ("", "US")}  # path prefix, default ship_to country

SORTS = {
    "relevance": "most_relevant",
    "price_low": "price_asc",
    "price_high": "price_desc",
    "newest": "most_recent",
    "top_reviews": "highest_reviews",
}

NETWORK_HELP = (
    "Code execution can't reach Etsy. Tell the user once that direct search needs claude.ai "
    "Settings > Capabilities > 'Allow network egress' with www.etsy.com added to the allowed domains "
    "(or 'All domains'). Meanwhile use the web_search fallback in SKILL.md and give the user the url above."
)
BLOCKED_HELP = (
    "Etsy blocks automated requests (bot-check). Do not retry. Use the web_search fallback in SKILL.md "
    "(e.g. query 'site:etsy.com/listing <keywords>'), then web_fetch promising listing links from the results. "
    "Give the user the url above so they can open the full, filtered results themselves."
)


def build_url(args) -> str:
    p: dict[str, str] = {"q": args.query}
    if args.min is not None or args.max is not None:
        p["explicit"] = "1"
        if args.min is not None:
            p["min"] = f"{args.min:g}"
        if args.max is not None:
            p["max"] = f"{args.max:g}"
    if args.sort != "relevance":
        p["order"] = SORTS[args.sort]
    for flag, key in (("free_shipping", "free_shipping"), ("handmade", "is_handmade"), ("vintage", "is_vintage"),
                      ("personalizable", "is_personalizable"), ("on_sale", "is_discounted")):
        if getattr(args, flag):
            p[key] = "true"
    prefix, country = REGIONS[args.region]
    p["ship_to"] = (args.ship_to or country).upper()
    if args.page > 1:
        p["page"] = str(args.page)
    return f"https://www.etsy.com{prefix}/search?{urlencode(p)}"


def _price(offers) -> str | None:
    if isinstance(offers, list):
        offers = offers[0] if offers else None
    if not isinstance(offers, dict):
        return None
    cur = offers.get("priceCurrency") or ""
    if offers.get("price") is not None:
        return f"{offers['price']} {cur}".strip()
    lo, hi = offers.get("lowPrice"), offers.get("highPrice")
    if lo is not None:
        return (f"{lo}–{hi} {cur}" if hi not in (None, lo) else f"{lo} {cur}").strip()
    return None


def _name(x) -> str | None:
    return x.get("name") if isinstance(x, dict) else x


def _rating(x) -> dict | None:
    if not isinstance(x, dict):
        return None
    return clean({"stars": x.get("ratingValue"), "reviews": x.get("reviewCount") or x.get("ratingCount")})


def _listing_url(u: str | None) -> str | None:
    return u.split("?", 1)[0] if u else u


def product_summary(obj: dict) -> dict:
    img = obj.get("image")
    if isinstance(img, list):
        img = img[0] if img else None
    if isinstance(img, dict):
        img = img.get("contentURL") or img.get("url")
    return clean({
        "title": obj.get("name"),
        "price": _price(obj.get("offers")),
        "shop": _name(obj.get("brand")),
        "rating": _rating(obj.get("aggregateRating")),
        "url": _listing_url(obj.get("url")),
        "image": img,
    })


_LISTING_TAG = re.compile(r'<a\b[^>]*href="(https://www\.etsy\.com/(?:[a-z-]+/)?listing/(\d+)/[^"?#]*)[^"]*"[^>]*>', re.I)


def parse_search(html: str) -> list[dict]:
    items, seen = [], set()
    for block in json_ld(html):
        for obj in walk(block):
            if of_type(obj, "Product") and obj.get("url"):
                s = product_summary(obj)
                if s.get("url") not in seen:
                    seen.add(s.get("url"))
                    items.append(s)
    if items:
        return items
    # Fallback: listing links on the page.
    for m in _LISTING_TAG.finditer(html):
        if m.group(2) in seen:
            continue
        seen.add(m.group(2))
        title = re.search(r'\btitle="([^"]*)"', m.group(0))
        items.append(clean({"title": unescape(title.group(1)).strip() if title else None, "url": m.group(1)}))
    return items


def parse_listing(html: str) -> dict:
    out: dict = {}
    for block in json_ld(html):
        for obj in walk(block):
            if of_type(obj, "Product") and "name" in obj:
                out.update(product_summary(obj))
                out.update(clean({
                    "description": strip_html(obj.get("description") or "", 3000),
                    "material": obj.get("material"),
                    "category": obj.get("category"),
                    "reviews": [
                        clean({
                            "stars": (r.get("reviewRating") or {}).get("ratingValue"),
                            "text": (r.get("reviewBody") or "")[:400],
                            "date": r.get("datePublished"),
                        })
                        for r in (obj.get("review") or [])[:8]
                        if isinstance(r, dict)
                    ],
                }))
                break
    if "title" not in out:
        m = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.S)
        if m:
            out["title"] = strip_html(m.group(1), 300)
    text = " ".join(t for t, _ in segments(html).segments)
    for label, pat in (
        ("sales", r"([\d,.]+k?)\s+sales"),
        ("ships_from", r"Ships from\s+([A-Z][^.|]{2,40}?)(?:\s{2}|\.|$)"),
        ("arrives", r"(?:Arrives soon!|Order today to get by|Arrives by)\s*([A-Z][a-z]{2}[^.]{0,30})"),
        ("returns", r"(Returns? (?:& exchanges )?(?:accepted|not accepted)[^.]{0,60})"),
        ("stock", r"(Only \d+ left|In demand\.[^.]{0,60}|\d+ people have this in their cart)"),
    ):
        m = re.search(pat, text, re.I)
        if m:
            out[label] = m.group(1).strip()
    return out


def parse_shop(html: str) -> dict:
    out: dict = {}
    for block in json_ld(html):
        for obj in walk(block):
            if (of_type(obj, "Organization") or of_type(obj, "Store") or of_type(obj, "LocalBusiness")) and obj.get("name"):
                out.update(clean({"name": obj.get("name"), "rating": _rating(obj.get("aggregateRating")),
                                  "description": strip_html(obj.get("description") or "", 800)}))
                break
    out["listings"] = parse_search(html)[:24]
    text = " ".join(t for t, _ in segments(html).segments)
    for label, pat in (("sales", r"([\d,.]+k?)\s+sales"), ("on_etsy_since", r"On Etsy since\s+(\d{4})"),
                       ("location", r"Sales\s*[\d,.]+k?\s*(?:\|)?\s*([A-Z][\w .,'-]{2,40}?)\s{2}")):
        m = re.search(pat, text, re.I)
        if m:
            out[label] = m.group(1).strip()
    return clean(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("search", "url"):
        s = sub.add_parser(name)
        s.add_argument("query")
        s.add_argument("--min", type=float)
        s.add_argument("--max", type=float)
        s.add_argument("--sort", choices=SORTS, default="relevance")
        s.add_argument("--free-postage", "--free-shipping", dest="free_shipping", action="store_true")
        s.add_argument("--ship-to", help="two-letter country code to deliver to (default: GB for uk, US for us)")
        s.add_argument("--handmade", action="store_true")
        s.add_argument("--vintage", action="store_true")
        s.add_argument("--personalizable", action="store_true")
        s.add_argument("--on-sale", action="store_true")
        s.add_argument("--page", type=int, default=1)
        s.add_argument("--limit", type=int, default=25)
    li = sub.add_parser("listing")
    li.add_argument("listing", help="listing URL or numeric listing id")
    sh = sub.add_parser("shop")
    sh.add_argument("shop", help="shop name or shop URL")
    for p in sub.choices.values():
        p.add_argument("--region", choices=REGIONS, default="uk", help="uk (default) or us")
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
        items = parse_search(html)
        emit({"url": url, "page": args.page, "showing": min(len(items), args.limit), "items": items[: args.limit]})
        return

    if args.cmd == "listing":
        m = re.search(r"/listing/(\d+)", args.listing) or re.fullmatch(r"\s*(\d+)\s*", args.listing)
        if not m:
            sys.exit("Give an Etsy listing URL (…/listing/…) or a numeric listing id.")
        url = f"https://www.etsy.com{REGIONS[args.region][0]}/listing/{m.group(1)}"
        try:
            html = fetch(url)
        except FetchError as e:
            fail(e, url, NETWORK_HELP if e.kind == "network" else
                 "Etsy blocked the request. Use web_fetch on this url (it came from search results or the user), "
                 "or ask the user to paste the listing text.")
        emit({"url": url, **parse_listing(html)})
        return

    m = re.search(r"/shop/([A-Za-z0-9_-]+)", args.shop)
    name = m.group(1) if m else args.shop.strip()
    url = f"https://www.etsy.com{REGIONS[args.region][0]}/shop/{quote(name)}"
    try:
        html = fetch(url)
    except FetchError as e:
        fail(e, url, NETWORK_HELP if e.kind == "network" else
             "Etsy blocked the request. Use web_search for '<shop name> etsy shop reviews' and web_fetch the shop page.")
    emit({"url": url, **parse_shop(html)})


if __name__ == "__main__":
    main()
