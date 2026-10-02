import gzip
import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "ebay-etsy-shopping" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import common  # noqa: E402
import ebay  # noqa: E402
import etsy  # noqa: E402

# Older eBay layout (li.s-item)
S_ITEM = """
<ul class="srp-results">
<li class="s-item s-item__pl-on-bottom"><a href="https://ebay.com/itm/123456">Shop on eBay</a></li>
<li class="s-item s-item__pl-on-bottom" data-viewport="x">
 <div class="s-item__image"><img src="a.jpg" alt="Nintendo Switch OLED White"></div>
 <a class="s-item__link" href="https://www.ebay.co.uk/itm/Nintendo-Switch-OLED/335512345678?hash=item1&amp;x=1">
  <div class="s-item__title"><span role="heading"><span class="LIGHT_HIGHLIGHT">New Listing</span>Nintendo Switch OLED White</span>
  <span class="clipped">Opens in a new window or tab</span></div></a>
 <div class="s-item__subtitle"><span class="SECONDARY_INFO">Pre-Owned</span></div>
 <span class="s-item__price">£229.99</span>
 <span class="s-item__shipping s-item__logisticsCost">+£3.99 postage</span>
 <span class="s-item__location s-item__itemLocation">from United Kingdom</span>
 <span class="s-item__seller-info-text">gamerguy (2,345) 99.7%</span>
 <span class="s-item__bids s-item__bidCount">3 bids</span>
 <span class="s-item__time-left">2d 4h left</span>
 <script>var junk = "$1.00 delivery";</script>
</li>
<li class="s-item"><div class="s-item__title"><span>Switch OLED Neon</span></div>
 <a href="https://www.ebay.com/itm/335599999999"></a>
 <span class="s-item__caption--signal POSITIVE">Sold  28 Sep 2026</span>
 <span class="s-item__price"><span class="POSITIVE">£210.00</span></span>
 <span class="s-item__shipping">Free postage</span>
 <span class="s-item__free-returns">Free returns</span>
</li></ul>
<h1 class="srp-controls__count-heading"><span class="BOLD">1,234</span> results for nintendo switch</h1>
"""

# Newer eBay layout (li.s-card)
S_CARD = """
<ul class="srp-results srp-list"><li class="s-card s-card--horizontal" data-listingid="226612345678" id="item1">
 <div class="su-media"><img class="s-card__image" src="b.webp" alt="Apple iPad Air 5th Gen 64GB"></div>
 <div class="su-card-container__content">
  <a class="su-link" href="https://www.ebay.com/itm/226612345678?_skw=ipad&amp;hash=x">
   <div role="heading" class="s-card__title"><span class="su-styled-text primary default">Apple iPad Air 5th Gen 64GB</span><span class="clipped">Opens in a new window or tab</span></div></a>
  <div class="s-card__subtitle-row"><div class="s-card__subtitle"><span class="su-styled-text secondary default">Excellent - Refurbished</span><span class="su-styled-text secondary default">·</span><span>Apple iPad Air</span></div></div>
  <div class="s-card__attribute-row"><span class="su-styled-text primary bold large-1 s-card__price">$349.00</span></div>
  <div class="s-card__attribute-row"><span class="su-styled-text secondary large">or Best Offer</span></div>
  <div class="s-card__attribute-row"><span class="su-styled-text secondary large">Free delivery</span></div>
  <div class="s-card__attribute-row"><span class="su-styled-text secondary large">Free returns</span></div>
  <div class="s-card__attribute-row"><span>Located in United States</span></div>
  <div class="s-card__attribute-row"><span>87 sold</span></div>
  <div class="su-card-container__attributes__secondary"><span>techdeals 99.4% positive (12.3K)</span></div>
 </div></li></ul>
"""

ITEM_PAGE = """
<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Nintendo Switch OLED",
"brand":{"@type":"Brand","name":"Nintendo"},"gtin13":"0045496883386","image":["https://i.ebayimg.com/1.jpg"],
"offers":{"@type":"Offer","price":"229.99","priceCurrency":"USD","itemCondition":"https://schema.org/UsedCondition","availability":"https://schema.org/InStock"}}</script></head>
<body><h1 class="x-item-title__mainTitle"><span class="ux-textspans ux-textspans--BOLD">Nintendo Switch OLED White w/ Dock</span></h1>
<div class="x-price-primary"><span class="ux-textspans">US £229.99</span></div>
<div class="x-sellercard-atf__info"><span>gamerguy</span><span>(2345)</span><span>99.7% positive</span></div>
<div class="ux-layout-section-evo">
 <dl class="ux-labels-values"><dt class="ux-labels-values__labels"><div class="ux-labels-values__labels-content"><span>Condition:</span></div></dt>
  <dd class="ux-labels-values__values"><div class="ux-labels-values__values-content"><span>Used</span><span>See all condition definitions</span></div></dd></dl>
 <dl class="ux-labels-values"><dt class="ux-labels-values__labels"><span>Returns:</span></dt>
  <dd class="ux-labels-values__values"><span>30 days returns.</span><span>Buyer pays for return shipping.</span></dd></dl>
 <dl class="ux-labels-values"><dt class="ux-labels-values__labels"><span>Color</span></dt>
  <dd class="ux-labels-values__values"><span>White</span></dd></dl>
</div>
<iframe id="desc_ifr" src="DESC_URL"></iframe></body></html>
"""

DESC = "<html><body><p>Works great.</p><p>Includes dock &amp; joy-cons.</p><script>x()</script></body></html>"

ETSY_SEARCH = """<script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","itemListElement":[
{"@type":"Product","name":"Custom Leather Dog Collar","url":"https://www.etsy.com/listing/1234567890/custom-leather-dog-collar?ref=search",
"image":"https://i.etsystatic.com/1.jpg","brand":{"@type":"Brand","name":"BarkLeather"},
"offers":{"@type":"Offer","price":"34.00","priceCurrency":"USD"},"aggregateRating":{"@type":"AggregateRating","ratingValue":"4.9","reviewCount":"812"}},
{"@type":"Product","name":"Engraved Collar","url":"https://www.etsy.com/listing/222/engraved",
"offers":{"@type":"AggregateOffer","lowPrice":"20.00","highPrice":"45.00","priceCurrency":"USD"}}]}</script>"""

ETSY_LISTING = """<script type="application/ld+json">{"@type":"Product","name":"Custom Leather Dog Collar",
"url":"https://www.etsy.com/listing/1234567890/custom","brand":{"@type":"Brand","name":"BarkLeather"},
"description":"Hand-stitched &amp; made to order.","material":"Leather",
"offers":{"@type":"AggregateOffer","lowPrice":"34.00","highPrice":"52.00","priceCurrency":"USD"},
"aggregateRating":{"ratingValue":"4.9","reviewCount":"812"},
"review":[{"reviewRating":{"ratingValue":5},"reviewBody":"Beautiful collar!","datePublished":"2026-09-01"}]}</script>
<body><p>Only 3 left</p><p>Ships from United Kingdom.</p><p>Returns &amp; exchanges accepted within 30 days</p></body>"""

BLOCKED = "<html><body>Please enable JS and disable any ad blocker<script src='https://js.datadome.co/tags.js'></script></body></html>"


def test_ebay_s_item_layout():
    items = ebay.parse_search(S_ITEM, "ebay.co.uk")
    assert len(items) == 2  # placeholder card skipped
    a, b = items
    assert a["title"] == "Nintendo Switch OLED White"
    assert a["price"] == "£229.99"
    assert a["url"] == "https://www.ebay.co.uk/itm/335512345678"
    assert a["condition"] == "Pre-Owned"
    assert a["shipping"] == "+£3.99 postage"
    assert a["location"] == "from United Kingdom"
    assert a["seller"] == "gamerguy (2,345) 99.7%"
    assert a["bids"] == 3 and a["time_left"] == "2d 4h left"
    assert b["sold_date"] == "28 Sep 2026" and b["price"] == "£210.00"
    assert b["shipping"] == "Free postage" and b["returns"] == "Free returns"
    assert ebay._total(S_ITEM) == "1,234"


def test_ebay_s_card_layout():
    [c] = ebay.parse_search(S_CARD, "ebay.com")
    assert c["title"] == "Apple iPad Air 5th Gen 64GB"
    assert c["price"] == "$349.00"
    assert c["condition"] == "Excellent - Refurbished"
    assert c["shipping"] == "Free delivery"
    assert c["returns"] == "Free returns"
    assert c["location"] == "Located in United States"
    assert c["popularity"] == "87 sold"
    assert c["seller"] == "techdeals 99.4% positive (12.3K)"
    assert "Opens in a new window or tab" not in json.dumps(c)


def test_ebay_item_page():
    d = ebay.parse_item(ITEM_PAGE)
    assert d["title"] == "Nintendo Switch OLED White w/ Dock"
    assert d["price"] == "US £229.99"
    assert d["brand"] == "Nintendo" and d["gtin"] == "0045496883386"
    assert d["availability"] == "InStock"
    assert d["details"] == {"Condition": "Used", "Returns": "30 days returns. Buyer pays for return shipping.", "Color": "White"}
    assert "99.7% positive" in d["seller"]
    assert d["description_url"] == "DESC_URL"


def args(**kw):
    base = dict(query="switch oled", min=None, max=None, condition=None, bin=False, auction=False, best_offer=False,
                free_shipping=False, sold=False, location=None, sort="best", page=1, limit=25, site="ebay.co.uk")
    base.update(kw)
    return SimpleNamespace(**base)


def test_ebay_url_builder():
    u = ebay.build_url(args(min=100, max=250, condition="used,refurbished", free_shipping=True, sold=True,
                            sort="price_low", location="domestic", page=2))
    assert u.startswith("https://www.ebay.co.uk/sch/i.html?_nkw=switch+oled&")
    for part in ("_udlo=100", "_udhi=250", "LH_ItemCondition=3000%7C2000%7C2010%7C2020%7C2030%7C2500",
                 "LH_FS=1", "LH_Sold=1", "LH_Complete=1", "_sop=15", "LH_PrefLoc=1", "_pgn=2", "_ipg=60"):
        assert part in u


def test_etsy_url_and_parsers():
    a = SimpleNamespace(query="dog collar", min=None, max=50, sort="top_reviews", free_shipping=True, handmade=False,
                        vintage=False, personalizable=True, on_sale=False, ship_to=None, page=1, region="uk")
    u = etsy.build_url(a)
    assert u == ("https://www.etsy.com/uk/search?q=dog+collar&explicit=1&max=50&order=highest_reviews"
                 "&free_shipping=true&is_personalizable=true&ship_to=GB")
    a.region, a.ship_to = "us", "ca"
    assert etsy.build_url(a).startswith("https://www.etsy.com/search?") and etsy.build_url(a).endswith("ship_to=CA")
    s = etsy.parse_search(ETSY_SEARCH)
    assert s[0] == {"title": "Custom Leather Dog Collar", "price": "34.00 USD", "shop": "BarkLeather",
                    "rating": {"stars": "4.9", "reviews": "812"},
                    "url": "https://www.etsy.com/listing/1234567890/custom-leather-dog-collar",
                    "image": "https://i.etsystatic.com/1.jpg"}
    assert s[1]["price"] == "20.00–45.00 USD"
    d = etsy.parse_listing(ETSY_LISTING)
    assert d["price"] == "34.00–52.00 USD"
    assert d["description"] == "Hand-stitched & made to order."
    assert d["reviews"] == [{"stars": 5, "text": "Beautiful collar!", "date": "2026-09-01"}]
    assert d["stock"] == "Only 3 left" and d["ships_from"] == "United Kingdom"
    assert d["returns"].startswith("Returns & exchanges accepted")


def test_etsy_link_fallback():
    html = '<a class="listing-link" href="https://www.etsy.com/listing/999/blue-mug?ref=x" title="Blue Mug">'
    assert etsy.parse_search(html) == [{"title": "Blue Mug", "url": "https://www.etsy.com/listing/999/blue-mug"}]


# ------------------------------------------------------------------ live HTTP against a local server

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        routes = {"/item": (200, ITEM_PAGE.replace("DESC_URL", f"http://127.0.0.1:{self.server.server_port}/desc")),
                  "/desc": (200, DESC), "/blocked": (403, BLOCKED), "/challenge": (200, BLOCKED)}
        code, body = routes.get(self.path, (404, "nope"))
        data = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        if "gzip" in self.headers.get("Accept-Encoding", "") and self.path == "/item":
            data = gzip.compress(data)
            self.send_header("Content-Encoding", "gzip")
        self.end_headers()
        self.wfile.write(data)


@pytest.fixture(scope="module")
def server():
    srv = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def test_fetch_gzip_and_block_detection(server):
    html = common.fetch(server + "/item")
    assert "x-item-title__mainTitle" in html
    for path in ("/blocked", "/challenge"):
        with pytest.raises(common.FetchError) as e:
            common.fetch(server + path)
        assert e.value.kind == "blocked"
    with pytest.raises(common.FetchError) as e:
        common.fetch("http://127.0.0.1:1/")
    assert e.value.kind == "network"


def run_cli(*argv):
    p = subprocess.run([sys.executable, *argv], cwd=SCRIPTS, capture_output=True, text=True)
    return p.returncode, json.loads(p.stdout) if p.stdout.strip() else p.stderr


def test_cli_url_commands_work_offline():
    code, out = run_cli("ebay.py", "url", "lego 10497", "--sort", "price_low", "--bin")
    assert code == 0 and out["ok"] and "LH_BIN=1" in out["url"] and "_sop=15" in out["url"]
    code, out = run_cli("etsy.py", "url", "ceramic mug", "--max", "40")
    assert code == 0 and out["url"] == "https://www.etsy.com/uk/search?q=ceramic+mug&explicit=1&max=40&ship_to=GB"
    code, out = run_cli("ebay.py", "url", "switch", "--location", "europe")
    assert out["url"].startswith("https://www.ebay.co.uk/") and "LH_PrefLoc=3" in out["url"]
    code, out = run_cli("ebay.py", "url", "switch", "--site", "ebay.com", "--location", "europe")
    assert code != 0  # EU filter only exists on eBay UK


def test_cli_item_keeps_site_from_link():
    code, out = run_cli("ebay.py", "item", "https://www.ebay.com/itm/335512345678")
    assert out["url"] == "https://www.ebay.com/itm/335512345678"
    code, out = run_cli("ebay.py", "item", "335512345678")
    assert out["url"] == "https://www.ebay.co.uk/itm/335512345678"


def test_cli_reports_network_failure_as_json():
    # The sandbox here can't reach ebay.com/etsy.com, which is exactly the "no network egress" case.
    code, out = run_cli("etsy.py", "search", "mug")
    assert code == 2 and out["ok"] is False and out["reason"] in ("network", "blocked")
    assert out["url"].startswith("https://www.etsy.com/uk/search?q=mug") and "web_search" in out["next_step"]
