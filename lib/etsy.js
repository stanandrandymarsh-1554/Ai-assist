// Etsy Open API v3 client: API-key access to public listings and shops.

const PAGE = 100; // Etsy maximum per request
const BATCH = 100; // listing ids per batch lookup
const CONCURRENCY = 4; // stay well inside Etsy's per-second limit
const SORTS = {
  relevance: ["score", "desc"],
  price_low: ["price", "asc"],
  price_high: ["price", "desc"],
  newest: ["created", "desc"],
};
// Rough rates for comparing non-GBP prices against a £ filter. Shown as "≈" in results.
const TO_GBP = { GBP: 1, USD: 0.75, EUR: 0.85, CAD: 0.55, AUD: 0.49, NZD: 0.45, CHF: 0.86, SEK: 0.07, DKK: 0.11, NOK: 0.07, PLN: 0.19, JPY: 0.005, INR: 0.009 };

export const ETSY_OPTIONS = { sorts: Object.keys(SORTS) };

export class EtsyError extends Error {}

async function pool(tasks, n) {
  const out = new Array(tasks.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); }
  }));
  return out;
}

export class Etsy {
  constructor(env, fetchImpl = fetch) {
    if (!env.ETSY_API_KEY || !env.ETSY_SHARED_SECRET) {
      throw new EtsyError("Etsy isn't set up: add ETSY_API_KEY and ETSY_SHARED_SECRET to the connector's environment variables.");
    }
    this.key = `${env.ETSY_API_KEY}:${env.ETSY_SHARED_SECRET}`;
    this.fetch = fetchImpl;
    this.base = (env.ETSY_API_BASE || "https://openapi.etsy.com") + "/v3/application";
  }

  async get(path, params) {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(params || {})) if (v != null && v !== "") url.searchParams.set(k, String(v));
    const r = await this.fetch(url, { headers: { "x-api-key": this.key, Accept: "application/json" } });
    if (!r.ok) {
      let msg = "";
      try { const b = await r.json(); msg = b.error_description || b.error || ""; } catch { /* not JSON */ }
      const hint = r.status === 401 || r.status === 403 ? " Check ETSY_API_KEY and ETSY_SHARED_SECRET." : "";
      throw new EtsyError(`Etsy API error ${r.status}${msg ? ": " + msg : ""}.${hint}`);
    }
    return r.json();
  }

  /** Fetch listings by id with their shop (and optionally shipping), 100 at a time. */
  async batch(ids, includes = "Shop,Images") {
    const chunks = [];
    for (let i = 0; i < ids.length; i += BATCH) chunks.push(ids.slice(i, i + BATCH));
    const pages = await pool(chunks.map((c) => () => this.get("/listings/batch", { listing_ids: c.join(","), includes }).catch(() => ({}))), CONCURRENCY);
    const byId = new Map();
    for (const p of pages) for (const li of p.results || []) byId.set(li.listing_id, li);
    return byId;
  }

  async search(o) {
    const [sort_on, sort_order] = SORTS[o.sort || "relevance"] || SORTS.relevance;
    const want = Math.max(1, Math.min(o.max_results ?? 200, 1000));
    // Etsy's own price filter isn't in £, so ask for a wider band and filter exactly below.
    const params = {
      keywords: o.query,
      sort_on, sort_order,
      shop_location: o.uk_shops_only === false ? undefined : "United Kingdom",
      taxonomy_id: o.category_id,
      min_price: o.min_price != null ? Math.floor(o.min_price * 0.8) : undefined,
      max_price: o.max_price != null ? Math.ceil(o.max_price * 1.7) : undefined,
    };
    const first = await this.get("/listings/active", { ...params, limit: Math.min(PAGE, want), offset: 0 });
    const total = first.count || 0;
    const offsets = [];
    for (let off = PAGE; off < Math.min(want, total); off += PAGE) offsets.push(off);
    const rest = await pool(offsets.map((offset) => () =>
      this.get("/listings/active", { ...params, limit: Math.min(PAGE, want - offset), offset }).catch(() => ({}))), CONCURRENCY);
    const seen = new Set();
    const raw = [];
    for (const p of [first, ...rest]) for (const li of p.results || []) {
      if (!seen.has(li.listing_id)) { seen.add(li.listing_id); raw.push(li); }
    }
    const extra = await this.batch(raw.map((li) => li.listing_id));
    const items = raw.slice(0, want).map((li) => summarize({ ...li, ...(extra.get(li.listing_id) ? { shop: extra.get(li.listing_id).shop, images: extra.get(li.listing_id).images } : {}) }));
    return { total, items };
  }

  async listings(refs) {
    const ids = refs.map(listingId);
    const byId = await this.batch(ids, "Shop,Shipping,Images");
    return ids.map((id) => (byId.has(id) ? detail(byId.get(id)) : { id, error: "Not found or no longer active" }));
  }

  async shop(ref, reviews = 10) {
    let s = String(ref).trim();
    const m = s.match(/\/shop\/([A-Za-z0-9_-]+)/);
    if (m) s = m[1];
    let shop;
    if (/^\d+$/.test(s)) shop = await this.get(`/shops/${s}`);
    else {
      const res = (await this.get("/shops", { shop_name: s, limit: 10 })).results || [];
      shop = res.find((x) => String(x.shop_name).toLowerCase() === s.toLowerCase()) || res[0];
      if (!shop) throw new EtsyError(`No Etsy shop called "${s}".`);
    }
    const out = summarizeShop(shop);
    if (reviews > 0) {
      const r = await this.get(`/shops/${shop.shop_id}/reviews`, { limit: Math.min(reviews, 100) }).catch(() => ({}));
      out.recentReviews = (r.results || []).map((x) => ({
        stars: x.rating,
        text: String(x.review || "").slice(0, 300),
        date: x.create_timestamp ? new Date(x.create_timestamp * 1000).toISOString().slice(0, 10) : undefined,
      }));
    }
    return out;
  }
}

export function listingId(ref) {
  const s = String(ref).trim();
  const m = s.match(/\/listing\/(\d+)/) || s.match(/^(\d+)$/);
  if (!m) throw new EtsyError(`Not an Etsy listing link or id: ${s}`);
  return Number(m[1]);
}

export const money = (p) => (p && p.amount != null ? p.amount / (p.divisor || 1) : null);

export function toGbp(amount, currency) {
  const rate = TO_GBP[currency];
  return amount == null || rate == null ? null : Math.round(amount * rate * 100) / 100;
}

function summarizeShop(s) {
  if (!s) return {};
  return {
    shopId: s.shop_id,
    name: s.shop_name,
    rating: s.review_average != null ? Math.round(s.review_average * 100) / 100 : null,
    reviews: s.review_count ?? null,
    sales: s.transaction_sold_count ?? null,
    activeListings: s.listing_active_count ?? null,
    country: s.shop_location_country_iso || "",
    onHoliday: !!s.is_vacation,
    url: s.url ? s.url.split("?")[0] : s.shop_name ? `https://www.etsy.com/uk/shop/${s.shop_name}` : undefined,
  };
}

export function summarize(li) {
  const price = money(li.price);
  const currency = li.price?.currency_code || "GBP";
  const shop = summarizeShop(li.shop);
  return {
    id: li.listing_id,
    title: li.title || "",
    price,
    currency,
    priceGbp: toGbp(price, currency),
    shop: shop.name || "",
    shopRating: shop.rating ?? null,
    shopReviews: shop.reviews ?? null,
    favourites: li.num_favorers ?? null,
    madeBy: li.who_made || "",
    personalisable: !!li.is_personalizable,
    url: `https://www.etsy.com/uk/listing/${li.listing_id}`,
  };
}

function detail(li) {
  const s = summarize(li);
  const days = (a, b) => (a == null && b == null ? undefined : a === b || b == null ? `${a}` : `${a}-${b}`);
  return {
    ...s,
    shopDetails: summarizeShop(li.shop),
    description: String(li.description || "").slice(0, 3000),
    tags: li.tags,
    materials: li.materials,
    quantity: li.quantity,
    whenMade: li.when_made,
    processingDays: days(li.processing_min, li.processing_max),
    postage: (li.shipping_profile?.shipping_profile_destinations || []).map((d) => ({
      to: d.destination_country_iso || d.destination_region || "everywhere else",
      cost: money(d.primary_cost),
      eachExtra: money(d.secondary_cost),
      deliveryDays: days(d.min_delivery_days, d.max_delivery_days),
    })),
    images: (li.images || []).map((i) => i.url_fullxfull).filter(Boolean).slice(0, 6),
  };
}
