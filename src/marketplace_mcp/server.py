"""MCP server exposing eBay and Etsy search/browse tools to an AI assistant."""

from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path
from typing import Annotated, Any, Literal

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from pydantic import Field

from .ebay import EbayClient
from .etsy import EtsyClient

# Load a .env from the working directory, falling back to the project root.
load_dotenv()
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

mcp = FastMCP(
    "marketplace",
    instructions=(
        "Tools for searching and inspecting live listings on eBay and Etsy. "
        "Search first, then use the get_* tools on promising results for full details "
        "(description, postage, returns, seller/shop reputation). Always give the user "
        "the listing URL so they can view or buy it themselves; these tools are read-only "
        "and cannot purchase, bid, or message sellers. Prices are as listed and exclude "
        "import charges on overseas items; check postage before comparing totals. Prices are in GBP "
        "unless the result says otherwise."
    ),
)

_ebay: EbayClient | None = None
_etsy: EtsyClient | None = None


def ebay() -> EbayClient:
    global _ebay
    if _ebay is None:
        cid, secret = os.getenv("EBAY_CLIENT_ID"), os.getenv("EBAY_CLIENT_SECRET")
        if not cid or not secret:
            raise RuntimeError(
                "eBay is not configured: set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET "
                "(see README). Etsy tools may still work."
            )
        _ebay = EbayClient(
            cid,
            secret,
            marketplace=os.getenv("EBAY_MARKETPLACE") or "EBAY_GB",
            env=(os.getenv("EBAY_ENV") or "production").lower(),
            delivery_postcode=os.getenv("EBAY_DELIVERY_POSTCODE") or None,
        )
    return _ebay


def etsy() -> EtsyClient:
    global _etsy
    if _etsy is None:
        key, secret = os.getenv("ETSY_API_KEY"), os.getenv("ETSY_SHARED_SECRET")
        if not key or not secret:
            raise RuntimeError(
                "Etsy is not configured: set ETSY_API_KEY and ETSY_SHARED_SECRET "
                "(see README). eBay tools may still work."
            )
        _etsy = EtsyClient(key, secret)
    return _etsy


EbaySort = Literal["best_match", "price_low", "price_high", "newest", "ending_soon", "distance"]
EbayCondition = Literal["new", "open_box", "refurbished", "used", "for_parts"]
EbayBuying = Literal["buy_it_now", "auction", "best_offer"]
EtsySort = Literal["relevance", "price_low", "price_high", "newest", "recently_updated"]


# ---------------------------------------------------------------- eBay


@mcp.tool()
async def ebay_search(
    query: Annotated[str | None, Field(description="Keywords, e.g. 'nintendo switch oled'")] = None,
    min_price: Annotated[float | None, Field(description="Minimum item price")] = None,
    max_price: Annotated[float | None, Field(description="Maximum item price")] = None,
    condition: Annotated[list[EbayCondition] | None, Field(description="Allowed conditions")] = None,
    buying_options: Annotated[
        list[EbayBuying] | None,
        Field(description="Listing types. eBay returns only Buy It Now by default; include 'auction' to see auctions."),
    ] = None,
    free_shipping: bool = False,
    returns_accepted: bool = False,
    item_location_country: Annotated[
        str | None, Field(description="Two-letter country code where the item is located, e.g. 'GB'")
    ] = None,
    category_id: Annotated[str | None, Field(description="eBay category ID to restrict results")] = None,
    sort: EbaySort = "best_match",
    limit: Annotated[int, Field(ge=1, le=200)] = 20,
    offset: Annotated[int, Field(ge=0, description="For paging: skip this many results")] = 0,
) -> dict[str, Any]:
    """Search live eBay listings. Returns title, price, condition, shipping, seller rating and URL for each."""
    return await ebay().search(
        query=query,
        category_id=category_id,
        min_price=min_price,
        max_price=max_price,
        conditions=list(condition) if condition else None,
        buying_options=list(buying_options) if buying_options else None,
        free_shipping=free_shipping,
        returns_accepted=returns_accepted,
        item_location_country=item_location_country,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@mcp.tool()
async def ebay_get_item(
    item: Annotated[
        str,
        Field(description="An eBay item URL (ebay.co.uk/itm/...), item number, or item_id from ebay_search"),
    ],
) -> dict[str, Any]:
    """Get full details of one eBay listing: description, item specifics, shipping options, returns, seller."""
    return await ebay().get_item(item)


# ---------------------------------------------------------------- Etsy


@mcp.tool()
async def etsy_search(
    query: Annotated[str, Field(description="Keywords, e.g. 'personalized leather wallet'")],
    min_price: Annotated[float | None, Field(description="Minimum price in the shop's currency")] = None,
    max_price: Annotated[float | None, Field(description="Maximum price in the shop's currency")] = None,
    shop_location: Annotated[str | None, Field(description="Shop location filter, e.g. 'United Kingdom'")] = None,
    taxonomy_id: Annotated[int | None, Field(description="Etsy category (taxonomy) ID")] = None,
    sort: EtsySort = "relevance",
    limit: Annotated[int, Field(ge=1, le=100)] = 20,
    offset: Annotated[int, Field(ge=0, description="For paging: skip this many results")] = 0,
) -> dict[str, Any]:
    """Search active Etsy listings. Returns title, price, shop, favorites, image and URL for each."""
    return await etsy().search(
        query=query,
        min_price=min_price,
        max_price=max_price,
        shop_location=shop_location,
        taxonomy_id=taxonomy_id,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@mcp.tool()
async def etsy_get_listing(
    listing: Annotated[str, Field(description="An Etsy listing URL (etsy.com/listing/...) or listing_id")],
) -> dict[str, Any]:
    """Get full details of one Etsy listing: description, tags, materials, shipping, processing time, shop."""
    return await etsy().get_listing(listing)


@mcp.tool()
async def etsy_get_shop(
    shop: Annotated[str, Field(description="Shop name, shop URL (etsy.com/shop/...), or numeric shop_id")],
) -> dict[str, Any]:
    """Look up an Etsy shop's reputation: rating, review count, total sales, location, active listings."""
    return await etsy().get_shop(shop)


@mcp.tool()
async def etsy_shop_listings(
    shop: Annotated[str, Field(description="Shop name, shop URL, or numeric shop_id")],
    query: Annotated[str | None, Field(description="Optional keywords to search within the shop")] = None,
    sort: EtsySort = "newest",
    limit: Annotated[int, Field(ge=1, le=100)] = 25,
    offset: Annotated[int, Field(ge=0)] = 0,
) -> dict[str, Any]:
    """List (or search within) the active listings of one Etsy shop."""
    return await etsy().shop_listings(shop, query=query, sort=sort, limit=limit, offset=offset)


@mcp.tool()
async def etsy_reviews(
    listing: Annotated[str | None, Field(description="Listing URL or id, to get reviews for that item")] = None,
    shop: Annotated[str | None, Field(description="Shop name/URL/id, to get reviews across the shop")] = None,
    limit: Annotated[int, Field(ge=1, le=100)] = 20,
    offset: Annotated[int, Field(ge=0)] = 0,
) -> dict[str, Any]:
    """Read buyer reviews for an Etsy listing or shop (give one of listing or shop)."""
    return await etsy().reviews(listing=listing, shop=shop, limit=limit, offset=offset)


# ---------------------------------------------------------------- both


@mcp.tool()
async def search_both(
    query: Annotated[str, Field(description="Keywords to search on both eBay and Etsy")],
    min_price: float | None = None,
    max_price: float | None = None,
    sort: Literal["relevance", "price_low", "price_high", "newest"] = "relevance",
    limit_each: Annotated[int, Field(ge=1, le=50)] = 10,
) -> dict[str, Any]:
    """Search eBay and Etsy at the same time for comparison shopping. If one site is unavailable, the other's results are still returned."""
    ebay_sort = "best_match" if sort == "relevance" else sort

    async def run(fn):
        try:
            return await fn()
        except Exception as e:  # report per-site failures instead of failing the whole call
            return {"error": str(e)}

    e, t = await asyncio.gather(
        run(lambda: ebay().search(query=query, min_price=min_price, max_price=max_price, sort=ebay_sort, limit=limit_each)),
        run(lambda: etsy().search(query=query, min_price=min_price, max_price=max_price, sort=sort, limit=limit_each)),
    )
    return {"ebay": e, "etsy": t}


def main() -> None:
    parser = argparse.ArgumentParser(description="eBay + Etsy MCP server")
    parser.add_argument(
        "--http",
        action="store_true",
        help="Serve over Streamable HTTP instead of stdio (for clients that connect by URL).",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if args.http:
        mcp.settings.host = args.host
        mcp.settings.port = args.port
        mcp.run(transport="streamable-http")
    else:
        mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
