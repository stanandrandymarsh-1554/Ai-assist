# Ai-assist: eBay + Etsy shopping for Claude (UK)

## Recommended: the Claude Desktop extension (automatic, no API keys)

[`ebay-etsy-shopper.mcpb`](ebay-etsy-shopper.mcpb) is a one-click extension
for the **Claude Desktop app** (Mac or Windows). Ask Claude about eBay or
Etsy, and it opens the pages itself in Google Chrome (or Microsoft Edge) on
your computer, reads them and answers. There's no copy-paste and no keys.
Because it browses from your own computer and connection, eBay and Etsy
treat it like you browsing.

**Install**
1. Have the Claude Desktop app and Google Chrome (or Edge, which comes with
   Windows) installed.
2. Double-click `ebay-etsy-shopper.mcpb`, or in Claude Desktop go to
   **Settings → Extensions** and drag the file in. Click **Install**.

**Use.** Just ask, for example: "Find a used Switch OLED under £200 with
free postage and compare the sellers", or "What do Pyrex 401 bowls actually
sell for?". A Chrome window opens while Claude looks. If a site asks you to
confirm you're human, do it in that window and ask again. It usually only
asks once.

It's read-only: it never buys, bids or messages anyone. It doesn't work in
the phone app. On a phone, use the button below.

Source: `desktop-extension/`. Rebuild with `npm install && npm run pack`.
Test with `npm test` (it drives a real Chromium against sample pages over
MCP).

---

## On your phone: Copy for Claude button + skill

Two parts that work together, with no API keys:

1. **Copy for Claude**: a bookmark button for your browser. On any eBay or
   Etsy page, tap it, and the listings on screen are copied as tidy text.
   Paste that into Claude. This runs in your own browser, so eBay's and
   Etsy's bot-checks don't get in the way.
   Setup page: <https://claude.ai/artifact/Fuz14zptEcbx1Sp3GZpS3h>
   (source in `bookmarklet/`).
2. **The Claude Skill** (`ebay-etsy-shopping.zip`). This teaches Claude to
   build filtered eBay UK and Etsy UK search links (price, condition, sold
   prices, free postage...), read what you paste from the button, and
   compare and flag risks. It also gives a first look using web search.

### Why the button?

eBay and Etsy block automated requests coming from Claude's servers. In
testing, every direct search got a bot-check, even with the sites on the
allowed-domains list. eBay's old search feed is gone too. Reading the page in
your own browser is the reliable way to give Claude real, current listings.

### Install

1. Open the setup page above and add the **Copy for Claude** button
   (instructions for computer, iPhone and Android are on the page).
2. In claude.ai, turn on **Settings → Capabilities → Code execution and file
   creation**.
3. Go to **Customize → Skills** (on some layouts it's under Settings →
   Capabilities). Delete any older `ebay-etsy-shopping`, then **Upload
   skill**, pick [`ebay-etsy-shopping.zip`](ebay-etsy-shopping.zip), and
   switch it on. Uploading skills requires a paid plan.

### Use

- Ask, for example: "Find a used Switch OLED under £200 with free postage."
  Claude gives a quick first look from web search, plus a filtered eBay
  link.
- Open the link, tap **Copy for Claude**, and paste the result into the
  chat. Claude then compares the real listings.
- For "is this a good price?", use the sold-listings link, then copy and
  paste the same way.

It's read-only. Claude never buys, bids or messages anyone.

### Developing

- Skill: edit `skill/ebay-etsy-shopping/`, run `sh skill/build.sh` to
  rebuild the zip, and run the tests with `pytest skill/tests`.
- Button: edit `bookmarklet/copy-for-claude.js`. Then, in `bookmarklet/`,
  run `npm install` once and `npm run build`. The tests run the button in
  real Chromium against sample pages:
  `node test/run.mjs && node test/install-page.mjs`. Republish
  `bookmarklet/install.html` to update the setup page.

---

## Alternative: MCP server (needs free API keys)

This is a local server for Claude Desktop or Claude Code. It uses eBay's and
Etsy's official APIs, so it's more reliable, especially for Etsy, but you
need to create developer keys first. Setup is below.

Lets an AI assistant (Claude Desktop, Claude Code, or any app that supports
[MCP](https://modelcontextprotocol.io)) search and browse **eBay** and **Etsy**
for you. It uses each site's official API, so it doesn't break when the
websites change and it doesn't violate their terms.

It is **read-only**. The AI can search, compare, read descriptions, check
shipping and returns, and look up seller and shop reputation. It cannot buy,
bid, or message sellers. It gives you the listing links so you can do that
yourself.

## Tools the AI gets

| Tool | What it does |
| --- | --- |
| `ebay_search` | Search eBay with filters for price, condition, auction or Buy It Now, free postage, returns, item location and sort order |
| `ebay_get_item` | Full details for one eBay listing (paste a URL or item number) |
| `etsy_search` | Search Etsy with filters for price, shop location, category and sort order |
| `etsy_get_listing` | Full details for one Etsy listing: description, materials, shipping, processing time |
| `etsy_get_shop` | Shop reputation: rating, review count, total sales, location |
| `etsy_shop_listings` | Browse or search inside one Etsy shop |
| `etsy_reviews` | Read buyer reviews for a listing or a shop |
| `search_both` | Search both sites at once to compare |

## 1. Install

You need Python 3.10 or newer.

```bash
git clone <this repo> marketplace-mcp
cd marketplace-mcp
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e .
```

This installs a `marketplace-mcp` command. To find its full path for the config
below, run `which marketplace-mcp` (on Windows: `where marketplace-mcp`).

## 2. Get API keys (free)

You can set up just one site if you like. The tools for the other site will
say they aren't configured.

**eBay**
1. Sign in at <https://developer.ebay.com> and go to **Application Keys**.
2. Create a **Production** keyset. eBay will ask about *Marketplace Account
   Deletion* notifications. This tool stores no eBay user data, so choose the
   option to apply for an exemption.
3. Copy the **App ID (Client ID)** and the **Cert ID (Client Secret)**.

**Etsy**
1. Go to <https://www.etsy.com/developers/register> and create an app.
2. Copy the **Keystring** and the **Shared Secret**. Since February 2026 Etsy
   requires both.

## 3. Add your keys

Copy `.env.example` to `.env` and fill it in:

```
EBAY_CLIENT_ID=YourApp-PRD-1234...
EBAY_CLIENT_SECRET=PRD-abcd...
ETSY_API_KEY=abc123keystring
ETSY_SHARED_SECRET=xyz789secret
```

Optional settings: `EBAY_MARKETPLACE` (default `EBAY_GB`, eBay UK; you can also use
`EBAY_US`, `EBAY_IE`, `EBAY_DE`, `EBAY_AU` and others) and
`EBAY_DELIVERY_POSTCODE` (for example `SW1A 1AA`), which gives you postage
estimates for your area.

`.env` is git-ignored, so your keys stay off GitHub. You can also pass the keys
as `env` values in the client config below instead.

## 4. Connect it to your AI

**Claude Desktop.** Open Settings → Developer → Edit Config. Or edit the file
directly: `~/Library/Application Support/Claude/claude_desktop_config.json` on
macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows. Add:

```json
{
  "mcpServers": {
    "marketplace": {
      "command": "/full/path/to/marketplace-mcp/.venv/bin/marketplace-mcp"
    }
  }
}
```

Restart Claude Desktop. The tools will then show up in the tools (🔨) menu.

**Claude Code**

```bash
claude mcp add marketplace -- /full/path/to/.venv/bin/marketplace-mcp
```

**Apps that connect by URL** (remote MCP / custom connectors):

```bash
marketplace-mcp --http --port 8000     # serves http://127.0.0.1:8000/mcp
```

The HTTP mode has **no login**. Anyone who can reach the URL can use your API
keys. Keep it on `127.0.0.1`, or put it behind something that adds
authentication if you expose it.

## Example things to ask

- "Find me a used Nintendo Switch OLED on eBay under £200 with free postage,
  sellers with 99%+ feedback only."
- "Search Etsy for a personalized leather dog collar and show me the 5 best-rated
  shops."
- "Compare prices for a vintage Pyrex mixing bowl set on eBay vs Etsy."
- "What are the return terms on https://www.ebay.co.uk/itm/1234567890?"
- "Read the recent reviews for the Etsy shop MugMaker. Any complaints about
  shipping?"

## Limits

- eBay's default quota for this API is about 5,000 calls per day. Etsy allows
  about 10,000 calls per day.
- eBay search returns Buy It Now listings by default. Ask for auctions
  explicitly and the AI will add the `auction` filter.
- eBay sold/completed-listing history isn't available through the public API.
- Prices are as listed. Postage is reported separately, and items sent from
  outside the UK may carry import VAT or customs charges.

## Development

```bash
pip install -e '.[dev]'
pytest tests
```
