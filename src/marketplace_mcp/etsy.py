"""Etsy Open API v3 client (read-only, API-key access to public data)."""

from __future__ import annotations

import re
from typing import Any

import httpx

BASE = "https://openapi.etsy.com/v3/application"

SORTS = {
    "relevance": ("score", "desc"),
    "price_low": ("price", "asc"),
    "price_high": ("price", "desc"),
    "newest": ("created", "desc"),
    "recently_updated": ("updated", "desc"),
}

_LISTING_URL = re.compile(r"/listing/(\d+)")
_SHOP_URL = re.compile(r"/shop/([A-Za-z0-9_-]+)")


class EtsyError(RuntimeError):
    pass


def parse_listing_ref(ref: str | int) -> int:
    s = str(ref).strip()
    if s.isdigit():
        return int(s)
    m = _LISTING_URL.search(s)
    if m:
        return int(m.group(1))
    raise EtsyError(f"Could not understand Etsy listing reference {ref!r}. Pass a listing URL or numeric id.")


def parse_shop_ref(ref: str | int) -> str:
    s = str(ref).strip()
    m = _SHOP_URL.search(s)
    return m.group(1) if m else s


def money(p: dict | None) -> str | None:
    if not p or p.get("amount") is None:
        return None
    divisor = p.get("divisor") or 1
    return f"{p['amount'] / divisor:.2f} {p.get('currency_code', '')}".strip()


def summarize_listing(li: dict) -> dict[str, Any]:
    images = li.get("images") or []
    shop = li.get("shop") or {}
    out = {
        "listing_id": li.get("listing_id"),
        "title": li.get("title"),
        "price": money(li.get("price")),
        "quantity": li.get("quantity"),
        "shop_id": li.get("shop_id"),
        "shop_name": shop.get("shop_name"),
        "favorites": li.get("num_favorers"),
        "made_by": li.get("who_made"),
        "when_made": li.get("when_made"),
        "personalizable": li.get("is_personalizable") or None,
        "has_variations": li.get("has_variations") or None,
        "image": images[0].get("url_570xN") if images else None,
        "url": _clean_url(li.get("url")),
    }
    return {k: v for k, v in out.items() if v not in (None, [], "")}


def detail_listing(li: dict) -> dict[str, Any]:
    out = summarize_listing(li)
    shop = li.get("shop") or {}
    extra = {
        "description": (li.get("description") or "")[:4000] or None,
        "tags": li.get("tags"),
        "materials": li.get("materials"),
        "processing_days": _range(li.get("processing_min"), li.get("processing_max")),
        "item_dimensions": _dims(li),
        "shipping": _shipping(li.get("shipping_profile")),
        "shop": summarize_shop(shop) if shop else None,
        "images": [i.get("url_fullxfull") for i in li.get("images") or []][:10],
    }
    out.update({k: v for k, v in extra.items() if v not in (None, [], {}, "")})
    return out


def summarize_shop(s: dict) -> dict[str, Any]:
    out = {
        "shop_id": s.get("shop_id"),
        "shop_name": s.get("shop_name"),
        "title": s.get("title"),
        "rating": s.get("review_average"),
        "review_count": s.get("review_count"),
        "sales": s.get("transaction_sold_count"),
        "active_listings": s.get("listing_active_count"),
        "favorites": s.get("num_favorers"),
        "country": s.get("shop_location_country_iso"),
        "on_vacation": s.get("is_vacation") or None,
        "url": _clean_url(s.get("url")),
    }
    return {k: v for k, v in out.items() if v not in (None, [], "")}


def _clean_url(url: str | None) -> str | None:
    # Etsy appends tracking params (?utm_source=...); drop them.
    return url.split("?", 1)[0] if url else url


def _range(lo: Any, hi: Any) -> str | None:
    if lo is None and hi is None:
        return None
    return str(lo) if lo == hi or hi is None else f"{lo}-{hi}"


def _dims(li: dict) -> str | None:
    dims = [li.get(k) for k in ("item_length", "item_width", "item_height")]
    if not any(dims):
        return None
    unit = li.get("item_dimensions_unit") or ""
    return " x ".join(str(d or "?") for d in dims) + f" {unit}".rstrip()


def _shipping(profile: dict | None) -> list[dict] | None:
    if not profile:
        return None
    out = []
    for d in profile.get("shipping_profile_destinations") or []:
        out.append(
            {
                "to": d.get("destination_country_iso") or d.get("destination_region") or "everywhere else",
                "cost": money(d.get("primary_cost")),
                "each_additional": money(d.get("secondary_cost")),
                "delivery_days": _range(d.get("min_delivery_days"), d.get("max_delivery_days")),
            }
        )
    return out or None


class EtsyClient:
    def __init__(self, api_key: str, shared_secret: str, http: httpx.AsyncClient | None = None):
        self.api_key_header = f"{api_key}:{shared_secret}"
        self.http = http or httpx.AsyncClient(timeout=30)

    async def _get(self, path: str, params: dict | None = None) -> dict:
        r = await self.http.get(
            f"{BASE}{path}",
            params={k: v for k, v in (params or {}).items() if v is not None},
            headers={"x-api-key": self.api_key_header, "Accept": "application/json"},
        )
        if r.status_code >= 400:
            try:
                body = r.json()
                msg = body.get("error_description") or body.get("error") or r.text[:300]
            except ValueError:
                msg = r.text[:300]
            hint = " Check ETSY_API_KEY and ETSY_SHARED_SECRET." if r.status_code in (401, 403) else ""
            raise EtsyError(f"Etsy API error {r.status_code}: {msg}.{hint}")
        return r.json()

    async def _enrich(self, listings: list[dict]) -> None:
        """Etsy search results lack shop names and images; fetch them in one batch call."""
        ids = [str(li["listing_id"]) for li in listings if "listing_id" in li]
        if not ids:
            return
        data = await self._get(
            "/listings/batch", {"listing_ids": ",".join(ids[:100]), "includes": "Images,Shop"}
        )
        enriched = {li["listing_id"]: li for li in data.get("results") or []}
        for li in listings:
            extra = enriched.get(li.get("listing_id"))
            if extra:
                li.setdefault("images", extra.get("images"))
                li.setdefault("shop", extra.get("shop"))

    async def search(
        self,
        query: str,
        min_price: float | None = None,
        max_price: float | None = None,
        shop_location: str | None = None,
        taxonomy_id: int | None = None,
        sort: str = "relevance",
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        if sort not in SORTS:
            raise EtsyError(f"Unknown sort {sort!r}. Use one of: {', '.join(SORTS)}")
        sort_on, sort_order = SORTS[sort]
        data = await self._get(
            "/listings/active",
            {
                "keywords": query,
                "min_price": min_price,
                "max_price": max_price,
                "shop_location": shop_location,
                "taxonomy_id": taxonomy_id,
                "sort_on": sort_on,
                "sort_order": sort_order,
                "limit": max(1, min(limit, 100)),
                "offset": max(0, offset),
            },
        )
        results = data.get("results") or []
        try:
            await self._enrich(results)
        except EtsyError:
            pass  # enrichment is best-effort
        items = [summarize_listing(li) for li in results]
        return {"total_matches": data.get("count", 0), "offset": offset, "returned": len(items), "items": items}

    async def get_listing(self, ref: str | int) -> dict[str, Any]:
        listing_id = parse_listing_ref(ref)
        data = await self._get(f"/listings/{listing_id}", {"includes": "Images,Shop,Shipping"})
        return detail_listing(data)

    async def get_shop(self, ref: str | int) -> dict[str, Any]:
        s = parse_shop_ref(ref)
        if s.isdigit():
            return summarize_shop(await self._get(f"/shops/{s}"))
        data = await self._get("/shops", {"shop_name": s, "limit": 5})
        results = data.get("results") or []
        exact = [r for r in results if (r.get("shop_name") or "").lower() == s.lower()]
        if not (exact or results):
            raise EtsyError(f"No Etsy shop found named {s!r}.")
        return summarize_shop((exact or results)[0])

    async def _shop_id(self, ref: str | int) -> int:
        s = parse_shop_ref(ref)
        if s.isdigit():
            return int(s)
        return (await self.get_shop(s))["shop_id"]

    async def shop_listings(
        self, shop: str | int, query: str | None = None, sort: str = "newest", limit: int = 25, offset: int = 0
    ) -> dict[str, Any]:
        if sort not in SORTS:
            raise EtsyError(f"Unknown sort {sort!r}. Use one of: {', '.join(SORTS)}")
        sort_on, sort_order = SORTS[sort]
        if sort_on == "score":
            sort_on, sort_order = "created", "desc"
        shop_id = await self._shop_id(shop)
        data = await self._get(
            f"/shops/{shop_id}/listings/active",
            {
                "keywords": query,
                "sort_on": sort_on,
                "sort_order": sort_order,
                "limit": max(1, min(limit, 100)),
                "offset": max(0, offset),
            },
        )
        results = data.get("results") or []
        try:
            await self._enrich(results)
        except EtsyError:
            pass
        items = [summarize_listing(li) for li in results]
        return {"shop_id": shop_id, "total_matches": data.get("count", 0), "returned": len(items), "items": items}

    async def reviews(
        self, listing: str | int | None = None, shop: str | int | None = None, limit: int = 20, offset: int = 0
    ) -> dict[str, Any]:
        if listing is not None:
            path = f"/listings/{parse_listing_ref(listing)}/reviews"
        elif shop is not None:
            path = f"/shops/{await self._shop_id(shop)}/reviews"
        else:
            raise EtsyError("Provide either a listing or a shop.")
        data = await self._get(path, {"limit": max(1, min(limit, 100)), "offset": max(0, offset)})
        reviews = [
            {
                k: v
                for k, v in {
                    "rating": r.get("rating"),
                    "text": r.get("review"),
                    "listing_id": r.get("listing_id"),
                    "date": r.get("create_timestamp"),
                    "language": r.get("language"),
                }.items()
                if v not in (None, "")
            }
            for r in data.get("results") or []
        ]
        avg = round(sum(r["rating"] for r in reviews if "rating" in r) / len(reviews), 2) if reviews else None
        return {"total_reviews": data.get("count", 0), "average_of_returned": avg, "reviews": reviews}
