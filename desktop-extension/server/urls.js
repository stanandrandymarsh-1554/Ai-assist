// Builds filtered eBay UK / Etsy UK search URLs (same parameters as the skill's Python scripts).

const EBAY_CONDITIONS = {
  new: "1000",
  open_box: "1500",
  refurbished: "2000|2010|2020|2030|2500",
  used: "3000",
  for_parts: "7000",
};
const EBAY_SORTS = { best: null, price_low: "15", price_high: "16", newest: "10", ending: "1", distance: "7" };
// LH_PrefLoc codes on ebay.co.uk
const EBAY_LOCATIONS = { uk_only: "1", worldwide: "2", europe: "3" };

export function ebaySearchUrl(o) {
  const p = new URLSearchParams({ _nkw: o.query });
  if (o.min_price != null) p.set("_udlo", String(o.min_price));
  if (o.max_price != null) p.set("_udhi", String(o.max_price));
  if (o.condition?.length) p.set("LH_ItemCondition", o.condition.map((c) => EBAY_CONDITIONS[c]).join("|"));
  if (o.listing_type === "buy_it_now") p.set("LH_BIN", "1");
  if (o.listing_type === "auction") p.set("LH_Auction", "1");
  if (o.best_offer) p.set("LH_BO", "1");
  if (o.free_postage) p.set("LH_FS", "1");
  if (o.sold) { p.set("LH_Sold", "1"); p.set("LH_Complete", "1"); }
  if (o.location) p.set("LH_PrefLoc", EBAY_LOCATIONS[o.location]);
  if (o.sort && EBAY_SORTS[o.sort]) p.set("_sop", EBAY_SORTS[o.sort]);
  if (o.page > 1) p.set("_pgn", String(o.page));
  p.set("_ipg", "60");
  return `https://www.ebay.co.uk/sch/i.html?${p}`;
}

const ETSY_SORTS = {
  relevance: null,
  price_low: "price_asc",
  price_high: "price_desc",
  newest: "most_recent",
  top_reviews: "highest_reviews",
};

export function etsySearchUrl(o) {
  const p = new URLSearchParams({ q: o.query });
  if (o.min_price != null || o.max_price != null) {
    p.set("explicit", "1");
    if (o.min_price != null) p.set("min", String(o.min_price));
    if (o.max_price != null) p.set("max", String(o.max_price));
  }
  if (o.sort && ETSY_SORTS[o.sort]) p.set("order", ETSY_SORTS[o.sort]);
  if (o.free_postage) p.set("free_shipping", "true");
  if (o.handmade) p.set("is_handmade", "true");
  if (o.vintage) p.set("is_vintage", "true");
  if (o.personalisable) p.set("is_personalizable", "true");
  if (o.on_sale) p.set("is_discounted", "true");
  p.set("ship_to", "GB");
  if (o.page > 1) p.set("page", String(o.page));
  return `https://www.etsy.com/uk/search?${p}`;
}

const ALLOWED = /^https:\/\/([a-z0-9-]+\.)*(ebay\.(co\.uk|com|ie|de|fr|it|es|com\.au|ca|at|ch|nl|be|pl)|etsy\.com)(\/|$)/i;

export function checkShoppingUrl(url) {
  if (!ALLOWED.test(url)) throw new Error("Only eBay and Etsy pages can be opened (https://www.ebay.co.uk/... or https://www.etsy.com/...).");
  return url;
}

export const OPTIONS = {
  ebayConditions: Object.keys(EBAY_CONDITIONS),
  ebaySorts: Object.keys(EBAY_SORTS),
  ebayLocations: Object.keys(EBAY_LOCATIONS),
  etsySorts: Object.keys(ETSY_SORTS),
};
