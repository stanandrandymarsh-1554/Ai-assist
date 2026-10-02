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

## Setup (one time: about 15 minutes of clicking, plus waiting for approval)

### 1. Get the API keys

Both are free, but **neither is instant**. Start with eBay: it's quicker,
and the connector works with eBay alone. Add Etsy later, when its key
arrives.

**eBay: usually about 1 business day**
1. Join the eBay Developers Program at <https://developer.ebay.com>
   (*Register*). You can use your normal eBay login. Approval takes about a
   business day, and you get an email.
2. Once approved, open **Hi \<name\> → Application Keys** and click
   **Create a keyset** under **Production**. Give the application any name,
   e.g. *Marketplace Bridge*.
3. The production keyset starts out **disabled**. Click the link in the
   notice to complete *Marketplace Account Deletion*, choose **I do not
   persist eBay data** (the exemption), and give a short reason like
   "Read-only personal search tool, stores no eBay user data". The keyset
   activates straight away.
4. Copy the **App ID (Client ID)** and **Cert ID (Client Secret)** from
   the Production column. Use those, not the Sandbox ones.

**Etsy: anywhere from 2 days to a few weeks**
1. Sign in to Etsy and go to <https://www.etsy.com/developers/register>.
2. Fill in the app form. The description is what gets reviewed, so be
   specific, for example: *"Personal, read-only tool that searches public
   Etsy listings and shop reviews to help me compare products. No selling,
   no buyer data, no data stored."*
3. The app shows **Pending Personal Approval**. Etsy says this usually
   takes a day or two, but personal apps are reviewed more closely, and
   waits of a week or more are common. If it's stuck after a week or so,
   contact Etsy through <https://developers.etsy.com/documentation/get-help/>.
4. When approved, open the app under **Your apps** and copy the
   **Keystring** and the **Shared Secret**. You need both.

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
5. Adding the Etsy key later: put the two Etsy values under **Settings →
   Environment Variables**, then **Deployments → ⋯ → Redeploy** so the new
   values take effect. Your connector link stays the same.

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
