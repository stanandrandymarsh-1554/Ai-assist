# Bulk Shopper

A Claude Desktop extension that lets Claude search **eBay UK** and **Etsy UK**
in bulk, with no API keys. It reads whole results pages in a Chrome window on
your computer: up to 240 eBay listings per page and up to 5 pages per search,
so around 1,000 listings in a few seconds. Then it filters them and gives
Claude a price summary and a compact table.

## Install

1. Have the **Claude Desktop** app and **Google Chrome** installed.
   Microsoft Edge works too, and it comes with Windows.
2. Download [`bulk-shopper.mcpb`](bulk-shopper.mcpb). Double-click it, or drag
   it into Claude Desktop → **Settings → Extensions**. Click **Install**.

## Use

Just ask in Claude Desktop, for example:

- "Pull 3 pages of used Switch OLEDs on eBay under £250, sellers 98%+, no
  broken ones. What's the typical price and which are the best deals?"
- "What do Pyrex 401 bowls actually sell for on eBay?" (uses sold listings)
- "Find personalised leather dog collars on Etsy under £30 rated 4.8+, no ads."

A Chrome window opens while it reads. If eBay or Etsy ask you to confirm
you're human, do it in that window and ask again. It usually only asks once.

| Tool | What it does |
| --- | --- |
| `ebay_search` | Up to 5 pages × 240 listings. Site filters: price, condition, Buy It Now / auction, offers, free postage, sold listings, location, category, sort. Its own filters: max price + postage, seller feedback % and count, words to exclude or require, hide sponsored. Returns lowest / quartiles / median / highest and a table. |
| `etsy_search` | Up to 8 pages. Site filters: price, free postage, handmade, vintage, personalisable, on sale, Star Sellers, sort. Its own filters: rating, review count, words, hide ads. |
| `open_listings` | Opens up to 8 listings for postage, returns, condition and details. |

"Show me more" is instant: results are kept for 10 minutes.

## Limits

- Works in the Claude **Desktop app** (and Claude Code). It doesn't work on
  claude.ai in a browser or the phone app.
- Read-only. It never buys, bids or messages anyone.
- Etsy's bot protection is stricter than eBay's, so Etsy may ask you to
  confirm you're human more often.
- It reads what the results pages show. Postage on Etsy, and returns
  details, need `open_listings`.

## Development

```bash
npm install
npm test        # parser tests + end-to-end with a real Chromium over MCP
npm run pack    # builds bulk-shopper.mcpb
```

On Linux, the end-to-end test uses `SHOPPER_BROWSER_PATH` (default
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`).
