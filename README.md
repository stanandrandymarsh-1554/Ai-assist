# Marketplace Bridge

A custom connector that gives Claude fast bulk search over **eBay UK** and
**Etsy** through their official APIs. One tool call pulls up to 1,000
listings, applies your filters, and returns a price summary plus a compact
table. It works everywhere connectors do: claude.ai, the phone app, Claude
Desktop and Cowork.

| Tool | What Claude gets |
| --- | --- |
| `ebay_search` | Up to 1,000 live listings (Buy It Now and auctions). Filters: price, total incl. postage, condition, listing type, free postage, UK-only, returns, business/private seller, seller feedback % and count, Top Rated, excluded sellers, words to exclude or require. Returns lowest / quartiles / median / highest price, then the rows. |
| `ebay_items` | Full details for up to 20 listings at once: description, item specifics, postage options and delivery dates, returns, quantity sold. |
| `etsy_search` | Up to 1,000 active listings (UK shops by default). Filters: £ price, shop rating, shop review count, handmade only, personalisable, words to exclude or require. Returns a price summary and the rows, with shop ratings. |
| `etsy_listings` | Full details for up to 50 listings at once: postage costs and delivery times, processing time, materials. |
| `etsy_shop` | A shop's rating, sales and recent reviews. |

It's read-only. It never buys, bids or messages anyone.

## Setup (one time, about 15 minutes)

### 1. Get free API keys

You can set up just one site; the other's tools will say they aren't set up.

- **eBay:** sign in at <https://developer.ebay.com>, open **Application
  Keys**, and create a **Production** keyset. When it asks about
  *Marketplace Account Deletion*, choose the exemption (this connector stores
  no eBay user data). Copy the **App ID** and **Cert ID**.
- **Etsy:** create an app at <https://www.etsy.com/developers/register>.
  Copy the **Keystring** and **Shared Secret**.

### 2. Deploy to Vercel (free)

1. Go to <https://vercel.com> and sign in with GitHub.
2. Choose **Add New → Project** and import this repository. Leave the
   framework as *Other*.
3. Under **Environment Variables** add:

   | Name | Value |
   | --- | --- |
   | `BRIDGE_TOKEN` | A long random secret you make up. It becomes part of your connector link. |
   | `EBAY_CLIENT_ID` | eBay App ID |
   | `EBAY_CLIENT_SECRET` | eBay Cert ID |
   | `ETSY_API_KEY` | Etsy Keystring |
   | `ETSY_SHARED_SECRET` | Etsy Shared Secret |
   | `EBAY_POSTCODE` | Optional. Your postcode, for accurate postage. |

4. Click **Deploy**. Note your address, e.g. `https://marketplace-bridge-abc.vercel.app`.

### 3. Add it to Claude

In claude.ai, go to **Settings → Connectors → Add custom connector**. Name it
*Marketplace Bridge* and set the URL to:

```
https://<your-vercel-address>/mcp/<your BRIDGE_TOKEN>
```

Then switch it on in a chat (or in Cowork) and ask, for example:

- "Pull 500 used Switch OLEDs on eBay under £220, sellers 98%+, no faulty
  ones. What's the typical price and which are the best deals?"
- "Find personalised leather dog collars on Etsy from UK shops rated 4.8+,
  under £30, and check postage on the top five."

Keep the link private. Anyone with it can use your API keys.

## Notes

- **Sold prices:** eBay's public API doesn't include sold or completed
  listings, so the price summary is based on live asking prices.
- **Etsy prices:** non-£ listings are shown with a rough £ conversion (≈).
  Postage isn't in Etsy search results; `etsy_listings` adds it.
- **Limits:** eBay allows 5,000 API calls a day, and a 1,000-listing search
  uses 5. Etsy allows about 10,000 a day; a 1,000-listing search uses 20.

## Development

```bash
npm install
npm test
```

The tests run the connector behind a real HTTP server and use the official
MCP client against fake eBay and Etsy APIs that answer like the real ones.
