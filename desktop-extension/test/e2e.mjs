// End-to-end: start the extension like Claude Desktop does, call its tools over MCP,
// with a real Chromium reading sample eBay/Etsy pages served on the real URLs.
import assert from "assert/strict";
import { mkdtempSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ebaySearchUrl, etsySearchUrl } from "../server/urls.js";

const doc = (body, head = "") => `<!doctype html><html><head><title>t</title>${head}</head><body><main>${body}</main></body></html>`;
const ebayUrl = ebaySearchUrl({ query: "switch oled", max_price: 200, condition: ["used"], free_postage: true });
const soldUrl = ebaySearchUrl({ query: "switch oled", sold: true });
const etsyUrl = etsySearchUrl({ query: "dog collar", sort: "top_reviews" });
const tmp = mkdtempSync(path.join(os.tmpdir(), "shopper-"));
const routes = {
  [ebayUrl]: doc(`<ul><li class="s-item"><a href="https://www.ebay.co.uk/itm/335512345678"><div class="s-item__title"><span>Nintendo Switch OLED White</span></div></a>
     <div>Pre-owned</div><div><span class="s-item__price">£164.99</span></div><div>Free postage</div><div>gamerguy (2,345) 99.7%</div></li></ul>`),
  [soldUrl]: doc(`<ul><li class="s-card"><a href="https://www.ebay.co.uk/itm/226612345678"><div class="s-card__title"><span>Switch OLED Neon</span></div></a>
     <div>Sold 28 Sep 2026</div><div class="s-card__price">£189.00</div></li></ul>`),
  [etsyUrl]: doc(`<div data-listing-id="1"><a class="listing-link" href="https://www.etsy.com/uk/listing/664834088/collar" title="Leather Dog Collar"></a>
     <div>4.9 (1.2k)</div><div>TheStatelyHound</div><div>£23.00</div><div>FREE UK delivery</div></div>`),
  // A listing served with a strict script policy, like the real sites: the extractor must still run.
  "https://www.ebay.co.uk/itm/335512345678": {
    headers: { "Content-Security-Policy": "script-src 'none'; object-src 'none'" },
    body: doc(`<h1 class="x-item-title__mainTitle"><span>Nintendo Switch OLED White</span></h1><div class="x-price-primary">£164.99</div>
      <dl class="ux-labels-values"><dt class="ux-labels-values__labels">Returns:</dt><dd class="ux-labels-values__values">30 days returns</dd></dl>`),
  },
  "https://www.etsy.com/uk/listing/999/blocked": doc("<p>Please enable JS and disable any ad blocker</p>", "<script src='https://js.datadome.co/tags.js'></script>"),
};
const routesFile = path.join(tmp, "routes.json");
writeFileSync(routesFile, JSON.stringify(routes));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL("../server/index.js", import.meta.url).pathname],
  env: {
    ...process.env,
    SHOPPER_BROWSER_PATH: process.env.SHOPPER_BROWSER_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    SHOPPER_HEADLESS: process.env.E2E_HEADED ? "false" : "true",
    SHOPPER_PROFILE_DIR: path.join(tmp, "profile"),
    SHOPPER_MIN_GAP_MS: "0",
    SHOPPER_TEST_ROUTES: routesFile,
  },
});
const client = new Client({ name: "test", version: "0" });
await client.connect(transport);

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(tools, ["ebay_search", "etsy_search", "open_page"]);
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  const t = r.content.map((c) => c.text).join("\n");
  console.log(`\n▶ ${name} ${JSON.stringify(args)}${r.isError ? "  [error]" : ""}\n${t}`);
  return { t, err: !!r.isError };
};

let r = await call("ebay_search", { query: "switch oled", max_price: 200, condition: ["used"], free_postage: true });
assert.match(r.t, /^### eBay UK search results · 02|^### eBay UK search results/);
assert.match(r.t, /1\. Nintendo Switch OLED White\n   Pre-owned \| £164\.99 \| Free postage \| gamerguy \(2,345\) 99\.7%\n   https:\/\/www\.ebay\.co\.uk\/itm\/335512345678/);

r = await call("ebay_search", { query: "switch oled", sold: true });
assert.match(r.t, /eBay UK sold listings/);
assert.match(r.t, /Sold 28 Sep 2026 \| £189\.00/);

r = await call("etsy_search", { query: "dog collar", sort: "top_reviews" });
assert.match(r.t, /1\. Leather Dog Collar\n   4\.9 \(1\.2k\) \| TheStatelyHound \| £23\.00 \| FREE UK delivery/);

r = await call("open_page", { url: "https://www.ebay.co.uk/itm/335512345678" });
assert.match(r.t, /Title: Nintendo Switch OLED White\nPrice: £164\.99/);
assert.match(r.t, /Returns: 30 days returns/);

r = await call("open_page", { url: "https://www.etsy.com/uk/listing/999/blocked" });
assert.match(r.t, /confirm you're human/); // headed: waits for the user, then explains

r = await call("open_page", { url: "https://evil.example.com/steal" });
assert.ok(r.err && /Only eBay and Etsy/.test(r.t));

await client.close();
console.log("\nEXTENSION E2E PASSED");
