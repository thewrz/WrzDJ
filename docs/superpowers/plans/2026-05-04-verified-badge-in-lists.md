# Verified Badge in Request Lists — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a green checkmark next to verified users' nicknames in the join-page and collect-page request lists.

**Architecture:** Outer-join `guests` table in two query sites (leaderboard endpoint, public requests endpoint). Derive `requester_verified` from `Guest.email_verified_at IS NOT NULL`. Frontend renders `✓` inline with existing nickname display. No migration needed.

**Tech Stack:** Python/FastAPI (SQLAlchemy outer join), Next.js/React (inline styles), Vitest + pytest (tests)

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `server/app/api/public.py:33-46` | Add `requester_verified` to `PublicRequestInfo` schema |
| Modify | `server/app/api/public.py:184-234` | Outer-join Guest in `get_public_requests()` |
| Modify | `server/app/schemas/collect.py:61-72` | Add `requester_verified` to `CollectLeaderboardRow` |
| Modify | `server/app/api/collect.py:114-147` | Outer-join Guest in `leaderboard()` |
| Modify | `dashboard/lib/api.ts:116-128` | Add `requester_verified` to TS `CollectLeaderboardRow` |
| Modify | `dashboard/app/collect/[code]/components/LeaderboardTabs.tsx:170-174` | Render ✓ badge |
| Modify | `dashboard/app/join/[code]/page.tsx:681-684` | Render ✓ badge |
| Modify | `server/tests/test_collect_public.py` | Test `requester_verified` in leaderboard |
| Modify | `server/tests/test_public.py` | Test `requester_verified` in guest request list |
| Modify | `dashboard/app/collect/[code]/components/LeaderboardTabs.test.tsx` | Update fixtures |

---

### Task 1: Backend — Add `requester_verified` to Pydantic schemas

**Files:**
- Modify: `server/app/api/public.py:33-41` (PublicRequestInfo)
- Modify: `server/app/schemas/collect.py:61-72` (CollectLeaderboardRow)

- [ ] **Step 1: Add field to `PublicRequestInfo`**

In `server/app/api/public.py`, add to class `PublicRequestInfo`:

```python
class PublicRequestInfo(BaseModel):
    id: int
    title: str
    artist: str
    artwork_url: str | None
    nickname: str | None = None
    vote_count: int = 0
    bpm: int | None = None
    musical_key: str | None = None
    genre: str | None = None
    requester_verified: bool = False
```

- [ ] **Step 2: Add field to `CollectLeaderboardRow`**

In `server/app/schemas/collect.py`, add to class `CollectLeaderboardRow`:

```python
class CollectLeaderboardRow(BaseModel):
    id: int
    title: str
    artist: str
    artwork_url: str | None
    vote_count: int
    nickname: str | None
    status: Literal["new", "accepted", "playing", "played", "rejected"]
    created_at: datetime
    bpm: int | None = None
    musical_key: str | None = None
    genre: str | None = None
    requester_verified: bool = False
```

- [ ] **Step 3: Verify schemas compile**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/python -c "from app.api.public import PublicRequestInfo; from app.schemas.collect import CollectLeaderboardRow; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add server/app/api/public.py server/app/schemas/collect.py
git commit -m "feat: add requester_verified field to public request schemas"
```

---

### Task 2: Backend — Outer-join Guest in leaderboard endpoint

**Files:**
- Modify: `server/app/api/collect.py:104-147`
- Test: `server/tests/test_collect_public.py`

- [ ] **Step 1: Write failing test — verified guest in leaderboard**

Append to `server/tests/test_collect_public.py`:

```python
def test_leaderboard_row_requester_verified_true(client, db, test_event: Event):
    """requester_verified is True when guest has email_verified_at set."""
    from app.models.guest import Guest
    from app.models.request import Request, RequestStatus

    _enable_collection(db, test_event)
    guest = Guest(
        token="verified_leaderboard_test",
        email_verified_at=datetime(2026, 5, 1),
    )
    db.add(guest)
    db.flush()
    req = Request(
        event_id=test_event.id,
        song_title="Verified Track",
        artist="Verified Artist",
        source="spotify",
        status=RequestStatus.NEW.value,
        vote_count=2,
        dedupe_key="verified_lb_test",
        submitted_during_collection=True,
        guest_id=guest.id,
        nickname="VerifiedUser",
    )
    db.add(req)
    db.commit()

    r = client.get(f"/api/public/collect/{test_event.code}/leaderboard?tab=all")
    assert r.status_code == 200
    rows = r.json()["requests"]
    assert len(rows) == 1
    assert rows[0]["requester_verified"] is True


def test_leaderboard_row_requester_verified_false_no_guest(client, db, test_event: Event):
    """requester_verified is False when request has no guest_id."""
    from app.models.request import Request, RequestStatus

    _enable_collection(db, test_event)
    req = Request(
        event_id=test_event.id,
        song_title="Anon Track",
        artist="Anon Artist",
        source="spotify",
        status=RequestStatus.NEW.value,
        vote_count=1,
        dedupe_key="anon_lb_test",
        submitted_during_collection=True,
    )
    db.add(req)
    db.commit()

    r = client.get(f"/api/public/collect/{test_event.code}/leaderboard?tab=all")
    assert r.status_code == 200
    rows = r.json()["requests"]
    assert len(rows) == 1
    assert rows[0]["requester_verified"] is False
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_collect_public.py::test_leaderboard_row_requester_verified_true -v`
Expected: FAIL (field not populated yet)

- [ ] **Step 3: Implement outer-join in `leaderboard()` endpoint**

In `server/app/api/collect.py`, update the `leaderboard()` function. Add import at top of file:

```python
from app.models.guest import Guest
```

Replace the query section (lines ~114–147):

```python
    q = (
        db.query(SongRequest, Guest.email_verified_at)
        .outerjoin(Guest, SongRequest.guest_id == Guest.id)
        .filter(SongRequest.event_id == event.id)
        .filter(SongRequest.submitted_during_collection == True)  # noqa: E712
    )
    if tab == "trending":
        q = q.filter(SongRequest.vote_count >= 1).order_by(
            SongRequest.vote_count.desc(), SongRequest.created_at.desc()
        )
    else:
        q = q.order_by(func.lower(SongRequest.song_title).asc())

    rows = q.limit(200).all()
    return CollectLeaderboardResponse(
        requests=[
            CollectLeaderboardRow(
                id=r.id,
                title=r.song_title,
                artist=r.artist,
                artwork_url=r.artwork_url,
                vote_count=r.vote_count,
                nickname=r.nickname,
                status=r.status,
                created_at=r.created_at,
                bpm=int(r.bpm) if r.bpm is not None else None,
                musical_key=r.musical_key,
                genre=r.genre,
                requester_verified=email_verified_at is not None,
            )
            for r, email_verified_at in rows
        ],
        total=len(rows),
    )
```

- [ ] **Step 4: Run tests — verify pass**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_collect_public.py -v -k "leaderboard"`
Expected: All leaderboard tests PASS (existing + new)

- [ ] **Step 5: Commit**

```bash
git add server/app/api/collect.py server/tests/test_collect_public.py
git commit -m "feat: populate requester_verified in collect leaderboard endpoint"
```

---

### Task 3: Backend — Outer-join Guest in public requests endpoint

**Files:**
- Modify: `server/app/api/public.py:184-234`
- Test: `server/tests/test_public.py`

- [ ] **Step 1: Write failing test — verified guest in public request list**

Append to `server/tests/test_public.py` (inside or after `TestGuestRequestList` class, or as a new class):

```python
class TestRequesterVerifiedField:
    """requester_verified field in GET /api/public/events/{code}/requests."""

    def test_verified_guest_shows_badge(self, client: TestClient, test_event: Event, db: Session):
        from app.models.guest import Guest

        guest = Guest(token="verified_public_test", email_verified_at=datetime(2026, 5, 1))
        db.add(guest)
        db.flush()
        req = Request(
            event_id=test_event.id,
            song_title="Badge Song",
            artist="Badge Artist",
            source="spotify",
            status=RequestStatus.NEW.value,
            dedupe_key="badge_test_001",
            guest_id=guest.id,
            nickname="Verified",
        )
        db.add(req)
        db.commit()

        response = client.get(f"/api/public/events/{test_event.code}/requests")
        assert response.status_code == 200
        data = response.json()
        assert data["requests"][0]["requester_verified"] is True

    def test_no_guest_shows_false(self, client: TestClient, test_event: Event, db: Session):
        req = Request(
            event_id=test_event.id,
            song_title="Orphan Song",
            artist="Orphan Artist",
            source="spotify",
            status=RequestStatus.NEW.value,
            dedupe_key="orphan_test_001",
        )
        db.add(req)
        db.commit()

        response = client.get(f"/api/public/events/{test_event.code}/requests")
        assert response.status_code == 200
        data = response.json()
        assert data["requests"][0]["requester_verified"] is False

    def test_unverified_guest_shows_false(self, client: TestClient, test_event: Event, db: Session):
        from app.models.guest import Guest

        guest = Guest(token="unverified_public_test", email_verified_at=None)
        db.add(guest)
        db.flush()
        req = Request(
            event_id=test_event.id,
            song_title="Unverified Song",
            artist="Unverified Artist",
            source="spotify",
            status=RequestStatus.NEW.value,
            dedupe_key="unverified_test_001",
            guest_id=guest.id,
        )
        db.add(req)
        db.commit()

        response = client.get(f"/api/public/events/{test_event.code}/requests")
        assert response.status_code == 200
        data = response.json()
        assert data["requests"][0]["requester_verified"] is False
```

Ensure `from datetime import datetime` is imported at top of test file.

- [ ] **Step 2: Run test — verify it fails**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_public.py::TestRequesterVerifiedField -v`
Expected: FAIL

- [ ] **Step 3: Implement outer-join in `get_public_requests()` endpoint**

In `server/app/api/public.py`, add import near top:

```python
from app.models.guest import Guest
```

Replace the request-fetching + response construction in `get_public_requests()` (lines ~203–234). Instead of calling `get_guest_visible_requests(db, event)`, inline the query with an outer join:

```python
    requests_with_verified = (
        db.query(SongRequest, Guest.email_verified_at)
        .outerjoin(Guest, SongRequest.guest_id == Guest.id)
        .filter(
            SongRequest.event_id == event.id,
            SongRequest.status.in_([RequestStatus.NEW.value, RequestStatus.ACCEPTED.value]),
        )
        .order_by(SongRequest.vote_count.desc(), SongRequest.created_at.desc())
        .limit(50)
        .all()
    )

    # Include now-playing if not hidden
    guest_now_playing = None
    if not is_now_playing_hidden(
        db, event.id, auto_hide_minutes=event.now_playing_auto_hide_minutes
    ):
        np = get_now_playing(db, event.id)
        if np:
            guest_now_playing = GuestNowPlaying(
                title=np.title,
                artist=np.artist,
                album_art_url=np.album_art_url,
                source=np.source,
            )

    return GuestRequestListResponse(
        event=PublicEventInfo(code=event.code, name=event.name),
        requests=[
            GuestRequestInfo(
                id=r.id,
                title=r.song_title,
                artist=r.artist,
                artwork_url=r.artwork_url,
                nickname=r.nickname,
                vote_count=r.vote_count,
                status=r.status,
                bpm=int(r.bpm) if r.bpm is not None else None,
                musical_key=r.musical_key,
                genre=r.genre,
                requester_verified=email_verified_at is not None,
            )
            for r, email_verified_at in requests_with_verified
        ],
        now_playing=guest_now_playing,
    )
```

Note: The `get_guest_visible_requests` import can be removed from the top if no other caller uses it in this file (check first — it's still imported for use in kiosk display, keep it if so).

- [ ] **Step 4: Run tests — verify pass**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/pytest tests/test_public.py -v`
Expected: All PASS

- [ ] **Step 5: Run full backend CI**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/ruff check . && .venv/bin/pytest --tb=short -q`
Expected: No lint errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add server/app/api/public.py server/tests/test_public.py
git commit -m "feat: populate requester_verified in public guest request list"
```

---

### Task 4: Frontend — Add `requester_verified` to TypeScript types

**Files:**
- Modify: `dashboard/lib/api.ts:116-128`

- [ ] **Step 1: Add field to `CollectLeaderboardRow`**

In `dashboard/lib/api.ts`, add to the `CollectLeaderboardRow` interface:

```typescript
export interface CollectLeaderboardRow {
  id: number;
  title: string;
  artist: string;
  artwork_url: string | null;
  vote_count: number;
  nickname: string | null;
  status: 'new' | 'accepted' | 'playing' | 'played' | 'rejected';
  created_at: string;
  bpm?: number | null;
  musical_key?: string | null;
  genre?: string | null;
  requester_verified?: boolean;
}
```

Note: `PublicRequestInfo` and `GuestRequestInfo` are auto-generated from the OpenAPI spec (in `api-types.generated.ts`). After running `npm run types:generate`, the field will appear there automatically. The hand-crafted `CollectLeaderboardRow` in `api.ts` needs manual update.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/adam/github/WrzDJ/dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/api.ts
git commit -m "feat: add requester_verified to CollectLeaderboardRow type"
```

---

### Task 5: Frontend — Render verified badge in LeaderboardTabs

**Files:**
- Modify: `dashboard/app/collect/[code]/components/LeaderboardTabs.tsx:170-174`
- Modify: `dashboard/app/collect/[code]/components/LeaderboardTabs.test.tsx`

- [ ] **Step 1: Update test fixture with `requester_verified` field**

In `dashboard/app/collect/[code]/components/LeaderboardTabs.test.tsx`, add a test case for the verified badge. First, add `requester_verified: true` to one fixture row:

Change the first row in the `rows` array (line 6):
```typescript
const rows: CollectLeaderboardRow[] = [
  {
    id: 1,
    title: 'A',
    artist: 'X',
    artwork_url: null,
    vote_count: 5,
    nickname: 'alex',
    status: 'new' as const,
    created_at: '2026-04-21',
    bpm: null,
    musical_key: null,
    genre: null,
    requester_verified: true,
  },
  ...
```

Add a test:
```typescript
it('renders verified badge for verified requester', () => {
  render(
    <LeaderboardTabs
      rows={rows}
      tab="trending"
      onTabChange={vi.fn()}
      onVote={vi.fn()}
      votedIds={new Set()}
    />,
  );
  const badge = screen.getByText('✓');
  expect(badge).toBeInTheDocument();
  expect(badge).toHaveStyle({ color: '#22c55e' });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `cd /home/adam/github/WrzDJ/dashboard && npx vitest run app/collect/\\[code\\]/components/LeaderboardTabs.test.tsx`
Expected: FAIL — ✓ not rendered yet

- [ ] **Step 3: Render badge in LeaderboardTabs**

In `dashboard/app/collect/[code]/components/LeaderboardTabs.tsx`, find the nickname rendering block (~line 170–174):

```tsx
{r.nickname && (
  <div className="collect-row-nickname">
    <em className="nickname-icon">@</em>{r.nickname}
  </div>
)}
```

Replace with:

```tsx
{r.nickname && (
  <div className="collect-row-nickname">
    <em className="nickname-icon">@</em>{r.nickname}
    {r.requester_verified && <span style={{ color: '#22c55e', marginLeft: 4, fontStyle: 'normal' }}>✓</span>}
  </div>
)}
```

- [ ] **Step 4: Run test — verify pass**

Run: `cd /home/adam/github/WrzDJ/dashboard && npx vitest run app/collect/\\[code\\]/components/LeaderboardTabs.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/collect/[code]/components/LeaderboardTabs.tsx dashboard/app/collect/[code]/components/LeaderboardTabs.test.tsx
git commit -m "feat: render verified badge in collect leaderboard"
```

---

### Task 6: Frontend — Render verified badge in join page

**Files:**
- Modify: `dashboard/app/join/[code]/page.tsx:681-684`

- [ ] **Step 1: Render badge in join page request list**

In `dashboard/app/join/[code]/page.tsx`, find the nickname line (~line 681–684):

```tsx
{req.nickname && (
  <div style={{ fontSize: 12.1, color: subFg2, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
    Requested by {req.nickname}
  </div>
)}
```

Replace with:

```tsx
{req.nickname && (
  <div style={{ fontSize: 12.1, color: subFg2, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
    Requested by {req.nickname}
    {req.requester_verified && <span style={{ color: '#22c55e', marginLeft: 4 }}>✓</span>}
  </div>
)}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/adam/github/WrzDJ/dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/join/[code]/page.tsx
git commit -m "feat: render verified badge in join page request list"
```

---

### Task 7: Regenerate OpenAPI types + final validation

**Files:**
- Regenerate: `dashboard/lib/api-types.generated.ts`

- [ ] **Step 1: Regenerate frontend types from backend OpenAPI spec**

Run: `cd /home/adam/github/WrzDJ/dashboard && npm run types:generate`
Expected: `api-types.generated.ts` updated with `requester_verified` in `PublicRequestInfo` and `GuestRequestInfo` schemas.

- [ ] **Step 2: Run full frontend CI**

Run: `cd /home/adam/github/WrzDJ/dashboard && npm run lint && npx tsc --noEmit && npx vitest run`
Expected: All pass

- [ ] **Step 3: Run full backend CI**

Run: `cd /home/adam/github/WrzDJ/server && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/bandit -r app -c pyproject.toml -q && .venv/bin/pytest --tb=short -q`
Expected: All pass

- [ ] **Step 4: Commit regenerated types (if changed)**

```bash
git add dashboard/lib/api-types.generated.ts
git commit -m "chore: regenerate OpenAPI types with requester_verified field"
```
