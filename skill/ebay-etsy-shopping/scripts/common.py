"""Shared helpers: fetching pages and pulling text/JSON-LD out of HTML (stdlib only)."""

from __future__ import annotations

import gzip
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request
import zlib
from html import unescape
from html.parser import HTMLParser

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
}

BOT_MARKERS = (
    "pardon our interruption",
    "captcha-delivery.com",
    "js.datadome.co",
    "please enable js and disable any ad blocker",
    "verify you are a human",
    "/splashui/challenge",
)


class FetchError(Exception):
    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind  # "network" | "blocked" | "http"


def _ssl_context() -> ssl.SSLContext:
    cafile = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
    return ssl.create_default_context(cafile=cafile) if cafile else ssl.create_default_context()


def fetch(url: str, timeout: int = 25) -> str:
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as r:
            raw = r.read()
            enc = (r.headers.get("Content-Encoding") or "").lower()
            charset = r.headers.get_content_charset() or "utf-8"
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = _decode(e.read(), (e.headers.get("Content-Encoding") or "").lower(), "utf-8")
        except Exception:
            pass
        if e.code in (403, 429) or _looks_blocked(body):
            raise FetchError("blocked", f"HTTP {e.code}: the site refused this automated request.") from None
        raise FetchError("http", f"HTTP {e.code} for {url}") from None
    except (urllib.error.URLError, OSError) as e:
        raise FetchError(
            "network",
            f"Could not connect ({getattr(e, 'reason', e)}). Code execution probably lacks internet access.",
        ) from None
    html = _decode(raw, enc, charset)
    if _looks_blocked(html):
        raise FetchError("blocked", "The site answered with a bot-check page instead of results.")
    return html


def _decode(raw: bytes, enc: str, charset: str) -> str:
    if "gzip" in enc:
        raw = gzip.decompress(raw)
    elif "deflate" in enc:
        raw = zlib.decompress(raw)
    return raw.decode(charset, errors="replace")


def _looks_blocked(html: str) -> bool:
    head = html[:20000].lower()
    return any(m in head for m in BOT_MARKERS)


def fail(err: FetchError, url: str, fallback: str) -> None:
    """Print a machine-readable failure so Claude knows which fallback to use, then exit."""
    print(json.dumps({"ok": False, "reason": err.kind, "message": str(err), "url": url, "next_step": fallback}, indent=1))
    sys.exit(2)


def emit(data: dict) -> None:
    print(json.dumps({"ok": True, **data}, indent=1, ensure_ascii=False))


# ------------------------------------------------------------------ HTML text segments

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
SKIP = {"script", "style", "noscript", "template", "svg"}


class Segments(HTMLParser):
    """Collects visible text pieces, each tagged with its ancestors' (element_id, class) pairs."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, int, str]] = []  # (tag, element_id, class)
        self.counter = 0
        self.skip = 0
        self.segments: list[tuple[str, list[tuple[int, str]]]] = []
        self.images: list[dict] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "img":
            self.images.append(a)
        if tag in VOID:
            return
        self.counter += 1
        self.stack.append((tag, self.counter, a.get("class") or ""))
        if tag in SKIP:
            self.skip += 1

    def handle_startendtag(self, tag, attrs):
        if tag == "img":
            self.images.append(dict(attrs))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                for t, _, _ in self.stack[i:]:
                    if t in SKIP:
                        self.skip -= 1
                del self.stack[i:]
                return

    def handle_data(self, data):
        if self.skip:
            return
        text = " ".join(data.split())
        if text:
            self.segments.append((text, [(eid, cls) for _, eid, cls in self.stack]))


def segments(html: str) -> Segments:
    p = Segments()
    p.feed(html)
    p.close()
    return p


def group_by_class(segs, needle: str) -> list[tuple[int, str]]:
    """Join text under each outermost element whose class contains `needle`, in document order."""
    groups: dict[int, list[str]] = {}
    for text, ancestors in segs:
        for eid, cls in ancestors:
            if needle in cls:
                groups.setdefault(eid, []).append(text)
                break
    return [(eid, " ".join(parts)) for eid, parts in groups.items()]


def first_in_class(segs, needle: str) -> str | None:
    g = group_by_class(segs, needle)
    return g[0][1] if g else None


# ------------------------------------------------------------------ JSON-LD

_LD = re.compile(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>', re.S | re.I)


def json_ld(html: str) -> list:
    out = []
    for block in _LD.findall(html):
        try:
            out.append(json.loads(unescape(block.strip()) if block.strip().startswith("&") else block.strip()))
        except ValueError:
            continue
    return out


def walk(obj):
    """Yield every dict nested anywhere inside obj."""
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from walk(v)


def of_type(obj: dict, name: str) -> bool:
    t = obj.get("@type")
    return t == name or (isinstance(t, list) and name in t)


def strip_html(s: str, limit: int = 3000) -> str:
    s = re.sub(r"(?is)<(script|style).*?</\1>", " ", s)
    s = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>", "\n", s)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    s = unescape(s)
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r" *\n[\s]*", "\n", s).strip()
    return s[:limit] + ("…" if len(s) > limit else "")


def clean(d: dict) -> dict:
    return {k: v for k, v in d.items() if v not in (None, "", [], {})}
