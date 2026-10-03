// Turns raw card text (from collect.js) into structured listings.

const CUR = { "£": "GBP", "$": "USD", "US $": "USD", "C $": "CAD", "AU $": "AUD", "€": "EUR", EUR: "EUR", GBP: "GBP", USD: "USD" };
const MONEY = /(US \$|C \$|AU \$|£|€|\$|EUR|GBP|USD)\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/g;

export function money(text) {
  const out = [];
  for (const m of String(text || "").matchAll(MONEY)) out.push({ amount: Number(m[2].replace(/,/g, "")), currency: CUR[m[1]] || "GBP" });
  return out;
}

function count(s) {
  const m = String(s).match(/([\d.,]+)\s*([kKmM])?/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Math.round(n * (m[2] ? (/k/i.test(m[2]) ? 1000 : 1e6) : 1));
}

const COND = /^(brand new|new|new \(other\)|new with tags|new without tags|new with box|new without box|new with defects|open box|pre-?owned|used|refurbished|certified - refurbished|excellent - refurbished|very good - refurbished|good - refurbished|seller refurbished|parts only|for parts or not working)\b/i;

export function parseEbayCard(c, host = "www.ebay.co.uk") {
  const it = {
    id: c.id, title: c.title, url: `https://${host}/itm/${c.id}`,
    price: null, currency: "GBP", priceIsRange: false, postage: null, postageLabel: "?",
    condition: "", auction: false, bids: null, timeLeft: "", bestOffer: false, sold: "",
    seller: "", feedbackPct: null, feedbackCount: null, location: "", returns: "", popularity: "", sponsored: !!c.sponsored,
  };
  const priceMoney = money(c.price);
  if (priceMoney.length) {
    it.price = priceMoney[0].amount;
    it.currency = priceMoney[0].currency;
    it.priceIsRange = /\bto\b/i.test(c.price) && priceMoney.length > 1;
  }
  for (const line of c.lines) {
    const low = line.toLowerCase();
    if (line === c.price) continue;
    if (!it.condition && COND.test(line) && line.length < 70) { it.condition = line.split("·")[0].trim(); continue; }
    if (/^sold\s+(\d{1,2}\s+\w{3}|\w{3}\s+\d)/i.test(line)) { it.sold = line.replace(/^sold\s+/i, ""); continue; }
    if (/(postage|delivery|shipping)/i.test(line) && !/returns?/i.test(line)) {
      if (/free (postage|delivery|shipping)/i.test(line)) { it.postage = 0; it.postageLabel = "free"; }
      else {
        const m = money(line);
        if (m.length) { it.postage = m[0].amount; it.postageLabel = `£${m[0].amount.toFixed(2)}`; }
        else if (/not specified/i.test(line)) it.postageLabel = "not given";
      }
      continue;
    }
    if (/collection in person|click & collect/i.test(line) && it.postage == null) { it.postageLabel = "collection"; continue; }
    if (/returns?/i.test(line)) { it.returns = line; continue; }
    const bids = line.match(/^(\d+)\s+bids?\b/i);
    if (bids) { it.auction = true; it.bids = Number(bids[1]); const left = line.match(/·\s*(.+left.*)$/i); if (left) it.timeLeft = left[1]; continue; }
    if (/\b\d+[dhm]\b.*\bleft\b|\bleft\s*\(|^ends in\b/i.test(line)) { it.timeLeft = line; it.auction = true; continue; }
    if (/or best offer/i.test(line)) { it.bestOffer = true; continue; }
    const fb = line.match(/(\d{2,3}(?:\.\d)?)%/);
    if (fb && !it.seller) {
      it.feedbackPct = Number(fb[1]);
      const paren = line.match(/\(([\d.,]+\s*[kKmM]?)\)/);
      it.feedbackCount = paren ? count(paren[1]) : null;
      it.seller = line.replace(/\(.*?\)/g, "").replace(/\d{2,3}(?:\.\d)?%\s*(positive)?/i, "").trim();
      continue;
    }
    if (/^(from|located in)\s/i.test(line)) { it.location = line.replace(/^(from|located in)\s+/i, ""); continue; }
    if (/^\d[\d,.]*k?\+?\s+(sold|watchers?|watching)\b|^last one\b|^almost gone\b/i.test(line)) { it.popularity = line; continue; }
    if (!it.price) { const m = money(line); if (m.length) { it.price = m[0].amount; it.currency = m[0].currency; } }
  }
  if (it.postage === 0 && !it.postageLabel) it.postageLabel = "free";
  it.total = it.price != null && it.postage != null ? round(it.price + it.postage) : null;
  return it;
}

const round = (n) => Math.round(n * 100) / 100;

export function parseEtsyCard(c) {
  const it = {
    id: c.id, title: c.title, url: `https://www.etsy.com/uk/listing/${c.id}`,
    price: null, currency: "GBP", originalPrice: null, discount: "", shop: "", rating: null, reviews: null,
    freeDelivery: false, starSeller: false, ad: false, bestseller: false,
  };
  for (const line of c.lines) {
    const low = line.toLowerCase();
    if (/^ad\b|ad by etsy seller|^ad from shop/i.test(line)) { it.ad = true; const m = line.match(/ad (?:by|from shop)\s+(\S+)/i); if (m && !/etsy/i.test(m[1])) it.shop = m[1]; continue; }
    if (/free (uk )?(delivery|shipping|postage)/i.test(line)) { it.freeDelivery = true; continue; }
    if (/star seller/i.test(low)) { it.starSeller = true; continue; }
    if (/bestseller|popular now/i.test(low)) { it.bestseller = true; continue; }
    const rating = line.match(/^(?:★\s*)?([1-5](?:\.\d)?)\s*(?:out of 5 stars?)?\s*\(([\d.,]+\s*[kK]?)\)/);
    if (rating) { it.rating = Number(rating[1]); it.reviews = count(rating[2]); continue; }
    const onlyRating = line.match(/^([1-5]\.\d)$/);
    if (onlyRating && it.rating == null) { it.rating = Number(onlyRating[1]); continue; }
    const onlyCount = line.match(/^\(([\d.,]+\s*[kK]?)\)$/);
    if (onlyCount && it.reviews == null) { it.reviews = count(onlyCount[1]); continue; }
    const m = money(line);
    if (m.length && it.price == null) {
      it.price = m[0].amount; it.currency = m[0].currency;
      if (m.length > 1 && m[1].amount > m[0].amount) it.originalPrice = m[1].amount;
      const off = line.match(/(\d+)% off/i);
      if (off) it.discount = `${off[1]}% off`;
      continue;
    }
    if (m.length && it.price != null && m[0].amount > it.price && it.originalPrice == null) { it.originalPrice = m[0].amount; continue; }
    if (/(\d+)% off/i.test(line)) { it.discount = line.match(/(\d+)% off/i)[0]; continue; }
    // A shop name is a single token like "TheStatelyHound".
    if (!it.shop && /^[A-Za-z0-9][A-Za-z0-9_-]{2,40}$/.test(line) && !/^(sale|ad|etsy|personalised|personalized|free|new|digital|download)$/i.test(line)) it.shop = line;
  }
  return it;
}

export function totalFromText(text) {
  const m = String(text || "").replace(/,/g, "").match(/(\d+)\+?\s*results?/i);
  return m ? Number(m[1]) : null;
}
