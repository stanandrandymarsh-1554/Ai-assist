import asyncio
import json

import httpx
import pytest

from marketplace_mcp import ebay as eb
from marketplace_mcp import etsy as et


def run(coro):
    return asyncio.run(coro)


# ------------------------------------------------------------------ eBay


def test_parse_item_ref():
    assert eb.parse_item_ref("v1|1234567890|0") == ("rest", "v1|1234567890|0")
    assert eb.parse_item_ref("https://www.ebay.com/itm/Some-Title/1234567890?hash=x") == ("legacy", "1234567890")
    assert eb.parse_item_ref("https://www.ebay.com/itm/123456789012") == ("legacy", "123456789012")
    assert eb.parse_item_ref("123456789012") == ("legacy", "123456789012")
    with pytest.raises(eb.EbayError):
        eb.parse_item_ref("not an item")


def test_build_filter():
    f = eb.build_filter(10, 50, "usd", ["new", "used"], ["auction"], True, True, "us")
    assert f == (
        "price:[10..50],priceCurrency:USD,conditionIds:{1000|3000|4000|5000|6000},"
        "buyingOptions:{AUCTION},maxDeliveryCost:0,returnsAccepted:true,itemLocationCountry:US"
    )
    assert eb.build_filter(None, 20, None, None, None, False, False, None) == "price:[..20]"
    assert eb.build_filter(None, None, "USD", None, None, False, False, None) is None
    with pytest.raises(eb.EbayError):
        eb.build_filter(None, None, None, ["mint"], None, False, False, None)


def ebay_transport(calls):
    def handler(req: httpx.Request):
        calls.append(req)
        if req.url.path == "/identity/v1/oauth2/token":
            assert req.headers["Authorization"].startswith("Basic ")
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 7200})
        assert req.headers["Authorization"] == "Bearer tok"
        assert req.headers["X-EBAY-C-MARKETPLACE-ID"] == "EBAY_US"
        if req.url.path == "/buy/browse/v1/item_summary/search":
            return httpx.Response(200, json={
                "total": 1, "offset": 0,
                "itemSummaries": [{
                    "itemId": "v1|111|0", "title": "Switch OLED",
                    "price": {"value": "249.99", "currency": "USD"},
                    "condition": "Used", "buyingOptions": ["FIXED_PRICE"],
                    "shippingOptions": [{"shippingCost": {"value": "0.00", "currency": "USD"}}],
                    "seller": {"username": "bob", "feedbackPercentage": "99.8", "feedbackScore": 1200},
                    "itemLocation": {"stateOrProvince": "CA", "country": "US"},
                    "itemWebUrl": "https://www.ebay.com/itm/111",
                }],
            })
        if req.url.path == "/buy/browse/v1/item/get_item_by_legacy_id":
            if req.url.params["legacy_item_id"] == "222222222222":
                return httpx.Response(400, json={"errors": [{"errorId": 11006, "longMessage": "item group"}]})
            return httpx.Response(200, json={
                "itemId": "v1|111|0", "title": "Switch OLED",
                "price": {"value": "249.99", "currency": "USD"},
                "description": "<p>Great <b>condition</b>&nbsp;box included</p>",
                "localizedAspects": [{"name": "Color", "value": "White"}],
                "returnTerms": {"returnsAccepted": True, "returnPeriod": {"value": 30, "unit": "DAY"},
                                "returnShippingCostPayer": "BUYER"},
            })
        if req.url.path == "/buy/browse/v1/item/get_items_by_item_group":
            return httpx.Response(200, json={"items": [{"itemId": "v1|222|1", "title": "Shirt S"},
                                                       {"itemId": "v1|222|2", "title": "Shirt M"}]})
        return httpx.Response(404, json={"errors": [{"message": "nope"}]})
    return httpx.MockTransport(handler)


def test_ebay_search_and_detail():
    calls = []
    c = eb.EbayClient("id", "secret", http=httpx.AsyncClient(transport=ebay_transport(calls)))
    res = run(c.search("switch", max_price=300, conditions=["used"], sort="price_low", limit=5))
    search_req = calls[1]
    assert search_req.url.params["q"] == "switch"
    assert search_req.url.params["sort"] == "price"
    assert search_req.url.params["filter"].startswith("price:[..300],priceCurrency:USD,conditionIds:{3000")
    item = res["items"][0]
    assert res["total_matches"] == 1
    assert item["price"] == "249.99 USD"
    assert item["shipping"] == "Free"
    assert item["location"] == "CA, US"

    d = run(c.get_item("https://www.ebay.com/itm/111111111111"))
    assert d["description"] == "Great condition box included"
    assert d["item_specifics"] == {"Color": "White"}
    assert d["returns"] == "30 day, paid by buyer"
    # token reused, not re-fetched
    assert sum(1 for r in calls if r.url.path.endswith("/token")) == 1

    g = run(c.get_item("222222222222"))
    assert [v["title"] for v in g["variations"]] == ["Shirt S", "Shirt M"]


def test_ebay_requires_query_or_category():
    c = eb.EbayClient("id", "secret", http=httpx.AsyncClient(transport=ebay_transport([])))
    with pytest.raises(eb.EbayError):
        run(c.search())


# ------------------------------------------------------------------ Etsy


def test_etsy_refs_and_money():
    assert et.parse_listing_ref("https://www.etsy.com/listing/123456/cool-mug?ref=x") == 123456
    assert et.parse_listing_ref(42) == 42
    assert et.parse_shop_ref("https://www.etsy.com/shop/MugMaker?ref=x") == "MugMaker"
    assert et.money({"amount": 1999, "divisor": 100, "currency_code": "USD"}) == "19.99 USD"


def etsy_transport(calls):
    listing = {
        "listing_id": 1, "title": "Mug", "shop_id": 9, "num_favorers": 5, "who_made": "i_did",
        "price": {"amount": 2500, "divisor": 100, "currency_code": "USD"},
        "url": "https://www.etsy.com/listing/1/mug?utm_source=api",
    }

    def handler(req: httpx.Request):
        calls.append(req)
        if req.headers["x-api-key"] != "key:secret":
            return httpx.Response(403, json={"error": "Shared secret is required"})
        p = req.url.path.removeprefix("/v3/application")
        if p == "/listings/active":
            return httpx.Response(200, json={"count": 1, "results": [dict(listing)]})
        if p == "/listings/batch":
            return httpx.Response(200, json={"results": [dict(listing, images=[{"url_570xN": "img.jpg"}],
                                                              shop={"shop_name": "MugMaker"})]})
        if p == "/listings/1":
            return httpx.Response(200, json=dict(
                listing, description="Handmade", tags=["mug"],
                shop={"shop_id": 9, "shop_name": "MugMaker", "review_average": 4.9, "review_count": 10},
                shipping_profile={"shipping_profile_destinations": [
                    {"destination_country_iso": "US", "primary_cost": {"amount": 500, "divisor": 100,
                     "currency_code": "USD"}, "min_delivery_days": 3, "max_delivery_days": 5}]},
            ))
        if p == "/shops":
            return httpx.Response(200, json={"results": [{"shop_id": 8, "shop_name": "MugMakerX"},
                                                         {"shop_id": 9, "shop_name": "MugMaker"}]})
        if p == "/shops/9/reviews":
            return httpx.Response(200, json={"count": 2, "results": [{"rating": 5, "review": "Love it"},
                                                                     {"rating": 4, "review": ""}]})
        if p == "/shops/9/listings/active":
            return httpx.Response(200, json={"count": 1, "results": [dict(listing)]})
        return httpx.Response(403, json={"error": "Shared secret is required"})
    return httpx.MockTransport(handler)


def test_etsy_flow():
    calls = []
    c = et.EtsyClient("key", "secret", http=httpx.AsyncClient(transport=etsy_transport(calls)))

    res = run(c.search("mug", max_price=30, sort="price_low"))
    assert calls[0].url.params["sort_on"] == "price"
    assert calls[0].url.params["sort_order"] == "asc"
    assert "min_price" not in calls[0].url.params
    item = res["items"][0]
    assert item == {
        "listing_id": 1, "title": "Mug", "price": "25.00 USD", "shop_id": 9, "shop_name": "MugMaker",
        "favorites": 5, "made_by": "i_did", "image": "img.jpg", "url": "https://www.etsy.com/listing/1/mug",
    }

    d = run(c.get_listing("https://www.etsy.com/listing/1/mug"))
    assert d["shop"]["rating"] == 4.9
    assert d["shipping"] == [{"to": "US", "cost": "5.00 USD", "each_additional": None, "delivery_days": "3-5"}]

    assert run(c.get_shop("MugMaker"))["shop_id"] == 9  # exact name match wins

    r = run(c.reviews(shop="MugMaker"))
    assert r["average_of_returned"] == 4.5
    assert r["reviews"][1] == {"rating": 4}

    sl = run(c.shop_listings("9", sort="relevance"))
    assert calls[-2].url.params["sort_on"] == "created"
    assert sl["returned"] == 1


def test_etsy_error_message():
    c = et.EtsyClient("key", "wrong", http=httpx.AsyncClient(transport=etsy_transport([])))
    with pytest.raises(et.EtsyError, match="Shared secret is required.*ETSY_SHARED_SECRET"):
        run(c.search("mug"))
