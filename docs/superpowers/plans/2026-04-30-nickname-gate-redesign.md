# Nickname Gate Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two-track entry (new name vs email login) to NicknameGate, enforce per-event nickname uniqueness with collision detection, and trigger an email OTP login flow when a taken nickname is email-claimed.

**Architecture:** DB functional unique index enforces uniqueness at the DB level; `upsert_profile()` checks for collisions first and raises `NicknameConflictError(claimed)` which the API endpoint maps to 409. The frontend NicknameGate gains 5 new internal states with a fully revised state machine — no new files, no new API endpoints.

**Tech Stack:** Python/FastAPI (backend), SQLAlchemy 2.0, Alembic, pytest; Next.js/React (frontend), TypeScript, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-04-30-nickname-gate-redesign-design.md`

---

## File Map

| File | Action | What changes |
|---|---|---|
| `server/alembic/versions/040_add_nickname_uniqueness.py` | **Create** | Migration — functional unique index on `guest_profiles(event_id, lower(nickname)) WHERE nickname IS NOT NULL` |
| `server/app/models/guest_profile.py` | **Modify** | Add comment documenting the DB-level index |
| `server/app/services/collect.py` | **Modify** | Add `NicknameConflictError`; update `upsert_profile()` with pre-insert collision check |
| `server/app/api/collect.py` | **Modify** | `set_profile()` catches `NicknameConflictError` + `IntegrityError` → 409 |
| `server/tests/test_collect_public.py` | **Modify** | 7 new tests for nickname collision behavior |
| `dashboard/lib/api.ts` | **Modify** | Export `NicknameConflictError` class; update `setCollectProfile()` to throw it on 409 |
| `dashboard/components/NicknameGate.tsx` | **Modify** | New state machine with 5 new states |
| `dashboard/components/__tests__/NicknameGate.test.tsx` | **Create** | 10 frontend tests |

---

## Task 0: Create branch

- [ ] **Create feature branch**

```bash
git checkout -b feat/nickname-gate-redesign
```

---

## Task 1: DB migration + model annotation

**Files:**
- Create: `server/alembic/versions/040_add_nickname_uniqueness.py`
- Modify: `server/app/models/guest_profile.py`

- [ ] **Step 1: Get the current Alembic head revision ID**

```bash
cd server && .venv/bin/alembic heads
```

Note the hex revision ID (e.g. `a1b2c3d4e5f6`). You need it for the `down_revision` field in the next step.

- [ ] **Step 2: Create the migration file**

Replace `<PREVIOUS_HEAD>` with the revision ID from step 1.

```python
# server/alembic/versions/040_add_nickname_uniqueness.py
"""add per-event nickname uniqueness index

Revision ID: 040_nickname_unique
Revises: <PREVIOUS_HEAD>
Create Date: 2026-04-30
"""
from alembic import op

revision = "040_nickname_unique"
down_revision = "<PREVIOUS_HEAD>"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE UNIQUE INDEX uq_guest_profile_event_nickname "
        "ON guest_profiles (event_id, lower(nickname)) "
        "WHERE nickname IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_guest_profile_event_nickname")
```

- [ ] **Step 3: Annotate the model**

Open `server/app/models/guest_profile.py`. Add a comment after the existing `UniqueConstraint` so future developers know the index exists:

```python
    __table_args__ = (
        UniqueConstraint(
            "event_id",
            "guest_id",
            name="uq_guest_profile_event_guest",
        ),
        # DB-level: unique per (event_id, lower(nickname)) WHERE nickname IS NOT NULL
        # Created by migration 040_add_nickname_uniqueness. Case-insensitive.
    )
```

- [ ] **Step 4: Run migration and verify**

```bash
cd server && .venv/bin/alembic upgrade head
```

Expected output ends with: `Running upgrade <prev> -> 040_nickname_unique, add per-event nickname uniqueness index`

- [ ] **Step 5: Confirm alembic check passes**

```bash
.venv/bin/alembic check
```

Expected: `No new upgrade operations detected.`

- [ ] **Step 6: Commit**

```bash
git add server/alembic/versions/040_add_nickname_uniqueness.py server/app/models/guest_profile.py
git commit -m "feat: add per-event nickname uniqueness DB index"
```

---

## Task 2: Backend — collision check and 409 response (TDD)

**Files:**
- Modify: `server/app/services/collect.py`
- Modify: `server/app/api/collect.py`
- Test: `server/tests/test_collect_public.py`

### Step 1: Write 7 failing tests

- [ ] **Append to `server/tests/test_collect_public.py`:**

```python
# ── Nickname uniqueness tests ──────────────────────────────────────────────

class TestNicknameUniqueness:
    """Tests for per-event nickname collision detection."""

    def _make_guest(self, db, token_suffix: str, verified: bool = False):
        import datetime
        from app.core.time import utcnow
        g = Guest(
            token="guest" + token_suffix.ljust(59, "0"),
            fingerprint_hash=f"fp_{token_suffix}",
            created_at=utcnow(),
            last_seen_at=utcnow(),
        )
        if verified:
            g.email_verified_at = utcnow()
        db.add(g)
        db.commit()
        db.refresh(g)
        return g

    def test_available_nickname_succeeds(self, client, db, test_event):
        r = client.post(
            f"/api/public/collect/{test_event.code}/profile",
            json={"nickname": "UniqueNick"},
        )
        assert r.status_code == 200
        assert r.json()["nickname"] == "UniqueNick"

    def test_collision_unclaimed_returns_409_claimed_false(self, client, db, test_event):
        # default guest (autouse) claims "Alex"
        client.post(
            f"/api/public/collect/{test_event.code}/profile",
            json={"nickname": "Alex"},
        )
        # second guest tries "Alex"
        guest2 = self._make_guest(db, "two")
        r = client.post(
            f"/api/public/collect/{test_event.code}/profile",
            json={"nickname": "Alex"},
            cookies={"wrzdj_guest": guest2.token},
        )
        assert r.status_code == 409
        body = r.json()["detail"]
        assert body["code"] == "nickname_taken"
        assert body["claimed"] is False

    def test_collision_claimed_returns_409_claimed_true(self, client, db, test_event):
        # default guest claims "Alex" and is email-verified
        verified_guest = self._make_guest(db, "verified", verified=True)
        client.post(
            f"/api/public/collect/{test_event.code}/profile",
            json={"nickname": "Alex"},
            cookies={"wrzdj_guest": verified_guest.token},
        )
        # second guest tries same name
        guest2 = self._make_guest(db, "two")
        r = client.post(
            f"/api/public/collect/{test_event.code}/profile",
            json={"nickname": "Alex"},
            cookies={"wrzdj_guest": guest2.token},
        )
        assert r.status_code == 409
        body = r.json()["detail"]
        assert body["code"] == "nickname_taken"
        assert body["claimed"] is True

    def test_self_collision_is_idempotent(self, client, db, test_event):
        client.post(
            f"/api/public/collect/{test_event.code}/profile",
            json={"nickname": "Alex"},
        )
        r = client.post(
            f"/api/public/collect/{test_event.code}/profile",
            json={"nickname": "Alex"},
        )
        assert r.status_code == 200

    def test_collision_is_case_insensitive(self, client, db, test_event):
        client.post(
            f"/api/public/collect/{test_event.code}/profile",
            json={"nickname": "Alex"},
        )
        for variant in ["alex", "ALEX", "aLeX"]:
            g = self._make_guest(db, variant)
            r = client.post(
                f"/api/public/collect/{test_event.code}/profile",
                json={"nickname": variant},
                cookies={"wrzdj_guest": g.token},
            )
            assert r.status_code == 409, f"Expected 409 for variant '{variant}'"

    def test_race_condition_integrity_error_maps_to_409(self, client, db, test_event, monkeypatch):
        from sqlalchemy.exc import IntegrityError
        import app.api.collect as collect_api

        def raise_integrity(db, *, event_id, guest_id=None, nickname=None):
            raise IntegrityError("unique constraint", None, Exception())

        monkeypatch.setattr(collect_api, "upsert_profile", raise_integrity)

        r = client.post(
            f"/api/public/collect/{test_event.code}/profile",
            json={"nickname": "Alex"},
        )
        assert r.status_code == 409
        body = r.json()["detail"]
        assert body["code"] == "nickname_taken"
        assert body["claimed"] is False

    def test_null_nickname_skips_uniqueness_check(self, client, db, test_event):
        # Posting with no nickname field should not trigger collision logic
        r = client.post(
            f"/api/public/collect/{test_event.code}/profile",
            json={},
        )
        assert r.status_code == 200
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
cd server && .venv/bin/pytest tests/test_collect_public.py::TestNicknameUniqueness -v
```

Expected: 7 failures. Typical error: `AssertionError: assert 200 == 409` (collision check doesn't exist yet).

### Step 3: Implement collision check in service

- [ ] **Update `server/app/services/collect.py`**

Add the exception class right after the imports section (after line 12, before `_to_naive_utc`):

```python
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app.models.guest import Guest


class NicknameConflictError(Exception):
    """Raised when a nickname is already in use by another guest in the event."""

    def __init__(self, claimed: bool) -> None:
        self.claimed = claimed
        super().__init__("nickname_taken")
```

Then replace the entire `upsert_profile` function (lines 170-195) with:

```python
def upsert_profile(
    db: Session,
    *,
    event_id: int,
    guest_id: int | None = None,
    nickname: str | None = None,
) -> GuestProfile | None:
    """Create or update a profile keyed on (event_id, guest_id). Returns None
    when no guest_id is provided — anonymous callers cannot persist profile state.

    Raises NicknameConflictError when the requested nickname is already held by
    a different guest in the same event. claimed=True when the owner is email-verified.
    """
    if guest_id is None:
        return None

    if nickname is not None:
        existing = (
            db.query(GuestProfile)
            .filter(
                GuestProfile.event_id == event_id,
                GuestProfile.guest_id != guest_id,
                func.lower(GuestProfile.nickname) == nickname.lower(),
            )
            .first()
        )
        if existing:
            owner = db.get(Guest, existing.guest_id)
            claimed = owner is not None and owner.email_verified_at is not None
            raise NicknameConflictError(claimed=claimed)

    profile = get_profile(db, event_id=event_id, guest_id=guest_id)
    if profile is None:
        profile = GuestProfile(
            event_id=event_id,
            guest_id=guest_id,
            nickname=nickname,
        )
        db.add(profile)
    else:
        if nickname is not None:
            profile.nickname = nickname
    db.commit()
    db.refresh(profile)
    return profile
```

### Step 4: Catch exception in endpoint

- [ ] **Update `server/app/api/collect.py` `set_profile` function**

Add the imports at the top of the file (with existing imports):

```python
from sqlalchemy.exc import IntegrityError

from app.services.collect import NicknameConflictError
```

Replace the `upsert_profile` call block inside `set_profile` (the section starting at line 177 through line 190 of the current file):

```python
    try:
        profile = collect_service.upsert_profile(
            db,
            event_id=event.id,
            guest_id=guest_id,
            nickname=payload.nickname,
        )
    except NicknameConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "nickname_taken", "claimed": exc.claimed},
        )
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail={"code": "nickname_taken", "claimed": False},
        )
    if payload.nickname is not None:
        log_activity(
            db,
            level="info",
            source="collect",
            message=f"Guest #{guest_id} updated profile: nickname",
            event_code=code,
        )
```

- [ ] **Step 5: Run tests — all 7 should pass**

```bash
cd server && .venv/bin/pytest tests/test_collect_public.py::TestNicknameUniqueness -v
```

Expected: 7 passed.

- [ ] **Step 6: Run the full backend test suite to confirm no regressions**

```bash
.venv/bin/pytest --tb=short -q
```

Expected: All existing tests pass.

- [ ] **Step 7: Run linting**

```bash
.venv/bin/ruff check . && .venv/bin/ruff format --check .
```

Fix any issues with `.venv/bin/ruff check --fix . && .venv/bin/ruff format .`

- [ ] **Step 8: Commit**

```bash
git add server/app/services/collect.py server/app/api/collect.py server/tests/test_collect_public.py
git commit -m "feat: enforce per-event nickname uniqueness with 409 collision response"
```

---

## Task 3: Frontend API client — NicknameConflictError (TDD)

**Files:**
- Modify: `dashboard/lib/api.ts`
- Test: `dashboard/lib/__tests__/api.test.ts`

- [ ] **Step 1: Write a failing test**

Open `dashboard/lib/__tests__/api.test.ts` and append:

```typescript
describe('setCollectProfile — nickname collision', () => {
  afterEach(() => vi.restoreAllMocks());

  it('throws NicknameConflictError with claimed=true on 409 claimed true', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ detail: { code: 'nickname_taken', claimed: true } }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(apiClient.setCollectProfile('EVT01', { nickname: 'Alex' })).rejects.toMatchObject({
      name: 'NicknameConflictError',
      claimed: true,
    });
  });

  it('throws NicknameConflictError with claimed=false on 409 claimed false', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ detail: { code: 'nickname_taken', claimed: false } }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(apiClient.setCollectProfile('EVT01', { nickname: 'Alex' })).rejects.toMatchObject({
      name: 'NicknameConflictError',
      claimed: false,
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd dashboard && npm test -- --run lib/__tests__/api.test.ts
```

Expected: 2 new failures — `NicknameConflictError is not defined`.

- [ ] **Step 3: Add `NicknameConflictError` to `dashboard/lib/api.ts`**

Insert after `ApiError` (after line 189):

```typescript
export class NicknameConflictError extends Error {
  claimed: boolean;
  constructor(claimed: boolean) {
    super('nickname_taken');
    this.name = 'NicknameConflictError';
    this.claimed = claimed;
  }
}
```

- [ ] **Step 4: Update `setCollectProfile` to throw on 409**

Replace the current `setCollectProfile` method (lines 1041–1053):

```typescript
  async setCollectProfile(
    code: string,
    data: { nickname?: string },
  ): Promise<CollectProfileResponse> {
    const res = await fetch(`${getApiUrl()}/api/public/collect/${code}/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    });
    if (res.status === 409) {
      const body = await res.json().catch(() => ({})) as { detail?: { claimed?: boolean } };
      throw new NicknameConflictError(body.detail?.claimed ?? false);
    }
    if (!res.ok) throw new ApiError(`setCollectProfile failed: ${res.status}`, res.status);
    return res.json();
  }
```

- [ ] **Step 5: Run tests — 2 new tests should pass**

```bash
cd dashboard && npm test -- --run lib/__tests__/api.test.ts
```

Expected: All pass including the 2 new ones.

- [ ] **Step 6: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add dashboard/lib/api.ts dashboard/lib/__tests__/api.test.ts
git commit -m "feat: export NicknameConflictError from api client, handle 409 in setCollectProfile"
```

---

## Task 4: NicknameGate redesign (TDD)

**Files:**
- Create: `dashboard/components/__tests__/NicknameGate.test.tsx`
- Modify: `dashboard/components/NicknameGate.tsx`

### Step 1: Write 10 failing tests

- [ ] **Create `dashboard/components/__tests__/NicknameGate.test.tsx`:**

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NicknameGate } from '../NicknameGate';

// Mock api module — must be hoisted above imports that use it
vi.mock('../../lib/api', () => {
  class ApiError extends Error {
    status: number;
    constructor(msg: string, status: number) {
      super(msg);
      this.name = 'ApiError';
      this.status = status;
    }
  }
  class NicknameConflictError extends Error {
    claimed: boolean;
    constructor(claimed: boolean) {
      super('nickname_taken');
      this.name = 'NicknameConflictError';
      this.claimed = claimed;
    }
  }
  return {
    apiClient: {
      getCollectProfile: vi.fn(),
      setCollectProfile: vi.fn(),
      requestVerificationCode: vi.fn(),
      confirmVerificationCode: vi.fn(),
    },
    ApiError,
    NicknameConflictError,
  };
});

vi.mock('../../lib/use-guest-identity', () => ({
  useGuestIdentity: () => ({
    isLoading: false,
    guestId: 1,
    isReturning: false,
    reconcileHint: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('../EmailVerification', () => ({
  default: ({ onVerified, onSkip }: { onVerified: () => void; onSkip: () => void }) => (
    <div>
      <button onClick={onVerified}>Verify Email</button>
      <button onClick={onSkip}>Skip Email</button>
    </div>
  ),
}));

import { apiClient, NicknameConflictError } from '../../lib/api';

const mockGetProfile = vi.mocked(apiClient.getCollectProfile);
const mockSetProfile = vi.mocked(apiClient.setCollectProfile);
const mockRequestCode = vi.mocked(apiClient.requestVerificationCode);
const mockConfirmCode = vi.mocked(apiClient.confirmVerificationCode);

const emptyProfile = {
  nickname: null,
  email_verified: false,
  submission_count: 0,
  submission_cap: 5,
};

describe('NicknameGate', () => {
  const onComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProfile.mockResolvedValue(emptyProfile);
    mockSetProfile.mockResolvedValue({ ...emptyProfile, nickname: 'TestUser' });
    mockRequestCode.mockResolvedValue({ sent: true });
    mockConfirmCode.mockResolvedValue({ verified: true, guest_id: 1, merged: false });
  });

  it('renders track_select when no profile exists', async () => {
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new name/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /have email/i })).toBeInTheDocument();
    });
  });

  it('transitions to nickname_input when "New name" clicked', async () => {
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => screen.getByRole('button', { name: /new name/i }));
    fireEvent.click(screen.getByRole('button', { name: /new name/i }));
    expect(screen.getByPlaceholderText(/dancingqueen/i)).toBeInTheDocument();
  });

  it('transitions to email_login when "Have email" clicked', async () => {
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => screen.getByRole('button', { name: /have email/i }));
    fireEvent.click(screen.getByRole('button', { name: /have email/i }));
    expect(screen.getByPlaceholderText(/you@example\.com/i)).toBeInTheDocument();
  });

  it('shows collision_unclaimed state on 409 claimed=false', async () => {
    mockSetProfile.mockRejectedValue(new NicknameConflictError(false));
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => screen.getByRole('button', { name: /new name/i }));
    fireEvent.click(screen.getByRole('button', { name: /new name/i }));
    fireEvent.change(screen.getByPlaceholderText(/dancingqueen/i), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      expect(screen.getByText(/already taken/i)).toBeInTheDocument();
      expect(screen.getByText(/original device/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /log in/i })).not.toBeInTheDocument();
  });

  it('shows collision_claimed state on 409 claimed=true', async () => {
    mockSetProfile.mockRejectedValue(new NicknameConflictError(true));
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => screen.getByRole('button', { name: /new name/i }));
    fireEvent.click(screen.getByRole('button', { name: /new name/i }));
    fireEvent.change(screen.getByPlaceholderText(/dancingqueen/i), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      expect(screen.getByText(/already taken/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /log in with email/i })).toBeInTheDocument();
    });
  });

  it('"Try a different nickname" from collision_unclaimed returns to nickname_input', async () => {
    mockSetProfile.mockRejectedValue(new NicknameConflictError(false));
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => screen.getByRole('button', { name: /new name/i }));
    fireEvent.click(screen.getByRole('button', { name: /new name/i }));
    fireEvent.change(screen.getByPlaceholderText(/dancingqueen/i), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => screen.getByText(/original device/i));
    fireEvent.click(screen.getByRole('button', { name: /try a different/i }));
    expect(screen.getByPlaceholderText(/dancingqueen/i)).toBeInTheDocument();
  });

  it('"Try a different nickname" from collision_claimed returns to nickname_input', async () => {
    mockSetProfile.mockRejectedValue(new NicknameConflictError(true));
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => screen.getByRole('button', { name: /new name/i }));
    fireEvent.click(screen.getByRole('button', { name: /new name/i }));
    fireEvent.change(screen.getByPlaceholderText(/dancingqueen/i), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => screen.getByRole('button', { name: /log in with email/i }));
    fireEvent.click(screen.getByRole('button', { name: /try a different/i }));
    expect(screen.getByPlaceholderText(/dancingqueen/i)).toBeInTheDocument();
  });

  it('transitions to complete when email verified and profile has nickname', async () => {
    mockGetProfile
      .mockResolvedValueOnce(emptyProfile)
      .mockResolvedValueOnce({
        nickname: 'Alex',
        email_verified: true,
        submission_count: 0,
        submission_cap: 5,
      });
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => screen.getByRole('button', { name: /have email/i }));
    fireEvent.click(screen.getByRole('button', { name: /have email/i }));
    fireEvent.change(screen.getByPlaceholderText(/you@example\.com/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send code/i }));
    await waitFor(() => screen.getByPlaceholderText(/6.digit/i));
    fireEvent.change(screen.getByPlaceholderText(/6.digit/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }));
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ nickname: 'Alex', emailVerified: true }),
      ),
    );
  });

  it('transitions to nickname_input when email verified but no nickname on guest', async () => {
    mockGetProfile
      .mockResolvedValueOnce(emptyProfile)
      .mockResolvedValueOnce({
        nickname: null,
        email_verified: true,
        submission_count: 0,
        submission_cap: 5,
      });
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    await waitFor(() => screen.getByRole('button', { name: /have email/i }));
    fireEvent.click(screen.getByRole('button', { name: /have email/i }));
    fireEvent.change(screen.getByPlaceholderText(/you@example\.com/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send code/i }));
    await waitFor(() => screen.getByPlaceholderText(/6.digit/i));
    fireEvent.change(screen.getByPlaceholderText(/6.digit/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }));
    await waitFor(() => expect(screen.getByPlaceholderText(/dancingqueen/i)).toBeInTheDocument());
  });

  it('skips email_prompt when nickname saved while already email-verified', async () => {
    mockGetProfile
      .mockResolvedValueOnce(emptyProfile)
      .mockResolvedValueOnce({
        nickname: null,
        email_verified: true,
        submission_count: 0,
        submission_cap: 5,
      });
    mockSetProfile.mockResolvedValue({
      nickname: 'NewUser',
      email_verified: true,
      submission_count: 0,
      submission_cap: 5,
    });
    render(<NicknameGate code="EVT01" onComplete={onComplete} />);
    // go through email login flow first
    await waitFor(() => screen.getByRole('button', { name: /have email/i }));
    fireEvent.click(screen.getByRole('button', { name: /have email/i }));
    fireEvent.change(screen.getByPlaceholderText(/you@example\.com/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send code/i }));
    await waitFor(() => screen.getByPlaceholderText(/6.digit/i));
    fireEvent.change(screen.getByPlaceholderText(/6.digit/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }));
    // now in nickname_input (verified, no nickname yet)
    await waitFor(() => screen.getByPlaceholderText(/dancingqueen/i));
    fireEvent.change(screen.getByPlaceholderText(/dancingqueen/i), {
      target: { value: 'NewUser' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    // should call onComplete directly, not show email_prompt
    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ nickname: 'NewUser', emailVerified: true }),
      ),
    );
    expect(screen.queryByText(/add your email/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to confirm all 10 tests fail**

```bash
cd dashboard && npm test -- --run components/__tests__/NicknameGate.test.tsx
```

Expected: 10 failures — components don't have the new states yet.

### Step 3: Rewrite NicknameGate

- [ ] **Replace the entire contents of `dashboard/components/NicknameGate.tsx`:**

```typescript
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { apiClient, ApiError, CollectProfileResponse, NicknameConflictError } from '../lib/api';
import { useGuestIdentity } from '../lib/use-guest-identity';
import { ModalOverlay } from './ModalOverlay';
import EmailVerification from './EmailVerification';

const nicknameSchema = z
  .string()
  .trim()
  .min(2, 'Nickname must be at least 2 characters')
  .max(30)
  .regex(/^[a-zA-Z0-9 _.-]+$/, 'Letters, numbers, spaces, . _ - only');

export interface GateResult {
  nickname: string;
  emailVerified: boolean;
  submissionCount: number;
  submissionCap: number;
}

interface Props {
  code: string;
  onComplete: (result: GateResult) => void;
}

type GateState =
  | 'loading'
  | 'error'
  | 'track_select'
  | 'nickname_input'
  | 'collision_unclaimed'
  | 'collision_claimed'
  | 'email_login'
  | 'email_code'
  | 'email_prompt';

export function NicknameGate({ code, onComplete }: Props) {
  const identity = useGuestIdentity();
  const [gateState, setGateState] = useState<GateState>('loading');
  const [savedNickname, setSavedNickname] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [collisionNickname, setCollisionNickname] = useState('');
  const [emailVerified, setEmailVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [profileCache, setProfileCache] = useState<CollectProfileResponse | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  const loadProfile = useCallback(async () => {
    setGateState('loading');
    try {
      const p = await apiClient.getCollectProfile(code);
      setProfileCache(p);
      if (p.nickname && p.email_verified) {
        onComplete({
          nickname: p.nickname,
          emailVerified: true,
          submissionCount: p.submission_count,
          submissionCap: p.submission_cap,
        });
      } else if (p.nickname) {
        setSavedNickname(p.nickname);
        setGateState('email_prompt');
      } else {
        setGateState('track_select');
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        onComplete({ nickname: '', emailVerified: false, submissionCount: 0, submissionCap: 0 });
      } else {
        setGateState('error');
      }
    }
  }, [code, onComplete]);

  useEffect(() => {
    if (identity.isLoading) return;
    loadProfile();
  }, [loadProfile, identity.isLoading]);

  const handleSaveNickname = async () => {
    const parsed = nicknameSchema.safeParse(nicknameInput);
    if (!parsed.success) {
      setInputError(parsed.error.issues[0].message);
      return;
    }
    setSaving(true);
    setInputError(null);
    try {
      const p = await apiClient.setCollectProfile(code, { nickname: parsed.data });
      setProfileCache(p);
      setSavedNickname(parsed.data);
      setSavedFlash(true);
      flashTimerRef.current = setTimeout(() => {
        setSavedFlash(false);
        if (emailVerified) {
          onComplete({
            nickname: parsed.data,
            emailVerified: true,
            submissionCount: p.submission_count,
            submissionCap: p.submission_cap,
          });
        } else {
          setGateState('email_prompt');
        }
      }, 1500);
    } catch (err) {
      if (err instanceof NicknameConflictError) {
        setCollisionNickname(parsed.data);
        setGateState(err.claimed ? 'collision_claimed' : 'collision_unclaimed');
      } else {
        setInputError(err instanceof ApiError ? err.message : "Couldn't save — please try again");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSendCode = async () => {
    setSendingCode(true);
    setInputError(null);
    try {
      await apiClient.requestVerificationCode(emailInput);
      setGateState('email_code');
    } catch (err) {
      setInputError(err instanceof ApiError ? err.message : 'Failed to send code. Try again.');
    } finally {
      setSendingCode(false);
    }
  };

  const handleConfirmCode = async () => {
    setVerifyingCode(true);
    setInputError(null);
    try {
      await apiClient.confirmVerificationCode(emailInput, codeInput);
      const p = await apiClient.getCollectProfile(code);
      setProfileCache(p);
      setEmailVerified(true);
      if (p.nickname) {
        onComplete({
          nickname: p.nickname,
          emailVerified: true,
          submissionCount: p.submission_count,
          submissionCap: p.submission_cap,
        });
      } else {
        setGateState('nickname_input');
      }
    } catch (err) {
      setInputError(err instanceof ApiError ? err.message : 'Invalid or expired code.');
    } finally {
      setVerifyingCode(false);
    }
  };

  const handleSkip = () => {
    onComplete({
      nickname: savedNickname,
      emailVerified: false,
      submissionCount: profileCache?.submission_count ?? 0,
      submissionCap: profileCache?.submission_cap ?? 0,
    });
  };

  const handleVerified = () => {
    onComplete({
      nickname: savedNickname,
      emailVerified: true,
      submissionCount: profileCache?.submission_count ?? 0,
      submissionCap: profileCache?.submission_cap ?? 0,
    });
  };

  // ── loading ───────────────────────────────────────────────────────────────

  if (gateState === 'loading') {
    return (
      <ModalOverlay card>
        <div style={{ textAlign: 'center', padding: '1rem' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Connecting…</p>
        </div>
      </ModalOverlay>
    );
  }

  if (gateState === 'error') {
    return (
      <ModalOverlay card>
        <p style={{ marginBottom: '1rem' }}>
          Couldn&apos;t connect to the event. Check your connection and try again.
        </p>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={loadProfile}>
          Retry
        </button>
      </ModalOverlay>
    );
  }

  // ── track_select ──────────────────────────────────────────────────────────

  if (gateState === 'track_select') {
    return (
      <ModalOverlay card>
        <h2 style={{ marginBottom: '0.5rem' }}>Join the event</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
          How would you like to identify yourself?
        </p>
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: '0.75rem' }}
          onClick={() => setGateState('nickname_input')}
        >
          ✏️ Pick a nickname
        </button>
        <button
          className="btn btn-secondary"
          style={{ width: '100%' }}
          onClick={() => setGateState('email_login')}
        >
          📧 I have an email
        </button>
      </ModalOverlay>
    );
  }

  // ── nickname_input ────────────────────────────────────────────────────────

  if (gateState === 'nickname_input') {
    return (
      <ModalOverlay card>
        <h2 style={{ marginBottom: '0.75rem' }}>What&apos;s your nickname?</h2>
        <div className="form-group">
          <input
            type="text"
            className="input"
            placeholder="DancingQueen"
            value={nicknameInput}
            onChange={(e) => {
              setNicknameInput(e.target.value);
              setInputError(null);
            }}
            maxLength={30}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nicknameInput.trim()) handleSaveNickname();
            }}
            autoFocus
          />
        </div>
        {inputError && <p className="collection-fieldset-error">{inputError}</p>}
        {savedFlash && (
          <p style={{ color: '#22c55e', marginBottom: '0.5rem' }}>&#10003; Nickname saved!</p>
        )}
        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          disabled={!nicknameInput.trim() || saving}
          onClick={handleSaveNickname}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </ModalOverlay>
    );
  }

  // ── collision_unclaimed ───────────────────────────────────────────────────

  if (gateState === 'collision_unclaimed') {
    return (
      <ModalOverlay card>
        <h2 style={{ marginBottom: '0.75rem' }}>Nickname taken</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
          <strong>&ldquo;{collisionNickname}&rdquo;</strong> is already taken.
        </p>
        <p
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '0.75rem',
            fontSize: '0.875rem',
            color: 'var(--text-secondary)',
            marginBottom: '1rem',
          }}
        >
          Not claimed yet. If this is yours, go back to the original device you used and claim it
          there with your email.
        </p>
        <button
          className="btn btn-secondary"
          style={{ width: '100%' }}
          onClick={() => {
            setNicknameInput('');
            setGateState('nickname_input');
          }}
        >
          Try a different nickname
        </button>
      </ModalOverlay>
    );
  }

  // ── collision_claimed ─────────────────────────────────────────────────────

  if (gateState === 'collision_claimed') {
    return (
      <ModalOverlay card>
        <h2 style={{ marginBottom: '0.75rem' }}>Nickname taken</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
          <strong>&ldquo;{collisionNickname}&rdquo;</strong> is already taken.
        </p>
        <p
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '0.75rem',
            fontSize: '0.875rem',
            color: 'var(--text-secondary)',
            marginBottom: '1rem',
          }}
        >
          This nickname has an email attached — if it&apos;s yours, log in to reclaim it.
        </p>
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: '0.75rem' }}
          onClick={() => setGateState('email_login')}
        >
          Log in with email
        </button>
        <button
          className="btn btn-secondary"
          style={{ width: '100%' }}
          onClick={() => {
            setNicknameInput('');
            setGateState('nickname_input');
          }}
        >
          Try a different nickname
        </button>
      </ModalOverlay>
    );
  }

  // ── email_login ───────────────────────────────────────────────────────────

  if (gateState === 'email_login') {
    return (
      <ModalOverlay card>
        <h2 style={{ marginBottom: '0.5rem' }}>Log in with email</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
          Enter your email to receive a login code.
        </p>
        <div className="form-group">
          <input
            type="email"
            className="input"
            placeholder="you@example.com"
            value={emailInput}
            onChange={(e) => {
              setEmailInput(e.target.value);
              setInputError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && emailInput.trim()) handleSendCode();
            }}
            autoFocus
          />
        </div>
        {inputError && <p className="collection-fieldset-error">{inputError}</p>}
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: '0.75rem' }}
          disabled={!emailInput.trim() || sendingCode}
          onClick={handleSendCode}
        >
          {sendingCode ? 'Sending…' : 'Send code'}
        </button>
        <button
          className="btn btn-secondary"
          style={{ width: '100%' }}
          onClick={() => setGateState('track_select')}
        >
          ← Back
        </button>
      </ModalOverlay>
    );
  }

  // ── email_code ────────────────────────────────────────────────────────────

  if (gateState === 'email_code') {
    return (
      <ModalOverlay card>
        <h2 style={{ marginBottom: '0.5rem' }}>Check your email</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
          Enter the 6-digit code sent to {emailInput}.
        </p>
        <div className="form-group">
          <input
            type="text"
            className="input"
            placeholder="6-digit code"
            value={codeInput}
            onChange={(e) => {
              setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6));
              setInputError(null);
            }}
            maxLength={6}
            autoFocus
          />
        </div>
        {inputError && <p className="collection-fieldset-error">{inputError}</p>}
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: '0.75rem' }}
          disabled={codeInput.length !== 6 || verifyingCode}
          onClick={handleConfirmCode}
        >
          {verifyingCode ? 'Verifying…' : 'Verify'}
        </button>
        <button
          className="btn btn-secondary"
          style={{ width: '100%' }}
          onClick={() => {
            setCodeInput('');
            setGateState('email_login');
          }}
        >
          Resend code
        </button>
      </ModalOverlay>
    );
  }

  // ── email_prompt ──────────────────────────────────────────────────────────

  return (
    <ModalOverlay card>
      <h2 style={{ marginBottom: '0.5rem' }}>Hi, {savedNickname}! 👋</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
        Add your email to unlock cross-device access and leaderboards.
      </p>
      <EmailVerification isVerified={false} onVerified={handleVerified} onSkip={handleSkip} />
    </ModalOverlay>
  );
}
```

- [ ] **Step 4: Run the 10 tests — all should pass**

```bash
cd dashboard && npm test -- --run components/__tests__/NicknameGate.test.tsx
```

Expected: 10 passed.

- [ ] **Step 5: Run the full frontend test suite to confirm no regressions**

```bash
npm test -- --run
```

Expected: All tests pass.

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add dashboard/components/NicknameGate.tsx dashboard/components/__tests__/NicknameGate.test.tsx
git commit -m "feat: redesign NicknameGate with two-track entry and collision UX"
```

---

## Task 5: Final CI verification and push

- [ ] **Step 1: Run full backend CI**

```bash
cd server
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/bandit -r app -c pyproject.toml -q
.venv/bin/pytest --tb=short -q
.venv/bin/alembic upgrade head && .venv/bin/alembic check
```

Expected: All pass. If `ruff format --check` fails, run `.venv/bin/ruff format .` then re-commit.

- [ ] **Step 2: Run full frontend CI**

```bash
cd dashboard
npm run lint
npx tsc --noEmit
npm test -- --run
```

Expected: All pass.

- [ ] **Step 3: Push branch and open PR**

```bash
git push -u origin feat/nickname-gate-redesign
gh pr create \
  --title "feat: nickname gate two-track entry and collision UX" \
  --body "$(cat <<'EOF'
## Summary
- Adds two-track entry to NicknameGate: pick a name vs log in with email
- Enforces per-event nickname uniqueness (case-insensitive) at DB and service layer
- 409 collision response distinguishes unclaimed (device hint) from email-claimed (OTP login flow)
- New Alembic migration 040 adds functional unique index on guest_profiles

## Test plan
- [ ] Backend: 7 new tests in TestNicknameUniqueness pass
- [ ] Frontend: 10 new NicknameGate tests pass
- [ ] Manual: open /join or /collect page as new guest, verify two-track gate appears
- [ ] Manual: try a taken nickname, verify correct collision message
- [ ] Manual: log in via email track end-to-end
EOF
)"
```
