# Guest Fingerprinting & Platform Identity

**Date:** 2026-04-26
**Status:** Approved
**Scope:** Backend (FastAPI), Frontend (Next.js), new npm dependency (ThumbmarkJS)

## Problem

WrzDJ identifies guests by IP address. This breaks in two critical scenarios:

1. **Shared NAT at live events** — dozens or hundreds of guests on the same WiFi share one public IP. WrzDJ treats them as one person. One guest requesting a song blocks everyone else from requesting it. All votes collapse to a single identity.
2. **Network switching** — a guest who switches from WiFi to cellular (or vice versa) becomes a different person. Their requests and profile don't follow them.

The IP-based approach also fails for abuse prevention. A troublemaker can open incognito mode or clear cookies to reset their identity and spam requests again.

## Goals

- Distinguish guests behind the same NAT (same public IP) at live events
- Maintain stable identity when guests switch networks (WiFi to cellular to work WiFi)
- Survive incognito mode and cookie clearing (casual troublemaker threat model)
- Establish platform-wide guest identity for future gamification (badges, cross-event reputation)
- Non-invasive: no account required, no consent banner, no canvas fingerprinting

## Non-Goals

- Defeating determined trolls (VPN, multiple devices, spoofed UAs) — out of scope
- Cross-browser identity (same person in Safari and Chrome = two guests) — accepted limitation
- Migrating old IP-based records to new identity system — clean break
- GDPR consent banner — fingerprinting is used for service functionality (abuse prevention), not advertising

## Architecture: Server-Token-First with Fingerprint Reconciliation

Two identity signals, serving different purposes:

| Signal | Storage | Purpose | Survives |
|--------|---------|---------|----------|
| **Server token** | HttpOnly cookie (`wrzdj_guest`) | Primary identity — canonical, unforgeable | Session, browser restarts, network changes |
| **Browser fingerprint** | ThumbmarkJS hash sent on identify | Reconciliation — recovers identity when cookie lost | Incognito, cookie clearing, cache clearing |

The server is the source of truth. The cookie is the fast path. The fingerprint is the safety net.

## Data Model

### New Table: `guests`

The platform-level identity root. One row per unique guest across all of WrzDJ.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | Integer | PK | Canonical guest identifier |
| `token` | String(64) | UNIQUE, NOT NULL, INDEX | Server-assigned, stored in HttpOnly cookie |
| `fingerprint_hash` | String(64) | NULLABLE, INDEX | ThumbmarkJS output for reconciliation lookups |
| `fingerprint_components` | JSON | NULLABLE | Raw signal breakdown (screen, timezone, etc.) for confidence scoring and debugging |
| `ip_address` | String(45) | NULLABLE | Last-seen IP for abuse investigation only |
| `user_agent` | String(256) | NULLABLE | Last-seen UA, aids reconciliation confidence |
| `created_at` | DateTime | NOT NULL | First identification |
| `last_seen_at` | DateTime | NOT NULL | Updated on every identify call |

- `token` is generated via `secrets.token_hex(32)` — 64 hex chars, cryptographically random.
- `fingerprint_hash` is the ThumbmarkJS output. Multiple guests can share the same hash (identical devices), so this is NOT unique — it's an indexed lookup column.
- `fingerprint_components` stores the raw signals (not just the hash) so reconciliation can compare individual signals for confidence scoring.

### Modified Table: `guest_profiles`

Add `guest_id` FK. Keep `client_fingerprint` for backward compatibility (old rows).

| Column | Change |
|--------|--------|
| `guest_id` | **ADD** — Integer FK to `guests.id`, NULLABLE, INDEX |
| `client_fingerprint` | **KEEP** — no longer written to for new records |

New constraint: `UNIQUE(event_id, guest_id)` — one profile per guest per event.

### Modified Table: `requests`

| Column | Change |
|--------|--------|
| `guest_id` | **ADD** — Integer FK to `guests.id`, NULLABLE, INDEX |
| `client_fingerprint` | **KEEP** — no longer written to for new guest requests |

DJ-submitted requests (via authenticated `POST /events/{code}/requests`) set both `guest_id=NULL` and `client_fingerprint=NULL` — they're owned by the DJ's user account.

### Modified Table: `request_votes`

| Column | Change |
|--------|--------|
| `guest_id` | **ADD** — Integer FK to `guests.id`, NULLABLE, INDEX |
| `client_fingerprint` | **KEEP** — no longer written to for new votes |

New constraint: `UNIQUE(request_id, guest_id)` — one vote per guest per request.

### Migration Strategy

**Clean break.** Old rows keep their IP-based `client_fingerprint`. New rows use `guest_id`. All new FK columns are nullable — no backfill, no data transformation. Old data ages out naturally as events end.

**Production wipe:** Since app.wrzdj.com has minimal usage, wipe old events and guests at deploy time for a clean start.

## Identity Flow

### New Endpoint: `POST /api/public/guest/identify`

Rate limited: `120/minute` per IP. This must be high enough for venues where 100+ guests share the same NAT — each guest calls `/identify` once on page load. 120/min accommodates burst arrivals (e.g., event starts, everyone scans QR at once) while still capping abuse.

**Request:**
```json
{
  "fingerprint_hash": "a1b2c3d4e5f6...",
  "fingerprint_components": {
    "screen": "1170x2532",
    "timezone": "America/Chicago",
    "language": "en-US",
    "platform": "iPhone",
    "hardware_concurrency": 6,
    "device_memory": 4
  }
}
```

**Response:**
```json
{
  "guest_id": 42
}
```

Plus `Set-Cookie: wrzdj_guest=<token>; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000; Path=/api/`

### Flow 1: First Visit (no cookie, no fingerprint on file)

1. No cookie on request — no token lookup.
2. Search `guests` WHERE `fingerprint_hash` = submitted hash.
3. No match — **create** new `Guest` row with new token, fingerprint, IP, UA.
4. Set cookie with new token.
5. Return `guest_id`.

### Flow 2: Return Visit (cookie present)

1. Cookie present — lookup `Guest` by token.
2. Found — **update** `last_seen_at`, `ip_address`, `user_agent`.
3. If `fingerprint_hash` changed: update hash + components (silent drift, normal over time).
4. Return `guest_id`.

### Flow 3: Reconciliation (cookie lost, fingerprint on file)

1. No cookie — no token lookup.
2. Search `guests` WHERE `fingerprint_hash` = submitted hash. If multiple rows match (identical devices), pick the one with the most recent `last_seen_at` — most likely the same person returning.
3. Found — **confidence check** before re-linking:
   - Compare stored `user_agent` family with submitted UA.
   - Same UA family + similar device signals → **high confidence** → re-link to existing Guest, issue new cookie.
   - Wildly different UA (e.g., stored=Safari/iPhone, submitted=Chrome/Android) → **low confidence** → create new Guest.
4. If confidence check fails on the best match, do NOT try the next match — create a new Guest. Cascading through matches risks merging unrelated guests.
5. Return `guest_id`.

### Flow 4: Incognito / Cleared Cookies

Same as Flow 3. ThumbmarkJS generates the same fingerprint (hardware signals survive incognito). Guest gets re-linked to their existing identity. Rate limits and submission history follow them.

### Cookie Attributes

| Attribute | Value | Rationale |
|-----------|-------|-----------|
| Name | `wrzdj_guest` | Namespaced to avoid collisions |
| HttpOnly | `true` | JS cannot read or steal the token |
| Secure | `true` in production, `false` in dev | HTTPS only in prod (nginx). In local dev without the dev proxy, `http://localhost` needs `Secure=false` to send cookies. Controlled by environment check (same pattern as other env-conditional settings). |
| SameSite | `Lax` | Sent on same-site navigation, blocks CSRF from third-party |
| Max-Age | `31536000` (1 year) | Persists between events months apart |
| Path | `/api/` | Only sent on API calls, not static asset requests |
| Domain | (not set) | Defaults to current domain, no cross-site leakage |

## Reconciliation Confidence Scoring

When a fingerprint matches an existing Guest but the cookie is missing, the server scores confidence before re-linking. This prevents false merges from fingerprint collisions (e.g., identical school iPads).

**Signals compared:**

| Signal | Weight | Comparison |
|--------|--------|------------|
| UA family | 0.5 | Browser engine (Safari, Chrome, Firefox) — must match |
| UA platform | 0.3 | Device type (iPhone, Android, Windows) — must match |
| UA version proximity | 0.2 | Major version within 2 → full score, else 0 |

**Thresholds:**
- `>= 0.7` → **re-link** to existing Guest
- `< 0.7` → **create new Guest** (likely a collision, not the same person)

Stored `fingerprint_components` are used for the comparison, not the hash (which is identical by definition in this flow).

## Endpoint Migration

All public endpoints that currently call `get_client_fingerprint(request)` switch to `get_guest_id(request, db)`.

### New utility: `get_guest_id(request, db) -> int | None`

1. Read `wrzdj_guest` cookie from request.
2. Lookup `Guest` by token.
3. Return `Guest.id` or `None` (guest hasn't called `/identify` yet).

This replaces `get_client_fingerprint()` for all guest-facing endpoints. The function is a simple cookie-to-ID lookup — no fingerprint logic, no IP extraction. Identity resolution happens only in the `/identify` endpoint.

### Affected Endpoints

| File | Endpoint | Current | After |
|------|----------|---------|-------|
| `public.py` | `GET /events/{code}/has-requested` | IP fingerprint | `guest_id` |
| `public.py` | `GET /events/{code}/my-requests` | IP fingerprint | `guest_id` |
| `votes.py` | `POST /votes/{id}` | IP fingerprint | `guest_id` |
| `votes.py` | `DELETE /votes/{id}` | IP fingerprint | `guest_id` |
| `collect.py` | `GET /collect/{code}/profile` | IP fingerprint | `guest_id` |
| `collect.py` | `PUT /collect/{code}/profile` | IP fingerprint | `guest_id` |
| `collect.py` | `GET /collect/{code}/my-picks` | IP fingerprint | `guest_id` |
| `collect.py` | `POST /collect/{code}/submit` | IP fingerprint | `guest_id` |
| `collect.py` | `POST /collect/{code}/vote/{id}` | IP fingerprint | `guest_id` |
| `collect.py` | Top contributor query | `GROUP BY client_fingerprint` | `GROUP BY guest_id` |
| `events.py` | `POST /events/{code}/requests` | IP fingerprint | `guest_id=None` (DJ-owned) |

### Services Affected

| File | Functions | Change |
|------|-----------|--------|
| `vote.py` | `add_vote`, `remove_vote`, `has_voted` | Accept `guest_id` parameter, query by `guest_id` |
| `request.py` | `create_request`, `get_requests_by_fingerprint` | Accept `guest_id`, rename to `get_requests_by_guest` |
| `collect.py` | `get_profile`, `set_or_update_profile`, `check_submission_limit` | Accept `guest_id` instead of `fingerprint` |

All service functions gain a `guest_id: int` parameter. The old `client_fingerprint: str` parameter is kept but deprecated — only used if `guest_id` is None (legacy path during transition).

## Frontend Integration

### Dependency: ThumbmarkJS

- Package: `thumbmarkjs` (MIT license, actively maintained)
- Install in `dashboard/` only
- Import dynamically to avoid blocking page load

### New Hook: `useGuestIdentity()`

Located in `dashboard/lib/hooks/use-guest-identity.ts`.

Responsibilities:
1. Dynamically import ThumbmarkJS
2. Call `ThumbmarkJS.getFingerprint()` to get hash + components
3. `POST /api/public/guest/identify` with fingerprint payload (cookie sent automatically by browser)
4. Return `{ guestId: number | null, isReturning: boolean, isLoading: boolean }`
5. Cache result in React context — called once per page load, not per component

### Where It Runs

Guest-facing pages only:
- `/e/{code}/` — join page, request submission, display
- `/collect/{code}/` — collect flow (profile, submit, vote, my-picks)

NOT on:
- DJ dashboard (`/events/`, `/events/[code]`)
- Admin pages (`/admin/`)
- Login/register pages

### API Client Changes

The `ApiClient` class in `dashboard/lib/api.ts` needs no changes. The `wrzdj_guest` cookie is same-origin and `SameSite=Lax` — the browser sends it automatically on all `/api/` requests. No manual header management needed.

### Loading & Error States

- `isLoading=true` while `/identify` is in flight. Guest-facing pages show their normal loading skeleton.
- If `/identify` fails: guest can still view the event and request list (read-only). Submit/vote attempts show an error message: "Unable to verify your identity — please refresh and try again."
- No silent fallback to IP-based fingerprinting — one identity path only.

## Logging & Observability

### Logger

```python
_guest_logger = logging.getLogger("app.guest.identity")
```

Structured `key=value` format, consistent with existing `app.fingerprint` logger pattern.

### INFO — Every Identify Call (One Line Each)

```
guest.identify action=create guest_id=42 fp=a1b2c3d4e5f6 source=new ip_source=x-real-ip
guest.identify action=cookie_hit guest_id=42 fp=a1b2c3d4e5f6 source=cookie ip_source=direct
guest.identify action=reconcile guest_id=42 fp=a1b2c3d4e5f6 source=fingerprint confidence=high ip_source=x-real-ip
```

- `action`: what happened (create, cookie_hit, reconcile)
- `fp`: masked fingerprint hash (SHA-256 truncated to 12 hex chars, same pattern as existing `mask_fingerprint()`)
- `source`: which signal resolved the identity
- `ip_source`: which header/layer provided the IP (direct, x-real-ip, x-forwarded-for)

### WARNING — Decision Points That May Indicate Problems

```
guest.identify action=reconcile_rejected fp=a1b2c3d4e5f6 reason=ua_mismatch existing_guest=42 new_guest=87
guest.identify action=fingerprint_collision fp=a1b2c3d4e5f6 count=3 event_code=PB5TTP
guest.identify action=fingerprint_drift guest_id=42 old_fp=a1b2c3d4e5f6 new_fp=f6e5d4c3b2a1
```

- `reconcile_rejected`: fingerprint matched but confidence check failed — created new guest instead of re-linking
- `fingerprint_collision`: same fingerprint hash maps to N different guests at one event
- `fingerprint_drift`: returning guest's fingerprint changed (browser/OS update)

### DEBUG — Signal Breakdown (Off in Production)

```
guest.identify.signals guest_id=42 screen=1170x2532 tz=America/Chicago lang=en-US platform=iPhone ua_family=Safari/17.4
guest.identify.confidence guest_id=42 ua_match=0.85 screen_match=1.0 tz_match=1.0 overall=0.92
```

### What Is Never Logged

- Raw IP addresses (only masked fingerprint tag)
- Raw cookie token values
- Email addresses from guest profiles
- Full user agent strings at INFO level (only `ua_family` summary)

Raw values exist in the database for abuse investigation. Logs are for pattern detection, not PII storage.

### Key Metrics

| Metric | Source | Watch for |
|--------|--------|-----------|
| Reconciliation rate | `action=reconcile` / total | >30% = cookies not persisting |
| Collision rate | `action=fingerprint_collision` | >5 guests/fingerprint = identical devices |
| Drift rate | `action=fingerprint_drift` | Spike after browser release = review ThumbmarkJS signals |
| New guest rate | `action=create` / total | High for new events, low for returning venues |
| Rejection rate | `action=reconcile_rejected` | High = confidence threshold too strict |

## Testing Strategy

### Unit Tests

**`test_guest_identity.py`** — core resolution logic:

- `test_create_guest_new_visitor` — no cookie, no fingerprint match → new Guest
- `test_cookie_hit_returns_existing` — valid cookie → same Guest, updated last_seen_at
- `test_cookie_hit_updates_ip_and_ua` — cookie hit from new IP/UA → fields updated
- `test_reconcile_by_fingerprint` — no cookie, fingerprint matches → re-links, new cookie
- `test_reconcile_rejected_ua_mismatch` — fingerprint matches, UA differs → new Guest
- `test_fingerprint_drift_updates_hash` — cookie valid, new fingerprint → hash updated
- `test_expired_token_ignored` — cookie present, token not in DB → new visitor
- `test_fingerprint_components_stored` — JSON saved on create, updated on reconcile
- `test_token_is_cryptographically_random` — 64 hex chars, unique across 1000 generations
- `test_cookie_attributes` — HttpOnly, Secure, SameSite=Lax, Max-Age, Path

**`test_guest_identity_confidence.py`** — reconciliation scoring:

- `test_high_confidence_same_ua_family` — same browser + screen → re-link
- `test_low_confidence_different_ua_family` — Safari vs Chrome → new Guest
- `test_medium_confidence_same_ua_different_version` — Safari 17.4 vs 18.0 → re-link
- `test_identical_devices_different_guests` — same fingerprint, both get unique tokens

**`test_vote_service_guest_id.py`** — vote dedup:

- `test_add_vote_by_guest_id` — vote created, unique constraint enforced
- `test_duplicate_vote_same_guest` — same guest + same request → rejected
- `test_different_guests_same_request` — two guests can vote on same request
- `test_has_voted_checks_guest_id` — queries by guest_id when present
- `test_legacy_vote_still_works` — old client_fingerprint-only vote still queryable

**`test_request_service_guest_id.py`** — request dedup:

- `test_duplicate_request_same_guest` — same guest, same song → deduped + auto-vote
- `test_same_song_different_guests` — two guests, same song → both created
- `test_my_requests_by_guest_id` — returns correct list

### Integration Tests

**`test_identify_endpoint.py`** — full HTTP round-trip:

- `test_identify_sets_cookie` — response includes Set-Cookie with correct attributes
- `test_identify_with_cookie_returns_same_guest` — second call → same guest_id
- `test_identify_without_cookie_reconciles` — second call, no cookie, fingerprint → same guest
- `test_identify_rate_limited` — rate limiting active
- `test_identify_invalid_fingerprint_format` — malformed hash → 422
- `test_identify_missing_body` — no body → 422

**`test_collect_flow_guest_id.py`** — collect flow end-to-end:

- `test_submit_creates_profile_with_guest_id` — profile created with guest_id FK
- `test_submit_dedup_same_guest` — same guest re-submits → vote, not duplicate
- `test_vote_self_guard` — guest can't vote on their own submission
- `test_my_picks_returns_own_submissions` — scoped to guest_id
- `test_top_contributor_uses_guest_id` — GROUP BY guest_id

**`test_public_endpoints_guest_id.py`** — public.py endpoints:

- `test_has_requested_uses_guest_id` — checks guest_id not IP
- `test_my_requests_uses_guest_id` — returns requests by guest_id

### Scenario Tests (Real Event Conditions)

**`test_nat_scenario.py`** — shared WiFi:

- `test_three_guests_same_ip_different_fingerprints` — 3 phones on same WiFi, each with unique fingerprint. All submit, vote, and see their own requests independently.
- `test_two_guests_same_ip_same_fingerprint_different_tokens` — identical devices (school iPads), same fingerprint hash. Each got their own cookie on first visit. Remain separate guests.

**`test_network_switch_scenario.py`** — network changes:

- `test_guest_switches_wifi_to_cellular` — identifies on WiFi, returns on cellular. Cookie persists → same guest_id. IP updated.
- `test_guest_clears_cookies_returns_same_device` — clears cookies, comes back. Fingerprint reconciliation → same guest_id recovered. New cookie issued.

**`test_abuse_scenario.py`** — casual troublemaker:

- `test_incognito_does_not_reset_identity` — guest identified, opens incognito (no cookie), same fingerprint. Reconciliation re-links. Rate limits follow.
- `test_clear_cookies_does_not_reset_identity` — same as above but clearing cookies. Fingerprint reconciliation recovers identity.

### Test Infrastructure

- SQLite in-memory test DB (existing pattern, no changes)
- TestClient default host `"testclient"` — existing fixtures valid for legacy tests
- New helper: `identify_guest(client, fingerprint_hash="abc123")` — calls `/identify`, returns cookie + guest_id
- Cookie extraction via `response.cookies["wrzdj_guest"]`

## Deployment Notes

### Production Wipe

Since app.wrzdj.com has minimal current usage, wipe old events and guest data at deploy time for a clean start. This avoids orphaned IP-based records cluttering the database.

### Alembic Migration

Single migration file:
1. Create `guests` table
2. Add `guest_id` FK (nullable) to `guest_profiles`, `requests`, `request_votes`
3. Add new unique constraints alongside existing ones
4. Existing `client_fingerprint` columns and constraints left in place

### CORS / Cookie Configuration

The `wrzdj_guest` cookie is same-origin — no CORS changes needed. The cookie's `Path=/api/` ensures it's sent on all API requests. `SameSite=Lax` is compatible with the existing CORS setup.

For local dev with the dev proxy (nginx on different ports), cookies work because the browser treats same-IP-different-port as same-site for `SameSite=Lax`.

### npm Dependency

Add `thumbmarkjs` to `dashboard/package.json`. Check for CVEs before adding (`npm audit`). MIT license — no restrictions.
