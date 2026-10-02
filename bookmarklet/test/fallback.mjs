import { readFileSync } from "fs";
import { createRequire } from "module";
const pw = createRequire(import.meta.url)("playwright");
const SRC = readFileSync(new URL("../copy-for-claude.min.js", import.meta.url), "utf8") // test what ships;
const b = await pw.chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true }); // no clipboard permission
await ctx.route("**/*", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: "<main><li class='s-item'><a href='https://www.ebay.co.uk/itm/335512345678'><div class='s-item__title'>Test item</div></a><span>£5.00</span></li></main>" }));
const p = await ctx.newPage();
await p.goto("https://www.ebay.co.uk/sch/i.html?_nkw=x");
await p.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error("denied")); });
await p.evaluate((src) => { location.href = "javascript:" + encodeURIComponent(src); }, SRC).catch(() => {});
await p.waitForSelector("#c4c-panel");
await p.waitForTimeout(300);
console.log("panel message:", await p.textContent("#c4c-panel div"));
const box = await p.$eval("#c4c-panel", (e) => { const r = e.getBoundingClientRect(); return [r.left, r.right, innerWidth]; });
console.log("panel fits phone width:", box[0] >= 0 && box[1] <= box[2], box);
await p.screenshot({ path: process.env.SHOT });
await b.close();
