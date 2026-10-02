// eBay Browse API client: application token, parallel paging, filters.

const PAGE = 200; // Browse API maximum per request
const CONDITIONS = {
  new: ["1000"],
  open_box: ["1500"],
  refurbished: ["2000", "2010", "2020", "2030", "2500"],
  used: ["3000", "4000", "5000", "6000"],
  for_parts: ["7000"],
};
const SORTS = { best_match: null, price_low: "price", price_high: "-price", newest: "newlyListed", ending_soon: "endingSoonest" };
const BUYING = { any: ["FIXED_PRICE", "AUCTION"], buy_it_now: ["FIXED_PRICE"], auction: ["AUCTION"], best_offer: ["BEST_OFFER"] };

export const EBAY_OPTIONS = {
  conditions: Object.keys(CONDITIONS),
  sorts: Object.keys(SORTS),
  listingTypes: Object.keys(BUYING),
};

export class EbayError extends Error {}

export class Ebay {
  constructor(env, fetchImpl = fetch) {
    if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
      throw new EbayError("eBay isn't set up: add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET to the connector's environment variables.");
    }
    this.env = env;
    this.fetch = fetchImpl;
    this.base = env.EBAY_API_BASE || "https://api.ebay.com";
    this.marketplace = env.EBAY_MARKETPLACE || "EBAY_GB";
  }

  async token() {
    const cache = Ebay.tokenCache;
    if (cache && cache.id === this.env.EBAY_CLIENT_ID && Date.now() < cache.expires) return cache.token;
    const basic = btoa(`${this.env.EBAY_CLIENT_ID}:${this.env.EBAY_CLIENT_SECRET}`);
    const r = await this.fetch(`${this.base}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
    });
    if (!r.ok) throw new EbayError(`eBay rejected the keys (${r.status}). Check EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are the Production keys.`);
    const body = await r.json();
    Ebay.tokenCache = { id: this.env.EBAY_CLIENT_ID, token: body.access_token, expires: Date.now() + (body.expires_in - 120) * 1000 };
    return body.access_token;
  }

  async get(path, params) {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(params || {})) if (v != null && v !== "") url.searchParams.set(k, String(v));
    const headers = { Authorization: `Bearer ${await this.token()}`, "X-EBAY-C-MARKETPLACE-ID": this.marketplace, Accept: "application/json" };
    if (this.env.EBAY_POSTCODE) {
      const country = this.marketplace.split("_")[1] || "GB";
      headers["X-EBAY-C-ENDUSERCTX"] = "contextualLocation=" + encodeURIComponent(`country=${country},zip=${this.env.EBAY_POSTCODE.replace(/\s+/g, "")}`);
    }
    const r = await this.fetch(url, { headers });
    if (r.status === 401) Ebay.tokenCache = null;
    if (!r.ok) {
      let msg = "";
      try { msg = ((await r.json()).errors || []).map((e) => e.longMessage || e.message).join("; "); } catch { /* not JSON */ }
      throw new EbayError(`eBay API error ${r.status}${msg ? ": " + msg : ""}`);
    }
    return r.json();
  }

  /** Fetch up to maxResults listings in parallel pages. Returns { total, items }. */
  async search(o) {
    const params = { q: o.query, category_ids: o.category_id, sort: SORTS[o.sort || "best_match"], filter: buildFilter(o, this.marketplace) };
    const want = Math.max(1, Math.min(o.max_results ?? 200, 1000));
    const first = await this.get("/buy/browse/v1/item_summary/search", { ...params, limit: Math.min(PAGE, want), offset: 0 });
    const total = first.total || 0;
    const pages = [first];
    const offsets = [];
    for (let off = PAGE; off < Math.min(want, total, 10000); off += PAGE) offsets.push(off);
    const rest = await Promise.all(offsets.map((offset) =>
      this.get("/buy/browse/v1/item_summary/search", { ...params, limit: Math.min(PAGE, want - offset), offset }).catch(() => ({}))));
    pages.push(...rest);
    const seen = new Set();
    const items = [];
    for (const p of pages) for (const it of p.itemSummaries || []) {
      if (seen.has(it.itemId)) continue;
      seen.add(it.itemId);
      items.push(summarize(it));
    }
    return { total, items: items.slice(0, want) };
  }

  async item(ref) {
    const s = String(ref).trim();
    if (s.startsWith("v1|")) return detail(await this.get(`/buy/browse/v1/item/${encodeURIComponent(s)}`));
    const m = s.match(/\/itm\/(?:[^/?#]+\/)?(\d{9,15})/) || s.match(/^(\d{9,15})$/);
    if (!m) throw new EbayError(`Not an eBay item link or number: ${s}`);
    try {
      return detail(await this.get("/buy/browse/v1/item/get_item_by_legacy_id", { legacy_item_id: m[1] }));
    } catch (e) {
      // Listings with variations (sizes, colours) have to be fetched as a group.
      try {
        const g = await this.get("/buy/browse/v1/item/get_items_by_item_group", { item_group_id: m[1] });
        return { variations: (g.items || []).map(detail), url: `https://www.ebay.co.uk/itm/${m[1]}` };
      } catch { throw e; }
    }
  }
}

export function buildFilter(o, marketplace = "EBAY_GB") {
  const f = [];
  const currency = { EBAY_GB: "GBP", EBAY_US: "USD", EBAY_IE: "EUR", EBAY_DE: "EUR", EBAY_AU: "AUD", EBAY_CA: "CAD" }[marketplace] || "GBP";
  if (o.min_price != null || o.max_price != null) {
    f.push(`price:[${o.min_price ?? ""}..${o.max_price ?? ""}]`, `priceCurrency:${currency}`);
  }
  if (o.condition?.length) f.push(`conditionIds:{${o.condition.flatMap((c) => CONDITIONS[c] || []).join("|")}}`);
  f.push(`buyingOptions:{${(BUYING[o.listing_type || "any"] || BUYING.any).join("|")}}`);
  if (o.free_postage) f.push("maxDeliveryCost:0");
  if (o.uk_only) f.push("itemLocationCountry:GB");
  if (o.returns_accepted) f.push("returnsAccepted:true");
  if (o.seller_type === "business") f.push("sellerAccountTypes:{BUSINESS}");
  if (o.seller_type === "private") f.push("sellerAccountTypes:{INDIVIDUAL}");
  if (o.exclude_sellers?.length) f.push(`excludeSellers:{${o.exclude_sellers.join("|")}}`);
  if (o.search_descriptions) f.push("searchInDescription:true");
  f.push(`deliveryCountry:${currency === "GBP" ? "GB" : marketplace.split("_")[1]}`);
  return f.join(",");
}

const num = (m) => (m && m.value != null ? Number(m.value) : null);

function postage(options) {
  if (!options?.length) return { cost: null, label: "?" };
  const o = options[0];
  if (o.shippingCostType === "CALCULATED" && !o.shippingCost) return { cost: null, label: "calc" };
  const c = num(o.shippingCost);
  return c == null ? { cost: null, label: "?" } : { cost: c, label: c === 0 ? "free" : c.toFixed(2) };
}

export function legacyId(itemId) {
  const m = String(itemId || "").match(/^v1\|(\d+)\|/);
  return m ? m[1] : itemId;
}

export function summarize(it) {
  const price = num(it.currentBidPrice) ?? num(it.price);
  const post = postage(it.shippingOptions);
  const seller = it.seller || {};
  const loc = it.itemLocation || {};
  return {
    id: legacyId(it.itemId),
    title: it.title || "",
    price,
    currency: (it.currentBidPrice || it.price || {}).currency || "GBP",
    postage: post.cost,
    postageLabel: post.label,
    total: price != null && post.cost != null ? Math.round((price + post.cost) * 100) / 100 : null,
    condition: it.condition || "",
    auction: (it.buyingOptions || []).includes("AUCTION"),
    bestOffer: (it.buyingOptions || []).includes("BEST_OFFER"),
    bids: it.bidCount,
    ends: it.itemEndDate,
    seller: seller.username || "",
    feedbackPct: seller.feedbackPercentage != null ? Number(seller.feedbackPercentage) : null,
    feedbackScore: seller.feedbackScore ?? null,
    topRated: !!it.topRatedBuyingExperience,
    location: [loc.city, loc.country].filter(Boolean).join(", ") || loc.country || "",
    url: `https://www.ebay.co.uk/itm/${legacyId(it.itemId)}`,
  };
}

function strip(html, limit = 3000) {
  const t = String(html || "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  return t.length > limit ? t.slice(0, limit) + "…" : t;
}

export function detail(it) {
  const s = summarize(it);
  const ret = it.returnTerms || {};
  const avail = (it.estimatedAvailabilities || [])[0] || {};
  return {
    ...s,
    subtitle: it.subtitle,
    brand: it.brand,
    conditionNotes: it.conditionDescription,
    category: it.categoryPath,
    available: avail.estimatedAvailableQuantity,
    sold: avail.estimatedSoldQuantity,
    returns: ret.returnsAccepted
      ? `${ret.returnPeriod?.value ?? "?"} ${String(ret.returnPeriod?.unit || "").toLowerCase()}, return postage paid by ${String(ret.returnShippingCostPayer || "?").toLowerCase()}`
      : ret.returnsAccepted === false ? "No returns" : undefined,
    postageOptions: (it.shippingOptions || []).map((o) => ({
      service: o.shippingServiceCode,
      cost: num(o.shippingCost),
      arrives: [o.minEstimatedDeliveryDate, o.maxEstimatedDeliveryDate].filter(Boolean).map((d) => d.slice(0, 10)).join(" to "),
    })),
    specifics: Object.fromEntries((it.localizedAspects || []).map((a) => [a.name, a.value])),
    description: strip(it.description || it.shortDescription),
    images: [it.image?.imageUrl, ...(it.additionalImages || []).map((i) => i.imageUrl)].filter(Boolean).slice(0, 6),
  };
}
