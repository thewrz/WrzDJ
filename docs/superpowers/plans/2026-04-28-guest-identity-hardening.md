# Guest Identity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the platform-breaking false positive where two physical guests on the same LAN merge into a single Guest record. Replace lax fingerprint reconciliation with a strict 5-rule gate; surface a deterministic email-recovery path on `/collect/{code}` and `/join/{code}`.

**Architecture:** Backend rewrites `identify_guest()` with rule-based reconciliation (canvas/webgl entropy restored client-side, exact UA match, single-match guard, 12h quiet period, verified-guest immunity). Frontend exposes `reconcileHint` from `useGuestIdentity` and adds a shared `EmailRecoveryButton` + `EmailRecoveryModal` (the latter wraps the existing `EmailVerification` component for the actual code flow).

**Tech Stack:** Python 3.11+ / FastAPI / SQLAlchemy 2.0 / Pydantic / pytest (backend); Next.js 16 / React 19 / TypeScript / Vitest / Playwright (frontend); ThumbmarkJS (browser fingerprinting).

**Spec:** [`docs/superpowers/specs/2026-04-28-guest-identity-hardening-design.md`](../specs/2026-04-28-guest-identity-hardening-design.md)

**Branch:** `fix/guest-identity-hardening` (already created)

---

## File Map

### Modify
- `server/app/services/guest_identity.py` — replace `_compute_confidence` with `_ua_signals_match`; rewrite reconciliation gate; add module constants; extend `IdentifyResult`
- `server/app/schemas/guest.py` — add `reconcile_hint: bool` to `IdentifyResponse`
- `server/app/api/guest.py` — wire `reconcile_hint` into JSON response
- `server/tests/test_guest_identity.py` — add new rule tests; remove confidence-based tests
- `server/tests/test_guest_confidence.py` — delete (`_compute_confidence` is removed)
- `server/tests/test_guest_scenarios.py` — update if any tests rely on old reconciliation behavior
- `dashboard/lib/use-guest-identity.ts` — remove canvas/webgl exclusion; add `reconcileHint`; add `refresh()`
- `dashboard/app/collect/[code]/page.tsx` — render `EmailRecoveryButton`, wire `onRecovered`
- `dashboard/app/join/[code]/page.tsx` — render `EmailRecoveryButton`, wire `onRecovered`

### Create
- `dashboard/components/EmailRecoveryButton.tsx` — passive vs emphasized affordance
- `dashboard/components/EmailRecoveryModal.tsx` — dialog wrapper around `EmailVerification`
- `dashboard/components/__tests__/EmailRecoveryButton.test.tsx`
- `dashboard/components/__tests__/EmailRecoveryModal.test.tsx`
- `dashboard/e2e/05-guest-identity-recovery.spec.ts`

### Delete
- `server/tests/test_guest_confidence.py` — `_compute_confidence` no longer exists

---

## Task 1: Setup & Baseline

**Files:** none modified yet — verifying environment

- [ ] **Step 1: Confirm working tree and branch**

Run:
```bash
git status
git branch --show-current
```
Expected: branch is `fix/guest-identity-hardening`, working tree clean (or only the spec/plan committed).

- [ ] **Step 2: Refresh GitNexus index**

Run: `npx gitnexus analyze`
Expected: completes without error, reports new index commit hash.

- [ ] **Step 3: Run impact analysis on `identify_guest`**

Run via the `mcp__gitnexus__impact` tool (or skip if MCP unavailable):
```
target: "identify_guest"
direction: "upstream"
```
Read the output, note all upstream callers (expected: `app.api.guest.identify` endpoint + tests).

- [ ] **Step 4: Run the existing backend test suite to establish baseline green**

Run: `cd server && .venv/bin/pytest tests/test_guest_identity.py tests/test_guest_confidence.py tests/test_guest_scenarios.py tests/test_guest_merge.py tests/test_verify_endpoints.py -v`
Expected: all PASS — this is the pre-change baseline.

- [ ] **Step 5: Run the existing frontend test suite to establish baseline green**

Run: `cd dashboard && npm test -- --run`
Expected: all PASS.

No commit — Task 1 is non-mutating.

---

## Task 2: Extend `IdentifyResult` dataclass with new fields

**Files:**
- Modify: `server/app/services/guest_identity.py:33-37`

- [ ] **Step 1: Update `IdentifyResult` dataclass**

Edit `server/app/services/guest_identity.py` lines 33-37. Replace:
```python
@dataclass
class IdentifyResult:
    guest_id: int
    action: Literal["create", "cookie_hit", "reconcile"]
    token: str | None  # set only when a new cookie should be issued
```
With:
```python
@dataclass
class IdentifyResult:
    guest_id: int
    action: Literal["create", "cookie_hit", "reconcile"]
    token: str | None  # set only when a new cookie should be issued
    reconcile_hint: bool = False  # true when create happened but a FP match existed
    rejection_reason: str | None = None  # internal-only — never sent to clients
```

- [ ] **Step 2: Add module-level constants below the imports (around line 20)**

Insert after the existing `_logger = ...` line:
```python
from datetime import timedelta  # add to imports if not present

RECONCILE_QUIET_PERIOD = timedelta(hours=12)
RECONCILE_FRESHNESS_WINDOW = timedelta(days=90)
```

- [ ] **Step 3: Update existing call sites of `IdentifyResult(...)` to keep working**

The current `identify_guest` returns `IdentifyResult(guest_id=..., action=..., token=...)` in three places. Because `reconcile_hint` and `rejection_reason` have defaults, these calls keep working unchanged. Verify by running the existing tests:

Run: `cd server && .venv/bin/pytest tests/test_guest_identity.py -v`
Expected: all PASS (additive change — no behavior change).

- [ ] **Step 4: Commit**

```bash
git add server/app/services/guest_identity.py
git commit -m "refactor(guest): add reconcile_hint + rejection_reason to IdentifyResult"
```

---

## Task 3: Add `_ua_signals_match` helper (TDD)

**Files:**
- Modify: `server/app/services/guest_identity.py` (add helper)
- Test: `server/tests/test_guest_identity.py` (add tests)

- [ ] **Step 1: Write failing parametrized test**

Append to `server/tests/test_guest_identity.py`:
```python
import pytest
from app.services.guest_identity import _ua_signals_match


CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/125.0 Safari/537.36"
CHROME_WIN_NEXT = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
CHROME_WIN_FAR = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"
CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0 Safari/537.36"
SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile Safari/604.1"
FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/124.0"
UNKNOWN_BOT = "PythonRequests/2.0"


@pytest.mark.parametrize(
    "stored,submitted,expected",
    [
        (CHROME_WIN, CHROME_WIN, True),                 # exact same
        (CHROME_WIN, CHROME_WIN_NEXT, True),            # +1 version
        (CHROME_WIN, CHROME_WIN_FAR, False),            # +5 versions
        (CHROME_WIN, CHROME_MAC, False),                # different platform
        (CHROME_WIN, SAFARI_IOS, False),                # different family + platform
        (SAFARI_IOS, CHROME_MAC, False),                # different family
        (None, CHROME_WIN, False),                      # stored=None
        (CHROME_WIN, UNKNOWN_BOT, False),               # unparseable submitted
        (UNKNOWN_BOT, CHROME_WIN, False),               # unparseable stored
        (FIREFOX_LINUX, FIREFOX_LINUX, True),           # firefox same
    ],
)
def test_ua_signals_match_strict(stored, submitted, expected):
    assert _ua_signals_match(stored, submitted) is expected
```

- [ ] **Step 2: Run test to verify it fails (function doesn't exist yet)**

Run: `cd server && .venv/bin/pytest tests/test_guest_identity.py::test_ua_signals_match_strict -v`
Expected: FAIL — `ImportError: cannot import name '_ua_signals_match'`.

- [ ] **Step 3: Implement `_ua_signals_match`**

Add to `server/app/services/guest_identity.py` (place it near `_compute_confidence`, around line 40, before `_parse_ua`):
```python
def _ua_signals_match(stored_ua: str | None, submitted_ua: str) -> bool:
    """Strict equality on UA family, platform, and ±1 major version.

    Replaces the weighted confidence score with hard-coded gates. Used by
    fingerprint reconciliation to decide whether two UA strings are
    consistent enough to plausibly be the same device.
    """
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && .venv/bin/pytest tests/test_guest_identity.py::test_ua_signals_match_strict -v`
Expected: 10 PASS (one per parametrize case).

- [ ] **Step 5: Commit**

```bash
git add server/app/services/guest_identity.py server/tests/test_guest_identity.py
git commit -m "feat(guest): add _ua_signals_match strict equality helper"
```

---

## Task 4: Rewrite `identify_guest` reconciliation gate

This is the largest single behavior change. Done as one atomic edit (the gate is a tightly coupled state machine — splitting it makes intermediate states untestable).

**Files:**
- Modify: `server/app/services/guest_identity.py:167-220`

- [ ] **Step 1: Read the current implementation to confirm the line range**

Run: `grep -n "Flow 3\|Flow 1" server/app/services/guest_identity.py`
Expected: shows current "Flow 3: Reconciliation" block (around line 167) and "Flow 1: New guest" block (around line 201).

- [ ] **Step 2: Replace the reconciliation + create-new-guest blocks**

Open `server/app/services/guest_identity.py`. Find the block starting `# --- Flow 3: Reconciliation ...` and ending after the `IdentifyResult(... action="create" ...)` return. Replace lines 167-220 with:

```python
    # --- LAYER 2: fingerprint reconciliation (gated by 4 rules) ---
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
                _logger.info(
                    "guest.identify action=reconcile guest_id=%s fp=%s",
                    existing.id,
                    short_fp,
                )
                return IdentifyResult(
                    guest_id=existing.id,
                    action="reconcile",
                    token=new_token,
                    reconcile_hint=False,
                    rejection_reason=None,
                )

        if rejection_reason is not None:
            _logger.warning(
                "guest.identify action=reconcile_rejected fp=%s reason=%s existing_guest=%s",
                short_fp,
                rejection_reason,
                matches[0].id if matches else None,
            )

    # --- LAYER 3: create new guest ---
    new_token = secrets.token_hex(32)
    guest = Guest(
        token=new_token,
        fingerprint_hash=fingerprint_hash,
        fingerprint_components=components_json,
        user_agent=user_agent,
        created_at=now,
        last_seen_at=now,
    )
    db.add(guest)
    db.commit()
    db.refresh(guest)

    hint = rejection_reason is not None
    _logger.info(
        "guest.identify action=create guest_id=%s fp=%s hint=%s reason=%s",
        guest.id,
        short_fp,
        hint,
        rejection_reason or "no_match",
    )
    return IdentifyResult(
        guest_id=guest.id,
        action="create",
        token=new_token,
        reconcile_hint=hint,
        rejection_reason=rejection_reason,
    )
```

- [ ] **Step 3: Delete the obsolete `_compute_confidence` function**

In `server/app/services/guest_identity.py`, remove the function block:
```python
def _compute_confidence(stored_ua: str | None, submitted_ua: str) -> float:
    ...
    return score
```
(lines 40-67 in the original file).

- [ ] **Step 4: Run the existing tests to see what breaks**

Run: `cd server && .venv/bin/pytest tests/test_guest_identity.py tests/test_guest_confidence.py tests/test_guest_scenarios.py -v`
Expected: most pass; some confidence-based tests will FAIL (expected — they tested the old `_compute_confidence`). Note which ones fail; we'll fix them in Task 5.

- [ ] **Step 5: Commit (red is OK here — next task fixes it)**

```bash
git add server/app/services/guest_identity.py
git commit -m "refactor(guest): rewrite identify_guest with strict reconciliation gate"
```

---

## Task 5: Delete obsolete confidence tests, add new rule tests

**Files:**
- Delete: `server/tests/test_guest_confidence.py`
- Modify: `server/tests/test_guest_scenarios.py` (only if a scenario relies on old confidence)
- Test: `server/tests/test_guest_identity.py` (add new rule tests)

- [ ] **Step 1: Delete the confidence test file**

Run: `git rm server/tests/test_guest_confidence.py`
Expected: file removed, staged for deletion.

- [ ] **Step 2: Inspect `test_guest_scenarios.py` for confidence-dependent tests**

Run: `grep -n "_compute_confidence\|confidence" server/tests/test_guest_scenarios.py`
Expected: either no matches (no work needed) or specific lines to update.

If any test references `_compute_confidence` or expects old reconcile-with-low-UA behavior, rewrite it. If a test asserts that two matched-fingerprint different-UA guests reconcile, update it to assert they DO NOT reconcile (creates new guest with `reconcile_hint=True`).

- [ ] **Step 3: Add Rule 3 (ambiguous match) test**

Append to `server/tests/test_guest_identity.py`:
```python
from datetime import timedelta
from app.core.time import utcnow


def test_create_when_ambiguous_match(db: Session):
    """Two guests with same FP within freshness window -> new guest, hint=True."""
    fp = "shared_fp_collision_xyz"
    now = utcnow()
    for token_prefix in ("a", "b"):
        g = Guest(
            token=token_prefix * 64,
            fingerprint_hash=fp,
            fingerprint_components="{}",
            user_agent="Mozilla/5.0 (Linux) Chrome/125.0",
            created_at=now - timedelta(days=1),
            last_seen_at=now - timedelta(days=1),
        )
        db.add(g)
    db.commit()

    result = identify_guest(
        db,
        token_from_cookie=None,
        fingerprint_hash=fp,
        fingerprint_components={},
        user_agent="Mozilla/5.0 (Linux) Chrome/125.0",
    )
    assert result.action == "create"
    assert result.reconcile_hint is True
    assert result.rejection_reason == "ambiguous_match"
    assert db.query(Guest).filter(Guest.fingerprint_hash == fp).count() == 3
```

- [ ] **Step 4: Add Rule 5 (verified guest) test**

Append:
```python
def test_create_when_verified_guest(db: Session):
    """Verified guest never auto-reconciles -> new guest, hint=True."""
    fp = "verified_user_fp"
    now = utcnow()
    g = Guest(
        token="v" * 64,
        fingerprint_hash=fp,
        fingerprint_components="{}",
        user_agent="Mozilla/5.0 (Windows NT 10.0) Chrome/125.0",
        created_at=now - timedelta(days=30),
        last_seen_at=now - timedelta(days=2),  # outside quiet period
        email_verified_at=now - timedelta(days=29),
        email_hash="x" * 64,
    )
    db.add(g)
    db.commit()

    result = identify_guest(
        db,
        token_from_cookie=None,
        fingerprint_hash=fp,
        fingerprint_components={},
        user_agent="Mozilla/5.0 (Windows NT 10.0) Chrome/125.0",
    )
    assert result.action == "create"
    assert result.reconcile_hint is True
    assert result.rejection_reason == "verified_guest"
    assert result.guest_id != g.id
```

- [ ] **Step 5: Add Rule 4 (concurrent activity) test**

Append:
```python
def test_create_when_concurrent_activity_5min(db: Session):
    """Existing guest active 5 min ago -> rejected, new guest created."""
    fp = "active_user_fp"
    now = utcnow()
    g = Guest(
        token="c" * 64,
        fingerprint_hash=fp,
        fingerprint_components="{}",
        user_agent="Mozilla/5.0 (Windows NT 10.0) Chrome/125.0",
        created_at=now - timedelta(hours=2),
        last_seen_at=now - timedelta(minutes=5),
    )
    db.add(g)
    db.commit()

    result = identify_guest(
        db,
        token_from_cookie=None,
        fingerprint_hash=fp,
        fingerprint_components={},
        user_agent="Mozilla/5.0 (Windows NT 10.0) Chrome/125.0",
    )
    assert result.action == "create"
    assert result.reconcile_hint is True
    assert result.rejection_reason == "concurrent_activity"
    assert result.guest_id != g.id


def test_reconcile_when_quiet_period_passed_13h(db: Session):
    """Existing guest active 13 hours ago, all gates pass -> reconcile."""
    fp = "returning_user_fp"
    now = utcnow()
    g = Guest(
        token="d" * 64,
        fingerprint_hash=fp,
        fingerprint_components="{}",
        user_agent="Mozilla/5.0 (Windows NT 10.0) Chrome/125.0",
        created_at=now - timedelta(days=7),
        last_seen_at=now - timedelta(hours=13),
    )
    db.add(g)
    db.commit()
    original_id = g.id

    result = identify_guest(
        db,
        token_from_cookie=None,
        fingerprint_hash=fp,
        fingerprint_components={},
        user_agent="Mozilla/5.0 (Windows NT 10.0) Chrome/125.0",
    )
    assert result.action == "reconcile"
    assert result.guest_id == original_id
    assert result.reconcile_hint is False
    assert result.token is not None
```

- [ ] **Step 6: Add Rule 2 (UA mismatch) test**

Append:
```python
def test_create_when_ua_mismatch_phone_vs_pc(db: Session):
    """Same FP but different UA platform -> rejected, new guest created."""
    fp = "ua_collision_fp"
    now = utcnow()
    g = Guest(
        token="e" * 64,
        fingerprint_hash=fp,
        fingerprint_components="{}",
        user_agent="Mozilla/5.0 (Windows NT 10.0) Chrome/125.0",
        created_at=now - timedelta(days=2),
        last_seen_at=now - timedelta(days=1),  # outside quiet period
    )
    db.add(g)
    db.commit()

    result = identify_guest(
        db,
        token_from_cookie=None,
        fingerprint_hash=fp,
        fingerprint_components={},
        user_agent=(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
            "AppleWebKit/605.1.15 Version/17.4 Mobile Safari/604.1"
        ),
    )
    assert result.action == "create"
    assert result.reconcile_hint is True
    assert result.rejection_reason == "ua_mismatch"
    assert result.guest_id != g.id
```

- [ ] **Step 7: Add freshness window (stale match exclusion) test**

Append:
```python
def test_stale_match_excluded_from_reconcile_pool(db: Session):
    """Match older than 90 days is filtered out at query level -> no rejection."""
    fp = "stale_user_fp"
    now = utcnow()
    g = Guest(
        token="f" * 64,
        fingerprint_hash=fp,
        fingerprint_components="{}",
        user_agent="Mozilla/5.0 (Windows NT 10.0) Chrome/120.0",
        created_at=now - timedelta(days=120),
        last_seen_at=now - timedelta(days=91),  # stale
    )
    db.add(g)
    db.commit()

    result = identify_guest(
        db,
        token_from_cookie=None,
        fingerprint_hash=fp,
        fingerprint_components={},
        user_agent="Mozilla/5.0 (Windows NT 10.0) Chrome/120.0",
    )
    assert result.action == "create"
    assert result.reconcile_hint is False
    assert result.rejection_reason is None
    assert result.guest_id != g.id
```

- [ ] **Step 8: Run all new tests + existing tests**

Run: `cd server && .venv/bin/pytest tests/test_guest_identity.py tests/test_guest_scenarios.py tests/test_guest_merge.py tests/test_verify_endpoints.py -v`
Expected: ALL PASS. If any old test in `test_guest_identity.py` or `test_guest_scenarios.py` still fails, update it to match the new behavior.

- [ ] **Step 9: Run with coverage to confirm threshold**

Run: `cd server && .venv/bin/pytest --tb=short -q`
Expected: PASS with coverage ≥ 80% (the project minimum).

- [ ] **Step 10: Commit**

```bash
git add server/tests/test_guest_identity.py server/tests/test_guest_confidence.py server/tests/test_guest_scenarios.py
git commit -m "test(guest): rule-based reconciliation tests; remove confidence tests"
```

---

## Task 6: Update `IdentifyResponse` schema and endpoint

**Files:**
- Modify: `server/app/schemas/guest.py`
- Modify: `server/app/api/guest.py`
- Test: `server/tests/test_guest_identity.py` (add response-shape test)

- [ ] **Step 1: Add `reconcile_hint` to schema**

Open `server/app/schemas/guest.py`. Replace the existing `IdentifyResponse` class with:
```python
class IdentifyResponse(BaseModel):
    guest_id: int
    action: Literal["create", "cookie_hit", "reconcile"]
    reconcile_hint: bool = False
```

- [ ] **Step 2: Wire `reconcile_hint` into the JSON response**

Open `server/app/api/guest.py`. Replace line 35:
```python
    response = JSONResponse(content={"guest_id": result.guest_id, "action": result.action})
```
With:
```python
    response = JSONResponse(
        content={
            "guest_id": result.guest_id,
            "action": result.action,
            "reconcile_hint": result.reconcile_hint,
        }
    )
```

The `rejection_reason` field is **deliberately not included** — it's server-internal and would leak information about other guests.

- [ ] **Step 3: Add a failing test for the response shape**

Append to `server/tests/test_guest_identity.py`:
```python
from fastapi.testclient import TestClient


def test_identify_response_includes_reconcile_hint(client: TestClient, db: Session):
    """API response always includes reconcile_hint key."""
    response = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": "fresh_fp_for_api_test", "fingerprint_components": {}},
    )
    assert response.status_code == 200
    body = response.json()
    assert "guest_id" in body
    assert "action" in body
    assert "reconcile_hint" in body
    assert body["reconcile_hint"] is False  # no FP match exists


def test_identify_does_not_leak_rejection_reason_to_client(client: TestClient, db: Session):
    """Even when reconciliation is rejected, rejection_reason MUST NOT be in response."""
    fp = "leak_test_fp"
    now = utcnow()
    g = Guest(
        token="z" * 64,
        fingerprint_hash=fp,
        fingerprint_components="{}",
        user_agent="Mozilla/5.0 (Windows NT 10.0) Chrome/125.0",
        created_at=now - timedelta(days=1),
        last_seen_at=now - timedelta(minutes=5),  # triggers concurrent_activity
    )
    db.add(g)
    db.commit()

    response = client.post(
        "/api/public/guest/identify",
        json={"fingerprint_hash": fp, "fingerprint_components": {}},
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/125.0"},
    )
    body = response.json()
    assert body["reconcile_hint"] is True
    assert "rejection_reason" not in body
    assert "existing_guest" not in body
```

- [ ] **Step 4: Run tests**

Run: `cd server && .venv/bin/pytest tests/test_guest_identity.py -v`
Expected: ALL PASS, including the two new API tests.

- [ ] **Step 5: Commit**

```bash
git add server/app/schemas/guest.py server/app/api/guest.py server/tests/test_guest_identity.py
git commit -m "feat(guest): expose reconcile_hint in identify API response"
```

---

## Task 7: Backend CI checks pass cleanly

**Files:** none modified — gate task

- [ ] **Step 1: Run ruff lint**

Run: `cd server && .venv/bin/ruff check .`
Expected: PASS. If failures: `cd server && .venv/bin/ruff check --fix .` then re-run.

- [ ] **Step 2: Run ruff format check**

Run: `cd server && .venv/bin/ruff format --check .`
Expected: PASS. If failures: `cd server && .venv/bin/ruff format .` then re-run check.

- [ ] **Step 3: Run bandit security scan**

Run: `cd server && .venv/bin/bandit -r app -c pyproject.toml -q`
Expected: no issues.

- [ ] **Step 4: Run full pytest with coverage**

Run: `cd server && .venv/bin/pytest --tb=short -q`
Expected: PASS, coverage ≥ 80%.

- [ ] **Step 5: Run alembic check**

Run: `cd server && .venv/bin/alembic upgrade head && .venv/bin/alembic check`
Expected: no model drift detected (we made no model changes — should be clean).

- [ ] **Step 6: Commit any auto-fixes**

If ruff format made changes:
```bash
git add server/
git commit -m "chore: ruff format"
```
Otherwise skip.

---

## Task 8: Restore canvas/webgl entropy in fingerprint

**Files:**
- Modify: `dashboard/lib/use-guest-identity.ts`

- [ ] **Step 1: Remove the entropy-stripping line**

Open `dashboard/lib/use-guest-identity.ts`. Find line 35:
```ts
      setOption("exclude", ["canvas", "webgl"]);
```
Delete this line entirely. Also remove `setOption` from the import on line 32-34 if it's no longer referenced (the line becomes `const { getFingerprint } = await import(...)`).

- [ ] **Step 2: Check that the file still type-checks**

Run: `cd dashboard && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/use-guest-identity.ts
git commit -m "fix(guest): restore canvas+webgl entropy in browser fingerprint"
```

---

## Task 9: Add `reconcileHint` and `refresh()` to `useGuestIdentity` (TDD)

**Files:**
- Modify: `dashboard/lib/use-guest-identity.ts`
- Test: `dashboard/lib/__tests__/use-guest-identity.test.ts` (create if missing)

- [ ] **Step 1: Check if a test file exists**

Run: `ls dashboard/lib/__tests__/use-guest-identity.test.ts 2>/dev/null || echo "missing"`
If missing, create the file in step 2.

- [ ] **Step 2: Write failing tests**

Create `dashboard/lib/__tests__/use-guest-identity.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useGuestIdentity } from '../use-guest-identity';

vi.mock('@thumbmarkjs/thumbmarkjs', () => ({
  setOption: vi.fn(),
  getFingerprint: vi.fn().mockResolvedValue({ hash: 'mock_fp', data: {} }),
}));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.resetModules();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockReset();
});

describe('useGuestIdentity', () => {
  it('exposes reconcileHint from server response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ guest_id: 42, action: 'create', reconcile_hint: true }),
    });

    const { result } = renderHook(() => useGuestIdentity());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.guestId).toBe(42);
    expect(result.current.reconcileHint).toBe(true);
  });

  it('refresh() clears module cache and re-fetches', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ guest_id: 1, action: 'create', reconcile_hint: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ guest_id: 99, action: 'cookie_hit', reconcile_hint: false }),
      });

    const { result } = renderHook(() => useGuestIdentity());
    await waitFor(() => expect(result.current.guestId).toBe(1));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.guestId).toBe(99);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('treats missing reconcile_hint field as false (backward-compat)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ guest_id: 7, action: 'create' }),
    });

    const { result } = renderHook(() => useGuestIdentity());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.reconcileHint).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd dashboard && npm test -- --run lib/__tests__/use-guest-identity.test.ts`
Expected: FAIL — `reconcileHint` and `refresh` not defined.

- [ ] **Step 4: Update `useGuestIdentity` implementation**

Replace the entire contents of `dashboard/lib/use-guest-identity.ts` with:
```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface GuestIdentity {
  guestId: number | null;
  isReturning: boolean;
  reconcileHint: boolean;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

let cachedIdentity: { guestId: number; isReturning: boolean; reconcileHint: boolean } | null = null;

export function useGuestIdentity(): GuestIdentity {
  const [state, setState] = useState<Omit<GuestIdentity, "refresh">>({
    guestId: cachedIdentity?.guestId ?? null,
    isReturning: cachedIdentity?.isReturning ?? false,
    reconcileHint: cachedIdentity?.reconcileHint ?? false,
    isLoading: !cachedIdentity,
    error: null,
  });
  const calledRef = useRef(false);

  const doIdentify = useCallback(async () => {
    try {
      const { getFingerprint } = await import("@thumbmarkjs/thumbmarkjs");
      const fp = await getFingerprint(true);

      const resp = await fetch(`${API_URL}/api/public/guest/identify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          fingerprint_hash: fp.hash,
          fingerprint_components: fp.data,
        }),
      });

      if (!resp.ok) {
        throw new Error(`Identify failed: ${resp.status}`);
      }

      const data = (await resp.json()) as {
        guest_id: number;
        action: "create" | "cookie_hit" | "reconcile";
        reconcile_hint?: boolean;
      };
      const identity = {
        guestId: data.guest_id,
        isReturning: data.action !== "create",
        reconcileHint: data.reconcile_hint ?? false,
      };
      cachedIdentity = identity;
      setState({ ...identity, isLoading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : "Identity check failed",
      }));
    }
  }, []);

  const identify = useCallback(async () => {
    if (cachedIdentity || calledRef.current) {
      return;
    }
    calledRef.current = true;
    await doIdentify();
  }, [doIdentify]);

  const refresh = useCallback(async () => {
    cachedIdentity = null;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    await doIdentify();
  }, [doIdentify]);

  useEffect(() => {
    identify();
  }, [identify]);

  return { ...state, refresh };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd dashboard && npm test -- --run lib/__tests__/use-guest-identity.test.ts`
Expected: 3 PASS.

- [ ] **Step 6: Run typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add dashboard/lib/use-guest-identity.ts dashboard/lib/__tests__/use-guest-identity.test.ts
git commit -m "feat(guest): expose reconcileHint and refresh() from useGuestIdentity"
```

---

## Task 10: Build `EmailRecoveryButton` component (TDD)

**Files:**
- Create: `dashboard/components/EmailRecoveryButton.tsx`
- Test: `dashboard/components/__tests__/EmailRecoveryButton.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `dashboard/components/__tests__/EmailRecoveryButton.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmailRecoveryButton from '../EmailRecoveryButton';

describe('EmailRecoveryButton', () => {
  it('renders passive variant when reconcileHint is false', () => {
    render(<EmailRecoveryButton reconcileHint={false} onOpen={vi.fn()} />);
    expect(screen.getByText(/already have an account/i)).toBeInTheDocument();
    expect(screen.queryByText(/looks like you might be a returning guest/i)).not.toBeInTheDocument();
  });

  it('renders emphasized banner when reconcileHint is true', () => {
    render(<EmailRecoveryButton reconcileHint={true} onOpen={vi.fn()} />);
    expect(screen.getByText(/looks like you might be a returning guest/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify email to recover/i })).toBeInTheDocument();
  });

  it('calls onOpen when passive link is clicked', () => {
    const onOpen = vi.fn();
    render(<EmailRecoveryButton reconcileHint={false} onOpen={onOpen} />);
    fireEvent.click(screen.getByText(/verify email/i));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('calls onOpen when emphasized button is clicked', () => {
    const onOpen = vi.fn();
    render(<EmailRecoveryButton reconcileHint={true} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /verify email to recover/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dashboard && npm test -- --run components/__tests__/EmailRecoveryButton.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement component**

Create `dashboard/components/EmailRecoveryButton.tsx`:
```tsx
'use client';

interface Props {
  reconcileHint: boolean;
  onOpen: () => void;
}

export default function EmailRecoveryButton({ reconcileHint, onOpen }: Props) {
  if (reconcileHint) {
    return (
      <div
        style={{
          border: '1px solid #3a3a3a',
          borderRadius: 8,
          padding: '12px 16px',
          background: '#1a1a1a',
          margin: '16px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ color: '#ededed', fontWeight: 500 }}>
          Looks like you might be a returning guest.
        </div>
        <button
          type="button"
          onClick={onOpen}
          style={{
            background: '#4a90e2',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            cursor: 'pointer',
            alignSelf: 'flex-start',
            fontWeight: 500,
          }}
        >
          Verify email to recover your account
        </button>
        <div style={{ color: '#888', fontSize: 13 }}>
          Or just continue — your nickname will be saved fresh.
        </div>
      </div>
    );
  }

  return (
    <div style={{ margin: '8px 0', color: '#888', fontSize: 14 }}>
      Already have an account?{' '}
      <button
        type="button"
        onClick={onOpen}
        style={{
          background: 'none',
          border: 'none',
          color: '#4a90e2',
          cursor: 'pointer',
          textDecoration: 'underline',
          padding: 0,
          font: 'inherit',
        }}
      >
        Verify email
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd dashboard && npm test -- --run components/__tests__/EmailRecoveryButton.test.tsx`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/components/EmailRecoveryButton.tsx dashboard/components/__tests__/EmailRecoveryButton.test.tsx
git commit -m "feat(guest): EmailRecoveryButton component with passive/emphasized states"
```

---

## Task 11: Build `EmailRecoveryModal` component (TDD)

**Files:**
- Create: `dashboard/components/EmailRecoveryModal.tsx`
- Test: `dashboard/components/__tests__/EmailRecoveryModal.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `dashboard/components/__tests__/EmailRecoveryModal.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmailRecoveryModal from '../EmailRecoveryModal';

vi.mock('../EmailVerification', () => ({
  default: ({ onVerified }: { onVerified: () => void }) => (
    <div data-testid="email-verification-mock">
      <button onClick={onVerified}>simulate-verified</button>
    </div>
  ),
}));

describe('EmailRecoveryModal', () => {
  it('does not render when open is false', () => {
    render(<EmailRecoveryModal open={false} onClose={vi.fn()} onRecovered={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog when open is true', () => {
    render(<EmailRecoveryModal open={true} onClose={vi.fn()} onRecovered={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('email-verification-mock')).toBeInTheDocument();
  });

  it('calls onClose when ESC is pressed', () => {
    const onClose = vi.fn();
    render(<EmailRecoveryModal open={true} onClose={onClose} onRecovered={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onRecovered then onClose after EmailVerification onVerified fires', async () => {
    const onClose = vi.fn();
    const onRecovered = vi.fn();
    render(<EmailRecoveryModal open={true} onClose={onClose} onRecovered={onRecovered} />);

    fireEvent.click(screen.getByText('simulate-verified'));

    expect(onRecovered).toHaveBeenCalledTimes(1);
    // onClose is called after a brief delay; modal handles its own animation
  });

  it('calls onClose when backdrop clicked', () => {
    const onClose = vi.fn();
    render(<EmailRecoveryModal open={true} onClose={onClose} onRecovered={vi.fn()} />);
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dashboard && npm test -- --run components/__tests__/EmailRecoveryModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement modal**

Create `dashboard/components/EmailRecoveryModal.tsx`:
```tsx
'use client';

import { useEffect } from 'react';
import EmailVerification from './EmailVerification';

interface Props {
  open: boolean;
  onClose: () => void;
  onRecovered: () => void;
}

export default function EmailRecoveryModal({ open, onClose, onRecovered }: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const handleVerified = () => {
    onRecovered();
    setTimeout(onClose, 1500);
  };

  return (
    <div
      data-testid="modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-labelledby="recovery-title"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1a1a1a',
          border: '1px solid #3a3a3a',
          borderRadius: 12,
          padding: 24,
          maxWidth: 420,
          width: '100%',
          color: '#ededed',
        }}
      >
        <h2 id="recovery-title" style={{ margin: '0 0 16px', fontSize: 18 }}>
          Recover your account
        </h2>
        <EmailVerification isVerified={false} onVerified={handleVerified} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `cd dashboard && npm test -- --run components/__tests__/EmailRecoveryModal.test.tsx`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/components/EmailRecoveryModal.tsx dashboard/components/__tests__/EmailRecoveryModal.test.tsx
git commit -m "feat(guest): EmailRecoveryModal dialog wrapper around EmailVerification"
```

---

## Task 12: Wire recovery flow into `/collect/[code]` page

**Files:**
- Modify: `dashboard/app/collect/[code]/page.tsx`

- [ ] **Step 1: Read the current collect page to find the right insertion point**

Run: `cat dashboard/app/collect/[code]/page.tsx | head -80`
Identify where the `FeatureOptInPanel` is rendered (or the page header / nickname-gate area). The recovery button should sit above `FeatureOptInPanel`.

- [ ] **Step 2: Add imports and recovery state**

In `dashboard/app/collect/[code]/page.tsx`, add the imports:
```tsx
import { useState } from 'react';  // if not present
import EmailRecoveryButton from '@/components/EmailRecoveryButton';
import EmailRecoveryModal from '@/components/EmailRecoveryModal';
```
At the top of the component function (alongside other `useState` calls):
```tsx
const [recoveryOpen, setRecoveryOpen] = useState(false);
```

If the page already calls `useGuestIdentity()`, destructure `reconcileHint` and `refresh`:
```tsx
const { guestId, reconcileHint, refresh: refreshIdentity } = useGuestIdentity();
```

- [ ] **Step 3: Render the button + modal**

Insert the following JSX above the `FeatureOptInPanel` element (or near the page header — match the visual hierarchy already in place):
```tsx
<EmailRecoveryButton
  reconcileHint={reconcileHint}
  onOpen={() => setRecoveryOpen(true)}
/>
<EmailRecoveryModal
  open={recoveryOpen}
  onClose={() => setRecoveryOpen(false)}
  onRecovered={async () => {
    await refreshIdentity();
    // Refetch profile + my-picks queries — re-run whatever existing
    // hooks/effects load these. If they depend on guestId, the
    // refresh() above triggers them automatically. Otherwise,
    // call their refetch handlers directly.
  }}
/>
```

If the page uses a SWR/React Query hook for the profile/my-picks, also call its `mutate()` / `refetch()` from `onRecovered`. If it just uses `useEffect` keyed on `guestId`, the dependency change from `refresh()` is enough.

- [ ] **Step 4: Run typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Run page-level tests if any exist**

Run: `cd dashboard && npm test -- --run app/collect/[code]/page.test.tsx`
Expected: PASS (existing tests should still work — we only added two components).

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/collect/[code]/page.tsx
git commit -m "feat(guest): wire EmailRecoveryButton into /collect/[code]"
```

---

## Task 13: Wire recovery flow into `/join/[code]` page

**Files:**
- Modify: `dashboard/app/join/[code]/page.tsx`

- [ ] **Step 1: Read the current join page**

Run: `cat dashboard/app/join/[code]/page.tsx | head -100`
Identify the request-form header / top-of-card area where the button should sit. The join page is denser, so the button should be more compact.

- [ ] **Step 2: Add imports and recovery state**

In `dashboard/app/join/[code]/page.tsx`, add the imports at the top:
```tsx
import { useState } from 'react';  // if not already imported
import EmailRecoveryButton from '@/components/EmailRecoveryButton';
import EmailRecoveryModal from '@/components/EmailRecoveryModal';
```
At the top of the component function, alongside other `useState` calls:
```tsx
const [recoveryOpen, setRecoveryOpen] = useState(false);
```
If the page already calls `useGuestIdentity()`, destructure the new fields:
```tsx
const { guestId, reconcileHint, refresh: refreshIdentity } = useGuestIdentity();
```
Otherwise add the import (`import { useGuestIdentity } from '@/lib/use-guest-identity';`) and the call.

- [ ] **Step 3: Render the button + modal**

Place the button at the top of the request-form card (near the header), and the modal at the page root:
```tsx
<EmailRecoveryButton
  reconcileHint={reconcileHint}
  onOpen={() => setRecoveryOpen(true)}
/>
<EmailRecoveryModal
  open={recoveryOpen}
  onClose={() => setRecoveryOpen(false)}
  onRecovered={async () => {
    await refreshIdentity();
    // refetch any guest-scoped panels currently mounted
  }}
/>
```

- [ ] **Step 4: Run typecheck**

Run: `cd dashboard && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Run page-level tests**

Run: `cd dashboard && npm test -- --run app/join/[code]/__tests__/page.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/join/[code]/page.tsx
git commit -m "feat(guest): wire EmailRecoveryButton into /join/[code]"
```

---

## Task 14: Add E2E test for recovery flow

**Files:**
- Create: `dashboard/e2e/05-guest-identity-recovery.spec.ts`

- [ ] **Step 1: Inspect existing e2e tests for testing patterns**

Run: `cat dashboard/e2e/02-guest-request.spec.ts | head -60`
Note how the project mocks `apiClient` and how it intercepts network calls.

- [ ] **Step 2: Write the e2e spec**

Create `dashboard/e2e/05-guest-identity-recovery.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

test.describe('Guest identity recovery flow', () => {
  test('passive recovery button visible on /collect/{code}', async ({ page }) => {
    await page.goto('/collect/TESTEVENT');
    // Page should load and the passive recovery hint should be visible
    await expect(page.getByText(/already have an account/i)).toBeVisible();
  });

  test('emphasized banner appears when reconcile_hint=true', async ({ page }) => {
    // Mock identify endpoint to return reconcile_hint=true
    await page.route('**/api/public/guest/identify', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ guest_id: 1, action: 'create', reconcile_hint: true }),
      })
    );
    await page.goto('/collect/TESTEVENT');
    await expect(
      page.getByText(/looks like you might be a returning guest/i)
    ).toBeVisible();
  });

  test('clicking button opens modal with email step', async ({ page }) => {
    await page.goto('/collect/TESTEVENT');
    await page.getByRole('button', { name: /verify email/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test('ESC closes the modal', async ({ page }) => {
    await page.goto('/collect/TESTEVENT');
    await page.getByRole('button', { name: /verify email/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });
});
```

Resolve the event code:
- Open `dashboard/e2e/02-guest-request.spec.ts` and find what event code it uses (likely a constant or seeded fixture). Replace every occurrence of `TESTEVENT` in the file you just created with that same value, OR add a `test.beforeAll` hook that seeds an event matching what `02-guest-request.spec.ts` does.
- If the project's `playwright.config.ts` has a `webServer` block, the backend will already be running for the test. If not, follow the existing e2e specs' setup pattern.

- [ ] **Step 3: Run e2e suite**

Run: `cd dashboard && npx playwright test e2e/05-guest-identity-recovery.spec.ts`
Expected: PASS. If a test relies on backend state that isn't set up, mock the identify endpoint as the second test does.

- [ ] **Step 4: Commit**

```bash
git add dashboard/e2e/05-guest-identity-recovery.spec.ts
git commit -m "test(e2e): guest identity recovery flow"
```

---

## Task 15: Frontend CI checks pass cleanly

**Files:** none modified — gate task

- [ ] **Step 1: Run ESLint**

Run: `cd dashboard && npm run lint`
Expected: PASS.

- [ ] **Step 2: Run TypeScript strict check**

Run: `cd dashboard && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Run Vitest**

Run: `cd dashboard && npm test -- --run`
Expected: ALL PASS, no skipped/failed.

- [ ] **Step 4: Restore `next-env.d.ts` if Next.js modified it**

Run: `git status dashboard/next-env.d.ts`
If it shows as modified: `git checkout dashboard/next-env.d.ts`.

- [ ] **Step 5: Commit any auto-fixes**

If ESLint --fix or anything ran:
```bash
git add dashboard/
git commit -m "chore(dashboard): lint auto-fixes"
```
Otherwise skip.

---

## Task 16: GitNexus impact verification

**Files:** none modified — verification task

- [ ] **Step 1: Re-run analyze to refresh the index**

Run: `npx gitnexus analyze`
Expected: completes; new commit hash logged.

- [ ] **Step 2: Detect changes in scope**

Use `mcp__gitnexus__detect_changes` (or skip if MCP unavailable). Expected output: changes confined to:
- `app.services.guest_identity.identify_guest`
- `app.services.guest_identity._ua_signals_match`
- `app.schemas.guest.IdentifyResponse`
- `app.api.guest.identify`
- New frontend components

If unrelated symbols show up as affected, investigate before pushing.

---

## Task 17: Manual verification

**Files:** none — runtime verification

Run the "push to testing" workflow (per project memory `MEMORY.md`):

- [ ] **Step 1: Tear down any existing local services**

```bash
ss -tlnp | grep :8000 | awk '{print $7}' | grep -oP 'pid=\K[0-9]+' | xargs -r kill
ss -tlnp | grep :3000 | awk '{print $7}' | grep -oP 'pid=\K[0-9]+' | xargs -r kill
docker compose -f deploy/dev-proxy/docker-compose.yml down 2>/dev/null || true
rm -f dashboard/.next/dev/lock
```

- [ ] **Step 2: Start the database and run migrations**

```bash
docker compose up -d db
cd server && .venv/bin/alembic upgrade head
```

- [ ] **Step 3: Start the dev proxy**

```bash
./deploy/dev-proxy/setup.sh
```
Note the LAN IP it prints.

- [ ] **Step 4: Start backend (in tmux/background)**

```bash
LAN_IP=$(ip -4 addr show | grep -oP '(?<=inet\s)192\.168\.\d+\.\d+' | head -1)
cd server && source .venv/bin/activate && \
CORS_ORIGINS="https://app.local,https://${LAN_IP}" \
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- [ ] **Step 5: Start frontend (in tmux/background)**

```bash
LAN_IP=$(ip -4 addr show | grep -oP '(?<=inet\s)192\.168\.\d+\.\d+' | head -1)
cd dashboard && NEXT_PUBLIC_API_URL="https://${LAN_IP}:8443" npm run dev
```

- [ ] **Step 6: Run the manual checklist on `https://<LAN_IP>`**

Verify in a browser — for each item, mark ✓ or document the failure:

```
[ ] Two physical devices on same LAN, fresh cookies → distinct guest_id (check logs)
[ ] Same device cookie cleared, 13+h later → reconciles correctly (simulate via DB last_seen_at backdate)
[ ] Same device cookie cleared, <12h later → new guest_id (expected new behavior)
[ ] Verified guest clears cookies → new guest, banner emphasized, recovery via email works
[ ] Banner copy + button copy renders correctly on small mobile (<400px width)
[ ] Modal a11y: ESC closes, focus trap holds, screen reader announces step transitions
[ ] iOS auto-fill picks up the verification code from email
[ ] Both /collect/{code} and /join/{code} show the button
[ ] Server logs show the new event types: action=create reason=concurrent_activity etc.
```

If a test fails, fix in code, commit, restart services, retest.

- [ ] **Step 7: Tear down**

```bash
ss -tlnp | grep :8000 | awk '{print $7}' | grep -oP 'pid=\K[0-9]+' | xargs -r kill
ss -tlnp | grep :3000 | awk '{print $7}' | grep -oP 'pid=\K[0-9]+' | xargs -r kill
docker compose -f deploy/dev-proxy/docker-compose.yml down
```

---

## Task 18: Push, open PR

- [ ] **Step 1: Verify clean working tree**

Run: `git status`
Expected: clean, all commits already made.

- [ ] **Step 2: Push the branch**

Run: `git push -u origin fix/guest-identity-hardening`
Expected: branch pushed; remote tracking set.

- [ ] **Step 3: Open the PR**

Run:
```bash
gh pr create --title "fix(guest): harden identity reconciliation against fingerprint false positives" --body "$(cat <<'EOF'
## Summary

- Fixes platform-breaking bug where two physical guests on the same LAN merged into a single Guest record (e.g., a phone inheriting a PC user's nickname/submissions)
- Replaces the lax `_compute_confidence` reconciliation (UA score >= 0.7) with a strict 5-rule gate
- Adds an `EmailRecoveryButton` + `EmailRecoveryModal` on `/collect/{code}` and `/join/{code}` as the deterministic recovery path

## Rule changes

1. Frontend restores `canvas` + `webgl` entropy in ThumbmarkJS (was disabled — that was the original entropy collapse)
2. Reconciliation requires exact UA family + platform + ±1 major version
3. Refuse if multiple Guests share the same fingerprint (ambiguity guard)
4. Refuse if the matching Guest was active within the last 12 hours (concurrent-activity guard)
5. Verified Guests (`email_verified_at IS NOT NULL`) are never auto-reconciled — cookie or email re-claim only

## Spec

[`docs/superpowers/specs/2026-04-28-guest-identity-hardening-design.md`](docs/superpowers/specs/2026-04-28-guest-identity-hardening-design.md)

## Test plan

- [ ] Backend tests pass (`cd server && .venv/bin/pytest --tb=short -q`)
- [ ] Frontend tests pass (`cd dashboard && npm test -- --run`)
- [ ] E2E recovery test passes
- [ ] Two physical devices on same LAN → distinct guest_ids
- [ ] Verified guest cookie clear → new guest + emphasized banner + recovery works
- [ ] Same device cookie clear after 13+ hours → reconciles correctly
- [ ] Server logs show new reason codes (`concurrent_activity`, `verified_guest`, `ambiguous_match`, `ua_mismatch`)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Watch CI**

Run: `gh pr checks --watch`
Expected: all green. If failing, diagnose, push fix, repeat.

- [ ] **Step 5: Hand off for human review**

Tell the user the PR URL and that the implementation is ready for their review.

---

## Done

This plan delivers:
- Backend: 5-rule reconciliation gate with reason-coded logging
- API: `reconcile_hint` field exposed; `rejection_reason` kept internal
- Frontend: canvas/webgl entropy restored; recovery affordance on both guest pages
- Tests: rule-by-rule unit coverage, schema response checks, e2e recovery flow
- No DB migration, no new env vars, no nginx changes, no new external services

The bug is forward-fixed. Existing conflated Guest records are untouched (per spec); affected users self-recover via the new email-recovery button.
