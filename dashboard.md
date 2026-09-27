# ULTRON — Premium Dashboard Spec

> **Non-negotiable:** The dashboard is the face of Black Hat Phase 1 **alert management**. *Top notch, no compromise.* Zero dependencies. One file. &lt;100ms. Operator-grade.

**Stack:** operator UI is a **React + TypeScript app built with Vite** (multi-file, `dashboard/web/`). Node/npm/Vite are used **only on the dev machine at build time**; Pi4 serves the built static output in `dist/` and fetches nothing at runtime (no CDN, no web fonts — everything same-origin/air-gapped). Runtime deps are React + ReactDOM only; charts/gauges/the hardware twin are hand-built SVG/canvas. A single standalone `debug/debug.html` (vanilla JS) is the read-only inspector. Served by Pi4 on **:8080**; real-time via WebSocket bridged from Mosquitto. There is also a **booth view** (`?view=booth`) for a 1920×1080 TV — a view, not a mode. Full reference: [`use.md`](use.md).

---

## 1. Design Principles

| # | Principle | Meaning |
|---|-----------|---------|
| 1 | **3-second mentor read** | Risk number → band color → red alerts → all nodes green |
| 2 | **Band is the theme** | Entire accent follows `html[data-band]` |
| 3 | **Notify-first copy** | Phase 1 never claims auto-block; response is Phase 2 |
| 4 | **Fail-visible** | LIVE / STALE / OFFLINE always honest |
| 5 | **Zero deps** | Air-gapped on Pi4 |
| 6 | **Ack is state** | Acknowledgements persist in SQLite |
| 7 | **Mobile-OK** | Usable on operator tablet at demo table |

---

## 2. Information Architecture

```
┌ Header ─────────────────────────────────────────────┐
│ ULTRON · LIVE · band chip · UTC clock · mode ULTRON │
├──────────────┬──────────────────────────────────────┤
│ Risk gauge   │ Band card + escalation note          │
│ 0–100        │ notify only — response is Phase 2    │
├──────────────┼──────────────────────────────────────┤
│ Node grid    │ Detection layers (IDS / LAN / …)      │
│ 4 tiles      │                                      │
├──────────────┴──────────────────────────────────────┤
│ Alert feed (ack)          │ 24h score sparkline     │
├───────────────────────────┴─────────────────────────┤
│ LAN joins · events/24h · ack rate · uptime        │
├ Footer: build · MQTT · evidence ────────────────────┤
```

**Priority order:** risk number → band color → red alerts → all nodes green.

---

## 3. Visual System

### Tokens

```css
:root {
  --bg: #0a0e14;
  --panel: #111823;
  --border: #1e2a3a;
  --text: #d7e0ea;
  --muted: #7a8b9f;
  --green: #22c55e;
  --yellow: #eab308;
  --red: #ef4444;
  --purple: #a855f7;
  --accent: var(--green); /* overridden by band */
}
html[data-band="GREEN"]  { --accent: var(--green); }
html[data-band="YELLOW"] { --accent: var(--yellow); }
html[data-band="RED"]    { --accent: var(--red); }
html[data-band="PURPLE"] { --accent: var(--purple); }
```

| Role | Spec |
|------|------|
| Font | `system-ui, ui-monospace, monospace` for numbers |
| Risk numeral | 72–96px, tabular-nums, `--accent` |
| Panels | `--panel`, 1px `--border`, 10–12px radius |
| Motion | 150–250ms ease; respect `prefers-reduced-motion` |

---

### 3c. Visual language — restrained operator console + hardware twin

Benchmark: serious instrumentation software — calm, precise, dense but legible, never decorative. Every pixel carries or frames data.
- **Surfaces:** near-black `--bg #0a0e14`, panels `#111823`, 1px `--border #1e2a3a` hairlines, a faint 8px panel grid at ≤4% contrast.
- **Colour:** exactly one live accent — the current band via `html[data-band]`; everything else greyscale. Glow only on actively-signalling elements (band ring, active cable, new alert), disabled under reduced motion.
- **Type:** `system-ui` for text; `ui-monospace` `tabular-nums` for every number. Labels uppercase 11–12px, 0.08em, muted.
- **Motion:** 150–250ms ease-out, transform/opacity only, zero layout shift. A band change restyles the whole UI within one frame; one 400ms accent header sweep on escalation and on reconnect.
- **Hardware twin (hero):** inline-SVG line drawing of the real shelf (architecture.md §3.6). Health LED per board; dead node → grey + `NO HEARTBEAT · Ns` + dashed cable; event → accent dash travels the node's cable to Pi4 (pooled refs, no per-event DOM); tripwire edge → that Pi's case lid swings open red.
- **No gimmicks:** no fake terminals, hex rain, world maps or fake metrics — live data or a clearly-marked empty state only.

## 4. Component Specifications

### 4.1 Header

- Left: wordmark **ULTRON**
- Center: connection chip — `LIVE` (green) / `STALE` (&gt;5s, yellow) / `OFFLINE` (red)
- Right: band pill, clock, `MODE: ULTRON`

### 4.2 Risk Gauge

- SVG arc or conic gradient 0–100
- Center: score + `/100`
- Tick marks at 30 / 60 / 85 band edges
- Animate value changes ≤300ms; no layout shift

### 4.3 Band Card

- Band name + short posture line
- Note: `notify only — response is Phase 2`
- 8-dot LED preview matching ESP32-C3 pattern

### 4.4 Node Grid (4 tiles)

| Tile | Heartbeat |
|------|-----------|
| Pi4 Governance | `ultron/health/pi4` |
| Pi3a Detection | `ultron/health/pi3a` |
| Pi3b Alert | `ultron/health/pi3b` |
| ESP32 (indicator+tripwire) | serial / GPIO events |

Each tile: name, pillar, IP, uptime, service pills, state dot (green/yellow/red).

### 4.5 Detection Layers

1. **IDS** — Suricata rule count + last alert age  
2. **LAN watch** — unknown devices seen today  
3. **WiFi** — rogue AP flag + last beacon anomaly  
4. **Tripwire** — armed + last edge  

Dot + label + value. Tripwire open flashes red on edge.

### 4.6 Alert Feed (core of alert management)

- Newest first; severity color bar
- Fields: time, sev, title, source, body
- **Ack** button → `ultron/ack/{id}` → persists; badge count drops
- Cap render at **200 rows** (window the rest)
- Empty: `No alerts — all quiet in the sensor mesh`

### 4.7 History

- 24h sparkline / step chart of score
- Points colored by band at sample time
- y grid at 30/60/85

### 4.8 Stats strip

- events/24h · alerts open · ack rate · uptime % · new devices/24h  
- Risk decay note: `governance: −2 pts / 10s → baseline 0`

### 4.9 Footer

- version, MQTT host, evidence path (Pi4 USB3 pendrive), link to docs

---

## 5. Real-Time Data Contract

Server (Pi4) subscribes allowlist:  
`ultron/health/#`, `ultron/alert/#`, `ultron/risk/score`, `ultron/risk/band`, `ultron/lan/#`, `ultron/tripwire/#`, `ultron/suricata/#`, `ultron/wifi/#` + score history on join.

WS envelope:

```json
{
  "t": "alert|score|band|health|lan|tripwire|history|toast|event",
  "ts": 1767000000,
  "d": {}
}
```

| `t` | `d` payload | UI effect |
|-----|-------------|-----------|
| `score` | `{v:42}` | gauge tween |
| `band` | `{b:"YELLOW"}` | `data-band` + toast if worse |
| `alert` | `{id,sev,title,src,body,ack:false}` | prepend, flash, count++ |
| `health` | `{node,up,services[]}` | tile state |
| `lan` | `{mac,ip,vendor,known,first_seen?,last_seen?}` | LAN watch layer, IoT graph |
| `tripwire` | `{node,edge}` | layer flash |
| `history` | `{points:[[ts,score],…]}` | chart on connect |
| `toast` | `{msg,sev}` | transient banner |
| `event` | `{topic,node,kind:"suricata"\|"wifi",sev,summary,src_ip?,dest_ip?,mac?,sig_id?}` | event feed row (no alert count change) |

> **`event` vs `alert`:** `ultron/suricata/#` and `ultron/wifi/#` map to `t:"event"` (passthrough for the event feed), **not** `t:"alert"`. Alerts come only from `ultron/alert/#` (owned by Pi3b's alert manager). This prevents duplicate alert counts, non-persistent ACKs for bridge-generated IDs, and suricata bursts corrupting stats.

**Transport-level control frames (not envelope data, never MQTT):** clock-sync ping-pong on `/ws` —
client sends `{ctl:"ping", c:<client_ms>}`, server replies `{ctl:"pong", c, s:<server_ms>}`. The browser
estimates its offset to the server clock so `bus → screen` latency is honest. Envelope `ts` is stamped at
MQTT-receive time, seconds since epoch with ms precision.

---

## 6. Performance Rules

1. Initial JS + CSS **≤150KB** gzipped (report per-chunk sizes; lazy-load booth). Current build ≈ **58KB gz** (index 55 + css 3)  
2. Main-thread handler **p95 &lt;8ms** on Pi4  
3. Event → paint **&lt;100ms** (demo gate)  
4. No layout thrash — transform/opacity only for motion  
5. Chart: canvas or lightweight SVG; no chart library  
6. Throttle non-critical renders to rAF  

---

## 7. States & Edge Cases

| State | Behavior |
|-------|----------|
| WS connect fail | Retry 1s,2s,5s… header `STALE`/`OFFLINE` |
| MQTT down | Banner `MQTT DEGRADED`; last score held with age |
| Score boundary 29/30 | Hysteresis 1 sample — no flicker |
| Duplicate alert id | Ignore |
| ACK offline | Queue; flush on reconnect |
| Empty history | Skeleton, not error |
| Clock skew | Use server `ts` when present |

---

## 8. Acceptance Checklist (Phase 1 — demo gate)

- [ ] Opens air-gapped at `http://192.168.100.1:8080` with zero network errors  
- [ ] Event MQTT → pixel **&lt;100ms** (measure in demo)  
- [ ] Band change restyles accent everywhere ≤1 frame  
- [ ] RED event → email sent + toast + gauge red  
- [ ] ACK removes badge and survives refresh (SQLite)  
- [ ] Kill Mosquitto → header STALE/OFFLINE within 5s  
- [ ] 4 node tiles match `ultron/health/#`  
- [ ] Detection layers show Suricata + LAN watch + WiFi + tripwire  
- [ ] 24h chart draws from history on first load  
- [ ] Tablet 1024px usable; no horizontal scroll on desktop  
- [ ] `prefers-reduced-motion` disables animations  
- [ ] **Same-origin only** — no external subresources in `dist/` or `debug.html`; network tab shows only same-origin requests + 1 WebSocket  

---

## 9. File & Serve Layout (Pi4)

Repo layout (built on the dev machine, `dist/` copied to Pi4):
```
dashboard/web/                      # React + TS source (Vite)  -> dashboard/web/dist
dashboard/server/                   # aiohttp app: main, bridge, clock, db, csp, config
dashboard/debug/debug.html          # standalone read-only inspector
dashboard/tools/mock_feed.py        # dev-only demo publisher
systemd/sentinel-dashboard.service  # After=mosquitto network-online
```
Deployed on Pi4:
```
/opt/ultron/dashboard/dist/         # vite build output
/opt/ultron/dashboard/server/       # python app  (python -m server.main)
/opt/ultron/dashboard/debug.html
```

- HTTP :8080 → static `dist/` (`/`, `/assets/*`) + `/healthz`  
- `/ws` → JSON bridge to Mosquitto (localhost) + ACK + clock-sync  
- `/debug.html` off by default (`ULTRON_DEBUG=1` or mgmt subnet + basic auth); never expose :8080 to WAN  

**CSP (app):** `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws:; img-src 'self' data:`. `debug.html` uses the same policy with its inline `<script>`/`<style>` sha256-pinned.

---

## 10. Future Phases (document, don't build)

| Phase | Dashboard delta |
|-------|-----------------|
| **2 Response** | Playbook cards, quarantine list, “last action” audit trail |
| **3 Hunting** | Hypothesis queue, baseline anomaly heat, attack-path graph |

---

## 11. Definition of Done

`dashboard.md` is satisfied only when **§8 checklist is green** and a mentor’s first frame is: **risk, band, alerts, nodes — alive in under 100 milliseconds.**
