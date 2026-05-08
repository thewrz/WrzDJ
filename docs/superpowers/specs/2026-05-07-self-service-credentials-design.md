# Self-Service Credential Management

**Date:** 2026-05-07
**Author:** thewrz
**Status:** Approved

## Overview

Allow authenticated DJs and admins to change their password and email address from a new `/account` page in the dashboard. Username is not in scope — it is the JWT `sub` claim and changing it mid-session would invalidate the user's own token.

## Decisions Made

| Question | Decision |
|---|---|
| Scope | Password + email change only (no username) |
| Session behavior on password change | Invalidate all sessions (bump `token_version`) |
| Current password required | Yes, for both operations |
| Email verification method | Confirmation link sent to new address (token in URL) |
| Pending token storage | Separate `pending_email_changes` table (Option B) |
| UI placement | New `/account` page |

---

## Data Model

### New table: `pending_email_changes`

| Column | Type | Constraints |
|---|---|---|
| `id` | Integer | PK |
| `user_id` | Integer | FK → `users.id` CASCADE, indexed |
| `new_email` | String(255) | |
| `token` | String(64) | unique, indexed — `secrets.token_hex(32)` |
| `expires_at` | DateTime | 24h TTL from creation |
| `used` | Boolean | default False |
| `created_at` | DateTime | `utcnow` |

- No changes to the `User` model.
- One new Alembic migration.
- On each new email change request, any existing unused records for that `user_id` are marked `used=True` before inserting — only the latest confirmation link is ever valid.

**Security note:** Token stored plaintext (matches existing `EmailVerificationCode` pattern). At 256 bits of entropy (`secrets.token_hex(32)`), brute force is computationally infeasible. A DB read compromise would expose tokens; this is an accepted trade-off consistent with the rest of the codebase.

---

## Backend API

All endpoints under `/api/auth/me/` use `get_current_active_user` (blocks `pending` users).

### `PATCH /api/auth/me/password`

Rate limit: `5/minute`

**Request body:**
```json
{
  "current_password": "...",
  "new_password": "...",
  "confirm_new_password": "..."
}
```

**Behaviour:**
1. Verify `current_password` via bcrypt against `user.password_hash`
2. Hash `new_password`, save to `user.password_hash`
3. Invalidate any pending email change records for this user (security gap: prevents in-flight email hijack surviving a password reset)
4. Bump `user.token_version` — invalidates ALL active sessions on all devices
5. Return `200 { status: "ok" }`

**Errors:** `400` wrong current password | `422` validation failure

### `POST /api/auth/me/email/request`

Rate limit: `3/minute`

**Request body:**
```json
{
  "current_password": "...",
  "new_email": "user@example.com"
}
```

**Behaviour:**
1. Verify `current_password`
2. Check `new_email` not already in `users` table — use same generic error as wrong password to prevent email enumeration
3. Invalidate any existing `pending_email_changes` for this `user_id`
4. Create `PendingEmailChange` record (24h TTL)
5. Send confirmation link to `new_email` via Resend: `{settings.public_url}/account/confirm-email?token=<token>`
6. Return `200 { status: "ok" }`

**Errors:** `400` wrong password or email taken (generic) | `422` validation failure | `422` email service unavailable

### `GET /api/auth/email/confirm`

Rate limit: `10/minute`  
**No authentication required** — the token is proof of email ownership. The user may be on a different device when clicking the link.

**Query param:** `?token=<64-char hex>`

**Behaviour:**
1. Look up token in `pending_email_changes`: must be unused and not expired
2. Re-check `new_email` not already taken (TOCTOU race guard)
3. Update `user.email` to `new_email`
4. Mark record `used=True`
5. Return `200 { status: "ok", message: "Email updated" }`

**Errors:** `400` token not found / expired / already used | `409` email now taken

---

## Service Layer

New file: `server/app/services/account.py`

```python
def change_password(db, user, current_password, new_password) -> None:
    # raises ValueError("incorrect_password") if current_password wrong
    # hashes + saves new password
    # calls invalidate_pending_email_changes(db, user.id)
    # bumps user.token_version
    # db.commit()

def request_email_change(db, user, current_password, new_email) -> None:
    # raises ValueError("incorrect_password") if current_password wrong
    # raises ValueError("email_taken") if new_email already in users table
    # invalidates existing pending records for user_id
    # creates PendingEmailChange record
    # calls send_email_confirmation(new_email, confirmation_url)

def confirm_email_change(db, token) -> User:
    # raises TokenNotFoundError, TokenExpiredError, TokenUsedError
    # raises EmailTakenError if email grabbed between request and confirm
    # marks record used=True
    # updates user.email
    # db.commit()
    # returns user

def invalidate_pending_email_changes(db, user_id) -> None:
    # marks all unused pending_email_changes for user_id as used=True
```

New function in `server/app/services/email_sender.py`:

```python
def send_email_confirmation(to_address: str, confirmation_url: str) -> None:
    # subject: "Confirm your new WrzDJ email address"
    # body: plain text with confirmation_url + 24h expiry notice
    # reuses existing resend infrastructure
```

Confirmation URL constructed as: `{settings.public_url}/account/confirm-email?token={token}`

---

## Frontend

### `/account` page — `dashboard/app/account/page.tsx`

Two independent cards. Nav link added to existing sidebar/header (placement decided at implementation time).

**Change Password card**
- Fields: Current password, New password, Confirm new password
- On submit → `PATCH /api/auth/me/password`
- On success: show inline success message → 1.5s → redirect to `/login` (token now invalid, all sessions cleared)
- On error: inline field error

**Change Email card**
- Read-only hint showing current email
- Fields: Current password, New email
- On submit → `POST /api/auth/me/email/request`
- On success: swap card to "check your inbox" state showing the pending email address
- Pending state: `GET /api/auth/me` returns `pending_email: str | None`. This field is NOT on the `User` ORM model — the `/me` endpoint does a separate DB lookup for an active (unused, unexpired) `PendingEmailChange` record for the current user and injects it into the response. `UserOut` gains `pending_email: str | None = None`.

### Email confirmation landing — `dashboard/app/account/confirm-email/page.tsx`

- Reads `?token=` from URL on mount
- Calls `GET /api/auth/email/confirm?token=...`
- Three states: loading spinner → success ("Email updated" + redirect to `/account` after 2s) → error ("Link expired or already used. Request a new one from your account settings.")

---

## Email Template

**Subject:** Confirm your new WrzDJ email address

**Body (plain text):**
```
Someone requested an email address change for your WrzDJ account.

Click the link below to confirm your new email address:
{confirmation_url}

This link expires in 24 hours.

If you didn't request this change, you can safely ignore this email.
Your account password was required to make this request, so your account remains secure.
```

---

## Security Summary

| Control | Implementation |
|---|---|
| Current password required | Both operations — prevents hijacked JWT from silently changing credentials |
| All sessions invalidated on password change | `token_version` bump — consistent with logout and admin force-revoke |
| Pending email invalidated on password change | `invalidate_pending_email_changes()` called in `change_password()` |
| No email enumeration | Email-taken error uses same message as wrong-password |
| Token entropy | 256 bits (`secrets.token_hex(32)`) — brute force infeasible |
| Single active confirmation link | Old records marked `used=True` before new record inserted |
| Replay prevention | `used` flag on `PendingEmailChange` |
| TOCTOU race on confirm | Email uniqueness re-checked at confirm time |
| Rate limiting | 5/min (password), 3/min (email request), 10/min (confirm) |
| Pending users blocked | `get_current_active_user` dependency on all `/me/` endpoints |

---

## Testing

### Backend — `server/tests/test_account.py`

**Password change:**
- `test_change_password_success` — hash updated, `token_version` bumped, pending email changes invalidated
- `test_change_password_wrong_current` — 400, nothing changes
- `test_change_password_pending_role_blocked` — 403
- `test_change_password_invalidates_pending_email` — regression test for gap #1

**Email change request:**
- `test_request_email_change_success` — record created, old records invalidated
- `test_request_email_change_wrong_password` — 400, no record created
- `test_request_email_change_email_taken` — 409 with generic message (no enumeration)
- `test_request_email_change_supersedes_previous` — second request marks first `used=True`

**Email confirmation:**
- `test_confirm_email_change_success` — email updated, record marked used
- `test_confirm_email_change_expired` — 400 token expired
- `test_confirm_email_change_used` — 400 already used
- `test_confirm_email_change_email_race` — email taken between request and confirm → 409

### Frontend — `dashboard/app/account/__tests__/page.test.tsx`

- Password form submits correct payload, redirects to `/login` on success
- Email form transitions to "check inbox" state on success
- Confirm-email page renders loading / success / error states correctly

---

## Files to Create / Modify

### New
- `server/app/models/pending_email_change.py`
- `server/app/services/account.py`
- `server/alembic/versions/NNN_add_pending_email_changes.py`
- `server/tests/test_account.py`
- `dashboard/app/account/page.tsx`
- `dashboard/app/account/confirm-email/page.tsx`
- `dashboard/app/account/__tests__/page.test.tsx`

### Modified
- `server/app/api/auth.py` — add three new endpoints
- `server/app/schemas/user.py` — add `ChangePasswordRequest`, `RequestEmailChangeRequest` schemas; add `pending_email: str | None` to `UserOut`
- `server/app/services/email_sender.py` — add `send_email_confirmation()`
- `server/app/models/__init__.py` — register new model
- `dashboard/lib/api.ts` — add `changePassword()`, `requestEmailChange()`, `confirmEmailChange()` methods
