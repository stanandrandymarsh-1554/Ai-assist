# Ai-assist: eBay + Etsy shopping for Claude

## Easiest: the Claude Skill (no API keys)

`ebay-etsy-shopping.zip` is a **Claude Skill**. You upload it to claude.ai
once, and Claude can then search eBay and Etsy for you in any chat, including
on your phone.

**Install (one time)**
1. Download [`ebay-etsy-shopping.zip`](ebay-etsy-shopping.zip).
2. In claude.ai, go to **Settings → Capabilities**. Make sure **Code execution
   and file creation** is on.
3. Go to **Customize → Skills** (on some layouts it's under Settings →
   Capabilities), choose **Upload skill**, pick the zip, and toggle it on.
   Uploading skills requires a paid plan (Pro, Max, Team or Enterprise).
4. Recommended: turn on **Allow network egress** and add these three entries
   to the allowed domains, exactly as written: `www.ebay.co.uk`,
   `vi.vipr.ebaydesc.com` (eBay's listing descriptions) and `www.etsy.com`
   (or choose *All domains*). This lets the
   skill read search results directly. Without it, Claude falls back to its
   built-in web search, which still works but gives less detail.

**Use it.** Just ask, for example:

- "Find a used Switch OLED on eBay under £200 with free postage."
- "What do Pyrex 401 bowls actually sell for on eBay?" (uses sold listings)
- "Find a personalized leather dog collar on Etsy from a highly rated shop."
- "Is this a good deal? https://www.ebay.co.uk/itm/…"

**What to expect**
- **eBay** usually works directly once network egress is on.
- **Etsy** blocks most automated requests with a bot-check, so Claude often
  has to use its web search instead. Results are thinner, and you'll always
  get a filtered Etsy search link you can open yourself.
- If you'd like Claude to browse Etsy fully, the *Claude in Chrome* extension
  (paid plans) lets it use your own browser.
- It's read-only. Claude gives you links, and you buy, bid or message
  sellers yourself.

**Updating the skill.** When there's a new version of the zip, go to
Customize → Skills, delete (or switch off) the old `ebay-etsy-shopping`, and
upload the new zip. Don't rely on "replace": some users report it keeps the
old files.

To change the skill, edit the files in `skill/ebay-etsy-shopping/`, run
`sh skill/build.sh` to rebuild the zip, and upload it again. Run the tests
with `pytest skill/tests`.

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
