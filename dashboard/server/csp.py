"""Content-Security-Policy headers.

Two policies:
  * APP  — for the built React app: strict, everything from 'self', no inline.
  * debug.html — same strictness but its ONE inline <script> and <style> are
    sha256-pinned (the debug page is standalone and must keep working even if
    the app build is broken, so it cannot use hashed-filename external files).
"""

from __future__ import annotations

import base64
import hashlib
import re

from aiohttp import web

CSP_APP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; "
    "connect-src 'self' ws: wss:; img-src 'self' data:; "
    "base-uri 'self'; frame-ancestors 'none'"
)

_STYLE_RE = re.compile(r"<style[^>]*>(.*?)</style>", re.DOTALL)
_SCRIPT_RE = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.DOTALL)


def sha256_b64(text: str) -> str:
    return "sha256-" + base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode("ascii")


def build_csp_for_html(html: str) -> str:
    """CSP for a standalone HTML page, hashing its inline blocks."""
    scripts = _SCRIPT_RE.findall(html)
    styles = _STYLE_RE.findall(html)
    script_src = " ".join(f"'{sha256_b64(s)}'" for s in scripts) or "'none'"
    style_src = " ".join(f"'{sha256_b64(s)}'" for s in styles) or "'none'"
    return (
        f"default-src 'self'; script-src {script_src}; style-src {style_src}; "
        "connect-src 'self' ws: wss:; img-src 'self' data:; "
        "base-uri 'self'; frame-ancestors 'none'"
    )


def apply(resp: web.StreamResponse, csp: str) -> web.StreamResponse:
    resp.headers["Content-Security-Policy"] = csp
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp
