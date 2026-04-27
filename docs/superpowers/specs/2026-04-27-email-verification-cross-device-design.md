# Email Verification & Cross-Device Guest Identity

**Date:** 2026-04-27
**Status:** Approved
**Scope:** Backend (FastAPI), Frontend (Next.js), SMTP integration, Alembic migration
**Depends on:** Guest Fingerprinting (PR #254, migration 036)

## Problem

The guest fingerprinting system (PR #254) creates device-bound identity — one `Guest` per device. This works for live events where guests use a single phone, but breaks for collection events spanning weeks where guests use both phone and laptop. A guest who enters nickname "beetlesfan" on their phone and laptop gets two separate `Guest` records with independent request histories, vote counts, and submission caps.

The `FeatureOptInPanel` already promises "Email: cross-device 'my picks' and leaderboard position" but the backend doesn't deliver — email is stored unverified on `GuestProfile` (per-event) and never used for identity linking.

## Goals

- Enable cross-device guest identity via verified email
- Auto-merge guest records when a second device verifies the same email
- Strongly advertise email verification with concrete benefits (cross-device picks, leaderboard, event notifications)
- Keep verification optional — nickname-only guests still work with zero friction
- Lay groundwork for future DJ-to-guest notifications (event changes, setlist posts)
- Remove unverified email from `GuestProfile` — one email field, always verified, always on `Guest`

## Non-Goals

- HTML email templates — plain text for v1
- DJ-to-guest notification sending — future feature, this just establishes the verified email
- Forced verification — never required to submit requests
- Kiosk email verification — shared devices, doesn't apply

## Architecture

Email verification extends the existing `Guest` model with a `verified_email` field. When a guest verifies their email, it's stored (encrypted) on their `Guest` record. When a second device verifies the same email, the two `Guest` records are auto-merged — all requests, votes, and profiles from the source guest are reassigned to the target guest.

SMTP sending via Dreamhost (existing provider, DNS records verified: SPF `-all`, DKIM 2048-bit, DMARC `p=reject` strict alignment).

## Data Model

### Modified: `guests` table

| Column | Type | Change | Description |
|--------|------|--------|-------------|
| `verified_email` | EncryptedText | **ADD** | Verified email, encrypted at rest |
| `email_hash` | String(64) | **ADD**, UNIQUE INDEX | SHA-256 of lowercased email — deterministic lookup key |
| `email_verified_at` | DateTime | **ADD** | When verification completed |
| `nickname` | String(30) | **ADD** | Platform-level display name |

- `verified_email` uses `EncryptedText` (Fernet AES-128-CBC + HMAC) for at-rest encryption — same as existing OAuth tokens
- `email_hash` is `SHA-256(email.lower())` — deterministic, used for unique constraint and lookups. Fernet is non-deterministic (random IV), so we can't index or query by the encrypted column directly.
- `nickname` on Guest is the platform default; `GuestProfile.nickname` can override per-event

### New Table: `email_verification_codes`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | Integer | PK | |
| `guest_id` | Integer | FK → guests.id, NOT NULL | Which guest initiated verification |
| `email_hash` | String(64) | NOT NULL, INDEX | SHA-256 of lowercased email — for lookups and rate limiting |
| `code` | String(6) | NOT NULL | 6-digit numeric code |
| `expires_at` | DateTime | NOT NULL | created_at + 15 minutes |
| `attempts` | Integer | DEFAULT 0 | Wrong code attempts (max 3) |
| `used` | Boolean | DEFAULT False | Code successfully used |
| `created_at` | DateTime | NOT NULL | |

Rate limit: max 5 active (unused, unexpired) codes per email per hour, enforced at creation time.

### Modified: `guest_profiles` table

- **Remove `email` column** — migration drops the EncryptedText email column
- `nickname` stays on GuestProfile for per-event display name overrides

### Migration (037)

1. Add `verified_email`, `email_hash`, `email_verified_at`, `nickname` to `guests`
2. Create `email_verification_codes` table
3. Drop `email` column from `guest_profiles`
4. Add unique index on `guests.email_hash`

## Verification Flow

### New Endpoints

**`POST /api/public/guest/verify/request`**

Rate limited: 10/minute per IP.

Request:
```json
{ "email": "fan@gmail.com" }
```
Cookie: `wrzdj_guest` (required — identifies which Guest)

Server:
1. Read `guest_id` from cookie
2. Validate email format (Pydantic `EmailStr`)
3. Check rate limit: < 5 unexpired/unused codes for this email in past hour
4. Generate 6-digit code: `secrets.randbelow(900000) + 100000`
5. Store in `email_verification_codes` (expires_at = now + 15 min)
6. Send email via SMTP (Dreamhost)
7. Return `{ sent: true }`

**`POST /api/public/guest/verify/confirm`**

Rate limited: 10/minute per IP.

Request:
```json
{ "email": "fan@gmail.com", "code": "847293" }
```
Cookie: `wrzdj_guest` (required)

Server:
1. Read `guest_id` from cookie
2. Lookup unexpired, unused code matching email + guest_id
3. Wrong code → increment attempts. 3 strikes → code invalidated. Return 400.
4. Correct code → mark code as used
5. Check: does another Guest already have this `email_hash`?
   - **YES** → merge current guest into existing guest (see Merge section)
   - **NO** → set `verified_email` + `email_verified_at` on current Guest
6. Return `{ verified: true, guest_id: <canonical>, merged: <bool> }`
7. Set new cookie with canonical Guest's token (if merged)

### Email Content

Plain text, no HTML. Minimal transactional email:

```
From: WrzDJ <noreply@wrzdj.com>
Subject: Your WrzDJ verification code

Your verification code is: 847293

Enter this code on the WrzDJ page. It expires in 15 minutes.

If you didn't request this, you can safely ignore this email.
```

### SMTP Configuration

New settings in `config.py` (all via environment variables, empty defaults = verification disabled in dev):

```python
smtp_host: str = ""
smtp_port: int = 465
smtp_username: str = ""
smtp_password: str = ""
smtp_from_address: str = ""
```

Production `.env`:
```
SMTP_HOST=<provider host>
SMTP_PORT=465
SMTP_USERNAME=<email>
SMTP_PASSWORD=<password>
SMTP_FROM_ADDRESS=<email>
```

Verification endpoints return clear error when SMTP is not configured. Server boots fine without SMTP — check is at call time, not startup.

### Verification Code Rules

| Rule | Value |
|------|-------|
| Code format | 6 digits (100000-999999) |
| Code validity | 15 minutes |
| Max wrong attempts | 3 per code |
| Max codes per email per hour | 5 |
| Code storage | DB row, marked used on success |

## Guest Merge

When a second device verifies an email that already belongs to another Guest, the two records are auto-merged silently.

### `merge_guests(db, source_guest_id, target_guest_id) -> MergeResult`

Target = the Guest that verified the email first (canonical). Source = the Guest being absorbed (current device).

**Step 1: Reassign requests**
```sql
UPDATE requests SET guest_id = target WHERE guest_id = source
```
No unique constraint conflict possible.

**Step 2: Reassign votes (with dedup)**
For each vote where `guest_id = source`:
- Try reassigning to target
- If `IntegrityError` (both voted on same request): delete source vote, decrement `request.vote_count` by 1
- One person, one vote — correct behavior

**Step 3: Reassign guest profiles (with merge)**
For each profile where `guest_id = source`:
- If target already has a profile for the same event:
  - Add source's `submission_count` to target's
  - Keep target's nickname (or source's if target has none)
  - Delete source profile
- Otherwise: reassign profile to target

**Step 4: Delete source Guest**
Source Guest row deleted. Source device gets target's cookie in the verify/confirm response.

### MergeResult

```python
@dataclass
class MergeResult:
    source_guest_id: int
    target_guest_id: int
    requests_moved: int
    votes_moved: int
    votes_deduped: int
    profiles_moved: int
    profiles_merged: int
```

## Frontend

### FeatureOptInPanel Redesign

Two distinct sections in the panel:

**Section 1: Nickname** — unchanged, saves to GuestProfile

**Section 2: Email Verification** — replaces old unverified email input

Three UI states:

**State A — Not verified:**
- Benefits pitch: cross-device picks, leaderboard position, event notifications
- Email input + "Send Code" button

**State B — Code sent:**
- 6 individual digit inputs (auto-advance on keystroke)
- Countdown timer (seconds remaining)
- "Resend" link (respects rate limit)

**State C — Verified:**
- Confirmed badge: "fan@gmail.com verified"
- Single-line collapsed view

### Where verification appears

| Page | Placement | Prominence |
|------|-----------|------------|
| `/collect/{code}` | In FeatureOptInPanel | High — collection spans weeks, multi-device expected |
| `/join/{code}` | Below request form, after first submission | Medium — "Want to track across devices?" |
| Kiosk display | NOT shown | Shared device, no email verification |

### API Client

Two new methods:

```typescript
requestVerificationCode(email: string): Promise<{ sent: boolean }>
confirmVerificationCode(email: string, code: string): Promise<{ verified: boolean; guest_id: number; merged: boolean }>
```

Both use `credentials: "include"` — cookie identifies the guest.

### Post-merge behavior

When `merged: true` returned:
1. New cookie set automatically (target Guest's token)
2. Brief "Synced with your other device" message
3. Page data refreshes (my-picks, profile, submission count now includes merged activity)

## Logging

Logger: `app.guest.verify`

```
guest.verify action=code_sent guest_id=42 email_hash=a1b2c3 ip_source=x-real-ip
guest.verify action=code_verified guest_id=42 email_hash=a1b2c3
guest.verify action=code_failed guest_id=42 email_hash=a1b2c3 attempts=2
guest.verify action=code_expired guest_id=42 email_hash=a1b2c3
guest.verify action=merge source_guest=2 target_guest=1 email_hash=a1b2c3 requests=5 votes=12 profiles=1
guest.verify action=rate_limited email_hash=a1b2c3 reason=max_codes_per_hour
```

`email_hash` = SHA-256 truncated to 12 hex chars (same `mask_fingerprint()` pattern). Raw email never in logs.

## Testing Strategy

### Unit Tests

**`test_email_verification.py`** — code lifecycle:
- `test_create_verification_code` — 6-digit code, correct expiry
- `test_verify_correct_code` — accepted, marked used, email set on Guest
- `test_verify_wrong_code_increments_attempts` — attempts +1
- `test_verify_three_strikes_invalidates` — 3 wrong → code dead
- `test_verify_expired_code_rejected` — past 15 min → rejected
- `test_rate_limit_five_codes_per_hour` — 6th → 429
- `test_verify_sets_email_on_guest` — Guest.verified_email populated
- `test_already_verified_same_email` — re-verify same email → no-op success

**`test_guest_merge.py`** — merge mechanics:
- `test_merge_moves_requests` — source requests → target
- `test_merge_moves_votes` — source votes → target
- `test_merge_deduplicates_votes` — same request voted by both → one kept, count decremented
- `test_merge_combines_profiles` — same event → submission_counts added
- `test_merge_moves_profile_different_event` — different event → reassigned
- `test_merge_nickname_fallback` — target has no nickname → source's kept
- `test_merge_deletes_source_guest` — source row deleted
- `test_merge_returns_correct_counts` — MergeResult accurate

**`test_smtp_service.py`** — email sending:
- `test_send_verification_email` — SMTP called correctly
- `test_smtp_not_configured_raises` — empty host → clear error
- `test_email_content_no_pii_leak` — body has code + expiry only

### Integration Tests

**`test_verify_endpoints.py`** — HTTP round-trips:
- `test_request_code_returns_sent` — 200 with `{sent: true}`
- `test_request_code_without_cookie_fails` — no cookie → 401
- `test_confirm_code_sets_email_on_guest` — correct code → email on Guest
- `test_confirm_code_returns_merged_true` — second device → `{merged: true}`, new cookie
- `test_confirm_wrong_code_returns_error` — wrong code → 400
- `test_rate_limit_on_request` — 6th request → 429

### Scenario Tests

**`test_cross_device_scenario.py`** — the real problem:
- `test_two_devices_same_email_merge` — phone submits 3 songs, laptop verifies same email → laptop sees all 3 in my-picks
- `test_merge_preserves_vote_counts` — both voted different songs → both votes exist after merge
- `test_merge_dedup_same_vote` — both voted same song → one vote, count decremented
- `test_verified_guest_on_third_device` — third device verifies same email → merges into same Guest
- `test_unverified_guest_unaffected` — no email → no merge, works as before

### Migration Tests

- `test_guest_profile_has_no_email_column` — column dropped
- `test_collect_profile_endpoint_no_email` — POST /profile no longer accepts email

## Known Issues (Out of Scope)

### Kiosk duplicate request upvoting

Kiosk requests go through `POST /events/{code}/requests` which auto-votes on duplicates via `create_request()`. On a kiosk (shared device, one Guest identity), the auto-vote is currently a no-op (same guest_id = idempotent). However, kiosks should not participate in vote inflation at all — a kiosk duplicate should return `{is_duplicate: true}` without attempting an auto-vote. This is a separate fix: detect kiosk context (via `kiosk_session_token` or endpoint flag) and skip the `add_vote()` call in `create_request()` for kiosk submissions.

## Deployment Notes

### Migration 037

1. Add columns to `guests`
2. Create `email_verification_codes` table
3. Drop `email` from `guest_profiles`
4. Unique index on `guests.verified_email`

### Environment Variables

Production `.env` needs:
```
SMTP_HOST=<provider>
SMTP_PORT=465
SMTP_USERNAME=<email>
SMTP_PASSWORD=<password>
SMTP_FROM_ADDRESS=<email>
```

### Schema Changes

- `CollectProfileRequest` schema: remove `email` field
- `CollectProfileResponse` schema: remove `has_email` field (or repurpose to reflect `Guest.verified_email`)
- `FeatureOptInPanel` props: remove `hasEmail`, add verification state
