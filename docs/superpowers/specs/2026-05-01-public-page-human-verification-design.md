# Public-Page Human Verification — Design Spec

**Date:** 2026-05-01
**Status:** Approved (brainstorming complete, awaiting implementation plan)
**Author:** thewrz + Claude

## Background

WrzDJ has working Cloudflare Turnstile + rate limiting on the DJ self-registration flow (`/api/auth/register`). The system is verified end-to-end:

- `services/turnstile.py` — server-side `siteverify` call, 10s timeout, fail-closed in prod when key missing.
- `api/auth.py:138` — Turnstile validated before uniqueness checks (no enumeration via timing).
- `api/auth.py:121` — `@limiter.limit("3/minute")` IP-based rate limit, configurable.
- `app/register/page.tsx` — Cloudflare widget renders only when site key present, token resets on failure.
- Tests cover dev bypass, prod fail-closed, valid/invalid tokens.

Public guest-facing pages do not currently have an equivalent human-proof gate. They have rate limits but no CAPTCHA. The publicly reachable pages are:

- `/join/[code]` — guests search songs (paid Tidal/Spotify API), submit requests, vote.
- `/collect/[code]` — guests set nickname, submit requests, vote, request OTP email codes.
- `/kiosk-pair` — Pi or browser creates kiosk pairing codes.

## Threat Model

Two scenarios drive this design (in scope):

- **A — Mass automated abuse.** Drive-by traffic floods search box (exhausts Tidal/Spotify quota), spams submissions, scrapes data. Defeated by minimal-friction Turnstile.
- **C — Email cost / sender-reputation abuse.** Bot loops `/api/verify/request` to burn Resend credits or get sending domain blocklisted. Needs heavy gating on that endpoint specifically.

Out of scope: targeted in-event griefing by attendees who knowingly hold the event code (separate threat model, not addressed by this spec).

## Architecture

Two cooperating layers plus a separate kiosk-pair mechanism.

### Layer 1 — Session-bootstrap human gate

Covers all guest mutating endpoints on `/join` and `/collect`.

1. On `/join` and `/collect` page load, frontend runs Cloudflare Turnstile in managed/invisible mode (`appearance: 'interaction-only'`).
2. On token callback, frontend POSTs token to new `POST /api/guest/verify-human`.
3. Backend verifies token with Cloudflare, sets a signed HMAC `wrzdj_human` cookie containing `{guest_id, exp}`.
4. Gated endpoints require valid `wrzdj_human` cookie via new `require_verified_human` FastAPI dependency.
5. Sliding window: every successful gated call extends `exp` to `now + 60min`. Cookie re-issued in response.

### Layer 2 — Per-action fresh Turnstile (OTP only)

`POST /api/verify/request` requires a fresh Turnstile token in the payload. This bypasses the session cookie. One Turnstile solve per OTP send. Rationale: Resend cost and sender-reputation damage justify per-action proof. Existing rate limits (10/min IP + 3/hr per email-hash) remain in place.

### Kiosk-pair nonce (separate, lighter mechanism)

The kiosk Pi has no human input device, so Turnstile is unsuitable. Instead:

- `GET /api/public/kiosk/pair-challenge` returns a fresh nonce (16 bytes of entropy, base64-encoded via `secrets.token_urlsafe(16)` → ~22-char string), stored 10s, bound to client IP.
- `POST /api/public/kiosk/pair` requires `X-Pair-Nonce` header matching active nonce for client IP.
- Rate limit on POST tightened from `10/minute` to `3/minute`.

### Trust hierarchy

```
wrzdj_guest cookie  (existing, identity)
    └→ wrzdj_human cookie  (new, human-proof, depends on wrzdj_guest)
        └→ gated endpoints  (checked via dependency)

OTP send: fresh Turnstile token per call (separate path)
Kiosk-pair: nonce-fetch + IP binding (separate path, no Turnstile)
```

### Threat coverage

- Bot floods search/submit/vote → must solve Turnstile per `guest_id`, capped by per-IP rate limit on bootstrap endpoint (`10/min`).
- Bot rotates IPs → each new IP needs new Turnstile solve. Cloudflare scoring catches IP-rotation patterns.
- Bot spams OTP send → must solve fresh Turnstile per email + email-hash 3/hr limit + IP 10/min limit.
- Bot floods kiosk pair table → IP-bound nonce kills replay, 3/min cap kills high-rate.

## Backend

### New module — `server/app/services/human_verification.py`

HMAC-SHA256 signed cookie helpers.

```python
COOKIE_NAME = "wrzdj_human"
COOKIE_TTL_SECONDS = 60 * 60  # sliding 60 min

def issue_human_cookie(response: Response, guest_id: int) -> None:
    """Sign payload with HMAC-SHA256, set cookie."""
    payload = {"guest_id": guest_id, "exp": int(utcnow().timestamp()) + COOKIE_TTL_SECONDS}
    signed = _sign(payload)  # base64(json(payload)).base64(hmac_sig)
    response.set_cookie(
        key=COOKIE_NAME, value=signed,
        httponly=True, secure=is_prod, samesite="lax",
        max_age=COOKIE_TTL_SECONDS, path="/api/",
    )

def verify_human_cookie(request: Request) -> int | None:
    """Return guest_id if cookie valid + signature OK + not expired, else None.
    Uses hmac.compare_digest for constant-time comparison.
    """
```

HMAC key sourced from new env var `HUMAN_COOKIE_SECRET` (32-byte base64). Required in prod, auto-generated ephemeral key in dev with startup warning. Mirrors the `TOKEN_ENCRYPTION_KEY` pattern.

### New endpoint — `POST /api/guest/verify-human`

Lives in `server/app/api/guest.py`.

```python
@router.post("/guest/verify-human", response_model=VerifyHumanResponse)
@limiter.limit("10/minute")
async def verify_human(
    request: Request,
    payload: VerifyHumanSchema,
    response: Response,
    db: Session = Depends(get_db),
):
    guest_id = get_guest_id(request, db)
    if guest_id is None:
        raise HTTPException(400, "Guest identity required")
    is_valid = await verify_turnstile_token(payload.turnstile_token, get_client_ip(request))
    if not is_valid:
        raise HTTPException(400, "CAPTCHA verification failed")
    issue_human_cookie(response, guest_id)
    return VerifyHumanResponse(verified=True, expires_in=COOKIE_TTL_SECONDS)
```

Schema:

```python
class VerifyHumanSchema(BaseModel):
    turnstile_token: str = Field(..., min_length=1, max_length=4096)

class VerifyHumanResponse(BaseModel):
    verified: bool
    expires_in: int
```

### New dependency — `require_verified_human`

Lives in `server/app/api/deps.py`.

```python
def require_verified_human(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> int:
    """Returns guest_id if human cookie valid. Refreshes cookie (sliding window).
    Returns 403 with structured detail if missing/invalid/expired."""
    guest_id_cookie = verify_human_cookie(request)
    guest_id_db = get_guest_id(request, db)
    if guest_id_cookie is None or guest_id_cookie != guest_id_db:
        raise HTTPException(
            status_code=403,
            detail={"code": "human_verification_required"},
        )
    issue_human_cookie(response, guest_id_db)  # slide window
    return guest_id_db
```

403 detail object lets the frontend distinguish "needs verify-human" from "forbidden generally" → triggers re-bootstrap.

### Gated endpoints

Apply `Depends(require_verified_human)` to:

- `events.py`
  - `POST /api/events/{code}/requests`
  - `GET /api/events/{code}/search`
- `votes.py` (public guest votes)
  - `POST /api/requests/{request_id}/vote`
  - `DELETE /api/requests/{request_id}/vote`
- `collect.py`
  - `POST /api/collect/{code}/profile`
  - `POST /api/collect/{code}/requests`
  - `POST /api/collect/{code}/vote`
  - `POST /api/collect/{code}/enrich-preview`

NOT gated (cheap reads, idempotent polls):

- `GET /api/events/{code}/display`, `/requests`, `/has-requested`, `/my-requests`
- `GET /api/collect/{code}`, `/leaderboard`, `/profile`, `/profile/me`

NOT gated (bootstrap, chicken-and-egg):

- `POST /api/guest/identify` (mints `wrzdj_guest` cookie, must run first)
- `POST /api/guest/verify-human` (sets `wrzdj_human` cookie, separate gating via Turnstile)

### OTP fresh-token gate

Modify existing `POST /api/verify/request` schema and handler:

```python
class VerifyRequestSchema(BaseModel):
    email: EmailStr
    turnstile_token: str = Field(..., min_length=1, max_length=4096)

@router.post("/verify/request", response_model=VerifyRequestResponse)
@limiter.limit("10/minute")
async def request_verification_code(
    payload: VerifyRequestSchema,
    request: Request,
    db: Session = Depends(get_db),
):
    is_valid = await verify_turnstile_token(payload.turnstile_token, get_client_ip(request))
    if not is_valid:
        raise HTTPException(400, "CAPTCHA verification failed")
    # ... existing flow (guest_id check, create_verification_code, etc.)
```

Does NOT use `require_verified_human` — fresh token per call is the whole point.

### Kiosk-pair nonce mechanism

In-memory cache in `server/app/api/kiosk.py`:

```python
# {client_ip: (nonce_bytes, expires_at_timestamp)}
_pair_nonces: dict[str, tuple[str, float]] = {}
_NONCE_TTL_SECONDS = 10
```

```python
@public_router.get("/pair-challenge", response_model=KioskPairChallengeResponse)
@limiter.limit("10/minute")
def get_pair_challenge(request: Request) -> KioskPairChallengeResponse:
    client_ip = get_client_ip(request)
    nonce = secrets.token_urlsafe(16)
    _pair_nonces[client_ip] = (nonce, time.time() + _NONCE_TTL_SECONDS)
    return KioskPairChallengeResponse(nonce=nonce, expires_in=_NONCE_TTL_SECONDS)

@public_router.post("/pair", response_model=KioskPairResponse)
@limiter.limit("3/minute")  # tightened from 10/min
def create_pairing(request: Request, db: Session = Depends(get_db)):
    client_ip = get_client_ip(request)
    nonce_header = request.headers.get("X-Pair-Nonce")
    entry = _pair_nonces.pop(client_ip, None)
    if not nonce_header or entry is None:
        raise HTTPException(400, "Missing or unknown pairing nonce")
    nonce, expires_at = entry
    if not hmac.compare_digest(nonce_header, nonce):
        raise HTTPException(400, "Invalid pairing nonce")
    if time.time() > expires_at:
        raise HTTPException(400, "Pairing nonce expired")
    kiosk = create_kiosk(db)
    return KioskPairResponse(...)
```

In-memory dict is safe under current single-worker uvicorn (`server/scripts/start.sh` runs `uvicorn` with no `--workers` flag → 1 worker). If the deploy ever scales to multi-worker, replace this with a `KioskPairChallenge` SQLAlchemy model (10s TTL row, periodic cleanup task). This caveat is documented in code and in `docs/HUMAN-VERIFICATION.md`.

Periodic cleanup: each call to `get_pair_challenge` opportunistically prunes expired entries from `_pair_nonces` (single-pass dict comprehension, O(n) where n stays small — at most a few hundred entries per minute under the rate limit). Each successful POST also calls `_pair_nonces.pop(client_ip)`, so live entries don't accumulate beyond the 10s window. Worst case is a flood of GETs from many IPs without follow-up POSTs; the prune-on-call pattern bounds memory at `(distinct_ips × 10s)` worth of entries.

### Config additions — `server/app/core/config.py`

```python
human_cookie_secret: str = ""           # required in prod; dev auto-generates
human_cookie_ttl_seconds: int = 3600    # 60 min sliding window
```

### Tests (backend)

- `tests/test_human_verification.py` — sign/verify cookie, expiry, tampered signature, mismatched `guest_id`, dev auto-generated key, prod missing key fatal.
- `tests/test_verify_human_endpoint.py` — happy path, missing guest cookie, invalid Turnstile, rate limit (10/min), structured 403 detail.
- Update existing endpoint tests to include valid `wrzdj_human` cookie fixture (helper in `conftest.py`).
- `tests/test_kiosk_pair_nonce.py` — challenge → pair, expired nonce, IP mismatch, missing nonce header, double-spend (nonce consumed once).
- `tests/test_otp_turnstile.py` — `verify/request` requires token, invalid token rejected, valid token accepted.

## Frontend

### New shared hook — `dashboard/lib/useHumanVerification.ts`

```ts
type State = 'idle' | 'loading' | 'verified' | 'challenge' | 'failed';

export function useHumanVerification(): {
  state: State;
  ensureVerified: () => Promise<void>;  // resolves when wrzdj_human cookie valid
  reverify: () => Promise<void>;        // force re-bootstrap (called on 403)
  TurnstileWidget: React.FC;            // inline widget for challenge mode
}
```

Behavior:

1. On mount (page load), runs Turnstile in invisible/managed mode via Cloudflare's JS API.
2. On token callback, POSTs to `/api/guest/verify-human` → server sets `wrzdj_human` cookie.
3. Tracks `verified` state in React.
4. `ensureVerified()` resolves when cookie is issued.
5. If Cloudflare escalates to interactive challenge, hook flips state to `'challenge'` and renders `TurnstileWidget` inline near the action button (per Q6 = "Eager + i").

Turnstile config:

```ts
window.turnstile.render(container, {
  sitekey: SITE_KEY,
  appearance: 'interaction-only',  // hidden until challenge needed
  size: 'normal',
  callback: (token) => verifyHuman(token),
  'error-callback': () => setState('failed'),
  'expired-callback': () => reverify(),
});
```

Site key sourced from existing `/api/auth/settings` (`turnstile_site_key`). Hook fetches once and caches in module-level variable.

### API client changes — `dashboard/lib/api.ts`

- New error type `HumanVerificationRequiredError` thrown when server returns 403 with `detail.code === 'human_verification_required'`.
- Wrapper around fetch for guest-public calls: catches that error → calls `reverify()` → retries original request once. If second attempt also fails, surfaces error.
- All public-facing fetch helpers route through this wrapper: `eventSearch`, `submitRequest` (public guest variant), `publicVoteRequest`, collect helpers (`getCollectEvent` writes, `submitCollectRequest`, `voteCollectRequest`, `setCollectProfile`, `enrichCollectPreview`).

### Page integration

- `app/join/[code]/page.tsx` — import `useHumanVerification`, mount on render, render `TurnstileWidget` in a hidden container (only visible when `state === 'challenge'`). Action buttons disabled until `verified`.
- `app/collect/[code]/page.tsx` — same.
- `app/kiosk-pair/page.tsx` — NO Turnstile (uses nonce path).
  - Before POSTing pair, GET `/api/public/kiosk/pair-challenge` to fetch nonce.
  - POST pair with `X-Pair-Nonce` header containing nonce.
  - On 400 nonce-expired, retry once.

### OTP fresh-token integration (Z choice)

`/collect/[code]` already has the email-verify flow. The "Send code" button now:

1. Renders a separate Turnstile widget inline (different instance, non-interactive mode, fresh token per click).
2. On token callback, POSTs `{email, turnstile_token}` to `/api/verify/request`.
3. After successful send, widget resets for next attempt.

This is independent of the session bootstrap. Even with a valid `wrzdj_human` cookie, OTP requires its own fresh token. Belt-and-suspenders.

### Tests (frontend)

- `dashboard/lib/__tests__/useHumanVerification.test.tsx` — state transitions, 403 retry, challenge mode render.
- Update `app/join/__tests__/page.test.tsx` and equivalents to mock the hook (default returns `verified` state).
- `dashboard/app/kiosk-pair/__tests__/page.test.tsx` — pair-challenge → pair-with-nonce flow, nonce-expiry retry.
- Update existing `register/__tests__/page.test.tsx` if Turnstile widget interactions changed (no behavior change expected).

## Rollout

### Phase 1 — Deploy + soak

All gated endpoints accept calls WITHOUT `wrzdj_human` cookie but log a `human_verification_missing` warning. Frontend deploys Turnstile bootstrap in same release. This catches edge cases (existing users with stale tabs, kiosks mid-session) without locking them out.

### Phase 2 — Enforce (+7 days)

Flip a config flag `human_verification_enforced=true` on the `SystemSettings` table. Endpoint dependency starts returning 403 instead of warning. Frontend has been deployed for a week → all live users have valid cookies. Admin can flip via existing settings UI without redeploy. Mirrors the `registration_enabled` pattern.

### Phase 3 — Cleanup (+30 days)

Remove the soft-mode flag, dependency hard-enforces always. Clean up logging code.

### Production deploy checklist

1. Generate secret: `python -c "import secrets, base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"`
2. Add to VPS `.env` as `HUMAN_COOKIE_SECRET=<value>`
3. Deploy via `./deploy/deploy.sh` (already restarts container, picks up env)
4. Verify in prod logs: no "auto-generated ephemeral key" warning at startup.
5. nginx CSP update: ensure `https://challenges.cloudflare.com` is in `script-src` and `frame-src` for `/join`, `/collect`, `/kiosk-pair` paths. Re-run `setup-nginx.sh` if changed.

## Edge Cases

| Case | Behavior |
|---|---|
| Guest cookie missing (first visit) | `guest/identify` runs first, mints cookie. Then verify-human bootstrap runs. Order enforced in frontend hook. |
| `wrzdj_human` cookie tampered (bad sig) | Dependency returns 403 `human_verification_required` → frontend re-bootstraps (forces Turnstile widget reset to mint fresh token, since Turnstile tokens themselves expire ~5min after issue). |
| `wrzdj_human` cookie expired | Same as tampered: 403 → re-bootstrap (transparent if managed Turnstile passes). Hook calls `window.turnstile.reset(widgetId)` before re-rendering. |
| Cookie `guest_id` mismatch with current `wrzdj_guest` (cookie reuse / theft) | 403 → re-bootstrap with new guest_id. |
| Turnstile API down / 10s timeout | `verify_turnstile_token` returns False → 400 from verify-human → user sees retry button. Pre-existing failure mode; same handling as registration. |
| Cloudflare blocks legit user (Tor, VPN) | Inline widget renders interactive challenge per Q6/i. User clicks checkbox. If still blocked, retry button. |
| Multi-tab same guest | All tabs share `wrzdj_human` cookie. One bootstrap covers all. |
| OTP send rate limit (Resend down) | Existing `EmailSendError` handling unchanged. Turnstile token consumed regardless — user must re-solve to retry. Acceptable: retry pressure is the entire point. |
| Single-worker assumption breaks | Spec note + code comment: if uvicorn `--workers > 1` ever set, replace nonce dict with `KioskPairChallenge` DB model. |
| Existing `wrzdj_guest` cookie path is `/api/` | `wrzdj_human` mirrors this exactly: `httponly, secure (prod), samesite=lax, path=/api/, max_age=3600`. |

## Observability

- Log structured event on each bootstrap: `guest.human_verify action=verified guest_id=N`
- Log on each 403 from gated endpoint: `guest.human_verify action=blocked guest_id=N reason=cookie_invalid|expired|missing`
- Log Turnstile failures: `guest.human_verify action=turnstile_failed reason=cloudflare_rejected`
- Counter for nonce path: `kiosk.pair action=nonce_issued|nonce_consumed|nonce_expired|nonce_missing`

## Documentation

- Update `CLAUDE.md` Security Posture section: add bullet about `wrzdj_human` cookie and `require_verified_human` dependency.
- New file `docs/HUMAN-VERIFICATION.md` — explains the system for future devs (similar in spirit to `docs/RECOVERY-IP-IDENTITY.md`).

## Out of Scope

Explicitly NOT in this spec:

- Per-action fresh Turnstile on submit/vote (would re-introduce visible friction).
- Server-side IP reputation scoring beyond what Cloudflare provides.
- Captcha alternatives (hCaptcha, Friendly Captcha) — Turnstile already integrated.
- Bot detection on authenticated DJ endpoints — DJs auth via JWT, separate threat model.
- Rate-limit storage in Redis (current slowapi in-memory is fine for single worker).
- Targeted in-event griefing by attendees with valid event codes (different threat model).

## Decision Log

| Decision | Picked | Rationale |
|---|---|---|
| Threat priority | A + C (mass bot + email cost) | User priority. In-event griefing deferred. |
| Gate granularity | Z — session bootstrap + extra OTP gate | Invisible for normal use, hard gate where cost is highest. |
| Claim storage | B — signed HMAC cookie | Industry standard (cf_clearance pattern). Stateless, scalable. |
| Cookie TTL | C — 60min sliding window | Matches active-user behavior; idle = re-prove. |
| Endpoint scope | Approved as proposed | Mutating + paid-API endpoints gated; reads + bootstrap excluded. |
| Kiosk-pair | iii — nonce + tighter rate limit | Pi has no input device; nonce-bound-to-IP defeats single-shot floods. |
| Bootstrap timing + failure UX | Eager + inline widget | Snappy interaction, familiar Cloudflare pattern. |
