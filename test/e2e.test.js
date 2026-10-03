// End-to-end: start the extension like Claude Desktop does (stdio), call its tools with the official
// MCP client, and let a real Chromium read sample eBay/Etsy results pages served on the real URLs.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ebaySearchUrl, etsySearchUrl } from "../server/urls.js";

const doc = (body, head = "") => `<!doctype html><html><head><meta charset="utf-8"><title>t</title>${head}</head><body><main>${body}</main></body></html>`;

// eBay: 580 results over 3 pages; page 1 uses the newer card layout, pages 2-3 the older one.
const ebayItem = (i) => ({
  id: String(300000000000 + i),
  title: i % 40 === 5 ? `Nintendo Switch OLED BROKEN spares ${i}` : `Nintendo Switch OLED White ${i}`,
  price: 120 + (i % 150),
  postage: i % 3 === 0 ? 0 : 3.99,
  fb: i % 17 === 0 ? 91.5 : 99.6,
  fbCount: 50 + i,
  auction: i % 25 === 3,
});
const sCard = (x) => `<li class="s-card s-card--horizontal" data-listingid="${x.id}"><div class="su-card-container">
  <a class="su-link" href="https://www.ebay.co.uk/itm/${x.id}?_skw=x&amp;hash=1"><div role="heading" class="s-card__title"><span>${x.title}</span><span class="clipped">Opens in a new window or tab</span></div></a>
  <div class="s-card__subtitle"><span>Pre-owned · Nintendo Switch</span></div>
  <div class="s-card__attribute-row"><span class="s-card__price">£${x.price.toFixed(2)}</span></div>
  ${x.auction ? `<div class="s-card__attribute-row"><span>2 bids · 1d 3h left</span></div>` : `<div class="s-card__attribute-row"><span>or Best Offer</span></div>`}
  <div class="s-card__attribute-row"><span>${x.postage ? `+£${x.postage.toFixed(2)} delivery` : "Free delivery"}</span></div>
  <div class="s-card__attribute-row"><span>Located in United Kingdom</span></div>
  <div class="su-card-container__attributes__secondary"><span>seller${x.id.slice(-3)} ${x.fb}% positive (${x.fbCount})</span></div></div></li>`;
const sItem = (x) => `<li class="s-item"><a class="s-item__link" href="https://www.ebay.co.uk/itm/Nintendo/${x.id}?hash=x">
  <div class="s-item__title"><span>${x.title}</span></div></a>
  <div class="s-item__subtitle"><span class="SECONDARY_INFO">Pre-owned</span></div>
  <div><span class="s-item__price">£${x.price.toFixed(2)}</span></div>
  <div><span class="s-item__shipping">${x.postage ? `+£${x.postage.toFixed(2)} postage` : "Free postage"}</span></div>
  <div><span class="s-item__seller-info-text">seller${x.id.slice(-3)} (${x.fbCount}) ${x.fb}%</span></div></li>`;
const ebayPage = (from, to, layout) => doc(`<h1 class="srp-controls__count-heading"><span>580</span> results for switch oled</h1>
  <ul class="srp-results"><li class="s-item"><a href="https://ebay.com/itm/123456">Shop on eBay</a></li>
  ${Array.from({ length: to - from }, (_, k) => layout(ebayItem(from + k))).join("\n")}</ul>`);

// Etsy: 2 pages of 64 cards, "128 results".
const etsyCard = (i) => `<li><div class="v2-listing-card" data-listing-id="${5000 + i}">
  <a class="listing-link" href="https://www.etsy.com/uk/listing/${5000 + i}/leather-collar?ref=search" title="Leather Dog Collar ${i}"><img alt="x" src="x.jpg"></a>
  ${i % 10 === 0 ? "<div>Ad by Etsy seller</div>" : ""}
  <div>${(4.5 + (i % 5) / 10).toFixed(1)} (${100 + i})</div><div>CollarShop${i % 7}</div>
  <div>£${(15 + (i % 30)).toFixed(2)}</div>${i % 2 ? "<div>FREE UK delivery</div>" : ""}</div></li>`;
const etsyPage = (from) => doc(`<span>128 results</span><ol>${Array.from({ length: 64 }, (_, k) => etsyCard(from + k)).join("")}</ol>`);

const EBAY_ARGS = { query: "switch oled", max_price: 300, condition: ["used"] };
const ETSY_ARGS = { query: "dog collar", max_price: 40 };
const routes = {
  [ebaySearchUrl(EBAY_ARGS, 1)]: ebayPage(0, 240, sCard),
  [ebaySearchUrl(EBAY_ARGS, 2)]: ebayPage(240, 480, sItem),
  [ebaySearchUrl(EBAY_ARGS, 3)]: ebayPage(480, 580, sItem),
  [etsySearchUrl(ETSY_ARGS, 1)]: etsyPage(0),
  [etsySearchUrl(ETSY_ARGS, 2)]: etsyPage(64),
  "https://www.ebay.co.uk/itm/300000000001": {
    headers: { "Content-Security-Policy": "script-src 'none'; object-src 'none'" },
    body: doc(`<h1 class="x-item-title__mainTitle"><span>Nintendo Switch OLED White 1</span></h1><div class="x-price-primary">£121.00</div>
      <dl class="ux-labels-values"><dt class="ux-labels-values__labels">Returns:</dt><dd class="ux-labels-values__values">30 days returns. Buyer pays for return postage.</dd></dl>`),
  },
  "https://www.etsy.com/uk/listing/999/blocked": doc("<p>Please enable JS and disable any ad blocker</p>", "<script src='https://js.datadome.co/tags.js'></script>"),
};

let client, logFile;
const loads = () => readFileSync(logFile, "utf8").split("\n").filter((u) => routes[u] != null);

before(async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "bulk-shopper-"));
  const routesFile = path.join(tmp, "routes.json");
  logFile = path.join(tmp, "log.txt");
  writeFileSync(routesFile, JSON.stringify(routes));
  writeFileSync(logFile, "");
  client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../server/index.js", import.meta.url).pathname],
    env: {
      ...process.env,
      SHOPPER_BROWSER_PATH: process.env.SHOPPER_BROWSER_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
      SHOPPER_HEADLESS: process.env.E2E_HEADED ? "false" : "true",
      SHOPPER_PROFILE_DIR: path.join(tmp, "profile"),
      SHOPPER_MIN_GAP_MS: "0",
      SHOPPER_CHALLENGE_WAIT_MS: "3000",
      SHOPPER_TEST_ROUTES: routesFile,
      SHOPPER_TEST_LOG: logFile,
    },
  }));
});
after(() => client.close());

const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError };
};
const rows = (t) => t.split("\n").filter((l) => /^\| \d+ \|/.test(l));

test("lists three tools", async () => {
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name), ["ebay_search", "etsy_search", "open_listings"]);
});

test("ebay_search reads 3 pages (580 listings), filters, summarises, then serves more rows from cache", async () => {
  const t0 = Date.now();
  const { text, isError } = await call("ebay_search", { ...EBAY_ARGS, pages: 5, exclude_words: ["broken"], min_feedback_pct: 98, order_results: "cheapest", show: 15 });
  const secs = (Date.now() - t0) / 1000;
  assert.equal(isError, false, text);
  const items = Array.from({ length: 580 }, (_, i) => ebayItem(i));
  const kept = items.filter((x) => !/BROKEN/.test(x.title) && x.fb >= 98);
  assert.match(text, new RegExp(`580 matches on eBay · read 580 from 3 pages · ${kept.length} after your filters`));
  assert.equal(loads().length, 3, "only the 3 pages that exist are loaded, though 5 were allowed");
  const totals = kept.map((x) => x.price + x.postage).sort((a, b) => a - b);
  assert.match(text, new RegExp(`lowest £${totals[0].toFixed(2)} · `));
  assert.match(text, new RegExp(`highest £${totals[totals.length - 1].toFixed(2)}`));
  const r = rows(text);
  assert.equal(r.length, 15);
  const shown = r.map((l) => Number(l.split("|")[2].trim().slice(1)));
  assert.deepEqual(shown, [...shown].sort((a, b) => a - b));
  assert.ok(r.some((l) => /\| BIN \/ offers \|/.test(l)) || r.some((l) => /Auction, 2 bids, 1d 3h left/.test(l)));
  assert.match(r[0], /seller\d{3} 99\.6% \(\d+\) \| United Kingdom|seller\d{3} 99\.6% \(\d+\) \| UK\?/);
  assert.match(r[0], /\| https:\/\/www\.ebay\.co\.uk\/itm\/3000000\d{5} \|$/);
  assert.ok(!/BROKEN|Opens in a new window|123456 \|/.test(text));
  console.log(`  ebay_search: 580 listings over 3 pages in ${secs.toFixed(1)}s\n` + text.split("\n").slice(0, 9).map((l) => "    " + l).join("\n"));

  const before = loads().length;
  const next = await call("ebay_search", { ...EBAY_ARGS, pages: 5, exclude_words: ["broken"], min_feedback_pct: 98, order_results: "cheapest", show: 15, show_from: 15 });
  assert.equal(loads().length, before, "show_from is served from cache, no page loads");
  assert.equal(Number(rows(next.text)[0].split("|")[1].trim()), 16);
});

test("etsy_search reads both pages, parses cards and filters", async () => {
  const { text, isError } = await call("etsy_search", { ...ETSY_ARGS, pages: 8, min_rating: 4.7, hide_ads: true, show: 250 });
  assert.equal(isError, false, text);
  const expected = Array.from({ length: 128 }, (_, i) => i).filter((i) => 4.5 + (i % 5) / 10 >= 4.7 && i % 10 !== 0 && 15 + (i % 30) <= 40).length;
  assert.match(text, new RegExp(`128 results on Etsy · read 128 from 2 pages · ${expected} after your filters`));
  assert.equal(rows(text).length, expected);
  console.log(text.split("\n").slice(0, 8).map((l) => "    " + l).join("\n"));
  assert.match(text, /\| £\d+\.00 \| CollarShop\d \| 4\.\d★ \(\d+\) \| (free|\?) \|/);
  assert.match(text, /https:\/\/www\.etsy\.com\/uk\/listing\/50\d\d \|/);
});

test("open_listings reads a listing page even with a strict script policy", async () => {
  const { text } = await call("open_listings", { urls: ["https://www.ebay.co.uk/itm/300000000001"] });
  assert.match(text, /Title: Nintendo Switch OLED White 1\nPrice: £121\.00/);
  assert.match(text, /Returns: 30 days returns/);
});

test("a human check is reported clearly", async () => {
  const { text } = await call("open_listings", { urls: ["https://www.etsy.com/uk/listing/999/blocked"] });
  assert.match(text, /confirm you're human/);
});

test("only eBay and Etsy pages can be opened", async () => {
  const r = await call("open_listings", { urls: ["https://evil.example.com/x"] });
  assert.equal(r.isError, true);
  assert.match(r.text, /Only eBay and Etsy pages/);
});
