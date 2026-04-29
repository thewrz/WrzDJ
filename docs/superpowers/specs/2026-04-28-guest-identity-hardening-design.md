# Guest Identity Hardening — Design Spec

**Date:** 2026-04-28
**Status:** Approved
**Surfaces affected:**
- Backend: `server/app/services/guest_identity.py`, `server/app/api/public.py` (identify), `server/app/schemas/` (identify response)
- Frontend: `dashboard/lib/use-guest-identity.ts`, `dashboard/app/collect/[code]/page.tsx`, `dashboard/app/join/[code]/page.tsx`, new `EmailRecoveryModal` component
**Surfaces explicitly excluded:** `/e/{code}/display` kiosk (no guest identity at all), DJ login flow, admin endpoints

---

## Problem

Browser fingerprinting (ThumbmarkJS) is producing false positives that cause two physical guests on the same LAN to be merged into a single Guest record. Reported case: Guest 1 on PC registered with one nickname, Guest 2 on a different PC registered with another, Guest 2's phone then loaded the page and inherited Guest 1's identity. This is platform-breaking — guests can read another guest's submissions, votes, and nickname, and cannot complete their own nickname/identity flow because the system has them mis-identified.

Two compounding root causes:

1. **`dashboard/lib/use-guest-identity.ts:35`** excludes both `canvas` and `webgl` from ThumbmarkJS, the two highest-entropy components. Without them, the fingerprint collapses to UA + screen + timezone + language + plugins + fonts. On the same LAN with similar devices, collisions become likely.
2. **`server/app/services/guest_identity.py:168-191`** auto-reconciles ANY new device to an existing Guest if the fingerprint matches AND a hand-rolled User-Agent confidence score reaches `>= 0.7`. The scoring (family + platform + version) is too lax — a phone Safari and a desktop Safari can score 0.8 and silently take over a different user's Guest record. The reconciliation issues a new HttpOnly cookie pointing to the other user's Guest, making the takeover sticky until cookies are cleared.

There is no in-product mechanism for a returning user to deterministically reclaim their identity on a new device. The codebase has the primitives (`/verify/request`, `/verify/confirm`, `merge_guests()`) but they are only surfaced through other UX flows (post-nickname email opt-in), never as a "recover account" entry point.

---

## Architecture

A 4-layer identity model with explicit precedence and fallback:

```
Layer 1 — HttpOnly cookie (wrzdj_guest)         AUTHORITATIVE
  → cookie hit short-circuits all other logic
       ↓ missing?
Layer 2 — Fingerprint reconciliation            HEURISTIC, gated by 5 rules
  → either reconciles + rolls cookie, OR falls through to Layer 3
       ↓ rejected/none?
Layer 3 — New Guest                             DEFAULT SAFE STATE
  → creates Guest, sets cookie, surfaces email-recovery affordance
       ↓ user-initiated
Layer 4 — Email verification merge              AUTHORITATIVE, deterministic
  → merge_guests() consolidates records, rolls cookie
```

**Key invariants:**
- A present-and-valid cookie always wins. No reconciliation path overrides it.
- Verified Guests (have `email_verified_at`) cannot be auto-reconciled. Only cookie or email-claim re-identifies them.
- Ambiguous fingerprint state (multi-match, recent activity, UA mismatch) always falls to "create new Guest." The system fails toward fragmentation, never toward incorrect merge.
- Every reconciliation rejection is logged at WARN level with a reason code for ops visibility.

---

## Backend Changes

### File: `server/app/services/guest_identity.py`

Replace the existing `_compute_confidence` function and reconciliation block with a strict 5-rule gate.

**New module-level constants:**
```python
RECONCILE_QUIET_PERIOD = timedelta(hours=12)
RECONCILE_FRESHNESS_WINDOW = timedelta(days=90)
```

**New `IdentifyResult` fields:**
```python
@dataclass
class IdentifyResult:
    guest_id: int
    action: Literal["create", "cookie_hit", "reconcile"]
    token: str | None
    reconcile_hint: bool       # NEW
    rejection_reason: str | None  # NEW (server-internal, never sent to client)
```

**Rejection reason taxonomy:**

| Reason | Trigger |
|---|---|
| `concurrent_activity` | Rule 4 — matching guest active within 12h |
| `verified_guest` | Rule 5 — matching guest has `email_verified_at IS NOT NULL` |
| `ambiguous_match` | Rule 3 — multiple guests share this fingerprint within freshness window |
| `ua_mismatch` | Rule 2 — UA family/platform/version doesn't match |
| `stale_match` | Match exists but `last_seen_at` older than 90 days (excluded from reconcile pool) |
| `none` | No fingerprint match at all |

**Gate sequence (replaces lines 167-220 of current file):**

```python
# --- LAYER 1: cookie hit (existing behavior, unchanged) ---
# … cookie_hit returns early …

# --- LAYER 2: fingerprint reconciliation (gated) ---
rejection_reason: str | None = None
if fingerprint_hash:
    matches = (
        db.query(Guest)
        .filter(Guest.fingerprint_hash == fingerprint_hash)
        .filter(Guest.last_seen_at > now - RECONCILE_FRESHNESS_WINDOW)
        .all()
    )

    if len(matches) > 1:
        rejection_reason = "ambiguous_match"
    elif len(matches) == 1:
        existing = matches[0]
        if existing.email_verified_at is not None:
            rejection_reason = "verified_guest"
        elif existing.last_seen_at > now - RECONCILE_QUIET_PERIOD:
            rejection_reason = "concurrent_activity"
        elif not _ua_signals_match(existing.user_agent, user_agent):
            rejection_reason = "ua_mismatch"
        else:
            # All gates passed — reconcile
            existing.last_seen_at = now
            existing.user_agent = user_agent
            existing.fingerprint_components = components_json
            new_token = secrets.token_hex(32)
            existing.token = new_token
            db.commit()
            _logger.info("guest.identify action=reconcile guest_id=%s fp=%s",
                         existing.id, short_fp)
            return IdentifyResult(
                guest_id=existing.id, action="reconcile",
                token=new_token, reconcile_hint=False, rejection_reason=None,
            )

        _logger.warning(
            "guest.identify action=reconcile_rejected fp=%s reason=%s existing_guest=%s",
            short_fp, rejection_reason, matches[0].id,
        )

# --- LAYER 3: create new guest ---
# (existing logic, but stamps reconcile_hint = (rejection_reason is not None))
```

**New `_ua_signals_match` (replaces `_compute_confidence`):**

```python
def _ua_signals_match(stored_ua: str | None, submitted_ua: str) -> bool:
    """Strict equality on UA family, platform, and ±1 major version."""
    if not stored_ua:
        return False
    s_family, s_platform, s_version = _parse_ua(stored_ua)
    n_family, n_platform, n_version = _parse_ua(submitted_ua)
    if s_family == "unknown" or n_family == "unknown":
        return False
    if s_family != n_family or s_platform != n_platform:
        return False
    if not s_version or not n_version:
        return False
    try:
        return abs(int(s_version) - int(n_version)) <= 1
    except ValueError:
        return s_version == n_version
```

The old `_compute_confidence` function is deleted.

### File: `server/app/api/public.py` (identify endpoint)

The endpoint at `/api/public/guest/identify` already wraps `identify_guest()`. Add the new `reconcile_hint` field to its response. The internal `rejection_reason` is **never serialized to the client** — leaks information about other guests' state.

### File: `server/app/schemas/guest.py` (or wherever the identify response schema lives)

Add `reconcile_hint: bool = False` to the response model. Field is documented as: *"True when a fingerprint match existed but reconciliation was rejected — frontend may emphasize the email-recovery affordance."*

### File: `server/app/services/email_verification.py` and `server/app/api/verify.py`

**No changes.** The existing flow (`create_verification_code` → `confirm_verification_code` → `merge_guests`) is reused as-is for the recovery path.

### File: `server/app/models/guest.py`

**No changes.** All required columns (`fingerprint_hash`, `last_seen_at`, `email_verified_at`) already exist.

### Migration / data backfill

**None.** Existing corrupted Guest records (multi-user conflations from the bug) are left as-is. Affected users self-recover via the new email-recovery button — verifying their email on the device they're currently on either creates a fresh verified Guest or merges them onto a separate verified record. Reasoning:

1. There is no per-row signal that lets the server deterministically untangle who originally submitted what.
2. The fix is forward-looking — from deploy onward, no new conflations occur.
3. Events are short-lived; conflated state ages out of relevance within days.

---

## Frontend Changes

### File: `dashboard/lib/use-guest-identity.ts`

Three changes:

1. **Remove the entropy-stripping line.** Delete:
   ```ts
   setOption("exclude", ["canvas", "webgl"]);
   ```
   This is the single most important client-side change. It restores fingerprint entropy by an order of magnitude.

2. **Expose `reconcileHint`** in the returned `GuestIdentity` state:
   ```ts
   interface GuestIdentity {
     guestId: number | null;
     isReturning: boolean;
     reconcileHint: boolean;    // NEW
     isLoading: boolean;
     error: string | null;
     refresh: () => Promise<void>;  // NEW
   }
   ```

3. **Add `refresh()`** that clears the module-level `cachedIdentity` and re-fires the identify call. Used by the recovery modal after a successful email verify (especially when `merged: true`, the cookie points to a different Guest now).

### File: `dashboard/components/EmailRecoveryModal.tsx` (NEW)

A thin modal/dialog wrapper around the **existing** `dashboard/components/EmailVerification.tsx` component, which already implements the full email-then-6-digit-code flow with rate-limit handling, expiry timer, and error states.

```tsx
interface Props {
  open: boolean;
  onClose: () => void;
  onRecovered: () => void;
}

export default function EmailRecoveryModal({ open, onClose, onRecovered }: Props) {
  // role="dialog", focus trap, ESC-to-close
  // Renders <EmailVerification isVerified={false} onVerified={handleSuccess} />
  // handleSuccess: toast("Welcome back!"), call onRecovered, close after 1.5s
  // No onSkip — recovery is a deliberate flow, not a coexisting opt-in
}
```

Reusing `EmailVerification.tsx` keeps the actual verification logic in one place. The modal contributes only the dialog chrome, focus trap, and post-success state handling.

### File: `dashboard/components/EmailRecoveryButton.tsx` (NEW)

A small affordance with two visual states driven by `reconcileHint`:

- **Passive (default):** an unobtrusive secondary-style text link, *"Already have an account? Verify email"*
- **Emphasized (`reconcileHint=true`):** a bordered banner with subtle accent color: *"Looks like you might be a returning guest."* with a primary CTA button *"Verify email to recover your account"*, plus secondary text *"Or just continue — your nickname will be saved fresh."*

Click in either state opens `EmailRecoveryModal`.

### File: `dashboard/app/collect/[code]/page.tsx`

Place `EmailRecoveryButton` above the existing `FeatureOptInPanel`, sibling to the event header. Wire `reconcileHint` from `useGuestIdentity`. On modal `onRecovered`:
1. Call `identity.refresh()` to invalidate the cached identity and re-resolve via the cookie (which now points to the merged Guest).
2. Refetch the collect profile (`GET /api/public/collect/{code}/profile`) — its result is keyed via cookie, so the new identity is picked up automatically.
3. Refetch "my picks" (`GET /api/public/collect/{code}/profile/me`) — same reason.

### File: `dashboard/app/join/[code]/page.tsx`

Place `EmailRecoveryButton` inside the request-form header, top-right of the card. Inline (rather than full-width) emphasized banner styling — the join page is denser. On modal `onRecovered`:
1. Call `identity.refresh()`.
2. Refetch any guest-scoped panels currently mounted (existing requests list keyed on guest_id).

### Modal flow detail

```
Step 1: Email entry
  Input: type=email, inputmode=email, autocomplete=email
  Submit → POST /api/public/guest/verify/request
  → 200: advance to step 2
  → 422: "Email verification temporarily unavailable" (system error)
  → 429: "Too many attempts — try again in a minute"

Step 2: Code entry
  Input: 6 separate digit fields, inputmode=numeric, autocomplete=one-time-code
  Submit → POST /api/public/guest/verify/confirm
  → 200 with merged=true: toast "Welcome back, <nickname>!"; refresh; close
  → 200 with merged=false: toast "Email verified."; refresh; close
  → 400 (invalid code): inline error, retry allowed (max 3 attempts, then "Send new code" reverts to step 1)
  → 400 (expired code): inline error, "Send new code" reverts to step 1
  → 429: "Too many attempts" briefly disable form
```

### Race conditions / edge cases

| Scenario | Handling |
|---|---|
| User submits email but loses connection | Modal stays in code-entry; "Resend" re-fires `/verify/request` |
| User enters wrong code 3 times | Backend `CodeInvalidError` "Too many failed attempts"; modal shows message; "Send new code" reverts |
| User verifies an email already on this device | Backend treats as no-op; modal toasts "Email confirmed." |
| User abandons modal mid-flow | Modal closes; partial state discarded |
| Multiple browser tabs | Each tab has its own modal state; post-merge cookie is shared via browser cookie store; tabs that re-fetch see new identity |
| Phone scans QR while logged into a different guest's email | Verify on phone → merge fires → cookie rolls → phone correctly identified as email owner |

---

## Testing Strategy

### Backend unit tests — `server/tests/test_guest_identity.py`

Updated/added tests:

- `test_cookie_hit_bypasses_reconciliation`
- `test_cookie_hit_records_fp_drift`
- `test_create_when_no_fp_match`
- `test_create_when_ua_mismatch_phone_vs_pc`
- `test_create_when_concurrent_activity_5min`
- `test_create_when_concurrent_activity_11h_boundary`
- `test_reconcile_when_quiet_period_passed_13h`
- `test_create_when_verified_guest`
- `test_create_when_ambiguous_match`
- `test_stale_match_excluded_from_reconcile_pool`
- `test_concurrent_identify_calls_create_two_guests`
- `test_ua_signals_match_strict` (parametrized)
- `test_rejected_reconcile_logged_with_reason`

Existing tests against `_compute_confidence` are deleted (function is removed).

### Backend API tests

- `server/tests/test_public_identify.py`: `test_identify_response_includes_reconcile_hint`, `test_identify_does_not_leak_rejection_reason_to_client`
- `server/tests/test_verify.py`: `test_confirm_after_rule4_rejection_merges_correctly` (full lifecycle)

### Frontend unit tests

- `dashboard/components/__tests__/EmailRecoveryButton.test.tsx`: passive vs emphasized rendering, modal-open on click
- `dashboard/components/__tests__/EmailRecoveryModal.test.tsx`: success path, cancel, focus trap behavior, ESC closes (most flow logic is already covered by the existing `EmailVerification.test.tsx`, so this file focuses on the modal-specific behavior)
- `dashboard/lib/__tests__/use-guest-identity.test.ts`: `refresh()` clears cache and re-fetches; `reconcileHint` exposed; concurrent mounts only fire one identify call

### E2E (Playwright)

`dashboard/e2e/05-guest-identity-recovery.spec.ts`:
- Full recovery flow on `/collect/{code}` (mock email send, intercept code retrieval)
- Banner emphasized when `reconcile_hint=true` (pre-seed Guest with same FP)
- Banner passive when no FP match

### Manual testing checklist (PR description)

```
[ ] Two physical devices on same LAN, fresh cookies → distinct guest_id
[ ] Same device cookie cleared, 13+h later → reconciles correctly
[ ] Same device cookie cleared, <12h later → new guest_id (expected)
[ ] Verified guest clears cookies → new guest, banner emphasized, recovery via email works
[ ] Banner copy + button copy renders correctly on small mobile (<400px width)
[ ] Modal a11y: ESC closes, focus trap holds, screen reader announces step transitions
[ ] iOS auto-fill picks up the verification code from email
[ ] Both /collect/{code} and /join/{code} show the button
```

### Security regression

Add `~/wrzdj-testing/11-guest-identity.sh`:
- Cannot pass another guest's `guest_id` in body to bypass identification
- Cannot replay an old token after merge has rolled it
- `reconcile_hint` value is not user-influenceable (server-derived only)
- Rate limit on `/verify/request` (10/min) actually fires
- Used codes can't be re-confirmed

---

## Observability

**Server log events (already exist or added):**

| Event | Level | Fields |
|---|---|---|
| `cookie_hit` | INFO | `guest_id`, `fp` |
| `reconcile` | INFO | `guest_id`, `fp` |
| `reconcile_rejected` | WARN | `fp`, `reason`, `existing_guest` |
| `create` | INFO | `guest_id`, `fp`, `hint`, `reason` |
| `fp_drift` | WARN | `guest_id`, `old_fp`, `new_fp` |

**Watch lists (post-deploy):**

- Sustained `reconcile_rejected reason=ambiguous_match` rate > baseline → fingerprint entropy degraded; investigate
- `reconcile_rejected reason=verified_guest` rate → indicates verified users hitting Rule 5 (cookie loss + recovery prompt)
- `reconcile_rejected reason=concurrent_activity` rate during events → Rule 4 firing as designed for similar devices in same room

**Activity log (`services/activity_log.py`):** No new entries. Identify-events are not user-facing — server logs are the right channel.

---

## Deployment

### Two-PR rollout

**PR 1 — Backend hardening.** Ship the rule rewrite + schema change + tests. Observe production logs for 24–48 h to confirm rejections fire as expected and no regression in cookie-hit / new-guest flows.

**PR 2 — Frontend recovery flow.** Ship the modal + button + `useGuestIdentity` changes + e2e tests once PR 1 is stable.

### No migration, no env vars, no nginx changes

This is purely application-layer code. The Guest model has all required columns. No new external services. No CSP changes.

### Backwards compatibility

- Old frontends (cached) continue working — `reconcile_hint` is additive in the response.
- Old backends (during deploy interleave) — frontend treats missing `reconcile_hint` as `false`.

### Rollback

`git revert` and redeploy. No data migrations to undo. Existing Guest rows untouched by either PR.

### Tunable knobs (code-level)

| Constant | File | Default | Tune if... |
|---|---|---|---|
| `RECONCILE_QUIET_PERIOD` | `guest_identity.py` | 12h | Legitimate cross-event returns being Rule-4 rejected |
| `RECONCILE_FRESHNESS_WINDOW` | `guest_identity.py` | 90d | Users complain returning guests forgotten |
| Banner emphasis copy | `EmailRecoveryButton.tsx` | "Looks like you might be a returning guest" | A/B testing reveals friction or confusion |

---

## Out of Scope

| Item | Why excluded |
|---|---|
| Automatic cleanup of historical conflated Guest records | Cannot deterministically untangle without per-row signal; users self-recover via email button |
| localStorage-based persistent UUID as a stronger identity layer | Adds a 4th identity layer; marginal benefit over the 5 rules; defer |
| Email-required gate on high-value actions (vote-stuffing protection) | Separate feature with its own UX; future spec |
| Per-event customizable reconciliation policy | Premature abstraction; data first |
| Admin tool to manually unmerge two Guests | Reasonable follow-up if support requests come in |
| Push notification when verified guest hits Rule 5 path | Deferred until Rule-5 rejection rate is observed |
| Replacing ThumbmarkJS | Library is fine; bug was misuse + over-trusting threshold |

---

## Risks Accepted

1. **Within-session cookie clear penalizes legitimate users.** A user who clears cookies mid-event gets a new guest_id and resets their submission cap. Mitigation: rare behavior; recovery available via email button.
2. **13+ hour gap between identical-device users still cross-merges (unverified guests only).** A returning anonymous guest with no email could be inherited by a different identical device the next day. Bounded blast radius — no email, single nickname, single event.
3. **The 12-hour and 90-day windows are heuristic.** Tuned for typical event cadence, not measured against real data. First weeks of production logs should validate or motivate adjustment.
4. **ThumbmarkJS could regress upstream.** Pin version exactly in `dashboard/package.json`; review changelogs on bumps.
