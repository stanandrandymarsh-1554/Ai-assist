// Functions that run inside a results page and return raw cards:
// { id, url, title, price, lines[] }. Interpreting the lines happens in parse.js.

export function collectEbayCards() {
  const T = (s) => (s || "").replace(/\s+/g, " ").trim();
  const NOISE = /^(opens in a new window or tab|new listing|shop on ebay|watch|sponsored|\||·)$/i;
  const out = [];
  const seen = new Set();
  const totalText = (document.querySelector(".srp-controls__count-heading, .result-count__count-heading") || {}).innerText || "";
  for (const card of document.querySelectorAll("li.s-item, li.s-card, li[data-listingid]")) {
    const a = Array.from(card.querySelectorAll("a[href*='/itm/']"))[0];
    const m = a && a.href.match(/\/itm\/(?:[^/?#]+\/)?(\d{9,15})/);
    if (!m || m[1] === "123456" || seen.has(m[1])) continue;
    seen.add(m[1]);
    const tEl = card.querySelector(".s-item__title, .s-card__title, [role='heading']");
    let title = T(tEl ? tEl.innerText : "").replace(/^new listing\s*/i, "").replace(/\s*opens in a new window or tab$/i, "");
    if (!title) title = T((card.querySelector("img[alt]") || {}).alt);
    const priceEl = card.querySelector(".s-item__price, .s-card__price");
    const lines = [];
    for (const raw of (card.innerText || "").split("\n")) {
      const t = T(raw);
      if (t && !NOISE.test(t) && t !== title && !lines.includes(t) && t.length <= 160) lines.push(t);
    }
    out.push({ id: m[1], title, price: T(priceEl && priceEl.innerText), lines: lines.slice(0, 14),
      sponsored: /\bsponsored\b/i.test(card.innerText || "") });
  }
  return { total: T(totalText), cards: out, host: location.host };
}

export function collectEtsyCards() {
  const T = (s) => (s || "").replace(/\s+/g, " ").trim();
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll("a[href*='/listing/']")) {
    const m = a.href.match(/\/listing\/(\d+)/);
    if (!m || seen.has(m[1])) continue;
    // Widen from the link to the largest box that still holds only this one listing.
    let card = a;
    while (card.parentElement && card.parentElement !== document.body) {
      const ids = new Set(Array.from(card.parentElement.querySelectorAll("a[href*='/listing/']")).map((x) => (x.href.match(/\/listing\/(\d+)/) || [])[1]));
      if (ids.size > 1) break;
      card = card.parentElement;
    }
    seen.add(m[1]);
    const tEl = card.querySelector("h2, h3, .v2-listing-card__title");
    const title = T(a.getAttribute("title")) || T(tEl && tEl.innerText) || T((card.querySelector("img[alt]") || {}).alt);
    const lines = [];
    for (const raw of (card.innerText || "").split("\n")) {
      const t = T(raw);
      if (t && t !== title && !lines.includes(t) && t.length <= 160) lines.push(t);
    }
    out.push({ id: m[1], title, lines: lines.slice(0, 14) });
  }
  const totalText = Array.from(document.querySelectorAll("span, p, div")).map((e) => e.childElementCount === 0 ? T(e.textContent) : "")
    .find((t) => /^[\d,]+\+? results?/i.test(t) || /\([\d,]+\+? results?\)/i.test(t)) || "";
  return { total: totalText, cards: out, host: location.host };
}
