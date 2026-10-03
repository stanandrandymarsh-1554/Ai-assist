// Post-filters, price summary and the compact table Claude reads.

const gbp = (n) => (n == null ? "?" : `£${n.toFixed(2)}`);
const cell = (s, n) => String(s ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim().slice(0, n);
const lower = (a) => (a || []).map((w) => String(w).toLowerCase()).filter(Boolean);

// The sites filter by price too; this catches sale prices and cards that slip through.
const inPriceRange = (o, it) => it.currency !== "GBP" || it.price == null ||
  ((o.min_price == null || it.price >= o.min_price) && (o.max_price == null || it.price <= o.max_price));

export function titleFilter(o) {
  const ex = lower(o.exclude_words), req = lower(o.must_include);
  return (title) => {
    const t = String(title).toLowerCase();
    return !ex.some((w) => t.includes(w)) && req.every((w) => t.includes(w));
  };
}

export function priceSummary(values, label) {
  if (!values.length) return `${label}: no prices to summarise`;
  const s = [...values].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  const mid = s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return `${label} (${s.length} listings): lowest ${gbp(s[0])} · 25% ${gbp(q(0.25))} · median ${gbp(mid)} · 75% ${gbp(q(0.75))} · highest ${gbp(s[s.length - 1])}`;
}

const ORDER = {
  as_found: null,
  cheapest: (a, b) => (a._sort ?? Infinity) - (b._sort ?? Infinity),
  dearest: (a, b) => (b._sort ?? -Infinity) - (a._sort ?? -Infinity),
};
export const ORDER_OPTIONS = Object.keys(ORDER);

function window_(items, o) {
  const cmp = ORDER[o.order_results || "as_found"];
  const list = cmp ? [...items].sort(cmp) : items;
  const start = Math.max(0, o.show_from ?? 0);
  const show = Math.max(1, Math.min(o.show ?? 40, 250));
  return { rows: list.slice(start, start + show), start, more: Math.max(0, list.length - start - show) };
}

export function ebayReport(o, { items, total, pagesRead, notes, firstUrl }) {
  const keep = titleFilter(o);
  const kept = items.filter((it) =>
    keep(it.title) && inPriceRange(o, it) &&
    (o.min_feedback_pct == null || (it.feedbackPct ?? 0) >= o.min_feedback_pct) &&
    (o.min_feedback_count == null || (it.feedbackCount ?? 0) >= o.min_feedback_count) &&
    (o.max_total == null || (it.total ?? it.price ?? Infinity) <= o.max_total) &&
    (!o.hide_sponsored || !it.sponsored));
  for (const it of kept) it._sort = it.total ?? it.price;
  const { rows, start, more } = window_(kept, o);
  const prices = kept.filter((it) => it.currency === "GBP" && !it.priceIsRange).map((it) => it.total ?? it.price).filter((x) => x != null);
  const what = o.sold ? "sold listings" : "listings";
  const lines = [
    `eBay UK ${what} · "${o.query}" · ${total != null ? total.toLocaleString("en-GB") + " matches on eBay · " : ""}read ${items.length} from ${pagesRead} page${pagesRead === 1 ? "" : "s"} · ${kept.length} after your filters`,
    priceSummary(prices, o.sold ? "Sold for, incl. postage where shown" : "Price incl. postage where shown"),
    `Search page: ${firstUrl}`,
    "",
    `| # | Total | Price | Post | Condition | ${o.sold ? "Sold" : "Type"} | Seller (feedback) | From | Title | Link |`,
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((it, i) => {
      const cur = it.currency === "GBP" ? "" : ` ${it.currency}`;
      const type = o.sold ? it.sold || "?" : it.auction ? `Auction${it.bids != null ? `, ${it.bids} bids` : ""}${it.timeLeft ? `, ${it.timeLeft}` : ""}` : it.bestOffer ? "BIN / offers" : "BIN";
      const seller = it.seller || it.feedbackPct != null ? `${cell(it.seller, 18)} ${it.feedbackPct ?? "?"}%${it.feedbackCount != null ? ` (${it.feedbackCount})` : ""}` : "?";
      return `| ${start + i + 1} | ${gbp(it.total)}${cur} | ${gbp(it.price)}${it.priceIsRange ? "+" : ""} | ${it.postageLabel} | ${cell(it.condition, 22)} | ${cell(type, 40)} | ${seller} | ${cell(it.location || "UK?", 16)} | ${cell(it.title, 80)} | ${it.url} |`;
    }),
  ];
  if (more) lines.push("", `${more} more matched. Call again with show_from=${start + rows.length} to see them (no need to re-search: use the same arguments).`);
  if (!kept.length) lines.push("", "Nothing matched. Try loosening the filters or a broader query.");
  lines.push("", "Price with + = a range (variations). Post '?' = not shown on the results page. 'From' blank on eBay UK usually means the UK.");
  if (notes.length) lines.push("", ...notes);
  return lines.join("\n");
}

export function etsyReport(o, { items, total, pagesRead, notes, firstUrl }) {
  const keep = titleFilter(o);
  const kept = items.filter((it) =>
    keep(it.title) && inPriceRange(o, it) &&
    (o.min_rating == null || (it.rating ?? 0) >= o.min_rating) &&
    (o.min_reviews == null || (it.reviews ?? 0) >= o.min_reviews) &&
    (!o.hide_ads || !it.ad));
  for (const it of kept) it._sort = it.price;
  const { rows, start, more } = window_(kept, o);
  const lines = [
    `Etsy UK · "${o.query}" · ${total != null ? total.toLocaleString("en-GB") + " results on Etsy · " : ""}read ${items.length} from ${pagesRead} page${pagesRead === 1 ? "" : "s"} · ${kept.length} after your filters`,
    priceSummary(kept.filter((it) => it.currency === "GBP").map((it) => it.price).filter((x) => x != null), "Price (before postage)"),
    `Search page: ${firstUrl}`,
    "",
    "| # | Price | Shop | Rating (reviews) | Delivery | Notes | Title | Link |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map((it, i) => {
      const price = `${it.currency === "GBP" ? gbp(it.price) : `${it.price ?? "?"} ${it.currency}`}${it.originalPrice ? ` (was ${gbp(it.originalPrice)})` : ""}`;
      const notesCell = [it.ad && "ad", it.starSeller && "Star Seller", it.bestseller && "bestseller", it.discount].filter(Boolean).join(", ");
      return `| ${start + i + 1} | ${price} | ${cell(it.shop || "?", 24)} | ${it.rating ?? "?"}★${it.reviews != null ? ` (${it.reviews})` : ""} | ${it.freeDelivery ? "free" : "?"} | ${notesCell} | ${cell(it.title, 80)} | ${it.url} |`;
    }),
  ];
  if (more) lines.push("", `${more} more matched. Call again with show_from=${start + rows.length} to see them.`);
  if (!kept.length) lines.push("", "Nothing matched. Try loosening the filters or a broader query.");
  lines.push("", "Delivery '?' = not shown on the results page; open_listings gives postage and dispatch times. Rating (reviews) is the listing's or shop's, as shown on the card.");
  if (notes.length) lines.push("", ...notes);
  return lines.join("\n");
}
