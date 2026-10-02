"""eBay Browse API client (read-only, application-level OAuth)."""

from __future__ import annotations

import base64
import re
import time
from typing import Any

import httpx

API_SCOPE = "https://api.ebay.com/oauth/api_scope"

HOSTS = {
    "production": "https://api.ebay.com",
    "sandbox": "https://api.sandbox.ebay.com",
}

# Friendly condition names -> eBay condition IDs.
CONDITION_IDS = {
    "new": ["1000"],
    "open_box": ["1500"],
    "refurbished": ["2000", "2010", "2020", "2030", "2500"],
    "used": ["3000", "4000", "5000", "6000"],
    "for_parts": ["7000"],
}

SORTS = {
    "best_match": None,
    "price_low": "price",
    "price_high": "-price",
    "newest": "newlyListed",
    "ending_soon": "endingSoonest",
    "distance": "distance",
}

BUYING_OPTIONS = {
    "buy_it_now": "FIXED_PRICE",
    "auction": "AUCTION",
    "best_offer": "BEST_OFFER",
}

_ITM_URL = re.compile(r"/itm/(?:[^/?#]+/)?(\d{9,15})")


class EbayError(RuntimeError):
    pass


def parse_item_ref(ref: str) -> tuple[str, str]:
    """Return ("rest", id) for a Browse API id like v1|123|0, or ("legacy", id)."""
    ref = ref.strip()
    if ref.startswith("v1|"):
        return "rest", ref
    m = _ITM_URL.search(ref)
    if m:
        return "legacy", m.group(1)
    if ref.isdigit():
        return "legacy", ref
    raise EbayError(
        f"Could not understand eBay item reference {ref!r}. "
        "Pass an item URL, a numeric item number, or a Browse API id (v1|...|0)."
    )


def build_filter(
    min_price: float | None,
    max_price: float | None,
    currency: str | None,
    conditions: list[str] | None,
    buying_options: list[str] | None,
    free_shipping: bool,
    returns_accepted: bool,
    item_location_country: str | None,
) -> str | None:
    parts: list[str] = []
    if min_price is not None or max_price is not None:
        lo = "" if min_price is None else f"{min_price:g}"
        hi = "" if max_price is None else f"{max_price:g}"
        parts.append(f"price:[{lo}..{hi}]")
        if currency:
            parts.append(f"priceCurrency:{currency.upper()}")
    if conditions:
        ids: list[str] = []
        for c in conditions:
            key = c.strip().lower().replace(" ", "_").replace("-", "_")
            if key not in CONDITION_IDS:
                raise EbayError(f"Unknown condition {c!r}. Use one of: {', '.join(CONDITION_IDS)}")
            ids.extend(CONDITION_IDS[key])
        parts.append("conditionIds:{" + "|".join(ids) + "}")
    if buying_options:
        opts = []
        for b in buying_options:
            key = b.strip().lower().replace(" ", "_")
            if key not in BUYING_OPTIONS:
                raise EbayError(f"Unknown buying option {b!r}. Use one of: {', '.join(BUYING_OPTIONS)}")
            opts.append(BUYING_OPTIONS[key])
        parts.append("buyingOptions:{" + "|".join(opts) + "}")
    if free_shipping:
        parts.append("maxDeliveryCost:0")
    if returns_accepted:
        parts.append("returnsAccepted:true")
    if item_location_country:
        parts.append(f"itemLocationCountry:{item_location_country.upper()}")
    return ",".join(parts) or None


def _money(m: dict | None) -> str | None:
    if not m or "value" not in m:
        return None
    return f"{m['value']} {m.get('currency', '')}".strip()


def _shipping(options: list[dict] | None) -> str | None:
    if not options:
        return None
    first = options[0]
    cost = first.get("shippingCost")
    if cost and str(cost.get("value")) in ("0", "0.0", "0.00"):
        return "Free"
    return _money(cost) or first.get("shippingCostType")


def summarize_item(it: dict) -> dict[str, Any]:
    seller = it.get("seller") or {}
    out = {
        "item_id": it.get("itemId"),
        "title": it.get("title"),
        "price": _money(it.get("price")),
        "current_bid": _money(it.get("currentBidPrice")),
        "bid_count": it.get("bidCount"),
        "buying_options": it.get("buyingOptions"),
        "condition": it.get("condition"),
        "shipping": _shipping(it.get("shippingOptions")),
        "location": ", ".join(
            v for v in ((it.get("itemLocation") or {}).get(k) for k in ("city", "stateOrProvince", "country")) if v
        )
        or None,
        "seller": seller.get("username"),
        "seller_feedback_pct": seller.get("feedbackPercentage"),
        "seller_feedback_score": seller.get("feedbackScore"),
        "ends": it.get("itemEndDate"),
        "image": (it.get("image") or {}).get("imageUrl"),
        "url": it.get("itemWebUrl"),
    }
    return {k: v for k, v in out.items() if v not in (None, [], "")}


def detail_item(it: dict) -> dict[str, Any]:
    out = summarize_item(it)
    ret = it.get("returnTerms") or {}
    extra = {
        "subtitle": it.get("subtitle"),
        "brand": it.get("brand"),
        "condition_description": it.get("conditionDescription"),
        "quantity_available": (it.get("estimatedAvailabilities") or [{}])[0].get("estimatedAvailableQuantity"),
        "quantity_sold": (it.get("estimatedAvailabilities") or [{}])[0].get("estimatedSoldQuantity"),
        "category": it.get("categoryPath"),
        "returns": (
            f"{ret.get('returnPeriod', {}).get('value', '?')} {ret.get('returnPeriod', {}).get('unit', '').lower()}"
            f", paid by {ret.get('returnShippingCostPayer', '?').lower()}"
            if ret.get("returnsAccepted")
            else ("No returns" if ret else None)
        ),
        "item_specifics": {a["name"]: a.get("value") for a in it.get("localizedAspects") or [] if "name" in a},
        "description": _strip_html(it.get("description") or it.get("shortDescription") or "")[:4000] or None,
        "additional_images": [i.get("imageUrl") for i in it.get("additionalImages") or []][:10],
        "shipping_options": [
            {
                "service": s.get("shippingServiceCode"),
                "cost": _money(s.get("shippingCost")),
                "min_delivery": s.get("minEstimatedDeliveryDate"),
                "max_delivery": s.get("maxEstimatedDeliveryDate"),
            }
            for s in it.get("shippingOptions") or []
        ],
    }
    out.update({k: v for k, v in extra.items() if v not in (None, [], {}, "")})
    return out


def _strip_html(s: str) -> str:
    s = re.sub(r"(?is)<(script|style).*?</\1>", " ", s)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    s = re.sub(r"&nbsp;", " ", s)
    s = re.sub(r"&amp;", "&", s)
    return re.sub(r"\s+", " ", s).strip()


class EbayClient:
    def __init__(
        self,
        client_id: str,
        client_secret: str,
        marketplace: str = "EBAY_GB",
        env: str = "production",
        delivery_postcode: str | None = None,
        http: httpx.AsyncClient | None = None,
    ):
        if env not in HOSTS:
            raise EbayError(f"EBAY_ENV must be 'production' or 'sandbox', got {env!r}")
        self.client_id = client_id
        self.client_secret = client_secret
        self.marketplace = marketplace
        self.delivery_postcode = delivery_postcode
        self.base = HOSTS[env]
        self.http = http or httpx.AsyncClient(timeout=30)
        self._token: str | None = None
        self._token_expiry = 0.0

    async def _get_token(self) -> str:
        if self._token and time.time() < self._token_expiry - 60:
            return self._token
        basic = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        r = await self.http.post(
            f"{self.base}/identity/v1/oauth2/token",
            headers={"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"},
            data={"grant_type": "client_credentials", "scope": API_SCOPE},
        )
        if r.status_code != 200:
            raise EbayError(f"eBay auth failed ({r.status_code}): {r.text[:300]}. Check EBAY_CLIENT_ID/SECRET.")
        body = r.json()
        self._token = body["access_token"]
        self._token_expiry = time.time() + int(body.get("expires_in", 7200))
        return self._token

    async def _get(self, path: str, params: dict | None = None) -> dict:
        headers = {
            "Authorization": f"Bearer {await self._get_token()}",
            "X-EBAY-C-MARKETPLACE-ID": self.marketplace,
            "Accept": "application/json",
        }
        if self.delivery_postcode:
            country = self.marketplace.split("_", 1)[-1]
            loc = _quote(f"country={country},zip={self.delivery_postcode.replace(' ', '')}")
            headers["X-EBAY-C-ENDUSERCTX"] = f"contextualLocation={loc}"
        r = await self.http.get(f"{self.base}{path}", params=params, headers=headers)
        if r.status_code == 401:
            self._token = None
        if r.status_code >= 400:
            try:
                errs = r.json().get("errors", [])
                msg = "; ".join(e.get("longMessage") or e.get("message", "") for e in errs) or r.text[:300]
            except ValueError:
                msg = r.text[:300]
            raise EbayError(f"eBay API error {r.status_code}: {msg}")
        return r.json()

    async def search(
        self,
        query: str | None = None,
        category_id: str | None = None,
        min_price: float | None = None,
        max_price: float | None = None,
        conditions: list[str] | None = None,
        buying_options: list[str] | None = None,
        free_shipping: bool = False,
        returns_accepted: bool = False,
        item_location_country: str | None = None,
        sort: str = "best_match",
        limit: int = 20,
        offset: int = 0,
        currency: str | None = None,
    ) -> dict[str, Any]:
        if not query and not category_id:
            raise EbayError("Provide a search query and/or a category_id.")
        if sort not in SORTS:
            raise EbayError(f"Unknown sort {sort!r}. Use one of: {', '.join(SORTS)}")
        params: dict[str, Any] = {"limit": max(1, min(limit, 200)), "offset": max(0, offset)}
        if query:
            params["q"] = query
        if category_id:
            params["category_ids"] = category_id
        if SORTS[sort]:
            params["sort"] = SORTS[sort]
        flt = build_filter(
            min_price, max_price, currency or _default_currency(self.marketplace), conditions,
            buying_options, free_shipping, returns_accepted, item_location_country,
        )
        if flt:
            params["filter"] = flt
        data = await self._get("/buy/browse/v1/item_summary/search", params)
        items = [summarize_item(i) for i in data.get("itemSummaries") or []]
        return {
            "marketplace": self.marketplace,
            "total_matches": data.get("total", 0),
            "offset": data.get("offset", offset),
            "returned": len(items),
            "items": items,
        }

    async def get_item(self, ref: str) -> dict[str, Any]:
        kind, ident = parse_item_ref(ref)
        if kind == "rest":
            data = await self._get(f"/buy/browse/v1/item/{_quote(ident)}")
        else:
            try:
                data = await self._get(
                    "/buy/browse/v1/item/get_item_by_legacy_id", {"legacy_item_id": ident}
                )
            except EbayError as original:
                # Multi-variation listings (sizes/colors) can't be fetched by legacy id;
                # their listing number doubles as the item group id.
                try:
                    group = await self._get(
                        "/buy/browse/v1/item/get_items_by_item_group", {"item_group_id": ident}
                    )
                except EbayError:
                    raise original from None
                return {
                    "note": "This listing has multiple variations (sizes/colors/etc.); each is listed below.",
                    "variations": [detail_item(i) for i in group.get("items") or []],
                }
        return detail_item(data)


def _quote(s: str) -> str:
    from urllib.parse import quote

    return quote(s, safe="")


def _default_currency(marketplace: str) -> str | None:
    return {
        "EBAY_US": "USD", "EBAY_GB": "GBP", "EBAY_DE": "EUR", "EBAY_FR": "EUR", "EBAY_IT": "EUR",
        "EBAY_ES": "EUR", "EBAY_AT": "EUR", "EBAY_IE": "EUR", "EBAY_NL": "EUR", "EBAY_BE": "EUR",
        "EBAY_AU": "AUD", "EBAY_CA": "CAD", "EBAY_CH": "CHF", "EBAY_PL": "PLN", "EBAY_HK": "HKD",
        "EBAY_SG": "SGD",
    }.get(marketplace)
