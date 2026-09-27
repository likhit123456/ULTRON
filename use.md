# ULTRON — Dashboard `use.md`

> Complete reference for the **Phase 1 dashboard** (owning node: **Pi4 — GOVERNANCE**, `192.168.100.1:8080`).
> Written from the actual code (routes, subscriptions, publishes and SQL were grepped — see §12 for the commands + counts).
> Phase 1 is **notify-only**: nothing here blocks, quarantines, or responds. That is Phase 2.

**Stack:** operator UI = **React + TypeScript, built with Vite** (multi-file, `dashboard/web/`). The Pi4 serves only the built static output in `dist/` — it never runs Node/npm and fetches nothing from the internet at runtime. Server = **Python (aiohttp) `dashboard/server/`**. Debug page = one standalone `dashboard/debug/debug.html` (vanilla JS).

---

## 1. Quick use

```bash
# Build the UI (dev machine only)
cd dashboard/web && npm install && npm run build      # -> dashboard/web/dist

# Run the server (dev)
cd dashboard && pip install -r server/requirements.txt
python -m server.main                                  # serves dist + /ws on :8080

# Open
#   operator : http://<host>:8080/
#   booth TV : http://<host>:8080/?view=booth
#   debug    : http://<host>:8080/debug.html      (only if ULTRON_DEBUG=1 or mgmt subnet+auth)

# Dev demo feed (needs a broker; never run in prod)
python tools/mock_feed.py --host 127.0.0.1 --port 1883 --script demo

# Tests
cd dashboard/web && npm run test        # vitest (web logic)
cd dashboard && python -m pytest        # pytest (server)
```

**Deploy to Pi4**
```bash
sudo mkdir -p /opt/ultron/dashboard
sudo cp -r dashboard/web/dist /opt/ultron/dashboard/dist
sudo cp -r dashboard/server   /opt/ultron/dashboard/server
sudo cp dashboard/debug/debug.html /opt/ultron/dashboard/debug.html
sudo cp systemd/sentinel-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now sentinel-dashboard   # start
sudo systemctl stop sentinel-dashboard                                           # stop
```

---

## 2. HTTP endpoints

| Method | Path | Auth / enable | Response | Cache | Used by |
|--------|------|---------------|----------|-------|---------|
| GET | `/` | open (LAN) | React `index.html` (app CSP) | `no-store` | browser |
| GET | `/assets/{file}` | open | hashed JS/CSS/fonts | `public, max-age=31536000, immutable` | browser |
| GET | `/debug.html` | `ULTRON_DEBUG=1`, **or** client in `ULTRON_MGMT_SUBNET` + HTTP Basic auth; else **404** | standalone debug page (hashed CSP) | `no-store` | operator |
| GET | `/healthz` | open | `{ok, mqtt_connected, db_readable, uptime_s, version, ws_clients}` | `no-store` | systemd, debug page |
| GET | `/favicon.ico` | open | `dist/favicon.ico` or `204` | — | browser |
| WS  | `/ws` | **session cookie + Origin** | data stream + ACK in + clock-sync | — | operator, booth, debug |
| POST | `/auth/setup` | enrollment token | begin first-credential registration | — | CLI / setup |
| POST | `/auth/setup/complete` | ceremony cookie | finish first registration + session | — | CLI / setup |
| POST | `/auth/login/begin` | open | begin authentication ceremony | — | browser |
| POST | `/auth/login/complete` | ceremony cookie | finish login + session | — | browser |
| POST | `/auth/reauth/begin` | open | begin re-authentication | — | browser |
| POST | `/auth/reauth/complete` | ceremony cookie | finish re-auth + session refresh | — | browser |
| POST | `/auth/register/begin` | session | begin add-credential ceremony | — | browser |
| POST | `/auth/register/complete` | session + ceremony | finish add credential | — | browser |
| POST | `/auth/logout` | session | revoke session, close WS | — | browser |
| GET | `/auth/status` | open | `{has_owner, authenticated}` | — | browser |
| GET | `/auth/credentials` | session | list credentials | — | browser |
| DELETE | `/auth/credentials/{id}` | session | revoke a credential | — | browser |
| GET | `/{path}` | open | SPA fallback → `index.html` | `no-store` | deep links |

Example `/healthz`:
```json
{"ok":true,"mqtt_connected":true,"db_readable":false,"uptime_s":1.2,"version":"0.4.0-phase1","ws_clients":1}
```
Routes beyond §3's allowed set are justified: `/favicon.ico` (browser default request → 204) and the SPA fallback (`?view=booth` is a query on `/`, but the fallback keeps deep links working).

**CSP.** App pages: `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; base-uri 'self'; frame-ancestors 'none'` (the built `index.html` has no inline script/style). `debug.html`: same, but its one inline `<script>` and `<style>` are `sha256`-pinned at startup by `server/csp.py`.

---

## 3. WebSocket `/ws`

Envelope (server → client), `ts` = **MQTT-receive time**, seconds since epoch with **ms precision**:
```json
{ "t": "score|band|alert|health|lan|tripwire|history|toast|event", "ts": 1767000000.123, "d": {} }
```

| `t` | `d` schema | example | from MQTT topic | consumed by |
|-----|-----------|---------|-----------------|-------------|
| `score` | `{v:int}` | `{"v":72}` | `ultron/risk/score` | RiskPanel, History, PipelineStrip |
| `band` | `{b:Band}` | `{"b":"RED"}` | `ultron/risk/band` | App (theme), RiskPanel, IndicatorTwin, Header |
| `alert` | `{id,sev,title,src,body,ts?,ack,ack_ts?}` | `{"id":"a1","sev":"red",…}` | `ultron/alert/#` | AlertFeed, EventFeed |
| `health` | `{node,up?,services?[]}` | `{"node":"pi4","up":9000}` | `ultron/health/#` | NodeTiles, HardwareTwin, StatusStrip |
| `lan` | `{mac,ip?,vendor?,known?,first_seen?,last_seen?}` | `{"mac":"AA:…","known":false}` | `ultron/lan/#` | EventFeed, IoTGraph, StatusStrip |
| `tripwire` | `{node,edge}` | `{"node":"pi3a","edge":"open"}` | `ultron/tripwire/#` | EventFeed, HardwareTwin (lid pop) |
| `history` | `{points:[[ts,score],…]}` | sent once on join | evidence SQLite `scores` | History, RiskPanel |
| `toast` | `{msg,sev}` | `{"msg":"MQTT DEGRADED",…}` | server-generated | DegradedBanner |
| `event` | `{topic,node,kind,sev,summary,src_ip?,dest_ip?,mac?,sig_id?}` | `{"node":"pi3a","kind":"suricata","sev":"red","summary":"ET MALWARE…"}` | `ultron/suricata/#`, `ultron/wifi/#` | EventFeed, IoTGraph |

> **`event` vs `alert`:** `ultron/suricata/#` and `ultron/wifi/#` are surfaced as `t:"event"` (structured passthrough for the unified event feed), **not** `t:"alert"`. Alerts come only from `ultron/alert/#` (owned by Pi3b's alert manager). This separation prevents duplicate alert counts, non-persistent ACKs for bridge-generated IDs, and suricata bursts corrupting ack stats.

**Client → server**
| Message | Example | Server action |
|---------|---------|---------------|
| ACK | `{"ack":"a1"}` | publishes `ultron/ack/a1` (QoS 1, JSON `{id,ts,op:"dashboard"}`). Offline → UI queues, flushes on reconnect. |
| Clock ping | `{"ctl":"ping","c":<client_ms>}` | replies `{"ctl":"pong","c":<client_ms>,"s":<server_ms>}` — **never touches MQTT**, not an envelope type. |

**Connect sequence:** `history` (24h scores from SQLite) → recent alerts replayed as `alert` **with stored `ack`** → a `toast` reflecting broker state → live stream.
**Reconnect:** backoff 1 s → 2 s → 5 s; chip LIVE → STALE (>5 s no frame) → OFFLINE (socket closed).

---

## 4. MQTT

**Subscribed (allowlist — exactly these 8, nothing else):**
`ultron/health/#`, `ultron/alert/#`, `ultron/risk/score`, `ultron/risk/band`, `ultron/lan/#`, `ultron/tripwire/#`, `ultron/suricata/#`, `ultron/wifi/#`.

**Published (the only publish in the whole server):** `ultron/ack/{id}` — QoS 1, not retained.

| Topic | Publisher (owner) | Retained | Dashboard role |
|-------|-------------------|----------|----------------|
| `ultron/risk/score` · `ultron/risk/band` | **Pi4** | yes | subscribe (read) |
| `ultron/alert/#` | Pi4 / Pi3b | no | subscribe |
| `ultron/suricata/#` · `ultron/lan/#` · `ultron/wifi/#` · `ultron/tripwire/#` | Pi3a (tripwire also Pi3b) | no | subscribe |
| `ultron/health/#` | all nodes | yes | subscribe |
| `ultron/ack/#` | **dashboard** → Pi3b | no | **publish only** |

The dashboard **never** writes `ultron/risk/#` (that is Pi4's `sentinel-risk`), and never invents topics.

---

## 5. Data changes (who writes what)

**Frontend store fields ← which message** (`dashboard/web/src/store/store.ts`):

| Message | Store mutation |
|---------|----------------|
| `score` | `score`, `scoreTs`, append `history`, `pipeline.govern` |
| `band` | `band`; `bandBump++` if worse |
| `history` | replace `history`; sync `score` |
| `alert` | prepend `alerts` (dedupe by id, cap 200); `eventCount++`, `ackTotal++`, `openCount`/`ackDone`; append to `events` as `kind:"alert"`; `pipeline.alert` |
| `event` | `eventCount++`; append to `events` (cap 500) with structured fields; suricata→`layers.ids*`, wifi→`layers.wifi*`; `pipeline.detect` |
| `health` | `nodes[node] = {up,lastSeen}`; `pipeline.{govern|detect|alert}` |
| `lan` | `layers.lanToday++`, `eventCount++`, `pipeline.detect` |
| `tripwire` | `layers.tripLast`, `layers.tripSeq++`, `eventCount++`, `pipeline.{detect|alert}` |
| `toast` | `degraded` on/off, `lastToast` |
| (client) `ackLocal` | mark alert acked, `openCount--`, `ackDone++` (optimistic) |
| (pong) | `clock` offset/uncertainty; feeds `latencyLast`/`latencyP95` |

**SQLite reads (read-only, `dashboard/server/db.py`):**
- `SELECT ts, score FROM scores WHERE ts >= ? ORDER BY ts ASC` — 24h history for the chart on join.
- `SELECT id, ts, sev, title, src, body, ack, ack_ts FROM alerts WHERE ts >= ? ORDER BY ts DESC LIMIT ?` — recent alerts + **stored ack** (so ACK survives refresh).
- `SELECT 1` — `db_readable` probe for `/healthz`.

**ACK flow, end to end:** ACK button → WS `{ack:id}` → server `bridge.publish_ack` → **`ultron/ack/{id}`** → Pi3b writes `alerts.ack` / `alerts.ack_ts` → on refresh the server replays that alert with `ack:true`.

**The dashboard never writes:** `ultron/risk/#`, any other MQTT topic, or the evidence DB (opened `mode=ro`).

### 5.1 Operator commands (`lib/commands.ts` — 17 total)

| # | Command | Args | Mode | Description |
|---|---------|------|------|-------------|
| 1 | `/help` | — | client | List commands with args |
| 2 | `/filter` | `<sev:x src:x type:x>` | client | Filter the events panel |
| 3 | `/clear-filter` | — | client | Reset event filters |
| 4 | `/focus` | `<pi4\|pi3a\|pi3b\|c3\|wroom>` | client | Highlight a node in the device map |
| 5 | `/device` | `<ip\|mac>` | client | Open a device card in the IoT graph |
| 6 | `/history` | `<1h\|6h\|24h>` | client | Change the chart range |
| 7 | `/view` | `<operator\|booth>` | client | Switch view |
| 8 | `/latency` | — | client | Print latency stats |
| 9 | `/health` | — | client | Print per-node heartbeat ages |
| 10 | `/mute` | `<minutes>` | client | Mute toasts |
| 11 | `/export` | `alerts` | client | Browser-side CSV of alerts |
| 12 | `/ack` | `<id\|all>` | server (deferred) | Acknowledge alert(s) — requires owner session |
| 13 | `/lock` | — | server (deferred) | End the session — requires owner session |
| 14 | `/devices` | — | server (deferred) | List registered passkeys — requires owner session |
| 15 | `/block` | — | Phase 2 (disabled) | Block a device |
| 16 | `/isolate` | — | Phase 2 (disabled) | Isolate a segment |
| 17 | `/quarantine` | — | Phase 2 (disabled) | Quarantine a host |
| 18 | `/restart` | — | Phase 2 (disabled) | Restart a service |
| 19 | `/scan` | — | Phase 2 (disabled) | Scan network |

Modes: **client** = runs in browser, no server; **server (deferred)** = needs authenticated WS, returns "requires authentication" until Part B; **Phase 2 (disabled)** = response action, rejected with "Phase 2" message, chip disabled in UI. The `COMMANDS` array has exactly **19** entries (`lib/commands.ts`).

**Quick Controls** (6 buttons): ACK ALL (disabled — requires session), UNACKED, FOCUS NODE, BOOTH VIEW, EXPORT CSV, LOCK (disabled — requires session).

---

## 6. What was built for what

| Thing | Does | Reads | Satisfies | Node |
|-------|------|-------|-----------|------|
| `web/store` | external store + selectors (useSyncExternalStore), rAF-batched | all `t` | perf §6.2, render isolation | Pi4 |
| `web/transport` | WS client, reconnect, ACK queue, clock sync, latency | `/ws` | §7 states, clock skew | Pi4 |
| `RiskPanel` | numeral + ring gauge + failure grey | score/band/conn | §4.2, 6.6 | Pi4 |
| `HardwareTwin` | SVG shelf; health LEDs, cable pulses, tripwire lid pop | health/tripwire/events | §6.1, README §7 beat 3 | all |
| `PipelineStrip` | DETECT→GOVERN→ALERT + bus→screen latency + p95 | pipeline/latency | §6.3, perf gate | all |
| `AlertFeed` | cards, ACK, dedupe, window 200, empty state | alerts | §4.6 alert mgmt | Pi3b |
| `DetectionLayers` | IDS/LAN/WiFi/Tripwire rows; trip flash | alerts/lan/tripwire | §4.5 | Pi3a |
| `IndicatorTwin` | 128×64 OLED canvas + 8 LEDs (band pattern) | score/band/nodes | §4.3, ESP32-C3 mirror | Pi4/ESP |
| `NodeTiles` | 4 tiles, state dot, uptime, service pills | health | §4.4 | all |
| `History` | 24h step ribbon, grid 30/60/85 | history/score | §4.7 | Pi4 |
| `StatsStrip` | events/open/ack%/uptime/new-devices + decay note | derived | §4.8 | Pi4 |
| `Header`/`DegradedBanner` | LIVE/STALE/OFFLINE, band pill, clock; degraded banner | conn/band | §4.1, 6.6 | Pi4 |
| `BoothView` | 1920×1080 TV view (lazy) | same store | §6.7 | Pi4 |
| `server/main` | routes, /ws, /healthz, static, debug gating | — | §3 | Pi4 |
| `server/bridge` | MQTT↔WS allowlist, envelope, fan-out, ack publish | MQTT | §4, §5 | Pi4 |
| `server/db` · `csp` · `clock` · `config` | evidence reads · CSP · ping-pong · env | — | §2, §3 | Pi4 |
| `debug.html` | 6-panel read-only inspector | `/ws`, `/healthz` | §7 | Pi4 |
| `tools/mock_feed` | dev demo publisher (`--script demo`) | — | §9 rehearsal | dev |

---

## 7. Config / environment variables

| Var | Default | Effect |
|-----|---------|--------|
| `ULTRON_HTTP_HOST` / `ULTRON_HTTP_PORT` | `0.0.0.0` / `8080` | bind address |
| `ULTRON_MQTT_HOST` / `ULTRON_MQTT_PORT` | `127.0.0.1` / `1883` | broker |
| `ULTRON_MQTT_USER` / `ULTRON_MQTT_PASS` | `dash` / `` | broker auth (empty user = anonymous) |
| `ULTRON_EVIDENCE_DB` | `/mnt/pendrive/ultron/ultron.db` | read-only evidence SQLite |
| `ULTRON_DIST` | auto (`dashboard/dist` → `web/dist`) | built app directory |
| `ULTRON_DEBUG` | `0` | `1` enables `/debug.html` globally |
| `ULTRON_MGMT_SUBNET` | `192.168.50.0/24` | subnet allowed to reach `/debug.html` with auth |
| `ULTRON_DEBUG_USER` / `ULTRON_DEBUG_PASS` | `admin` / `` | Basic auth for `/debug.html` |
| `ULTRON_LOG` | `INFO` | log level |
| `ULTRON_AUTH_DB` | `dashboard/auth.db` | auth SQLite (sessions, credentials, audit) |
| `ULTRON_RP_ID` | `localhost` | WebAuthn relying party ID (must be hostname, not IP) |
| `ULTRON_RP_NAME` | `ULTRON` | WebAuthn relying party display name |
| `ULTRON_ORIGINS` | `http://localhost:8080` | comma-separated allowed origins (non-localhost `http://` rejected) |
| `ULTRON_SESSION_TTL` | `3600` | session lifetime in seconds |

**Config guards** — server refuses to start if:
1. `ULTRON_ORIGINS` contains a non-localhost `http://` origin
2. `ULTRON_DEBUG=1` with a non-localhost `ULTRON_RP_ID`
3. `ULTRON_RP_ID` is an IP address (must be a hostname)

---

## 8. Fixed issues

| Issue | Status | Detail |
|-------|--------|--------|
| **Unauthenticated WS ACK** | **closed (CP4)** | WS upgrade now requires a valid session cookie and matching `Origin` header. ACK is accepted only on an authenticated socket. Prior to CP4, any LAN client could send `{"ack":"<id>"}` over WS and acknowledge alerts without authentication. |

---

## 9. Known gaps

- **Left out (bus carries no data):** WiFi "last beacon anomaly" detail and Suricata "rule count" are approximated from the alert stream (`src`), since no dedicated topic/field exists. IDS "rule count" shows alert count, not loaded-rule count.
- **CSS modules:** the brief suggested per-component CSS modules; the app uses one `styles/global.css` + `tokens.css` (smaller bundle) — a deliberate deviation.
- **hardware.png vs docs (docs authoritative):** (1) switch port numbering; (2) ESP32-WROOM shown on USB "serial" vs docs GPIO-only/radio-off; (3) pendrive on USB2 hub vs Pi4 USB3; (4) TL-WN722N on Pi4 vs Pi3a; (5) SSD "NAS" vs admin-key/offload; (6) extra USB2 hub (docs: none); (7) fan vs passive heatsink; (8) 3 AC outlets vs one PSU strip; (9) tripwire Pi-side pin labels vs the `ultron/tripwire/pi3a|pi3b` topic contract. The hardware twin follows **architecture.md §3.6**.

Phase 2 (response) and Phase 3 (hunting) are documented in the roadmap only — no code shipped.
