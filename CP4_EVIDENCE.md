# CP4 Evidence — Auth Backend

## 1. Library

- **Package:** `webauthn==3.0.1` (PyPI: py_webauthn)
- **Pinned in:** `dashboard/server/requirements.txt`
- **No hand-rolled crypto.** All credential verification via `webauthn.verify_registration_response` and `webauthn.verify_authentication_response`.

## 2. auth.db schema dump

```sql
CREATE TABLE credentials (
    id              TEXT PRIMARY KEY,   -- credential ID (base64url)
    public_key      BLOB NOT NULL,      -- CBOR-encoded public key from py_webauthn
    sign_count      INTEGER NOT NULL DEFAULT 0,
    transports      TEXT,               -- JSON list of transports
    created_at      REAL NOT NULL,
    last_used_at    REAL,
    revoked         INTEGER NOT NULL DEFAULT 0,
    device_type     TEXT,               -- single_device / multi_device
    backed_up       INTEGER NOT NULL DEFAULT 0,
    aaguid          TEXT
);

CREATE TABLE sessions (
    id_hash         TEXT PRIMARY KEY,   -- SHA-256 of the actual session ID
    created_at      REAL NOT NULL,
    expires_at      REAL NOT NULL,
    credential_id   TEXT NOT NULL,
    ip              TEXT,
    revoked         INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (credential_id) REFERENCES credentials(id)
);

CREATE TABLE challenges (
    ceremony_id     TEXT PRIMARY KEY,   -- cookie value binding this ceremony
    challenge       TEXT NOT NULL,      -- base64url challenge
    type            TEXT NOT NULL,      -- 'registration' or 'authentication'
    created_at      REAL NOT NULL,
    expires_at      REAL NOT NULL,
    consumed        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE enrollment_tokens (
    token_hash      TEXT PRIMARY KEY,   -- SHA-256 of the plaintext token
    created_at      REAL NOT NULL,
    expires_at      REAL NOT NULL,
    consumed        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE auth_audit (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              REAL NOT NULL,
    event           TEXT NOT NULL,
    ip              TEXT,
    credential_id   TEXT,
    detail          TEXT
);
```

**Key properties:**
- `sessions.id_hash` — SHA-256 of session ID; plaintext never stored
- `enrollment_tokens.token_hash` — SHA-256 of token; plaintext printed once, never logged
- `challenges.consumed` — single-use; consumed=1 after first use
- No biometric fields anywhere

## 3. Curl matrix (all routes × no cookie / expired / valid session)

| Route | Method | No cookie | Expired session | Valid session |
|-------|--------|-----------|-----------------|---------------|
| `/auth/status` | GET | 200 `{has_owner:false, authenticated:false}` | 200 `{authenticated:false}` | 200 `{authenticated:true}` |
| `/auth/setup` | POST | 403 (no token) / 200 (valid token) | 403/200 (token-gated, not session-gated) | 403/200 |
| `/auth/setup/complete` | POST | 400 (no ceremony cookie) | 400 | 200 (with ceremony cookie) |
| `/auth/login/begin` | POST | 200 (returns options) | 200 | 200 |
| `/auth/login/complete` | POST | 400 (no ceremony cookie) | 400 | 200 (with ceremony cookie) |
| `/auth/reauth/begin` | POST | 200 | 200 | 200 |
| `/auth/reauth/complete` | POST | 400 (no ceremony cookie) | 400 | 200 |
| `/auth/register/begin` | POST | **401** | **401** | 200 |
| `/auth/register/complete` | POST | **401** | **401** | 200 (with ceremony cookie) |
| `/auth/logout` | POST | 200 (no-op) | 200 (no-op) | 200 (revokes session) |
| `/auth/credentials` | GET | **401** | **401** | 200 (list) |
| `/auth/credentials/{id}` | DELETE | **401** | **401** | 200/409 |
| `/ws` | GET (upgrade) | **401** | **401** | 101 (upgrade, Origin checked) |
| `/ws` (bad Origin) | GET (upgrade) | **403** | **403** | **403** |
| `/healthz` | GET | 200 | 200 | 200 |
| `/` | GET | 200 | 200 | 200 |
| All `/auth/*` after 5 failures | POST | **429** | **429** | **429** |

## 4. Pytest results (19 tests, real signed assertions)

```
tests/server/test_auth.py::test_setup_full_flow PASSED
tests/server/test_auth.py::test_login_flow PASSED
tests/server/test_auth.py::test_unknown_credential_rejected PASSED
tests/server/test_auth.py::test_revoked_credential_rejected PASSED
tests/server/test_auth.py::test_expired_challenge_rejected PASSED
tests/server/test_auth.py::test_replayed_challenge_rejected PASSED
tests/server/test_auth.py::test_counter_regression_rejected PASSED
tests/server/test_auth.py::test_session_validate_and_expire PASSED
tests/server/test_auth.py::test_rate_limiting PASSED
tests/server/test_auth.py::test_enrollment_token_single_use PASSED
tests/server/test_auth.py::test_setup_bad_token PASSED
tests/server/test_auth.py::test_auth_status PASSED
tests/server/test_auth.py::test_logout_revokes_session PASSED
tests/server/test_auth.py::test_config_guard_http_nonlocal PASSED
tests/server/test_auth.py::test_config_guard_debug_nonlocal_rp PASSED
tests/server/test_auth.py::test_config_guard_ip_rp_id PASSED
tests/server/test_auth.py::test_list_credentials_requires_session PASSED
tests/server/test_auth.py::test_list_credentials_authenticated PASSED
tests/server/test_auth.py::test_cannot_revoke_last_credential PASSED
======================= 19 passed in 1.24s =======================
```

All tests use a **real software authenticator** (ES256 key generation, CBOR-encoded attestation objects, real ECDSA signatures). py_webauthn performs actual cryptographic verification — **no mocked verify calls**.

## 5. Threat model

| # | Threat | Mitigation | Audit event |
|---|--------|------------|-------------|
| T1 | Brute-force login | Per-IP rate limiting (5/5min, exponential backoff) | `rate_limited` |
| T2 | Stolen session cookie | SHA-256 hashed storage; HttpOnly + SameSite=Strict; 1h TTL | — |
| T3 | Session fixation | New session ID on every login (rotate, not reuse) | `login_success` |
| T4 | Cross-site WS hijack | Origin header validated against `ULTRON_ORIGINS` allowlist | — |
| T5 | Unauthenticated ACK | WS upgrade requires valid session; ACK only on authenticated socket | `unknown_credential` |
| T6 | Replay attack (challenge) | Single-use challenges, ceremony-bound via HttpOnly cookie, 3-min expiry | `*_challenge_invalid` |
| T7 | Cloned authenticator | Sign counter regression check (py_webauthn + explicit check) | `counter_regression` / `login_verify_failed` |
| T8 | Unknown credential probe | Credential lookup before challenge consumption; rejects unknown first | `unknown_credential` |
| T9 | Revoked credential use | Non-revoked check before any processing | `revoked_credential_used` |
| T10 | Enrollment token leak | SHA-256 stored; plaintext printed once to terminal, never logged; single-use + 10-min TTL | `setup_token_consumed` / `setup_bad_token` |
| T11 | Non-localhost HTTP origin | Config guard refuses startup with non-localhost `http://` in `ULTRON_ORIGINS` | — |
| T12 | Debug mode in prod | Config guard refuses startup if `ULTRON_DEBUG=1` with non-localhost RP ID | — |
| T13 | IP-based RP ID | Config guard refuses startup if RP ID is an IP address (WebAuthn spec) | — |
| T14 | Session left open after logout | All WS for that session closed within 1s of logout/revocation/expiry | `logout` |
| T15 | Last credential revoked (lockout) | HTTP 409 prevents revoking the last non-revoked credential; `reset-owner` requires typed confirmation | `credential_revoked` |

## 6. CLI commands

```
python -m dashboard.server.auth_cli enroll-token [--ttl 600]
python -m dashboard.server.auth_cli list-credentials
python -m dashboard.server.auth_cli revoke <credential_id>
python -m dashboard.server.auth_cli reset-owner          # typed "RESET OWNER" confirmation
python -m dashboard.server.auth_cli audit [--limit 50]
```

## 7. Files changed/added (CP4)

| File | Action |
|------|--------|
| `dashboard/server/auth_db.py` | **new** — auth database (schema, CRUD, SHA-256 hashing) |
| `dashboard/server/auth.py` | **new** — WebAuthn routes, rate limiting, ceremony/session cookies |
| `dashboard/server/ws_session.py` | **new** — per-session WS tracking, close-on-logout |
| `dashboard/server/auth_cli.py` | **new** — 5 CLI commands |
| `dashboard/server/main.py` | **modified** — auth integration, WS session+Origin gate, ACK protection |
| `dashboard/server/config.py` | **modified** — auth config fields, 3 config guards, version bump |
| `dashboard/server/requirements.txt` | **modified** — added `webauthn==3.0.1` |
| `dashboard/tests/server/test_auth.py` | **new** — 19 tests with real signed assertions |
| `use.md` | **modified** — auth routes, config vars, fixed issues (unauthenticated WS ACK) |
| `.gitignore` | **modified** — added `auth.db` |
| `CP4_EVIDENCE.md` | **new** — this file |
