# Nickname Gate — Design Spec

**Date:** 2026-04-28
**Status:** Approved
**Surfaces affected:** `/join/{code}` (live join), `/collect/{code}` (pre-event collection)
**Surfaces explicitly excluded:** `/e/{code}/display` kiosk modal — no nickname, no email, no gate, ever

---

## Problem

Nicknames are currently optional. Guests can submit song requests anonymously. The platform needs every guest on the join and collect pages to have a saved nickname before they interact, and should nudge (not force) email verification for cross-device continuity.

---

## Architecture

A new `NicknameGate` component renders as a full-screen overlay over the join and collect pages before any page content is shown. Once the gate completes, a persistent `IdentityBar` replaces it at the top of the page for the rest of the session.

**New components:**
- `dashboard/components/NicknameGate.tsx` — gate overlay (shared between join + collect)
- `dashboard/components/IdentityBar.tsx` — persistent identity strip shown after gate passes

**Modified components:**
- `dashboard/app/join/[code]/page.tsx` — add gate + identity bar, auto-pass saved nickname to submit
- `dashboard/app/collect/[code]/page.tsx` — add gate + identity bar, pre-fill collect profile nickname
- `dashboard/app/collect/[code]/components/EmailVerification.tsx` — add optional `onSkip?: () => void` prop that renders "Skip for now" link when provided

**No new backend endpoints.** All calls reuse existing APIs.

---

## Routing Logic

On page load, `NicknameGate` calls `useGuestIdentity()` to resolve the cookie, then immediately calls `GET /api/public/collect/{code}/profile` to read the current nickname and email status.

```
Profile GET result → gate state:

  404 (event not found / not active)
    → pass-through: let the page render its own not-found UI

  5xx / network error
    → block: "Couldn't connect to the event. Check your connection and try again." + Retry button

  200, profile.nickname !== null AND profile.email_verified === true
    → skip gate entirely: fire onComplete(nickname, true) immediately

  200, profile.nickname !== null AND profile.email_verified === false
    → skip nickname_input: advance to email_prompt state

  200, profile.nickname === null   (new guest, or returning guest who never saved a name)
    → start at nickname_input state
```

---

## Gate States

### `loading`
Spinner while `useGuestIdentity` and the profile GET resolve. No user-facing content beyond a minimal loading indicator.

### `nickname_input`
- Heading: **"What's your nickname?"**
- Single text input, max 30 chars
- Save button: **disabled** until ≥1 character typed
- On click Save:
  1. `POST /api/public/collect/{code}/profile { nickname }`
  2. On success: show inline "✓ Nickname saved!" for 1.5 s, then advance to `email_prompt`
  3. On failure: inline error below input — "Couldn't save — please try again"

### `email_prompt`
- Heading: **"Add your email to unlock cross-device access and leaderboards"**
- Renders `<EmailVerification onSkip={handleSkip} onVerified={handleVerified} />`
  - `onSkip` → `onComplete(nickname, false)`
  - `onVerified` → `onComplete(nickname, true)`

### `complete`
- Fires `onComplete(nickname, emailVerified)` and unmounts

---

## Identity Bar (`IdentityBar.tsx`)

Renders below the page header after the gate completes. Always visible for the rest of the session.

**If email not verified:**
```
👤 [Name]   •   + Add email →   (pulsing dot animation)
```
Clicking "Add email →" expands `<EmailVerification>` inline beneath the bar. On verify: bar updates to verified state.

**If email verified:**
```
👤 [Name]   •   ✓ Verified
```

CSS: `@keyframes` pulse on a `::before` indicator dot next to "Add email →". No heavy animation — 2 s ease-in-out opacity pulse.

---

## Session Persistence

After `onComplete` fires, the gate result is written to `sessionStorage`:

```
sessionStorage['wrzdj_nick_{code}'] = JSON.stringify({ nickname, emailVerified })
```

On subsequent page loads within the same session: if this key exists AND the profile GET returns a matching nickname, skip the gate. `sessionStorage` unavailability (private browsing edge cases) is handled silently — gate simply shows again.

---

## Page Modifications

### Join page (`/join/{code}`)
- Wrap content with `NicknameGate`. Before the gate completes, nothing else renders.
- After gate: show `IdentityBar` pinned below the event name header.
- Remove the optional nickname field from the song confirm screen. Pass the gate-saved nickname automatically to `api.submitRequest(...)` from component state.

### Collect page (`/collect/{code}`)
- Same gate + identity bar pattern.
- Pre-fill the nickname in `CollectionFieldset` from gate state; make it **read-only** (visible but not editable) so guests can confirm their name is attached to each pick. Guests cannot change their nickname mid-session via the submit form.

### Kiosk modal (`RequestModal.tsx`)
- No changes. Nickname remains optional (placeholder text only), no email prompt, no gate.

---

## Backend

No new endpoints. All calls reuse:

| Call | Endpoint | Purpose |
|---|---|---|
| Read current nickname + email | `GET /api/public/collect/{code}/profile` | Gate routing |
| Save nickname | `POST /api/public/collect/{code}/profile` | Gate save |
| Request email OTP | `POST /api/public/guest/verify/request` | Email prompt |
| Confirm email OTP | `POST /api/public/guest/verify/confirm` | Email prompt |

The collect profile endpoint creates a `GuestProfile` row keyed to `(event_id, guest_id)` — correct for both join and collect pages since a live event is still active (`event.is_active` check, not phase check).

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Profile GET → 404 | Pass-through — page handles event not found |
| Profile GET → network / 5xx | Hard block: "Couldn't connect — try again" + Retry button |
| Save nickname POST fails | Inline error below the input field |
| Email verify fails | `EmailVerification` handles internally (already implemented) |
| sessionStorage unavailable | Gate works normally; no skip-on-refresh |
| wrzdj_guest cookie not yet set | Gate stays in `loading` until `useGuestIdentity` resolves before firing the profile GET |

---

## Testing

### Unit tests (new)
- `NicknameGate` routing: new guest → `nickname_input`; returning + no email → `email_prompt`; returning + email → immediate `onComplete`
- `NicknameGate`: Save button disabled on empty input, enabled at ≥1 char, fires POST on click
- `NicknameGate`: network error shows blocking error + Retry; 404 passes through
- `EmailVerification`: "Skip for now" link renders when `onSkip` prop provided, fires `onSkip` on click
- `IdentityBar`: pulse class present when `emailVerified=false`; verified state when true

### Regression (existing tests)
- Kiosk modal tests unchanged — confirm no identify calls, no nickname required
- Join page submit flow still passes nickname through correctly
- Collect page profile flow still saves correctly

### Manual E2E
- New guest: gate → save nickname → email prompt → skip → identity bar with pulse
- New guest: gate → save nickname → email prompt → verify → identity bar shows verified
- Returning guest (no email): email prompt shown, skip works
- Returning guest (email verified): gate bypassed, identity bar shown immediately
- Network error: blocking error state shown, Retry button reloads profile GET
