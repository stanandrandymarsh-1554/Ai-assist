// Tool definitions, post-filters, price summaries and compact table output.

import { EBAY_OPTIONS, Ebay } from "./ebay.js";
import { ETSY_OPTIONS, Etsy } from "./etsy.js";

const gbp = (n) => (n == null ? "?" : `£${n.toFixed(2)}`);
const cell = (s, n) => String(s ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim().slice(0, n);
const words = (a) => (a || []).map((w) => String(w).toLowerCase()).filter(Boolean);

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function priceLine(values, label) {
  if (!values.length) return `${label}: no prices to summarise`;
  const s = [...values].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  return `${label} (${s.length} listings): lowest ${gbp(s[0])} · 25% ${gbp(q(0.25))} · median ${gbp(median(s))} · 75% ${gbp(q(0.75))} · highest ${gbp(s[s.length - 1])}`;
}

function titleFilter(o) {
  const ex = words(o.exclude_words), req = words(o.must_include);
  return (title) => {
    const t = title.toLowerCase();
    return !ex.some((w) => t.includes(w)) && req.every((w) => t.includes(w));
  };
}

const SORT_OUTPUT = {
  as_fetched: null,
  cheapest: (a, b) => (a._sortPrice ?? Infinity) - (b._sortPrice ?? Infinity),
  dearest: (a, b) => (b._sortPrice ?? -Infinity) - (a._sortPrice ?? -Infinity),
};

function page(items, o) {
  const cmp = SORT_OUTPUT[o.order_results || "as_fetched"];
  const list = cmp ? [...items].sort(cmp) : items;
  const start = Math.max(0, o.show_from ?? 0);
  const show = Math.max(1, Math.min(o.show ?? 40, 200));
  return { rows: list.slice(start, start + show), start, more: Math.max(0, list.length - start - show) };
}

// ------------------------------------------------------------------ eBay

export async function ebaySearch(env, o, fetchImpl) {
  const ebay = new Ebay(env, fetchImpl);
  const { total, items } = await ebay.search(o);
  const keep = titleFilter(o);
  const kept = items.filter((it) =>
    keep(it.title) &&
    (o.min_feedback_pct == null || (it.feedbackPct ?? 0) >= o.min_feedback_pct) &&
    (o.min_feedback_score == null || (it.feedbackScore ?? 0) >= o.min_feedback_score) &&
    (o.max_total == null || (it.total ?? Infinity) <= o.max_total) &&
    (!o.top_rated_only || it.topRated));
  for (const it of kept) it._sortPrice = it.total ?? it.price;
  const { rows, start, more } = page(kept, o);
  const totals = kept.filter((it) => it.currency === "GBP").map((it) => it.total ?? it.price).filter((x) => x != null);
  const lines = [
    `eBay UK · "${o.query}" · ${total.toLocaleString("en-GB")} matches on eBay · fetched ${items.length} · ${kept.length} after your filters`,
    priceLine(totals, "Price incl. postage"),
    "",
    `| # | Total | Price | Post | Condition | Type | Seller (feedback) | From | Title | Link |`,
    `|---|---|---|---|---|---|---|---|---|---|`,
    ...rows.map((it, i) => {
      const type = it.auction ? `Auction ${it.bids ?? 0} bids, ends ${String(it.ends || "").slice(0, 16).replace("T", " ")}` : it.bestOffer ? "BIN/Offer" : "BIN";
      const fb = `${cell(it.seller, 18)} ${it.feedbackPct ?? "?"}% (${it.feedbackScore ?? "?"})${it.topRated ? " ★" : ""}`;
      const cur = it.currency === "GBP" ? "" : ` ${it.currency}`;
      return `| ${start + i + 1} | ${gbp(it.total)}${cur} | ${gbp(it.price)} | ${it.postageLabel} | ${cell(it.condition, 22)} | ${type} | ${fb} | ${cell(it.location, 18)} | ${cell(it.title, 80)} | ${it.url} |`;
    }),
  ];
  if (more) lines.push("", `${more} more listings matched. Call again with show_from=${start + rows.length} to see them.`);
  if (!kept.length) lines.push("", "Nothing matched. Try loosening the filters or a broader query.");
  lines.push("", "★ = eBay Top Rated Plus. Post 'calc' = depends on postcode, '?' = not given. Sold prices aren't available through eBay's API.");
  return lines.join("\n");
}

export async function ebayItems(env, o, fetchImpl) {
  const ebay = new Ebay(env, fetchImpl);
  const refs = (o.items || []).slice(0, 20);
  const out = await Promise.all(refs.map((r) => ebay.item(r).catch((e) => ({ ref: r, error: e.message }))));
  return JSON.stringify(out.map(stripInternal), null, 1);
}

// ------------------------------------------------------------------ Etsy

export async function etsySearch(env, o, fetchImpl) {
  const etsy = new Etsy(env, fetchImpl);
  const { total, items } = await etsy.search(o);
  const keep = titleFilter(o);
  const kept = items.filter((it) =>
    keep(it.title) &&
    (o.min_price == null || (it.priceGbp ?? -Infinity) >= o.min_price) &&
    (o.max_price == null || (it.priceGbp ?? Infinity) <= o.max_price) &&
    (o.min_shop_rating == null || (it.shopRating ?? 0) >= o.min_shop_rating) &&
    (o.min_shop_reviews == null || (it.shopReviews ?? 0) >= o.min_shop_reviews) &&
    (!o.handmade_only || it.madeBy === "i_did") &&
    (!o.personalisable_only || it.personalisable));
  for (const it of kept) it._sortPrice = it.priceGbp;
  const { rows, start, more } = page(kept, o);
  const lines = [
    `Etsy · "${o.query}" · ${o.uk_shops_only === false ? "all shops" : "UK shops"} · ${total.toLocaleString("en-GB")} matches on Etsy · fetched ${items.length} · ${kept.length} after your filters`,
    priceLine(kept.map((it) => it.priceGbp).filter((x) => x != null), "Price (before postage)"),
    "",
    `| # | Price | Shop (rating, reviews) | Favourites | Made by | Title | Link |`,
    `|---|---|---|---|---|---|---|`,
    ...rows.map((it, i) => {
      const price = it.currency === "GBP" ? gbp(it.price) : `${it.price} ${it.currency} (≈${gbp(it.priceGbp)})`;
      const shop = `${cell(it.shop, 24)} ${it.shopRating ?? "?"}★ (${it.shopReviews ?? "?"})`;
      const made = { i_did: "maker", someone_else: "partner", collective: "collective" }[it.madeBy] || it.madeBy || "?";
      return `| ${start + i + 1} | ${price} | ${shop} | ${it.favourites ?? "?"} | ${made}${it.personalisable ? ", personalisable" : ""} | ${cell(it.title, 80)} | ${it.url} |`;
    }),
  ];
  if (more) lines.push("", `${more} more listings matched. Call again with show_from=${start + rows.length} to see them.`);
  if (!kept.length) lines.push("", "Nothing matched. Try loosening the filters or a broader query.");
  lines.push("", "Postage isn't in Etsy search results: use etsy_listings on the ones you like to get postage and delivery times. ≈ = rough conversion to £.");
  return lines.join("\n");
}

export async function etsyListings(env, o, fetchImpl) {
  const etsy = new Etsy(env, fetchImpl);
  return JSON.stringify((await etsy.listings((o.listings || []).slice(0, 50))).map(stripInternal), null, 1);
}

export async function etsyShop(env, o, fetchImpl) {
  const etsy = new Etsy(env, fetchImpl);
  return JSON.stringify(await etsy.shop(o.shop, o.reviews ?? 10), null, 1);
}

function stripInternal(x) {
  return JSON.parse(JSON.stringify(x, (k, v) => (k.startsWith("_") || v === null || v === "" || (Array.isArray(v) && !v.length) ? undefined : v)));
}

// ------------------------------------------------------------------ schemas

const str = (description) => ({ type: "string", description });
const numb = (description, extra = {}) => ({ type: "number", description, ...extra });
const bool = (description) => ({ type: "boolean", description });
const list = (description, items = { type: "string" }, extra = {}) => ({ type: "array", items, description, ...extra });
const enumOf = (values, description) => ({ type: "string", enum: values, description });
const paging = {
  max_results: numb("How many listings to pull from the site before filtering (default 200, max 1000). More = slower but wider.", { minimum: 1, maximum: 1000 }),
  show: numb("How many rows to return (default 40, max 200).", { minimum: 1, maximum: 200 }),
  show_from: numb("Skip this many rows of the filtered results (for 'show me more').", { minimum: 0 }),
  order_results: enumOf(Object.keys(SORT_OUTPUT), "Order of the returned rows after filtering. cheapest/dearest use total incl. postage on eBay."),
  exclude_words: list("Drop listings whose title contains any of these words, e.g. ['broken','box only','case']"),
  must_include: list("Keep only listings whose title contains all of these words"),
};

export const TOOLS = [
  {
    name: "ebay_search",
    title: "Bulk search eBay UK",
    description: "Pull up to 1000 live eBay UK listings in one call (Buy It Now and auctions), filtered, with a price summary (lowest/quartiles/median/highest incl. postage) and a compact table: total, price, postage, condition, type, seller feedback, location, title, link.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: str("Search keywords, e.g. 'nintendo switch oled'"),
        min_price: numb("Minimum item price in £"),
        max_price: numb("Maximum item price in £"),
        max_total: numb("Maximum price + postage in £"),
        condition: list("Allowed conditions", { type: "string", enum: EBAY_OPTIONS.conditions }),
        listing_type: enumOf(EBAY_OPTIONS.listingTypes, "Default any (Buy It Now and auctions)"),
        free_postage: bool("Only listings with free postage"),
        uk_only: bool("Only items located in the UK"),
        returns_accepted: bool("Only listings that accept returns"),
        seller_type: enumOf(["any", "business", "private"], "Business or private sellers"),
        min_feedback_pct: numb("Minimum seller positive feedback %, e.g. 98"),
        min_feedback_score: numb("Minimum seller feedback count, e.g. 50"),
        top_rated_only: bool("Only eBay Top Rated Plus listings"),
        exclude_sellers: list("Seller usernames to leave out"),
        search_descriptions: bool("Also match keywords in descriptions (wider, noisier)"),
        category_id: str("eBay category ID to restrict to"),
        sort: enumOf(EBAY_OPTIONS.sorts, "How eBay orders results before they're pulled (matters when max_results is less than the matches)"),
        ...paging,
      },
    },
    run: ebaySearch,
  },
  {
    name: "ebay_items",
    title: "eBay listing details",
    description: "Full details for up to 20 eBay listings at once: description, item specifics, condition notes, all postage options with delivery dates, returns, quantity available/sold, seller, images.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      required: ["items"],
      properties: { items: list("eBay item links, item numbers, or ids from ebay_search", { type: "string" }, { minItems: 1, maxItems: 20 }) },
    },
    run: ebayItems,
  },
  {
    name: "etsy_search",
    title: "Bulk search Etsy",
    description: "Pull up to 1000 active Etsy listings in one call (UK shops by default), filtered, with a £ price summary and a compact table: price, shop rating and review count, favourites, who made it, title, link.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: str("Search keywords, e.g. 'personalised leather dog collar'"),
        min_price: numb("Minimum price in £"),
        max_price: numb("Maximum price in £"),
        uk_shops_only: bool("Only shops based in the UK (default true)"),
        min_shop_rating: numb("Minimum shop rating out of 5, e.g. 4.8"),
        min_shop_reviews: numb("Minimum number of shop reviews, e.g. 100"),
        handmade_only: bool("Only items the shop made itself"),
        personalisable_only: bool("Only personalisable items"),
        category_id: numb("Etsy taxonomy (category) ID"),
        sort: enumOf(ETSY_OPTIONS.sorts, "How Etsy orders results before they're pulled"),
        ...paging,
      },
    },
    run: etsySearch,
  },
  {
    name: "etsy_listings",
    title: "Etsy listing details",
    description: "Full details for up to 50 Etsy listings at once: description, materials, tags, processing time, postage costs and delivery times by destination, shop rating, images.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      required: ["listings"],
      properties: { listings: list("Etsy listing links or ids", { type: ["string", "number"] }, { minItems: 1, maxItems: 50 }) },
    },
    run: etsyListings,
  },
  {
    name: "etsy_shop",
    title: "Etsy shop and reviews",
    description: "An Etsy shop's rating, review count, total sales, location, holiday status and its most recent reviews.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      required: ["shop"],
      properties: {
        shop: str("Shop name, shop link or numeric shop id"),
        reviews: numb("How many recent reviews to include (default 10, max 100, 0 for none)", { minimum: 0, maximum: 100 }),
      },
    },
    run: etsyShop,
  },
];
