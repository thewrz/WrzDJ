# Nickname Gate Redesign

**Date:** 2026-04-30
**Scope:** `dashboard/components/NicknameGate.tsx`, `server/app/api/collect.py`, `server/app/services/collect.py`, `server/app/models/guest_profile.py`

---

## Problem

The current NicknameGate has three gaps:

1. **No returning-user entry point.** A guest who has previously verified their email has no obvious way to log back in from the gate. The `reconcileHint` path exists but is subtle and separate.
2. **No nickname uniqueness enforcement.** The same nickname can be claimed by multiple guests in the same event. There is no DB constraint, no API check, and no UX for collisions.
3. **No email-claim enforcement.** There is no point at which the system demands identity verification — it is fully frictionless in all cases, including nickname collisions.

---

## Decisions

| Question | Decision |
|---|---|
| Where does the "returning user" hint live? | Always visible on the gate as a second track ("Have email"), not conditional on `reconcileHint` |
| Nickname uniqueness scope | Per-event, case-insensitive |
| Collision behaviour — unclaimed nickname | Hard block. "First come, first served." No claim path. Direct user to original device. |
| Collision behaviour — email-claimed nickname | Block + offer email OTP login to prove ownership |
| When is email mandatory? | Only on collision with an email-claimed nickname. Otherwise frictionless forever. |

---

## Architecture

Only one layer of the stack changes meaningfully. Everything else reuses existing infrastructure.

| Layer | Change |
|---|---|
| **Database** | One new partial functional unique index on `guest_profiles` |
| **Backend service** | `upsert_profile()` runs a collision check before upsert; raises `NicknameConflictError` |
| **Backend endpoint** | `POST /api/events/{code}/profile` catches `NicknameConflictError` → 409 |
| **Frontend component** | `NicknameGate.tsx` gains 5 new internal states and a revised state machine |
| **Frontend API client** | `setCollectProfile()` handles 409 and surfaces `NicknameConflict` |
| **Everything else** | Unchanged — verify endpoints, merge service, join/collect pages, identity hook |

---

## State Machine

### States

| State | Type | Description |
|---|---|---|
| `loading` | existing | Fetches profile from server on mount |
| `track_select` | **new** | Two-track entry: "New name" vs "Have email" |
| `nickname_input` | existing | Text field + Continue button |
| `collision_unclaimed` | **new** | Nickname taken, owner has no email — device hint, no action |
| `collision_claimed` | **new** | Nickname taken, owner is email-verified — login CTA |
| `email_login` | **new** | Email input field, reachable from `track_select` or `collision_claimed` |
| `email_code` | **new** | 6-digit OTP entry |
| `email_prompt` | existing | Optional email nudge after nickname saved (skipped if already verified) |
| `complete` | existing | Gate dismissed, event content shown |

### Transitions

| From | Trigger | To |
|---|---|---|
| `loading` | No profile found | `track_select` |
| `loading` | Profile has nickname, no email | `email_prompt` |
| `loading` | Profile has nickname + email verified | `complete` |
| `track_select` | "New name" clicked | `nickname_input` |
| `track_select` | "Have email" clicked | `email_login` |
| `nickname_input` | Submit → 200, guest not email-verified | `email_prompt` |
| `nickname_input` | Submit → 200, guest already email-verified | `complete` |
| `nickname_input` | Submit → 409 `claimed=false` | `collision_unclaimed` |
| `nickname_input` | Submit → 409 `claimed=true` | `collision_claimed` |
| `collision_unclaimed` | "Try a different nickname" | `nickname_input` |
| `collision_claimed` | "Try a different nickname" | `nickname_input` |
| `collision_claimed` | "Log in with email" | `email_login` |
| `email_login` | Email submitted, code sent | `email_code` |
| `email_code` | Code verified, guest has nickname | `complete` |
| `email_code` | Code verified, guest has no nickname | `nickname_input` |
| `email_prompt` | Email verified or skipped | `complete` |

---

## API Contract

### Modified: `POST /api/events/{code}/profile`

Existing endpoint. One new error response added.

**New 409 response** (nickname collision):
```json
{ "detail": { "code": "nickname_taken", "claimed": true } }
```

- `claimed: true` — existing owner has `email_verified_at IS NOT NULL`
- `claimed: false` — existing owner has no email verification

All other responses (200, 401, 422, 429) unchanged.

### Unchanged endpoints reused by new flows

- `POST /api/guest/verify/request` — sends OTP (email login and email_code states)
- `POST /api/guest/verify/confirm` — verifies code, merges guests if email already claimed, sets cookie
- `GET /api/events/{code}/profile` — called after `email_code` completes to determine if `complete` or `nickname_input` is next

No new endpoints.

---

## Data Model

### New index on `guest_profiles`

```sql
CREATE UNIQUE INDEX uq_guest_profile_event_nickname
ON guest_profiles (event_id, lower(nickname))
WHERE nickname IS NOT NULL;
```

Partial (skips NULL nicknames) and functional (case-insensitive via `lower()`). SQLAlchemy model `__table_args__` gets a matching `Index(...)` declaration.

Alembic migration: `server/alembic/versions/NNN_add_nickname_uniqueness.py`

### Service layer: `upsert_profile()` in `services/collect.py`

Before upserting, runs:
```python
existing = db.query(GuestProfile).filter(
    GuestProfile.event_id == event_id,
    GuestProfile.guest_id != guest_id,
    func.lower(GuestProfile.nickname) == nickname.lower(),
).first()

if existing:
    owner = db.get(Guest, existing.guest_id)
    claimed = owner is not None and owner.email_verified_at is not None
    raise NicknameConflictError(claimed=claimed)
```

`NicknameConflictError` is a new domain exception in `services/collect.py`, not an `HTTPException`. The API layer maps it to 409.

---

## Error Handling

### Race condition

Two guests submit the same nickname simultaneously. Both pass the application-level check. One wins the DB unique index; the other gets `sqlalchemy.exc.IntegrityError`. The endpoint catches `IntegrityError` on the profile insert and maps it to 409 `claimed=false` (the race winner has no email yet). No stuck states.

### Email service unavailable

When `email_login` submits and `/api/guest/verify/request` returns 422, the frontend shows an inline error and surfaces "Try a different nickname" as an escape hatch. The gate does not get stuck.

### OTP expiry / max attempts

Handled by existing `email_verification.py` (15-minute expiry, 3-attempt limit). The `email_code` state has a "Resend code" button that calls `/api/guest/verify/request` again. No new handling required.

### Self-collision

A guest re-submitting their own nickname never sees a 409. The collision query excludes `guest_id == current_guest_id`. Idempotent.

### Merged account nickname is authoritative

After `collision_claimed` → email login → verify → merge: frontend calls `GET /api/events/{code}/profile`. It gets the target account's existing nickname (not what the user originally typed). Gate goes directly to `complete`.

---

## Testing

### Backend (pytest) — new tests in `tests/test_collect.py`

| Test | Assertion |
|---|---|
| `test_profile_nickname_available` | 200, profile upserted |
| `test_profile_nickname_collision_unclaimed` | 409, `claimed=false` |
| `test_profile_nickname_collision_claimed` | 409, `claimed=true` |
| `test_profile_nickname_self_collision` | 200, re-saving own nickname succeeds |
| `test_profile_nickname_case_insensitive` | "Alex" blocks "alex" and "ALEX" |
| `test_profile_nickname_race_condition` | IntegrityError maps to 409 `claimed=false` |
| `test_profile_nickname_null_allowed` | NULL nickname skips uniqueness check |

### Frontend (vitest) — new tests in `NicknameGate.test.tsx`

| Test | Assertion |
|---|---|
| Initial state (no profile) | Renders `track_select` |
| "New name" click | Transitions to `nickname_input` |
| "Have email" click | Transitions to `email_login` |
| 409 `claimed=false` on submit | Renders `collision_unclaimed` with device hint |
| 409 `claimed=true` on submit | Renders `collision_claimed` with login CTA |
| "Try a different nickname" from unclaimed | Returns to `nickname_input` |
| "Try a different nickname" from claimed | Returns to `nickname_input` |
| `email_code` verify → profile has nickname | Transitions to `complete` |
| `email_code` verify → profile has no nickname | Transitions to `nickname_input` |
| Nickname saved when already email-verified | Transitions to `complete`, skips `email_prompt` |

---

## Files Touched

| File | Change |
|---|---|
| `dashboard/components/NicknameGate.tsx` | New state machine, 5 new states, `email_login` + `email_code` UI |
| `dashboard/lib/api.ts` | `setCollectProfile()` handles 409, returns typed conflict info |
| `server/app/api/collect.py` | Catches `NicknameConflictError`, returns 409 |
| `server/app/services/collect.py` | `upsert_profile()` collision check; new `NicknameConflictError` |
| `server/app/models/guest_profile.py` | New `Index(...)` in `__table_args__` |
| `server/alembic/versions/NNN_add_nickname_uniqueness.py` | New migration |
| `server/tests/test_collect.py` | 7 new backend tests |
| `dashboard/components/__tests__/NicknameGate.test.tsx` | 10 new frontend tests |
