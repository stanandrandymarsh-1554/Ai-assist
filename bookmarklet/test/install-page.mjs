// The install page must hand out exactly the code that was tested.
import { readFileSync } from "fs";
import { createRequire } from "module";
import assert from "assert/strict";
const pw = createRequire(import.meta.url)("playwright");
const min = readFileSync(new URL("../copy-for-claude.min.js", import.meta.url), "utf8").trim();
const html = readFileSync(new URL("../install.html", import.meta.url), "utf8");
const b = await pw.chromium.launch();
const ctx = await b.newContext({ viewport: { width: 400, height: 900 } });
await ctx.route("**/*", (r) => {
  const u = r.request().url();
  if (u.startsWith("https://install.test/")) return r.fulfill({ contentType: "text/html; charset=utf-8", body: "<!doctype html><meta name=viewport content='width=device-width'>" + html });
  if (u.startsWith("https://www.ebay.co.uk/")) return r.fulfill({ contentType: "text/html; charset=utf-8", body: "<main><li class='s-item'><a href='https://www.ebay.co.uk/itm/335512345678'><div class='s-item__title'>Round trip item</div></a><span>£9.99</span></li></main>" });
  return r.fulfill({ status: 204, body: "" });
});
const p = await ctx.newPage();
await p.goto("https://install.test/");
const href = await p.getAttribute("#tag", "href");
assert.equal(decodeURIComponent(href.slice("javascript:".length)), min);
assert.equal(await p.inputValue("#code"), href);
const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
assert.equal(overflow, false, "no sideways scroll at phone width");
await p.screenshot({ path: process.env.SHOT, fullPage: true });
await p.goto("https://www.ebay.co.uk/sch/i.html?_nkw=x");
await p.evaluate((h) => { location.href = h; }, href).catch(() => {});
await p.waitForSelector("#c4c-panel");
assert.match(await p.evaluate(() => window.__copyForClaude), /1\. Round trip item\n   £9\.99\n   https:\/\/www\.ebay\.co\.uk\/itm\/335512345678/);
console.log("INSTALL PAGE ROUND TRIP OK");
await b.close();
