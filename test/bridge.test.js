// Runs the connector behind a real HTTP server and talks to it with the official MCP client,
// the same way Claude does, against the fake eBay/Etsy APIs.
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handle } from "../lib/mcp.js";
import { buildFilter } from "../lib/ebay.js";
import { EBAY_ITEMS, ENV, ETSY_LISTINGS, fakeFetch } from "./fake-apis.js";

let server, base, client, calls, env;

async function serve(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const response = await handle(request, env, fakeFetch(calls));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

before(async () => {
  env = { ...ENV };
  calls = [];
  server = http.createServer(serve);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${ENV.BRIDGE_TOKEN}`)));
});
after(async () => { await client.close(); server.close(); });

const call = async (name, args) => {
  calls.length = 0;
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError };
};
const rows = (text) => text.split("\n").filter((l) => /^\| \d+ \|/.test(l));

describe("connector basics", () => {
  test("lists the five tools with schemas", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ["ebay_search", "ebay_items", "etsy_search", "etsy_listings", "etsy_shop"]);
    for (const t of tools) assert.equal(t.inputSchema.type, "object");
    assert.equal(client.getServerVersion().name, "marketplace-bridge");
    assert.match(client.getInstructions(), /UK/);
  });

  test("wrong or missing token gets 404, GET gets 405", async () => {
    assert.equal((await fetch(`${base}/mcp/wrong-token`, { method: "POST", body: "{}" })).status, 404);
    assert.equal((await fetch(`${base}/api/mcp`, { method: "POST", body: "{}" })).status, 404);
    assert.equal((await fetch(`${base}/api/mcp?token=${ENV.BRIDGE_TOKEN}`, { method: "GET" })).status, 405);
  });

  test("query-string token works too (Vercel rewrite form)", async () => {
    const r = await fetch(`${base}/api/mcp?token=${ENV.BRIDGE_TOKEN}`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    assert.deepEqual(await r.json(), { jsonrpc: "2.0", id: 1, result: {} });
  });
});

describe("ebay_search", () => {
  test("pulls 450 listings in parallel pages and applies filters", async () => {
    const { text, isError } = await call("ebay_search", {
      query: "switch oled", max_price: 250, condition: ["used"], free_postage: true, uk_only: true,
      max_results: 1000, exclude_words: ["broken"], min_feedback_pct: 98, order_results: "cheapest", show: 10,
    });
    assert.equal(isError, false, text);
    const searches = calls.filter((u) => u.pathname.endsWith("/item_summary/search"));
    assert.deepEqual(searches.map((u) => [u.searchParams.get("offset"), u.searchParams.get("limit")]), [["0", "200"], ["200", "200"], ["400", "200"]]);
    assert.equal(searches[0].searchParams.get("filter"),
      "price:[..250],priceCurrency:GBP,conditionIds:{3000|4000|5000|6000},buyingOptions:{FIXED_PRICE|AUCTION},maxDeliveryCost:0,itemLocationCountry:GB,deliveryCountry:GB");
    const expected = EBAY_ITEMS.filter((it, i) => !/broken/i.test(it.title) && i % 15 !== 0).length;
    assert.match(text, new RegExp(`450 matches on eBay · fetched 450 · ${expected} after your filters`));
    assert.match(text, /Price incl\. postage \(\d+ listings\): lowest £\d+\.\d\d · 25% .* median .* highest £\d+\.\d\d/);
    const r = rows(text);
    assert.equal(r.length, 10);
    const totals = r.map((l) => Number(l.split("|")[2].trim().slice(1)));
    assert.deepEqual(totals, [...totals].sort((a, b) => a - b), "cheapest first");
    assert.match(r[0], /Auction 4 bids, ends 2026-10-05 19:00/); // £80 bid + postage is cheapest
    assert.match(r[0], /https:\/\/www\.ebay\.co\.uk\/itm\/3000000000\d\d/);
    assert.match(text, new RegExp(`${expected - 10} more listings matched\\. Call again with show_from=10`));
    assert.ok(!/BROKEN/.test(text));
  });

  test("default max_results pulls one page of 200", async () => {
    const { text } = await call("ebay_search", { query: "switch" });
    assert.equal(calls.filter((u) => u.pathname.endsWith("/search")).length, 1);
    assert.match(text, /fetched 200/);
    assert.equal(rows(text).length, 40);
  });

  test("filter builder covers the other options", () => {
    assert.equal(buildFilter({ min_price: 10, listing_type: "buy_it_now", returns_accepted: true, seller_type: "business", exclude_sellers: ["a", "b"], search_descriptions: true }),
      "price:[10..],priceCurrency:GBP,buyingOptions:{FIXED_PRICE},returnsAccepted:true,sellerAccountTypes:{BUSINESS},excludeSellers:{a|b},searchInDescription:true,deliveryCountry:GB");
  });
});

describe("ebay_items", () => {
  test("details for several items, by link and number, with group fallback and per-item errors", async () => {
    const { text, isError } = await call("ebay_items", { items: ["https://www.ebay.co.uk/itm/Some-Title/300000000001?hash=x", "300000000002", "999999999999", "123456789012"] });
    assert.equal(isError, false);
    const out = JSON.parse(text);
    assert.equal(out[0].id, "300000000001");
    assert.equal(out[0].returns, "30 day, return postage paid by buyer");
    assert.equal(out[0].description, "Works perfectly.\nDock & box included");
    assert.deepEqual(out[0].specifics, { Colour: "White" });
    assert.equal(out[1].available, 2);
    assert.deepEqual(out[2].variations.map((v) => v.title), ["Shirt Size S", "Shirt Size M"]);
    assert.match(out[3].error, /Item not found/);
  });
});

describe("etsy_search", () => {
  test("pulls 250 listings, adds shop ratings in batches, filters in £", async () => {
    const { text, isError } = await call("etsy_search", { query: "dog collar", max_results: 1000, max_price: 40, min_shop_rating: 4.7, handmade_only: true, show: 200 });
    assert.equal(isError, false, text);
    const pages = calls.filter((u) => u.pathname.endsWith("/listings/active"));
    assert.deepEqual(pages.map((u) => u.searchParams.get("offset")), ["0", "100", "200"]);
    assert.equal(pages[0].searchParams.get("max_price"), "68"); // wide band; exact £ filter applied after
    assert.equal(calls.filter((u) => u.pathname.endsWith("/listings/batch")).length, 3);
    const rating = (shopId) => 4.5 + (shopId % 5) / 10;
    const expected = ETSY_LISTINGS.filter((l, i) => {
      const gbp = (l.price.amount / 100) * (l.price.currency_code === "USD" ? 0.75 : 1);
      return gbp <= 40 && rating(l.shop_id) >= 4.7 && l.who_made === "i_did";
    }).length;
    assert.match(text, new RegExp(`UK shops · 250 matches on Etsy · fetched 250 · ${expected} after your filters`));
    assert.equal(rows(text).length, expected);
    assert.match(text, /\| CollarShop\d+ 4\.\d★ \(\d+\) \|/);
    assert.match(text, /https:\/\/www\.etsy\.com\/uk\/listing\/\d+ \|/);
  });

  test("non-£ prices are shown with a rough £ conversion", async () => {
    const { text } = await call("etsy_search", { query: "dog collar", show: 200 });
    assert.match(text, /\| 15 USD \(≈£11\.25\) \|/); // listing 0: $15.00
  });

  test("listing details include postage and delivery days", async () => {
    const out = JSON.parse((await call("etsy_listings", { listings: ["https://www.etsy.com/uk/listing/1003/collar", 1004, "424242"] })).text);
    assert.equal(out[0].id, 1003);
    assert.deepEqual(out[0].postage, [{ to: "GB", cost: 2.95, deliveryDays: "2-4" }]);
    assert.equal(out[0].processingDays, "1-3");
    assert.equal(out[0].shopDetails.name, "CollarShop53");
    assert.equal(out[1].id, 1004);
    assert.match(out[2].error, /Not found/);
  });

  test("shop lookup by name with recent reviews", async () => {
    const out = JSON.parse((await call("etsy_shop", { shop: "https://www.etsy.com/uk/shop/CollarShop51?ref=x", reviews: 5 })).text);
    assert.equal(out.name, "CollarShop51");
    assert.equal(out.rating, 4.6);
    assert.equal(out.url, "https://www.etsy.com/shop/CollarShop51");
    assert.deepEqual(out.recentReviews[0], { stars: 5, text: "Lovely collar", date: "2026-09-21" });
  });
});

describe("errors are reported to Claude, not thrown", () => {
  test("missing eBay keys", async () => {
    const keep = env;
    env = { ...ENV, EBAY_CLIENT_ID: "" };
    const r = await call("ebay_search", { query: "x" });
    env = keep;
    assert.equal(r.isError, true);
    assert.match(r.text, /eBay isn't set up: add EBAY_CLIENT_ID/);
  });

  test("wrong Etsy secret", async () => {
    const keep = env;
    env = { ...ENV, ETSY_SHARED_SECRET: "nope" };
    const r = await call("etsy_search", { query: "x" });
    env = keep;
    assert.equal(r.isError, true);
    assert.match(r.text, /Etsy API error 403: Shared secret is required\. Check ETSY_API_KEY and ETSY_SHARED_SECRET\./);
  });
});
