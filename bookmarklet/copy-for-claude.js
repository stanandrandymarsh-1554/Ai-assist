/* Copy for Claude: bookmarklet that turns the eBay or Etsy page you're looking at
   into compact text and copies it, ready to paste into a Claude chat.
   Runs only in your own browser, on the page you already have open. */
(() => {
  const T = (s) => (s || "").replace(/\s+/g, " ").trim();
  const host = location.hostname;
  const path = location.pathname;
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const NOISE = /^(opens in a new window or tab|sponsored|new listing|shop on ebay|watch|watching|save|saved|ad|ad by etsy seller|add to favourites|add to favorites|remove from favourites|see more like this|more like this|more colours|more colors|\||·|•|-)$/i;
  const lines = (el, skip = []) => {
    const seen = new Set(skip.map(T));
    const out = [];
    for (const raw of (el.innerText || el.textContent || "").split("\n")) {
      const t = T(raw);
      if (!t || seen.has(t) || NOISE.test(t) || t.length > 140) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  };
  const ld = () => {
    const found = [];
    const walk = (o) => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o && typeof o === "object") {
        found.push(o);
        Object.values(o).forEach(walk);
      }
    };
    for (const s of qsa('script[type="application/ld+json"]')) {
      try { walk(JSON.parse(s.textContent)); } catch (e) { /* ignore bad blocks */ }
    }
    return found.filter((o) => [].concat(o["@type"]).includes("Product"));
  };
  const money = (o) => {
    o = [].concat(o || [])[0];
    if (!o) return "";
    const c = o.priceCurrency || "";
    if (o.price != null) return `${o.price} ${c}`.trim();
    if (o.lowPrice != null) return `${o.lowPrice}${o.highPrice && o.highPrice != o.lowPrice ? "–" + o.highPrice : ""} ${c}`.trim();
    return "";
  };
  const pageText = (limit) => {
    const main = qs("main") || qs("#mainContent") || qs("#content") || document.body;
    const text = lines(main).join("\n");
    return text.length > limit ? text.slice(0, limit) + "\n…(trimmed)" : text;
  };

  const isEbay = /(^|\.)ebay\./.test(host) || !!qs("li.s-item, li.s-card, .x-item-title");
  const isEtsy = /(^|\.)etsy\.com$/.test(host) || !!qs("[data-listing-id]");
  const site = isEbay ? (host.endsWith(".co.uk") ? "eBay UK" : host.replace(/^www\./, "") || "eBay") : isEtsy ? (path.startsWith("/uk") ? "Etsy UK" : "Etsy") : host;
  const ebayBase = /(^|\.)ebay\./.test(host) ? `https://${host}` : "https://www.ebay.co.uk";
  let kind = "page", body = [], count = 0;

  if (isEbay && /\/itm\//.test(path) || isEbay && qs(".x-item-title")) {
    kind = "listing";
    const title = T((qs(".x-item-title__mainTitle") || qs("h1") || {}).innerText);
    body.push(`Title: ${title}`);
    const add = (label, sel) => { const el = qs(sel); if (el) { const t = lines(el).join(" · "); if (t) body.push(`${label}: ${t}`); } };
    add("Price", ".x-price-primary");
    add("Bids / time left", ".x-bid-count, .x-end-time, .x-timer");
    add("Quantity", ".x-quantity");
    add("Seller", ".x-sellercard-atf, [data-testid='x-sellercard-atf']");
    const pairs = qsa(".ux-labels-values").map((row) => {
      const l = qs(".ux-labels-values__labels", row), v = qs(".ux-labels-values__values", row);
      return l && v ? `${T(l.innerText).replace(/:$/, "")}: ${lines(v).filter((x) => !/^(see all condition definitions|read more|see details)/i.test(x)).join(" ")}` : "";
    }).filter(Boolean);
    if (pairs.length) body.push("Details:", ...[...new Set(pairs)].map((p) => "  " + p.slice(0, 300)));
    const desc = qsa("iframe").map((f) => f.src).find((s) => /ebaydesc\.com/.test(s));
    if (desc) body.push(`Seller's description (separate page): ${desc}`);
    count = 1;
  } else if (isEbay) {
    kind = /LH_Sold=1/.test(location.search) ? "sold listings" : "search results";
    const seen = new Set();
    for (const card of qsa("li.s-item, li.s-card, li[data-listingid]")) {
      const a = qsa("a[href*='/itm/']", card)[0];
      const m = a && a.href.match(/\/itm\/(?:[^/?#]+\/)?(\d{9,15})/);
      if (!m || m[1] === "123456" || seen.has(m[1])) continue;
      seen.add(m[1]);
      const tEl = qs(".s-item__title, .s-card__title, [role='heading']", card);
      let title = T(tEl ? tEl.innerText : "").replace(/^new listing\s*/i, "").replace(/\s*opens in a new window or tab$/i, "");
      if (!title) title = T((qs("img[alt]", card) || {}).alt);
      const info = lines(card, [title, tEl ? tEl.innerText : ""]).slice(0, 9);
      count++;
      body.push(`${count}. ${title}`, `   ${info.join(" | ")}`, `   ${ebayBase}/itm/${m[1]}`);
    }
  } else if (isEtsy && /\/listing\/\d+/.test(path)) {
    kind = "listing";
    const p = ld()[0];
    const title = T(p && p.name) || T((qs("h1") || {}).innerText);
    body.push(`Title: ${title}`);
    if (p) {
      const r = p.aggregateRating || {};
      const shop = p.brand && (p.brand.name || p.brand);
      body.push(...[
        money(p.offers) && `Price: ${money(p.offers)}`,
        shop && `Shop: ${shop}`,
        r.ratingValue && `Rating: ${r.ratingValue}★ from ${r.reviewCount || r.ratingCount || "?"} reviews`,
      ].filter(Boolean));
    }
    body.push("Page text:", pageText(7000));
    count = 1;
  } else if (isEtsy) {
    kind = path.startsWith("/shop") || path.includes("/shop/") ? "shop page" : "search results";
    const seen = new Set();
    for (const a of qsa("a[href*='/listing/']")) {
      const m = a.href.match(/\/listing\/(\d+)/);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      // Widen from the link to the largest box that still holds only this one listing.
      let card = a;
      while (card.parentElement && card.parentElement !== document.body) {
        const ids = new Set(qsa("a[href*='/listing/']", card.parentElement).map((x) => (x.href.match(/\/listing\/(\d+)/) || [])[1]));
        if (ids.size > 1) break;
        card = card.parentElement;
      }
      const tEl = qs("h2, h3, .v2-listing-card__title", card);
      const title = T(a.getAttribute("title")) || T(tEl && tEl.innerText) || T((qs("img[alt]", card) || {}).alt);
      const info = lines(card, [title]).slice(0, 8);
      count++;
      body.push(`${count}. ${title}`, `   ${info.join(" | ")}`, `   ${a.href.split("?")[0]}`);
    }
    if (kind === "shop page") {
      const head = qs("[data-region='shop-header'], .shop-home-wider-sections, header") || null;
      if (head) body.unshift("Shop info: " + lines(head).slice(0, 12).join(" | "), "");
    }
  }
  if (!count) {
    kind = "page";
    body = ["Page text:", pageText(9000)];
  }

  const header = [
    `### ${window.__c4cSilent ? "" : "Copied for Claude · "}${site} ${kind}${count > 1 ? ` · ${count} items` : ""} · ${new Date().toLocaleDateString("en-GB")}`,
    `Page: ${location.href}`,
    "",
  ];
  const text = header.concat(body).join("\n");
  window.__copyForClaude = text;
  if (window.__c4cSilent) return; // the desktop extension reads the text itself: no panel, no clipboard

  /* Show a small panel: auto-copy when the browser allows it, otherwise a Copy button. */
  const old = document.getElementById("c4c-panel");
  if (old) old.remove();
  const panel = document.createElement("div");
  panel.id = "c4c-panel";
  panel.setAttribute("style", "position:fixed;z-index:2147483647;left:12px;right:12px;bottom:12px;max-width:460px;margin:0 auto;background:#1d2421;color:#f3f6f4;font:14px/1.4 -apple-system,system-ui,sans-serif;border-radius:12px;padding:14px;box-shadow:0 8px 30px rgba(0,0,0,.35)");
  const msg = document.createElement("div");
  msg.style.marginBottom = "10px";
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.readOnly = true;
  ta.setAttribute("style", "width:100%;box-sizing:border-box;height:90px;font:12px/1.35 ui-monospace,monospace;border-radius:8px;border:0;padding:8px;background:#0f1412;color:#cfe3d9");
  const row = document.createElement("div");
  row.setAttribute("style", "display:flex;gap:8px;margin-top:10px");
  const btn = (label, fn, primary) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.setAttribute("style", `flex:1;padding:10px;border-radius:8px;border:0;font:600 14px system-ui,sans-serif;cursor:pointer;background:${primary ? "#7fd1a8" : "#33403a"};color:${primary ? "#0f1412" : "#f3f6f4"}`);
    b.onclick = fn;
    return b;
  };
  const what = kind === "listing" || kind === "page" ? `this ${site} ${kind}` : `${count} ${site} listing${count === 1 ? "" : "s"}`;
  const done = () => { msg.textContent = `✓ Copied ${what}. Now paste it into your Claude chat.`; };
  const copy = () => {
    const fallback = () => {
      ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { /* not supported */ }
      msg.textContent = ok ? `✓ Copied ${what}. Now paste it into your Claude chat.` : "Select all the text in the box and copy it, then paste it into Claude.";
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  };
  msg.textContent = `Ready: ${what}.`;
  row.append(btn("Copy", copy, true), btn("Close", () => panel.remove()));
  panel.append(msg, ta, row);
  document.body.appendChild(panel);
  copy();
})();
