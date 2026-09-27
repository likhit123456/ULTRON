"""ULTRON dashboard web server (Pi4 — GOVERNANCE, :8080).

Routes (the only ones): /  /assets/*  /debug.html  /ws  /healthz
(+ /favicon.ico and a SPA fallback — justified in use.md).

Serves the built React app, bridges MQTT<->/ws, replays history + acked alerts
on join, handles ACK and clock-sync control frames. Never writes ultron/risk/#.
"""

from __future__ import annotations

import asyncio
import base64
import ipaddress
import json
import logging
import os
import time
from pathlib import Path

from aiohttp import WSMsgType, web

from . import clock, csp, db
from .bridge import Bridge, Hub, envelope
from .config import Config, load

LOG = logging.getLogger("ultron.main")
_START = time.monotonic()


# --------------------------------------------------------------------------- #
# Debug gating
# --------------------------------------------------------------------------- #
def _ip_in(ip: str, subnet: str) -> bool:
    try:
        return ipaddress.ip_address(ip) in ipaddress.ip_network(subnet, strict=False)
    except ValueError:
        return False


def _check_basic(request: web.Request, user: str, pw: str) -> bool:
    hdr = request.headers.get("Authorization", "")
    if not hdr.startswith("Basic "):
        return False
    try:
        raw = base64.b64decode(hdr[6:]).decode("utf-8")
        u, _, p = raw.partition(":")
    except Exception:  # noqa: BLE001
        return False
    return u == user and p == pw


def _debug_gate(request: web.Request, cfg: Config) -> None:
    """Raise 404/401 unless debug is permitted for this client."""
    ip = request.remote or ""
    in_mgmt = _ip_in(ip, cfg.mgmt_subnet)
    if not (cfg.debug_enabled or in_mgmt):
        raise web.HTTPNotFound()
    if cfg.debug_pass:
        if not _check_basic(request, cfg.debug_user, cfg.debug_pass):
            raise web.HTTPUnauthorized(headers={"WWW-Authenticate": 'Basic realm="ultron"'})
    elif not cfg.debug_enabled:
        # Reached via mgmt subnet but no password configured -> fail safe.
        raise web.HTTPNotFound()


# --------------------------------------------------------------------------- #
# HTTP handlers
# --------------------------------------------------------------------------- #
async def handle_index(request: web.Request) -> web.Response:
    cfg: Config = request.app["cfg"]
    if not cfg.dist_index.exists():
        raise web.HTTPNotFound(text="frontend not built; run: make build (vite build)")
    resp = web.Response(text=cfg.dist_index.read_text(encoding="utf-8"),
                        content_type="text/html", charset="utf-8")
    resp.headers["Cache-Control"] = "no-store"
    return csp.apply(resp, csp.CSP_APP)


async def handle_asset(request: web.Request) -> web.StreamResponse:
    cfg: Config = request.app["cfg"]
    tail = request.match_info.get("tail", "")
    target = (cfg.dist_dir / "assets" / tail).resolve()
    assets_root = (cfg.dist_dir / "assets").resolve()
    if assets_root != target and assets_root not in target.parents:
        raise web.HTTPNotFound()
    if not target.is_file():
        raise web.HTTPNotFound()
    resp = web.FileResponse(target)
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return csp.apply(resp, csp.CSP_APP)


async def handle_spa(request: web.Request) -> web.Response:
    # SPA fallback for unknown same-origin paths (justified in use.md).
    return await handle_index(request)


async def handle_favicon(request: web.Request) -> web.StreamResponse:
    cfg: Config = request.app["cfg"]
    fav = cfg.dist_dir / "favicon.ico"
    if fav.is_file():
        return csp.apply(web.FileResponse(fav), csp.CSP_APP)
    return web.Response(status=204)


async def handle_debug(request: web.Request) -> web.Response:
    cfg: Config = request.app["cfg"]
    _debug_gate(request, cfg)
    page = request.app.get("debug_page")
    if page is None:
        raise web.HTTPNotFound(text="debug.html missing")
    body, policy = page
    resp = web.Response(text=body, content_type="text/html", charset="utf-8")
    resp.headers["Cache-Control"] = "no-store"
    return csp.apply(resp, policy)


async def handle_healthz(request: web.Request) -> web.Response:
    app = request.app
    cfg: Config = app["cfg"]
    bridge: Bridge = app["bridge"]
    body = {
        "ok": True,
        "mqtt_connected": bool(bridge.connected),
        "db_readable": await db.db_readable(cfg.evidence_db),
        "uptime_s": round(time.monotonic() - _START, 1),
        "version": cfg.version,
        "ws_clients": app["hub"].count,
    }
    return web.json_response(body, headers={"Cache-Control": "no-store"})


# --------------------------------------------------------------------------- #
# WebSocket
# --------------------------------------------------------------------------- #
async def handle_ws(request: web.Request) -> web.WebSocketResponse:
    app = request.app
    cfg: Config = app["cfg"]
    hub: Hub = app["hub"]
    bridge: Bridge = app["bridge"]

    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    hub.add(ws)
    LOG.info("WS join (%d clients)", hub.count)

    def send(obj: dict) -> "asyncio.Future":
        return ws.send_str(json.dumps(obj, separators=(",", ":")))

    # 1) history, 2) recent alerts replayed with stored ack, 3) broker state
    await send(envelope("history", {"points": await db.read_history(cfg.evidence_db)}))
    for alert in reversed(await db.read_recent_alerts(cfg.evidence_db)):
        await send(envelope("alert", alert))
    await send(envelope("toast", {"msg": "MQTT LIVE" if bridge.connected else "MQTT DEGRADED",
                                  "sev": "green" if bridge.connected else "red"}))

    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                if msg.type == WSMsgType.ERROR:
                    LOG.warning("WS error: %s", ws.exception())
                continue
            try:
                ctrl = json.loads(msg.data)
            except ValueError:
                continue
            if not isinstance(ctrl, dict):
                continue
            # clock-sync control frame (never touches MQTT)
            if clock.is_ctl(ctrl):
                pong = clock.make_pong(ctrl)
                if pong is not None:
                    await send(pong)
                continue
            # operator ACK
            aid = ctrl.get("ack")
            if aid:
                ok = await bridge.publish_ack(str(aid))
                await send(envelope("toast", {
                    "msg": f"ACK {'sent' if ok else 'queued'}: {aid}",
                    "sev": "green" if ok else "yellow"}))
    finally:
        hub.remove(ws)
        LOG.info("WS leave (%d clients)", hub.count)
    return ws


# --------------------------------------------------------------------------- #
# App wiring
# --------------------------------------------------------------------------- #
async def _on_startup(app: web.Application) -> None:
    app["bridge_task"] = asyncio.create_task(app["bridge"].run())


async def _on_cleanup(app: web.Application) -> None:
    app["bridge"].stop()
    task = app.get("bridge_task")
    if task:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


def create_app(cfg: Config | None = None) -> web.Application:
    cfg = cfg or load()
    app = web.Application()
    app["cfg"] = cfg
    app["hub"] = Hub()
    app["bridge"] = Bridge(cfg, app["hub"])

    if cfg.debug_html.exists():
        html = cfg.debug_html.read_text(encoding="utf-8")
        app["debug_page"] = (html, csp.build_csp_for_html(html))
        LOG.info("debug.html loaded from %s", cfg.debug_html)
    else:
        app["debug_page"] = None

    LOG.info("dist=%s (exists=%s) version=%s", cfg.dist_dir, cfg.dist_dir.exists(), cfg.version)

    app.add_routes([
        web.get("/ws", handle_ws),
        web.get("/healthz", handle_healthz),
        web.get("/debug.html", handle_debug),
        web.get("/favicon.ico", handle_favicon),
        web.get("/assets/{tail:.*}", handle_asset),
        web.get("/", handle_index),
        web.get("/{tail:.*}", handle_spa),
    ])
    app.on_startup.append(_on_startup)
    app.on_cleanup.append(_on_cleanup)
    return app


def main() -> None:
    logging.basicConfig(level=os.environ.get("ULTRON_LOG", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if os.name == "nt":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    cfg = load()
    web.run_app(create_app(cfg), host=cfg.http_host, port=cfg.http_port, print=None)


if __name__ == "__main__":
    main()
