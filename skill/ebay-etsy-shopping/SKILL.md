---
name: ebay-etsy-shopping
description: Search and compare live listings on eBay and Etsy for the user, with no API keys. Covers price filters, condition, auctions vs Buy It Now, free shipping, sold-price history on eBay, Etsy shops and reviews, and listing details. Use whenever the user wants to find, compare, price-check or evaluate something on eBay or Etsy, or pastes an ebay.com or etsy.com link.
---

# eBay + Etsy shopping

You are shopping on the user's behalf: finding listings, comparing them and
pointing out the best options. You cannot buy, bid or message sellers.
Always give the user the listing links so they can do that themselves.

The scripts live in `scripts/` next to this file. Run them with `python3`
from that folder. They use only the Python standard library and print JSON.

## Step 1: Try the scripts first

```bash
cd <this skill's folder>/scripts

# eBay
python3 ebay.py search "nintendo switch oled" --max 250 --condition used --free-shipping
python3 ebay.py search "pyrex 401 primary blue" --sold      # recent SOLD prices = real market value
python3 ebay.py item https://www.ebay.com/itm/1234567890    # full details, specifics, description

# Etsy
python3 etsy.py search "personalized leather dog collar" --sort top_reviews --ship-to US
python3 etsy.py listing https://www.etsy.com/listing/123456789/...
python3 etsy.py shop ShopName

# Just build a filtered search link (no internet needed)
python3 ebay.py url "lego 10497" --sort price_low --bin
python3 etsy.py url "ceramic mug" --max 40 --free-shipping
```

Options:
- **eBay `search`**:
  - `--min`, `--max`: price range.
  - `--condition`: one or more of new, open_box, refurbished, used, for_parts, separated by commas.
  - Listing type: `--bin` (Buy It Now only), `--auction`, `--best-offer`.
  - `--free-shipping`.
  - `--sold`: completed sales.
  - `--location`: domestic, north_america or worldwide.
  - `--sort`: best, price_low, price_high, newest, ending or distance. price_low and price_high include shipping.
  - `--page`, `--limit`.
  - `--site`: for other eBay countries, e.g. ebay.co.uk, ebay.de or ebay.com.au.
- **Etsy `search`**:
  - `--min`, `--max`: price range.
  - `--sort`: relevance, price_low, price_high, newest or top_reviews.
  - Filters: `--free-shipping`, `--ship-to` (a country code such as US), `--handmade`, `--vintage`, `--personalizable`, `--on-sale`.
  - `--page`.

If the output has `"ok": false`, read `reason` and `next_step`:
- `reason: "network"` means code execution has no internet. Tell the user
  **once**, briefly: *"For direct searches, turn on Settings → Capabilities →
  Allow network egress and add `ebay.com` and `etsy.com` to the allowed
  domains (or pick All domains)."* Then continue with Step 2. Don't stop.
- `reason: "blocked"` means the site showed a bot-check. This is normal for
  Etsy and occasional for eBay. **Do not retry or try to get around it.** Go
  to Step 2.

## Step 2: Fallback using web search and web fetch

1. Use the web_search tool with focused queries, for example:
   - `site:ebay.com/itm <keywords>`, or for sold prices,
     `<keywords> sold price ebay`
   - `site:etsy.com/listing <keywords>`
   - For shop reputation: `<shop name> etsy reviews`
2. Use web_fetch on the most promising listing URLs **that appeared in the
   search results**. You can also fetch any URL the user pasted. web_fetch
   only accepts URLs that are already in the conversation, so don't make up
   URLs for it.
3. Always also give the user the filtered search link from
   `python3 ebay.py url ...` or `etsy.py url ...`. Those commands work
   without internet. The link lets the user see the full, filtered result
   list in one click.

If both steps fail, say so plainly. Give the search link and ask the user
to paste the page text or a screenshot. You can analyse that directly.

## Step 3: Present results well

- Show a compact table: **title, price, shipping, condition, seller/shop
  rating, link**. Add a **total (price + shipping)** column whenever shipping
  isn't free.
- Lead with your recommendation: the best 1–3 picks and why.
- Flag risks:
  - eBay seller feedback under ~98%, or very few ratings
  - no returns
  - shipping from overseas, or long Etsy processing times
  - a price far below the sold average (could be a scam or a mislabelled item)
  - "for parts" listings
  - stock photos on used items
- For **"is this a good price?"** questions, run `ebay.py search ... --sold`
  and give the typical range (median, low, high) of recent sales.
- For Etsy, check the shop's rating, review count and sales
  (`etsy.py shop`). Handmade items vary a lot between makers.
- Prices are as shown on the page in the site's currency. They don't include
  tax.

## Be a polite visitor

Only fetch what the request needs: usually 1–3 searches and up to ~8 detail
pages. Never loop over many pages or keep retrying a blocked request.
