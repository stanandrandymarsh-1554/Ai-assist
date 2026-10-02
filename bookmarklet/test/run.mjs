// Runs the bookmarklet in real Chromium against sample eBay/Etsy pages served on the real hostnames.
import { createRequire } from "module";
import { readFileSync } from "fs";
import assert from "assert/strict";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require(require("child_process").execSync("npm root -g").toString().trim() + "/playwright"); }

const SRC = readFileSync(new URL("../copy-for-claude.min.js", import.meta.url), "utf8") // test what ships;
const page = (body, head = "") => `<!doctype html><html><head>${head}</head><body><main>${body}</main><footer>Footer junk</footer></body></html>`;

const EBAY_SEARCH = page(`
<ul class="srp-results">
<li class="s-item"><a href="https://www.ebay.co.uk/itm/123456">Shop on eBay</a></li>
<li class="s-item">
  <a class="s-item__link" href="https://www.ebay.co.uk/itm/Nintendo-Switch-OLED/335512345678?hash=x">
   <div class="s-item__title"><span><span>New listing</span>Nintendo Switch OLED White</span><span class="clipped">Opens in a new window or tab</span></div></a>
  <div class="s-item__subtitle"><span class="SECONDARY_INFO">Pre-owned</span></div>
  <div><span class="s-item__price">£164.99</span></div>
  <div><span class="s-item__shipping">+£3.99 postage</span></div>
  <div><span class="s-item__location">from United Kingdom</span></div>
  <div><span>gamerguy (2,345) 99.7%</span></div>
</li>
<li class="s-card"><a class="su-link" href="https://www.ebay.co.uk/itm/226612345678"><div class="s-card__title"><span>Switch OLED Neon + 3 games</span></div></a>
  <div class="s-card__attribute-row"><span>Sold 28 Sep 2026</span></div>
  <div class="s-card__attribute-row"><span class="s-card__price">£189.00</span></div>
  <div class="s-card__attribute-row"><span>Free postage</span></div></li>
</ul>`);

const EBAY_ITEM = page(`
<h1 class="x-item-title__mainTitle"><span>Nintendo Switch OLED White w/ Dock</span></h1>
<div class="x-price-primary"><span>£164.99</span></div>
<div class="x-sellercard-atf"><div>gamerguy</div><div>(2345)</div><div>99.7% positive</div></div>
<dl class="ux-labels-values"><dt class="ux-labels-values__labels"><span>Condition:</span></dt><dd class="ux-labels-values__values"><div>Used</div><div>See all condition definitions</div></dd></dl>
<dl class="ux-labels-values"><dt class="ux-labels-values__labels"><span>Postage:</span></dt><dd class="ux-labels-values__values"><div>£3.99 Evri Standard</div></dd></dl>
<dl class="ux-labels-values"><dt class="ux-labels-values__labels"><span>Returns:</span></dt><dd class="ux-labels-values__values"><div>30 days returns. Buyer pays for return postage.</div></dd></dl>
<iframe id="desc_ifr" src="https://vi.vipr.ebaydesc.com/itmdesc/335512345678"></iframe>`);

const ETSY_SEARCH = page(`
<ol>
<li><div class="v2-listing-card" data-listing-id="664834088">
  <a class="listing-link" data-listing-id="664834088" href="https://www.etsy.com/uk/listing/664834088/leather-dog-collar?ga=1" title="Leather Dog Collar, Personalised, Brass">
   <img alt="Leather Dog Collar" src="x.jpg"></a>
  <h3 class="v2-listing-card__title">Leather Dog Collar, Personalised, Brass</h3>
  <div>4.9 (1.2k)</div><div>TheStatelyHound</div>
  <div><span class="currency-symbol">£</span><span class="currency-value">23.00</span></div>
  <div>FREE UK delivery</div><div>Add to Favourites</div>
</div></li>
<li><div class="v2-listing-card" data-listing-id="1463237003">
  <a class="listing-link" href="https://www.etsy.com/uk/listing/1463237003/personalised-dog-collars" title="Personalised Dog Collar"></a>
  <h3>Personalised Dog Collar</h3><div>Ad by Etsy seller</div><div>£14.99</div><div>PaddingPaws</div></div></li>
</ol>`);

const ETSY_LISTING = page(`<h1>Leather Dog Collar, Personalised</h1><p>Only 3 left</p><p>Dispatches from United Kingdom</p>`,
 `<script type="application/ld+json">{"@type":"Product","name":"Leather Dog Collar, Personalised","brand":{"@type":"Brand","name":"TheStatelyHound"},
  "offers":{"@type":"AggregateOffer","lowPrice":"23.00","highPrice":"31.00","priceCurrency":"GBP"},"aggregateRating":{"ratingValue":"4.9","reviewCount":"1204"}}</script>`);

const routes = {
  "https://www.ebay.co.uk/sch/i.html?_nkw=switch+oled&LH_Sold=1&LH_Complete=1": EBAY_SEARCH,
  "https://www.ebay.co.uk/itm/335512345678": EBAY_ITEM,
  "https://www.etsy.com/uk/search?q=dog+collar": ETSY_SEARCH,
  "https://www.etsy.com/uk/listing/664834088/leather-dog-collar": ETSY_LISTING,
  "https://example.org/some-page": page("<p>Hello world</p>"),
};

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
await ctx.route("**/*", (r) => {
  const body = routes[r.request().url()];
  return body ? r.fulfill({ contentType: "text/html; charset=utf-8", body }) : r.fulfill({ status: 204, body: "" });
});
const results = {};
for (const url of Object.keys(routes)) {
  const p = await ctx.newPage();
  await p.goto(url);
  // Run it exactly as a bookmarklet: a javascript: URL built from the source.
  await p.evaluate((src) => { location.href = "javascript:" + encodeURIComponent(src); }, SRC).catch(() => {});
  await p.waitForSelector("#c4c-panel", { timeout: 5000 });
  const text = await p.evaluate(() => window.__copyForClaude);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  const msg = await p.textContent("#c4c-panel div");
  assert.equal(clip, text, "clipboard holds the text");
  assert.match(msg, /Copied/);
  results[url] = text;
  console.log("—".repeat(60) + "\n" + text + "\n[panel] " + msg);
  await p.close();
}
await browser.close();

const [sold, item, esearch, elisting, other] = Object.values(results);
assert.match(sold, /^### Copied for Claude · eBay UK sold listings · 2 items/);
assert.ok(!sold.includes("123456\n") && !sold.includes("Opens in a new window"));
assert.match(sold, /1\. Nintendo Switch OLED White\n   Pre-owned \| £164\.99 \| \+£3\.99 postage \| from United Kingdom \| gamerguy \(2,345\) 99\.7%\n   https:\/\/www\.ebay\.co\.uk\/itm\/335512345678/);
assert.match(sold, /2\. Switch OLED Neon \+ 3 games\n   Sold 28 Sep 2026 \| £189\.00 \| Free postage/);
assert.match(item, /eBay UK listing/);
assert.match(item, /Price: £164\.99/);
assert.match(item, /Seller: gamerguy · \(2345\) · 99\.7% positive/);
assert.match(item, /Condition: Used\n/);
assert.match(item, /Returns: 30 days returns/);
assert.match(item, /ebaydesc\.com/);
assert.match(esearch, /Etsy UK search results · 2 items/);
assert.match(esearch, /1\. Leather Dog Collar, Personalised, Brass\n   4\.9 \(1\.2k\) \| TheStatelyHound \| £23\.00 \| FREE UK delivery\n   https:\/\/www\.etsy\.com\/uk\/listing\/664834088\/leather-dog-collar\n/);
assert.ok(!esearch.includes("Add to Favourites") && !esearch.includes("Ad by Etsy seller"));
assert.match(elisting, /Price: 23\.00–31\.00 GBP\nShop: TheStatelyHound\nRating: 4\.9★ from 1204 reviews/);
assert.match(elisting, /Only 3 left/);
assert.match(other, /Page text:\nHello world/);
assert.ok(!other.includes("Footer junk"));
console.log("\nALL BOOKMARKLET CHECKS PASSED");
