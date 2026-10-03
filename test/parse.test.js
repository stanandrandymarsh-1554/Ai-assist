import assert from "node:assert/strict";
import { test } from "node:test";
import { money, parseEbayCard, parseEtsyCard, totalFromText } from "../server/parse.js";

test("money finds amounts and currencies", () => {
  assert.deepEqual(money("£1,234.50 to £2,000.00"), [{ amount: 1234.5, currency: "GBP" }, { amount: 2000, currency: "GBP" }]);
  assert.deepEqual(money("US $12.00"), [{ amount: 12, currency: "USD" }]);
  assert.deepEqual(money("EUR 9,99"), [{ amount: 9, currency: "EUR" }]); // eBay EU sites aren't the target; GBP/USD are
  assert.equal(totalFromText("1,234 results for nintendo switch"), 1234);
  assert.equal(totalFromText("10,000+ results"), 10000);
});

test("eBay newer card layout (s-card)", () => {
  const it = parseEbayCard({
    id: "226612345678", title: "Apple iPad Air 5th Gen 64GB", price: "£349.00",
    lines: ["Excellent - Refurbished · Apple iPad Air", "£349.00", "or Best Offer", "+£4.99 delivery", "Free returns", "Located in United Kingdom", "87 sold", "techdeals 99.4% positive (12.3K)"],
  });
  assert.equal(it.price, 349);
  assert.equal(it.postage, 4.99);
  assert.equal(it.total, 353.99);
  assert.equal(it.condition, "Excellent - Refurbished");
  assert.equal(it.bestOffer, true);
  assert.equal(it.returns, "Free returns");
  assert.equal(it.location, "United Kingdom");
  assert.equal(it.popularity, "87 sold");
  assert.equal(it.seller, "techdeals");
  assert.equal(it.feedbackPct, 99.4);
  assert.equal(it.feedbackCount, 12300);
  assert.equal(it.url, "https://www.ebay.co.uk/itm/226612345678");
});

test("eBay older layout (s-item), auction with time left", () => {
  const it = parseEbayCard({
    id: "335512345678", title: "Nintendo Switch OLED White", price: "£80.00",
    lines: ["Pre-owned", "£80.00", "3 bids · 2d 4h left (Sat, 19:00)", "+£3.99 postage", "from United States", "gamerguy (2,345) 99.7%"],
  });
  assert.equal(it.auction, true);
  assert.equal(it.bids, 3);
  assert.equal(it.timeLeft, "2d 4h left (Sat, 19:00)");
  assert.equal(it.condition, "Pre-owned");
  assert.equal(it.location, "United States");
  assert.equal(it.seller, "gamerguy");
  assert.equal(it.feedbackCount, 2345);
  assert.equal(it.total, 83.99);
});

test("eBay sold card, free postage, price range, US dollars", () => {
  const sold = parseEbayCard({ id: "1".repeat(12), title: "Switch OLED Neon", price: "£189.00", lines: ["Sold 28 Sep 2026", "Brand New", "£189.00", "Free postage"] });
  assert.equal(sold.sold, "28 Sep 2026");
  assert.equal(sold.postage, 0);
  assert.equal(sold.postageLabel, "free");
  assert.equal(sold.total, 189);
  const range = parseEbayCard({ id: "2".repeat(12), title: "Case", price: "£5.99 to £9.99", lines: ["New", "£5.99 to £9.99", "Postage not specified"] });
  assert.equal(range.price, 5.99);
  assert.equal(range.priceIsRange, true);
  assert.equal(range.postageLabel, "not given");
  assert.equal(range.total, null);
  const usd = parseEbayCard({ id: "3".repeat(12), title: "Lamp", price: "US $40.00", lines: ["Used", "US $40.00", "+US $25.00 postage"] });
  assert.equal(usd.currency, "USD");
  assert.equal(usd.postage, 25);
});

test("Etsy cards: rating, shop, sale price, ad, free delivery", () => {
  const a = parseEtsyCard({ id: "664834088", title: "Leather Dog Collar", lines: ["4.9 (1.2k)", "TheStatelyHound", "£18.40", "£23.00", "(20% off)", "FREE UK delivery", "Star Seller"] });
  assert.deepEqual([a.rating, a.reviews, a.shop, a.price, a.originalPrice, a.discount, a.freeDelivery, a.starSeller], [4.9, 1200, "TheStatelyHound", 18.4, 23, "20% off", true, true]);
  assert.equal(a.url, "https://www.etsy.com/uk/listing/664834088");
  const b = parseEtsyCard({ id: "1463237003", title: "Personalised Collar", lines: ["Ad by Etsy seller", "★ 4.7 out of 5 stars (3,456)", "PaddingPaws", "Sale Price £14.99 £19.99 (25% off)"] });
  assert.deepEqual([b.ad, b.rating, b.reviews, b.shop, b.price, b.originalPrice, b.discount], [true, 4.7, 3456, "PaddingPaws", 14.99, 19.99, "25% off"]);
  const c = parseEtsyCard({ id: "9", title: "Mug", lines: ["5.0", "(87)", "Ad from shop MugMakerUK", "USD 22.50"] });
  assert.deepEqual([c.rating, c.reviews, c.ad, c.shop, c.price, c.currency], [5, 87, true, "MugMakerUK", 22.5, "USD"]);
});
