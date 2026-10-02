// A fake eBay Browse API and Etsy Open API that answer like the real ones, for tests.

export const ENV = {
  BRIDGE_TOKEN: "test-token-123",
  EBAY_CLIENT_ID: "id",
  EBAY_CLIENT_SECRET: "secret",
  ETSY_API_KEY: "key",
  ETSY_SHARED_SECRET: "shh",
  EBAY_API_BASE: "https://ebay.test",
  ETSY_API_BASE: "https://etsy.test",
};

// 450 eBay listings: varied price, postage, condition, sellers, a few auctions.
export const EBAY_ITEMS = Array.from({ length: 450 }, (_, i) => ({
  itemId: `v1|${300000000000 + i}|0`,
  title: i % 50 === 7 ? `Nintendo Switch OLED BROKEN for parts ${i}` : `Nintendo Switch OLED White ${i}`,
  price: { value: (100 + (i % 200)).toFixed(2), currency: "GBP" },
  ...(i % 10 === 3 ? { currentBidPrice: { value: "80.00", currency: "GBP" }, bidCount: 4, itemEndDate: "2026-10-05T19:00:00.000Z" } : {}),
  buyingOptions: i % 10 === 3 ? ["AUCTION"] : i % 4 === 0 ? ["FIXED_PRICE", "BEST_OFFER"] : ["FIXED_PRICE"],
  condition: i % 3 ? "Pre-owned" : "New",
  shippingOptions: [i % 2 ? { shippingCostType: "FIXED", shippingCost: { value: "3.99", currency: "GBP" } } : { shippingCostType: "FIXED", shippingCost: { value: "0.00", currency: "GBP" } }],
  seller: { username: `seller${i % 30}`, feedbackPercentage: i % 15 === 0 ? "92.1" : "99.6", feedbackScore: (i % 30) * 40 },
  itemLocation: { city: "Leeds", country: "GB" },
  topRatedBuyingExperience: i % 5 === 0,
  itemWebUrl: `https://www.ebay.co.uk/itm/${300000000000 + i}`,
}));

// 250 Etsy listings across UK shops, mostly GBP, a few USD.
export const ETSY_LISTINGS = Array.from({ length: 250 }, (_, i) => ({
  listing_id: 1000 + i,
  title: `Personalised Leather Dog Collar ${i}`,
  price: { amount: 1500 + (i % 40) * 100, divisor: 100, currency_code: i % 25 === 0 ? "USD" : "GBP" },
  shop_id: 50 + (i % 10),
  num_favorers: i * 3,
  who_made: i % 7 ? "i_did" : "someone_else",
  is_personalizable: i % 2 === 0,
  description: "Hand-stitched collar ".repeat(5),
  tags: ["dog", "collar"],
  processing_min: 1, processing_max: 3,
  url: `https://www.etsy.com/listing/${1000 + i}/collar?utm_source=x`,
}));
const shop = (id) => ({ shop_id: id, shop_name: `CollarShop${id}`, review_average: 4.5 + (id % 5) / 10, review_count: id * 10, transaction_sold_count: id * 100, shop_location_country_iso: "GB", url: `https://www.etsy.com/shop/CollarShop${id}?ref=x` });

export function fakeFetch(log = []) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    log.push(url);
    const headers = new Headers(init.headers || {});
    const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    const err = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

    if (url.host === "ebay.test") {
      if (url.pathname === "/identity/v1/oauth2/token") {
        return headers.get("Authorization") === `Basic ${btoa("id:secret")}` ? ok({ access_token: "tok", expires_in: 7200 }) : err(401, { error: "invalid_client" });
      }
      if (headers.get("Authorization") !== "Bearer tok") return err(401, { errors: [{ message: "Invalid access token" }] });
      if (headers.get("X-EBAY-C-MARKETPLACE-ID") !== "EBAY_GB") return err(400, { errors: [{ message: "wrong marketplace" }] });
      if (url.pathname === "/buy/browse/v1/item_summary/search") {
        const limit = Number(url.searchParams.get("limit"));
        const offset = Number(url.searchParams.get("offset"));
        if (limit > 200) return err(400, { errors: [{ longMessage: "limit too big" }] });
        return ok({ total: EBAY_ITEMS.length, offset, limit, itemSummaries: EBAY_ITEMS.slice(offset, offset + limit) });
      }
      if (url.pathname === "/buy/browse/v1/item/get_item_by_legacy_id") {
        const id = url.searchParams.get("legacy_item_id");
        if (id === "999999999999") return err(400, { errors: [{ errorId: 11006, longMessage: "This item is part of an item group" }] });
        const it = EBAY_ITEMS.find((x) => x.itemId === `v1|${id}|0`);
        if (!it) return err(404, { errors: [{ longMessage: "Item not found" }] });
        return ok({ ...it, description: "<p>Works perfectly.</p><p>Dock &amp; box included</p>", localizedAspects: [{ name: "Colour", value: "White" }],
          returnTerms: { returnsAccepted: true, returnPeriod: { value: 30, unit: "DAY" }, returnShippingCostPayer: "BUYER" },
          estimatedAvailabilities: [{ estimatedAvailableQuantity: 2, estimatedSoldQuantity: 5 }] });
      }
      if (url.pathname === "/buy/browse/v1/item/get_items_by_item_group") {
        if (url.searchParams.get("item_group_id") !== "999999999999") return err(404, { errors: [{ longMessage: "Item group not found" }] });
        return ok({ items: [{ ...EBAY_ITEMS[1], title: "Shirt Size S" }, { ...EBAY_ITEMS[2], title: "Shirt Size M" }] });
      }
    }

    if (url.host === "etsy.test") {
      if (headers.get("x-api-key") !== "key:shh") return err(403, { error: "Shared secret is required" });
      const p = url.pathname.replace("/v3/application", "");
      if (p === "/listings/active") {
        const limit = Number(url.searchParams.get("limit"));
        const offset = Number(url.searchParams.get("offset"));
        if (limit > 100) return err(400, { error: "limit must be <= 100" });
        if (url.searchParams.get("shop_location") !== "United Kingdom") return err(400, { error: "test expects UK shops" });
        return ok({ count: ETSY_LISTINGS.length, results: ETSY_LISTINGS.slice(offset, offset + limit) });
      }
      if (p === "/listings/batch") {
        const ids = url.searchParams.get("listing_ids").split(",").map(Number);
        if (ids.length > 100) return err(400, { error: "too many ids" });
        const inc = url.searchParams.get("includes") || "";
        return ok({ count: ids.length, results: ETSY_LISTINGS.filter((l) => ids.includes(l.listing_id)).map((l) => ({
          ...l,
          ...(inc.includes("Shop") ? { shop: shop(l.shop_id) } : {}),
          ...(inc.includes("Images") ? { images: [{ url_fullxfull: `https://i.etsystatic.com/${l.listing_id}.jpg` }] } : {}),
          ...(inc.includes("Shipping") ? { shipping_profile: { shipping_profile_destinations: [{ destination_country_iso: "GB", primary_cost: { amount: 295, divisor: 100, currency_code: "GBP" }, min_delivery_days: 2, max_delivery_days: 4 }] } } : {}),
        })) });
      }
      if (p === "/shops") return ok({ count: 2, results: [shop(51), { ...shop(52), shop_name: "CollarShop52" }].filter((s) => s.shop_name.toLowerCase().includes(url.searchParams.get("shop_name").toLowerCase())) });
      if (/^\/shops\/\d+\/reviews$/.test(p)) return ok({ count: 2, results: [{ rating: 5, review: "Lovely collar", create_timestamp: 1790000000 }, { rating: 4, review: "Slow postage" }] });
      if (/^\/shops\/\d+$/.test(p)) return ok(shop(Number(p.split("/")[2])));
    }
    return err(404, { error: `fake API has no route for ${url}` });
  };
}
