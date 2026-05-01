# Song Detail Panels, Vibes Enrichment & Collect UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix oversized artwork on the join detail sheet, add a tappable detail panel to the collect leaderboard (responsive: bottom sheet on mobile, centered dialog on desktop), expose enrichment fields (BPM/key/genre) in both public API responses, trigger enrichment on collect submissions, and add the "Highlight by Vibes" toggle with a scanline loading animation to collect search.

**Architecture:** Backend schema changes expose existing DB columns (`bpm`, `musical_key`, `genre`) through `PublicRequestInfo` and `CollectLeaderboardRow` without migrations. A new public `enrich-preview` endpoint calls Beatport fuzzy search on-demand for search-time vibes. Frontend adds a new `CollectDetailSheet` component and ports the vibes toggle from the join page.

**Tech Stack:** Python/FastAPI (Pydantic schemas, BackgroundTasks), SQLAlchemy, pytest; Next.js 16/React 19, TypeScript, vanilla CSS; openapi-typescript type generation.

**Spec:** `docs/superpowers/specs/2026-04-30-song-detail-vibes-enrichment-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `server/app/api/public.py` | Modify | Add `bpm`/`musical_key`/`genre` to `PublicRequestInfo`; populate in `get_public_requests` |
| `server/app/schemas/collect.py` | Modify | Add same 3 fields to `CollectLeaderboardRow`; add `EnrichPreviewItem/Result/Request/Response` schemas |
| `server/app/api/collect.py` | Modify | Populate fields in leaderboard; add `BackgroundTasks` to submit; add `enrich-preview` route |
| `server/tests/test_public.py` | Modify | Test BPM/key/genre in public request list response |
| `server/tests/test_collect_public.py` | Modify | Test leaderboard fields, enrichment trigger, enrich-preview endpoint |
| `dashboard/lib/api.ts` | Modify | Add 3 fields to `CollectLeaderboardRow` interface; add `enrichPreview()` method |
| `dashboard/app/join/[code]/components/SongDetailSheet.tsx` | Modify | Cap artwork at 160px; add BPM/key pills |
| `dashboard/app/collect/[code]/components/CollectDetailSheet.tsx` | **Create** | Responsive detail panel (mobile sheet / desktop dialog) |
| `dashboard/app/collect/[code]/components/LeaderboardTabs.tsx` | Modify | Add `onRowClick` prop; wire row clicks; stop-propagation on vote button |
| `dashboard/app/collect/[code]/page.tsx` | Modify | Wire `CollectDetailSheet`; add vibes state + toggle + `enrichPreview` call |
| `dashboard/app/globals.css` | Modify | Add `.vbs-scanning`, `.vbs-analyzing`, `.vbs-tier-in` CSS + keyframes |

---

## Task 1: Expose enrichment fields in PublicRequestInfo

**Files:**
- Modify: `server/app/api/public.py`
- Test: `server/tests/test_public.py`

- [ ] **Step 1: Write the failing test**

In `server/tests/test_public.py`, add after the existing `TestMyRequests` class:

```python
class TestPublicRequestsEnrichmentFields:
    """bpm/musical_key/genre are exposed in /events/{code}/requests response."""

    def test_enrichment_fields_present_when_set(
        self, client: TestClient, test_event: Event, db: Session
    ):
        from app.models.request import Request, RequestStatus

        req = Request(
            event_id=test_event.id,
            song_title="Levels",
            artist="Avicii",
            source="beatport",
            status=RequestStatus.NEW.value,
            dedupe_key="levels_avicii_001",
            bpm=128.0,
            musical_key="8A",
            genre="Progressive House",
        )
        db.add(req)
        db.commit()

        response = client.get(f"/api/public/events/{test_event.code}/requests")
        assert response.status_code == 200
        requests = response.json()["requests"]
        assert len(requests) == 1
        assert requests[0]["bpm"] == 128
        assert requests[0]["musical_key"] == "8A"
        assert requests[0]["genre"] == "Progressive House"

    def test_enrichment_fields_null_when_not_set(
        self, client: TestClient, test_event: Event, db: Session
    ):
        from app.models.request import Request, RequestStatus

        req = Request(
            event_id=test_event.id,
            song_title="Unknown",
            artist="Someone",
            source="spotify",
            status=RequestStatus.NEW.value,
            dedupe_key="unknown_someone_001",
        )
        db.add(req)
        db.commit()

        response = client.get(f"/api/public/events/{test_event.code}/requests")
        assert response.status_code == 200
        requests = response.json()["requests"]
        assert len(requests) == 1
        assert requests[0]["bpm"] is None
        assert requests[0]["musical_key"] is None
        assert requests[0]["genre"] is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && .venv/bin/pytest tests/test_public.py::TestPublicRequestsEnrichmentFields -v
```

Expected: FAIL — `KeyError: 'bpm'` or assertion on missing field.

- [ ] **Step 3: Add fields to PublicRequestInfo**

In `server/app/api/public.py`, replace the `PublicRequestInfo` class:

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
```

- [ ] **Step 4: Populate fields in get_public_requests**

In `server/app/api/public.py`, find the `get_public_requests` endpoint. Replace the `GuestRequestInfo(...)` constructor call in the list comprehension:

```python
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
        )
        for r in requests_list
    ],
    now_playing=guest_now_playing,
)
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd server && .venv/bin/pytest tests/test_public.py::TestPublicRequestsEnrichmentFields -v
```

Expected: PASS (both tests green).

- [ ] **Step 6: Run the full public test suite**

```bash
cd server && .venv/bin/pytest tests/test_public.py -v
```

Expected: all existing tests still PASS.

- [ ] **Step 7: Lint + format**

```bash
cd server && .venv/bin/ruff check app/api/public.py && .venv/bin/ruff format app/api/public.py
```

- [ ] **Step 8: Commit**

```bash
git checkout -b feat/song-detail-vibes-enrichment
git add server/app/api/public.py server/tests/test_public.py
git commit -m "feat(api): expose bpm/musical_key/genre in PublicRequestInfo"
```

---

## Task 2: Expose enrichment fields in CollectLeaderboardRow

**Files:**
- Modify: `server/app/schemas/collect.py`
- Modify: `server/app/api/collect.py`
- Test: `server/tests/test_collect_public.py`

- [ ] **Step 1: Write the failing test**

In `server/tests/test_collect_public.py`, add after the existing leaderboard tests:

```python
def test_leaderboard_row_includes_enrichment_fields(client, db, test_event: Event):
    """Leaderboard rows expose bpm/musical_key/genre when set on the request."""
    from app.models.request import Request, RequestStatus

    _enable_collection(db, test_event)
    req = Request(
        event_id=test_event.id,
        song_title="Levels",
        artist="Avicii",
        source="beatport",
        status=RequestStatus.NEW.value,
        vote_count=3,
        dedupe_key="levels_avicii_enriched",
        submitted_during_collection=True,
        bpm=128.0,
        musical_key="8A",
        genre="Progressive House",
    )
    db.add(req)
    db.commit()

    r = client.get(f"/api/public/collect/{test_event.code}/leaderboard?tab=all")
    assert r.status_code == 200
    rows = r.json()["requests"]
    assert len(rows) == 1
    assert rows[0]["bpm"] == 128
    assert rows[0]["musical_key"] == "8A"
    assert rows[0]["genre"] == "Progressive House"


def test_leaderboard_row_enrichment_fields_null_when_missing(client, db, test_event: Event):
    from app.models.request import Request, RequestStatus

    _enable_collection(db, test_event)
    req = Request(
        event_id=test_event.id,
        song_title="Unknown",
        artist="Someone",
        source="spotify",
        status=RequestStatus.NEW.value,
        dedupe_key="unknown_someone_collect",
        submitted_during_collection=True,
    )
    db.add(req)
    db.commit()

    r = client.get(f"/api/public/collect/{test_event.code}/leaderboard?tab=all")
    assert r.status_code == 200
    rows = r.json()["requests"]
    assert len(rows) == 1
    assert rows[0]["bpm"] is None
    assert rows[0]["musical_key"] is None
    assert rows[0]["genre"] is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && .venv/bin/pytest tests/test_collect_public.py::test_leaderboard_row_includes_enrichment_fields tests/test_collect_public.py::test_leaderboard_row_enrichment_fields_null_when_missing -v
```

Expected: FAIL — field missing from response.

- [ ] **Step 3: Add fields to CollectLeaderboardRow schema**

In `server/app/schemas/collect.py`, replace `CollectLeaderboardRow`:

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
```

- [ ] **Step 4: Populate fields in the leaderboard endpoint**

In `server/app/api/collect.py`, find the `leaderboard` endpoint's `CollectLeaderboardRow(...)` constructor call and add the three fields:

```python
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
        )
        for r in rows
    ],
    total=len(rows),
)
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd server && .venv/bin/pytest tests/test_collect_public.py::test_leaderboard_row_includes_enrichment_fields tests/test_collect_public.py::test_leaderboard_row_enrichment_fields_null_when_missing -v
```

Expected: PASS.

- [ ] **Step 6: Run the full collect public test suite**

```bash
cd server && .venv/bin/pytest tests/test_collect_public.py -v
```

Expected: all tests PASS.

- [ ] **Step 7: Lint + format**

```bash
cd server && .venv/bin/ruff check app/schemas/collect.py app/api/collect.py && .venv/bin/ruff format app/schemas/collect.py app/api/collect.py
```

- [ ] **Step 8: Commit**

```bash
git add server/app/schemas/collect.py server/app/api/collect.py server/tests/test_collect_public.py
git commit -m "feat(collect): expose bpm/musical_key/genre in leaderboard response"
```

---

## Task 3: Trigger enrichment on collect submit

**Files:**
- Modify: `server/app/api/collect.py`
- Test: `server/tests/test_collect_public.py`

- [ ] **Step 1: Write the failing test**

In `server/tests/test_collect_public.py`, add:

```python
def test_collect_submit_triggers_enrichment(client, db, test_event: Event):
    """Submitting a pick fires enrich_request_metadata as a background task."""
    from unittest.mock import patch

    _enable_collection(db, test_event)

    with patch("app.api.collect.enrich_request_metadata") as mock_enrich:
        r = client.post(
            f"/api/public/collect/{test_event.code}/requests",
            json={
                "song_title": "Levels",
                "artist": "Avicii",
                "source": "spotify",
            },
        )

    assert r.status_code == 201
    assert r.json()["is_duplicate"] is False
    mock_enrich.assert_called_once()
    _, request_id = mock_enrich.call_args[0]
    assert isinstance(request_id, int)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && .venv/bin/pytest tests/test_collect_public.py::test_collect_submit_triggers_enrichment -v
```

Expected: FAIL — `mock_enrich.assert_called_once()` fails (not called).

- [ ] **Step 3: Add BackgroundTasks + enrichment to submit endpoint**

In `server/app/api/collect.py`:

Add to the top-level imports at the top of the file:
```python
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
```
(Replace the existing `from fastapi import APIRouter, Depends, HTTPException, Request` line.)

Add the enrichment import after the existing service imports:
```python
from app.services.sync.enrichment_pipeline import enrich_request_metadata
```

Find the `submit` function signature and add `background_tasks: BackgroundTasks`:
```python
@router.post("/{code}/requests", status_code=201)
@limiter.limit("10/minute")
def submit(
    code: str,
    payload: CollectSubmitRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
```

After `db.refresh(row)` (line ~375), add:
```python
    background_tasks.add_task(enrich_request_metadata, db, row.id)
```

The full block after commit should look like:
```python
    db.add(row)
    db.commit()
    db.refresh(row)
    background_tasks.add_task(enrich_request_metadata, db, row.id)
    log_activity(
        ...
    )
    return {"id": row.id, "is_duplicate": False}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && .venv/bin/pytest tests/test_collect_public.py::test_collect_submit_triggers_enrichment -v
```

Expected: PASS.

- [ ] **Step 5: Run full collect test suite to check no regressions**

```bash
cd server && .venv/bin/pytest tests/test_collect_public.py tests/test_collect_service.py tests/test_collect_dj.py -v
```

Expected: all PASS.

- [ ] **Step 6: Lint + format**

```bash
cd server && .venv/bin/ruff check app/api/collect.py && .venv/bin/ruff format app/api/collect.py
```

- [ ] **Step 7: Commit**

```bash
git add server/app/api/collect.py server/tests/test_collect_public.py
git commit -m "feat(collect): trigger enrichment background task on pick submit"
```

---

## Task 4: Add enrich-preview endpoint

**Files:**
- Modify: `server/app/schemas/collect.py`
- Modify: `server/app/api/collect.py`
- Test: `server/tests/test_collect_public.py`

- [ ] **Step 1: Write the failing tests**

In `server/tests/test_collect_public.py`, add:

```python
def test_enrich_preview_returns_nulls_without_beatport_token(client, db, test_event: Event):
    """When the DJ has no Beatport token, all results have null bpm/key/genre."""
    _enable_collection(db, test_event)
    # Ensure no beatport token on the DJ user
    dj = test_event.created_by
    dj.beatport_access_token = None
    db.commit()

    r = client.post(
        f"/api/public/collect/{test_event.code}/enrich-preview",
        json={"items": [{"title": "Levels", "artist": "Avicii"}]},
    )
    assert r.status_code == 200
    results = r.json()["results"]
    assert len(results) == 1
    assert results[0]["title"] == "Levels"
    assert results[0]["artist"] == "Avicii"
    assert results[0]["bpm"] is None
    assert results[0]["key"] is None
    assert results[0]["genre"] is None


def test_enrich_preview_returns_bpm_from_beatport(client, db, test_event: Event):
    """When Beatport search returns a match, bpm/key/genre are populated."""
    from unittest.mock import MagicMock, patch

    _enable_collection(db, test_event)

    dj = test_event.created_by
    dj.beatport_access_token = "fake_token"  # nosec B106
    db.commit()

    mock_match = MagicMock()
    mock_match.title = "Levels"
    mock_match.artist = "Avicii"
    mock_match.bpm = 128
    mock_match.key = "8A"
    mock_match.genre = "Progressive House"
    mock_match.mix_name = "Original Mix"

    with patch("app.api.collect.search_beatport_tracks", return_value=[mock_match]), \
         patch("app.api.collect._find_best_match", return_value=mock_match):
        r = client.post(
            f"/api/public/collect/{test_event.code}/enrich-preview",
            json={"items": [{"title": "Levels", "artist": "Avicii"}]},
        )

    assert r.status_code == 200
    results = r.json()["results"]
    assert len(results) == 1
    assert results[0]["bpm"] == 128
    assert results[0]["key"] == "8A"
    assert results[0]["genre"] == "Progressive House"


def test_enrich_preview_caps_at_10_items(client, db, test_event: Event):
    """Requests with >10 items are silently capped — only first 10 processed."""
    _enable_collection(db, test_event)
    dj = test_event.created_by
    dj.beatport_access_token = None
    db.commit()

    items = [{"title": f"Song {i}", "artist": f"Artist {i}"} for i in range(15)]
    r = client.post(
        f"/api/public/collect/{test_event.code}/enrich-preview",
        json={"items": items},
    )
    assert r.status_code == 200
    assert len(r.json()["results"]) == 10


def test_enrich_preview_404_for_unknown_event(client):
    r = client.post(
        "/api/public/collect/ZZZZZZ/enrich-preview",
        json={"items": [{"title": "X", "artist": "Y"}]},
    )
    assert r.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && .venv/bin/pytest tests/test_collect_public.py::test_enrich_preview_returns_nulls_without_beatport_token tests/test_collect_public.py::test_enrich_preview_returns_bpm_from_beatport tests/test_collect_public.py::test_enrich_preview_caps_at_10_items tests/test_collect_public.py::test_enrich_preview_404_for_unknown_event -v
```

Expected: FAIL — 404 (route not found).

- [ ] **Step 3: Add Pydantic schemas**

In `server/app/schemas/collect.py`, add at the bottom:

```python
class EnrichPreviewItem(BaseModel):
    title: str
    artist: str
    source_url: str | None = None


class EnrichPreviewResult(BaseModel):
    title: str
    artist: str
    bpm: int | None = None
    key: str | None = None
    genre: str | None = None


class EnrichPreviewRequest(BaseModel):
    items: list[EnrichPreviewItem]


class EnrichPreviewResponse(BaseModel):
    results: list[EnrichPreviewResult]
```

- [ ] **Step 4: Add imports to collect.py**

In `server/app/api/collect.py`, replace the existing schema import block with:

```python
from app.schemas.collect import (
    CollectLeaderboardResponse,
    CollectLeaderboardRow,
    CollectMyPicksItem,
    CollectMyPicksResponse,
    CollectProfileRequest,
    CollectProfileResponse,
    CollectSubmitRequest,
    CollectVoteRequest,
    EnrichPreviewRequest,
    EnrichPreviewResponse,
    EnrichPreviewResult,
)
```

Also add these service imports after the existing service imports:

```python
from app.services.beatport import search_beatport_tracks
from app.services.sync.enrichment_pipeline import _find_best_match
```

If a circular import occurs (unlikely given the existing import structure), move them into the function body instead.

- [ ] **Step 5: Add the enrich-preview route**

In `server/app/api/collect.py`, add at the end of the file (after the `vote` endpoint):

```python
@router.post("/{code}/enrich-preview", response_model=EnrichPreviewResponse)
@limiter.limit("10/minute")
def enrich_preview(
    code: str,
    payload: EnrichPreviewRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> EnrichPreviewResponse:
    """Lightweight Beatport BPM/key lookup for search-time vibes — no DB writes."""
    event = _get_event_or_404(db, code)
    user = event.created_by
    items = payload.items[:10]
    results: list[EnrichPreviewResult] = []

    for item in items:
        bpm = None
        key = None
        genre = None

        if user and user.beatport_access_token:
            try:
                matches = search_beatport_tracks(db, user, f"{item.artist} {item.title}", limit=5)
                if matches:
                    best = _find_best_match(matches, item.title, item.artist)
                    if best:
                        bpm = int(best.bpm) if best.bpm is not None else None
                        key = best.key or None
                        genre = best.genre or None
            except Exception:
                pass  # nosec B110 — best-effort, callers handle null fields

        results.append(EnrichPreviewResult(
            title=item.title,
            artist=item.artist,
            bpm=bpm,
            key=key,
            genre=genre,
        ))

    return EnrichPreviewResponse(results=results)
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd server && .venv/bin/pytest tests/test_collect_public.py::test_enrich_preview_returns_nulls_without_beatport_token tests/test_collect_public.py::test_enrich_preview_returns_bpm_from_beatport tests/test_collect_public.py::test_enrich_preview_caps_at_10_items tests/test_collect_public.py::test_enrich_preview_404_for_unknown_event -v
```

Expected: all 4 PASS.

- [ ] **Step 7: Run full backend test suite**

```bash
cd server && .venv/bin/pytest --tb=short -q
```

Expected: all PASS, coverage ≥ 70%.

- [ ] **Step 8: Security scan**

```bash
cd server && .venv/bin/bandit -r app -c pyproject.toml -q
```

Expected: no new HIGH/MEDIUM issues. The `# nosec B110` in the endpoint suppresses the intentional `except/pass`.

- [ ] **Step 9: Lint + format**

```bash
cd server && .venv/bin/ruff check app/schemas/collect.py app/api/collect.py && .venv/bin/ruff format app/schemas/collect.py app/api/collect.py
```

- [ ] **Step 10: Commit**

```bash
git add server/app/schemas/collect.py server/app/api/collect.py server/tests/test_collect_public.py
git commit -m "feat(collect): add enrich-preview endpoint for search-time vibes BPM lookup"
```

---

## Task 5: Regenerate frontend types + update CollectLeaderboardRow

**Files:**
- Modify (generated): `dashboard/lib/api-types.generated.ts`
- Modify: `dashboard/lib/api.ts`

- [ ] **Step 1: Export the updated OpenAPI schema**

```bash
cd server && .venv/bin/python scripts/export_openapi.py
```

This writes `server/openapi.json` reflecting the new `bpm`/`musical_key`/`genre` fields on `PublicRequestInfo` and `GuestRequestInfo`.

- [ ] **Step 2: Regenerate TypeScript types**

```bash
cd dashboard && npm run types:generate
```

Expected: `dashboard/lib/api-types.generated.ts` updated. `GuestRequestInfo` in the generated file now includes `bpm`, `musical_key`, `genre` as optional nullable fields.

- [ ] **Step 3: Verify generated type includes new fields**

```bash
grep -A 5 "GuestRequestInfo" dashboard/lib/api-types.generated.ts | head -20
```

Expected output includes lines like:
```
bpm?: number | null;
musical_key?: string | null;
genre?: string | null;
```

- [ ] **Step 4: Add fields to the manual CollectLeaderboardRow interface**

In `dashboard/lib/api.ts`, find the `CollectLeaderboardRow` interface at line ~116 and replace it:

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
}
```

- [ ] **Step 5: Add enrichPreview method to ApiClient**

In `dashboard/lib/api.ts`, add this method to the `ApiClient` class (near other public collect methods):

```typescript
async enrichPreview(
  code: string,
  items: Array<{ title: string; artist: string; source_url?: string }>,
): Promise<Array<{ title: string; artist: string; bpm?: number | null; key?: string | null; genre?: string | null }>> {
  try {
    const res = await fetch(
      `${this.baseUrl}/api/public/collect/${encodeURIComponent(code)}/enrich-preview`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      },
    );
    if (!res.ok) return items.map((i) => ({ title: i.title, artist: i.artist }));
    const data = await res.json();
    return data.results ?? [];
  } catch {
    return items.map((i) => ({ title: i.title, artist: i.artist }));
  }
}
```

- [ ] **Step 6: TypeScript check**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add dashboard/lib/api-types.generated.ts dashboard/lib/api.ts server/openapi.json
git commit -m "feat(types): regenerate frontend types with bpm/musical_key/genre; add enrichPreview method"
```

---

## Task 6: Fix SongDetailSheet — artwork size + BPM/key pills

**Files:**
- Modify: `dashboard/app/join/[code]/components/SongDetailSheet.tsx`

- [ ] **Step 1: Run existing join page tests to confirm current baseline**

```bash
cd dashboard && npm test -- --run app/join
```

Expected: PASS.

- [ ] **Step 2: Fix artwork size**

In `dashboard/app/join/[code]/components/SongDetailSheet.tsx`, find the artwork `<div>` starting at line ~78. Replace:

```tsx
        {/* Artwork */}
        <div style={{
          width: '100%', aspectRatio: '1', borderRadius: 22, marginTop: 6,
          background: track.artwork_url ? undefined : artGradient(track.title + track.artist),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          boxShadow: `0 30px 70px -20px ${ACCENT}70, 0 0 0 1px ${border}`,
        }}>
```

With:

```tsx
        {/* Artwork */}
        <div style={{
          width: 160, height: 160, borderRadius: 22, marginTop: 6, margin: '6px auto 0',
          background: track.artwork_url ? undefined : artGradient(track.title + track.artist),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          boxShadow: `0 20px 50px -12px ${ACCENT}70, 0 0 0 1px ${border}`,
        }}>
```

Also update the initials font size inside this div (it was sized for full-width art):

```tsx
            <span style={{
              fontSize: 48, fontWeight: 800, color: '#fff', letterSpacing: 1,
              textShadow: '0 4px 30px rgba(0,0,0,0.3)',
            }}>
```

(was `fontSize: 77.4`)

- [ ] **Step 3: Add BPM/key pills below artist name**

In `SongDetailSheet.tsx`, find the title + artist block (starting around line ~101). After the artist `<div>`, add the pills row:

```tsx
        {/* Title + artist */}
        <div style={{ marginTop: 22, textAlign: 'center' }}>
          <div style={{ fontSize: 33.9, fontWeight: 800, letterSpacing: -0.8, lineHeight: 1.05 }}>
            {track.title}
          </div>
          <div style={{ fontSize: 20.6, color: subFg, marginTop: 5, fontWeight: 500 }}>
            {track.artist}
          </div>
          {(track.bpm || track.musical_key) && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              {track.bpm && (
                <span style={{
                  fontFamily: 'var(--font-mono, monospace)', fontSize: 10.9, fontWeight: 700,
                  padding: '3px 9px', borderRadius: 6,
                  background: `${ACCENT}18`, border: `1px solid ${ACCENT}50`, color: ACCENT,
                  letterSpacing: 1,
                }}>
                  {track.bpm} BPM
                </span>
              )}
              {track.musical_key && (
                <span style={{
                  fontFamily: 'var(--font-mono, monospace)', fontSize: 10.9, fontWeight: 700,
                  padding: '3px 9px', borderRadius: 6,
                  background: 'rgba(255,255,255,0.06)', border: `1px solid ${border}`,
                  color: 'rgba(255,255,255,0.7)', letterSpacing: 1,
                }}>
                  {track.musical_key}
                </span>
              )}
            </div>
          )}
        </div>
```

Note: also add `textAlign: 'center'` to the outer title div (as shown above).

- [ ] **Step 4: TypeScript check**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no errors. (`track.bpm` and `track.musical_key` are now on the generated `GuestRequestInfo` type.)

- [ ] **Step 5: Run join tests**

```bash
cd dashboard && npm test -- --run app/join
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/join/[code]/components/SongDetailSheet.tsx
git commit -m "fix(join): cap SongDetailSheet artwork at 160px and add BPM/key pills"
```

---

## Task 7: New CollectDetailSheet component

**Files:**
- Create: `dashboard/app/collect/[code]/components/CollectDetailSheet.tsx`

- [ ] **Step 1: Create the component file**

Create `dashboard/app/collect/[code]/components/CollectDetailSheet.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { CollectLeaderboardRow } from '@/lib/api';

interface Props {
  row: CollectLeaderboardRow;
  rank: number;
  totalCount: number;
  voted: boolean;
  onVote: () => void;
  onClose: () => void;
}

const ACCENT = '#00f0ff';
const ACCENT2 = '#ff2bd6';

const GRADIENTS = [
  'linear-gradient(135deg, #ff006e, #8338ec, #3a86ff)',
  'linear-gradient(135deg, #ffbe0b, #fb5607)',
  'linear-gradient(135deg, #06ffa5, #0077b6)',
  'linear-gradient(135deg, #ff6b9d, #c44569)',
  'linear-gradient(135deg, #f72585, #7209b7)',
  'linear-gradient(135deg, #4cc9f0, #4361ee)',
  'linear-gradient(135deg, #f15bb5, #fee440)',
  'linear-gradient(135deg, #2dc653, #25a244)',
  'linear-gradient(135deg, #ef476f, #ffd166)',
];
function artGradient(seed: string) {
  const code = (seed.charCodeAt(0) || 0) + (seed.charCodeAt(1) || 0);
  return GRADIENTS[code % GRADIENTS.length];
}

export default function CollectDetailSheet({
  row, rank, totalCount, voted, onVote, onClose,
}: Props) {
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    const check = () => setIsWide(window.innerWidth >= 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const surface = 'rgba(255,255,255,0.05)';
  const border = 'rgba(255,255,255,0.1)';
  const subFg = 'rgba(255,255,255,0.55)';
  const subFg2 = 'rgba(255,255,255,0.35)';
  const initials = `${row.title[0] ?? '?'}${row.artist[0] ?? ''}`.toUpperCase();

  const pills = (row.bpm || row.musical_key) ? (
    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
      {row.bpm && (
        <span style={{
          fontFamily: 'var(--font-mono, monospace)', fontSize: 10.3, fontWeight: 700,
          padding: '3px 9px', borderRadius: 6,
          background: `${ACCENT}18`, border: `1px solid ${ACCENT}50`, color: ACCENT,
          letterSpacing: 1,
        }}>
          {row.bpm} BPM
        </span>
      )}
      {row.musical_key && (
        <span style={{
          fontFamily: 'var(--font-mono, monospace)', fontSize: 10.3, fontWeight: 700,
          padding: '3px 9px', borderRadius: 6,
          background: 'rgba(255,255,255,0.06)', border: `1px solid ${border}`,
          color: 'rgba(255,255,255,0.7)', letterSpacing: 1,
        }}>
          {row.musical_key}
        </span>
      )}
    </div>
  ) : null;

  const statsRow = (
    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
      <div style={{ flex: 1, padding: 14, borderRadius: 14, background: surface, border: `1px solid ${border}`, textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10.3, color: subFg, letterSpacing: 1.5 }}>VOTES</div>
        <div style={{ fontSize: 30, fontWeight: 800, color: ACCENT, lineHeight: 1, marginTop: 4 }}>{row.vote_count}</div>
      </div>
      <div style={{ flex: 1, padding: 14, borderRadius: 14, background: surface, border: `1px solid ${border}`, textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10.3, color: subFg, letterSpacing: 1.5 }}>RANK</div>
        <div style={{ fontSize: 30, fontWeight: 800, color: '#fff', lineHeight: 1, marginTop: 4 }}>#{rank}</div>
        <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 9.7, color: subFg2, marginTop: 2 }}>of {totalCount}</div>
      </div>
    </div>
  );

  const voteBtn = (
    <button
      onClick={onVote}
      style={{
        width: '100%', height: 56, borderRadius: 14, marginTop: 12,
        background: voted ? 'transparent' : `linear-gradient(90deg, ${ACCENT}, ${ACCENT2})`,
        border: voted ? `1.5px solid ${ACCENT}` : 'none',
        color: voted ? ACCENT : '#000',
        fontFamily: 'var(--font-grotesk, system-ui)', fontSize: 16.9, fontWeight: 800,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        transition: 'all 160ms',
        boxShadow: voted ? 'none' : `0 12px 32px -8px ${ACCENT}90`,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
        <path d="M2 9L7 3L12 9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {voted ? 'VOTED' : 'UPVOTE THIS TRACK'}
    </button>
  );

  const suggestedBy = row.nickname ? (
    <div style={{
      marginTop: 12, padding: 12, borderRadius: 12,
      background: surface, border: `1px solid ${border}`,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
        background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 800, color: '#000',
      }}>
        {row.nickname[0]?.toUpperCase() ?? '?'}
      </div>
      <div>
        <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 9.7, color: subFg, letterSpacing: 1.5 }}>SUGGESTED BY</div>
        <div style={{ fontSize: 16.4, fontWeight: 700, marginTop: 2 }}>{row.nickname}</div>
      </div>
    </div>
  ) : null;

  const header = (
    <div style={{ padding: '12px 16px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10.3, color: subFg, letterSpacing: 1.5 }}>
        PRE-EVENT · #{rank}
      </div>
      <button
        onClick={onClose}
        style={{
          width: 40, height: 40, borderRadius: 11,
          background: surface, border: `1px solid ${border}`, color: '#fff',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        aria-label="Close"
      >
        <svg width="14" height="14" viewBox="0 0 14 14">
          <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );

  /* ── Desktop: centered dialog ─────────────────────────────── */
  if (isWide) {
    return (
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 110,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px',
        }}
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 480, background: '#0f0f18',
            borderRadius: 20, border: `1px solid ${border}`,
            boxShadow: `0 40px 100px rgba(0,0,0,0.6)`,
            fontFamily: 'var(--font-grotesk, system-ui)',
            color: '#fff', overflow: 'hidden',
          }}
        >
          {header}
          {/* Art + title side by side */}
          <div style={{ display: 'flex', gap: 14, padding: '10px 16px 0', alignItems: 'center' }}>
            <div style={{
              width: 96, height: 96, borderRadius: 14, flexShrink: 0,
              background: row.artwork_url ? undefined : artGradient(row.title + row.artist),
              overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 10px 30px -8px ${ACCENT}50`,
            }}>
              {row.artwork_url
                ? <img src={row.artwork_url} alt={row.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 32, fontWeight: 800, color: '#fff' }}>{initials}</span>
              }
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.title}</div>
              <div style={{ fontSize: 15.7, color: subFg, marginTop: 4, fontWeight: 500 }}>{row.artist}</div>
              {pills}
            </div>
          </div>
          <div style={{ padding: '0 16px 16px' }}>
            {statsRow}
            {suggestedBy}
            {voteBtn}
          </div>
        </div>
      </div>
    );
  }

  /* ── Mobile: full-screen bottom sheet ────────────────────── */
  return (
    <div className="gst-detail-sheet">
      {/* Glow */}
      <div style={{
        position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)',
        width: '100%', maxWidth: 420, height: 260,
        background: `radial-gradient(circle, ${ACCENT}22, transparent 65%)`,
        filter: 'blur(50px)', pointerEvents: 'none',
      }} />

      {header}

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 120px', position: 'relative', zIndex: 1 }}>
        {/* Artwork */}
        <div style={{
          width: 160, height: 160, borderRadius: 22, margin: '6px auto 0',
          background: row.artwork_url ? undefined : artGradient(row.title + row.artist),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          boxShadow: `0 20px 50px -12px ${ACCENT}70, 0 0 0 1px ${border}`,
        }}>
          {row.artwork_url
            ? <img src={row.artwork_url} alt={row.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontSize: 48, fontWeight: 800, color: '#fff' }}>{initials}</span>
          }
        </div>

        {/* Title + artist + pills */}
        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.7, lineHeight: 1.05 }}>{row.title}</div>
          <div style={{ fontSize: 18.2, color: subFg, marginTop: 5, fontWeight: 500 }}>{row.artist}</div>
          {pills && <div style={{ justifyContent: 'center', display: 'flex' }}>{pills}</div>}
        </div>

        {statsRow}
        {suggestedBy}
      </div>

      {/* Bottom vote CTA */}
      <div style={{
        position: 'absolute',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)',
        left: 14, right: 14, zIndex: 30,
      }}>
        {voteBtn}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/app/collect/[code]/components/CollectDetailSheet.tsx
git commit -m "feat(collect): add CollectDetailSheet — responsive detail panel for leaderboard rows"
```

---

## Task 8: Wire LeaderboardTabs + collect page detail sheet

**Files:**
- Modify: `dashboard/app/collect/[code]/components/LeaderboardTabs.tsx`
- Modify: `dashboard/app/collect/[code]/page.tsx`

- [ ] **Step 1: Write the failing test**

In `dashboard/app/collect/[code]/components/LeaderboardTabs.test.tsx` (create if it doesn't exist):

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import LeaderboardTabs from './LeaderboardTabs';
import type { CollectLeaderboardRow } from '@/lib/api';

const mockRow: CollectLeaderboardRow = {
  id: 1,
  title: 'Levels',
  artist: 'Avicii',
  artwork_url: null,
  vote_count: 5,
  nickname: null,
  status: 'new',
  created_at: new Date().toISOString(),
};

describe('LeaderboardTabs', () => {
  it('calls onRowClick when a row is clicked', () => {
    const onRowClick = vi.fn();
    render(
      <LeaderboardTabs
        rows={[mockRow]}
        tab="all"
        onTabChange={vi.fn()}
        onVote={vi.fn().mockResolvedValue(undefined)}
        votedIds={new Set()}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText('Levels'));
    expect(onRowClick).toHaveBeenCalledWith(mockRow);
  });

  it('does not call onRowClick when vote button is clicked', () => {
    const onRowClick = vi.fn();
    render(
      <LeaderboardTabs
        rows={[mockRow]}
        tab="all"
        onTabChange={vi.fn()}
        onVote={vi.fn().mockResolvedValue(undefined)}
        votedIds={new Set()}
        onRowClick={onRowClick}
      />,
    );
    const voteBtn = screen.getByRole('button', { name: /upvote/i });
    fireEvent.click(voteBtn);
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd dashboard && npm test -- --run LeaderboardTabs
```

Expected: FAIL — `onRowClick` not a valid prop.

- [ ] **Step 3: Add onRowClick to LeaderboardTabs**

In `dashboard/app/collect/[code]/components/LeaderboardTabs.tsx`, update the `Props` interface:

```typescript
interface Props {
  rows: CollectLeaderboardRow[];
  tab: 'trending' | 'all';
  onTabChange: (tab: 'trending' | 'all') => void;
  onVote: (requestId: number) => Promise<void>;
  votedIds: ReadonlySet<number>;
  onRowClick?: (row: CollectLeaderboardRow) => void;
}
```

Update the function signature:

```typescript
export default function LeaderboardTabs({ rows, tab, onTabChange, onVote, votedIds, onRowClick }: Props) {
```

On the outer row `div`, add `onClick` and `cursor: pointer`:

```tsx
              <div
                key={r.id}
                className="gst-collect-row"
                style={{
                  background: surface,
                  border: `1px solid ${border}`,
                  cursor: onRowClick ? 'pointer' : 'default',
                }}
                onClick={() => onRowClick?.(r)}
              >
```

On the vote button, add `e.stopPropagation()`:

```tsx
                    <button
                      type="button"
                      aria-label={voted ? 'upvoted' : 'upvote'}
                      aria-pressed={voted}
                      className={`gst-collect-vote-btn${voted ? ' voted' : ''}`}
                      disabled={voted}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleVote(r.id, r.vote_count);
                      }}
                    >
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd dashboard && npm test -- --run LeaderboardTabs
```

Expected: PASS.

- [ ] **Step 5: Wire CollectDetailSheet into collect page**

In `dashboard/app/collect/[code]/page.tsx`:

Add import at the top:
```tsx
import CollectDetailSheet from './components/CollectDetailSheet';
```

Add state after the existing `searchOpen` state:
```tsx
const [detailRow, setDetailRow] = useState<import('../../../lib/api').CollectLeaderboardRow | null>(null);
const [detailVoted, setDetailVoted] = useState(false);
```

Update the collect page's API import to include `CollectLeaderboardRow`:

```tsx
import {
  apiClient,
  ApiError,
  CollectEventPreview,
  CollectLeaderboardResponse,
  CollectLeaderboardRow,
  CollectMyPicksResponse,
  SearchResult,
} from '../../../lib/api';
```

Pass `onRowClick` to `LeaderboardTabs`:
```tsx
          <LeaderboardTabs
            rows={leaderboard?.requests ?? []}
            tab={tab}
            onTabChange={setTab}
            onVote={(id) => apiClient.voteCollectRequest(code, id)}
            votedIds={votedIds}
            onRowClick={setDetailRow}
          />
```

Add `CollectDetailSheet` render before the closing `</main>` tag:
```tsx
      {detailRow && (
        <CollectDetailSheet
          row={detailRow}
          rank={(leaderboard?.requests ?? []).findIndex((r) => r.id === detailRow.id) + 1 || 1}
          totalCount={leaderboard?.requests.length ?? 0}
          voted={detailVoted || votedIds.has(detailRow.id)}
          onVote={async () => {
            if (!detailVoted && !votedIds.has(detailRow.id)) {
              setDetailVoted(true);
              await apiClient.voteCollectRequest(code, detailRow.id);
            }
          }}
          onClose={() => { setDetailRow(null); setDetailVoted(false); }}
        />
      )}
```

Simplify the state declarations now that `CollectLeaderboardRow` is imported:
```tsx
const [detailRow, setDetailRow] = useState<CollectLeaderboardRow | null>(null);
const [detailVoted, setDetailVoted] = useState(false);
```

- [ ] **Step 6: TypeScript check**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Run frontend tests**

```bash
cd dashboard && npm test -- --run
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add dashboard/app/collect/[code]/components/LeaderboardTabs.tsx \
        dashboard/app/collect/[code]/components/LeaderboardTabs.test.tsx \
        dashboard/app/collect/[code]/page.tsx
git commit -m "feat(collect): wire CollectDetailSheet — tap a leaderboard row to open detail panel"
```

---

## Task 9: Collect vibes toggle + enrichment animation

**Files:**
- Modify: `dashboard/app/globals.css`
- Modify: `dashboard/app/collect/[code]/page.tsx`

- [ ] **Step 1: Add CSS animation classes to globals.css**

In `dashboard/app/globals.css`, find the end of the guest/kiosk section (after the last `@keyframes` block). Add:

```css
/* ── Vibes enrichment scanning animation ─────────────────────── */
.vbs-scanning {
  position: relative;
  overflow: hidden;
}
.vbs-scanning::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  top: 0;
  background: linear-gradient(90deg, transparent, rgba(0, 240, 255, 0.8), rgba(255, 43, 214, 0.8), transparent);
  animation: vbs-scanline 0.9s linear infinite;
  z-index: 10;
  pointer-events: none;
}

@keyframes vbs-scanline {
  0% { top: 0%; opacity: 1; }
  90% { top: 100%; opacity: 1; }
  100% { top: 100%; opacity: 0; }
}

.vbs-analyzing {
  animation: vbs-blink 0.6s step-end infinite;
}

@keyframes vbs-blink {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

.vbs-tier-in {
  animation: vbs-tier-fade 300ms ease both;
}

@keyframes vbs-tier-fade {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: none; }
}

.vbs-scan-icon {
  display: inline-block;
  animation: vbs-bounce 0.7s ease-in-out infinite alternate;
}

@keyframes vbs-bounce {
  from { transform: rotate(-10deg) scale(0.9); }
  to { transform: rotate(10deg) scale(1.1); }
}
```

- [ ] **Step 2: Add vibes state and scoring to collect page**

In `dashboard/app/collect/[code]/page.tsx`, add after the `searchOpen` state block:

```tsx
  // Vibes toggle
  const [sortByVibes, setSortByVibes] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichedResults, setEnrichedResults] = useState<SearchResult[]>([]);
```

Add the average BPM computation (after the `leaderboard` state is available, inside the component body):

```tsx
  const leaderboardAvgBpm = useMemo(() => {
    const withBpm = (leaderboard?.requests ?? []).filter((r) => r.bpm != null);
    return withBpm.length > 0
      ? withBpm.reduce((s, r) => s + (r.bpm ?? 0), 0) / withBpm.length
      : 128;
  }, [leaderboard]);
```

Add the `vibeScored` computation:

```tsx
  const tierInfo: Record<string, { rail: string; label: string }> = {
    perfect: { rail: '#00f0ff', label: 'IN THE POCKET' },
    good:    { rail: '#ff2bd6', label: 'BLENDS WELL' },
    ok:      { rail: 'rgba(255,255,255,0.4)', label: 'SLIGHT SHIFT' },
    far:     { rail: 'rgba(255,255,255,0.2)', label: 'TEMPO JUMP' },
  };

  const vibeScored = useMemo(() => {
    const base = enrichedResults.length > 0 ? enrichedResults : searchResults;
    if (!base.length) return base;
    return base.map((r) => {
      const dBpm = Math.abs((r.bpm ?? leaderboardAvgBpm) - leaderboardAvgBpm);
      const score = dBpm / 8;
      const tier: 'perfect' | 'good' | 'ok' | 'far' =
        score <= 1 ? 'perfect' : score <= 2.5 ? 'good' : score <= 4 ? 'ok' : 'far';
      return { ...r, _score: score, _tier: tier };
    }).sort((a, b) => sortByVibes ? (a._score ?? 0) - (b._score ?? 0) : 0);
  }, [searchResults, enrichedResults, sortByVibes, leaderboardAvgBpm]);
```

Add the `handleVibesToggle` function (alongside the other handlers):

```tsx
  const handleVibesToggle = async () => {
    if (sortByVibes) {
      setSortByVibes(false);
      setEnrichedResults([]);
      return;
    }
    setSortByVibes(true);
    const needsEnrich = searchResults.slice(0, 10).filter((r) => r.bpm == null);
    if (needsEnrich.length === 0) return;
    setEnriching(true);
    try {
      const results = await apiClient.enrichPreview(
        code,
        searchResults.slice(0, 10).map((r) => ({
          title: r.title,
          artist: r.artist,
          source_url: r.url ?? undefined,
        })),
      );
      const merged = searchResults.map((r, i) => {
        const enriched = results[i];
        if (!enriched) return r;
        return {
          ...r,
          bpm: r.bpm ?? enriched.bpm ?? null,
          key: r.key ?? enriched.key ?? null,
          genre: r.genre ?? enriched.genre ?? null,
        };
      });
      setEnrichedResults(merged as SearchResult[]);
    } catch {
      // swallow — vibes still works with whatever bpm data is already on results
    } finally {
      setEnriching(false);
    }
  };
```

Also reset vibes state when search closes:

```tsx
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setSubmitError(null);
    setSortByVibes(false);
    setEnrichedResults([]);
    setEnriching(false);
  };
```

- [ ] **Step 3: Add the vibes toggle button and animated result rows**

In `dashboard/app/collect/[code]/page.tsx`, find the search results section (the `{searchResults.length > 0 && (` block inside `searchOpen`). Replace the entire inner block with:

```tsx
            {vibeScored.length > 0 && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '0 18px 80px', position: 'relative', zIndex: 1 }}>
                {/* Results header with vibes toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0 10px' }}>
                  <span style={{ fontSize: 10.9, fontFamily: 'var(--font-mono, monospace)', color: 'rgba(255,255,255,0.35)', letterSpacing: 1.5 }}>
                    {searchResults.length} RESULTS
                  </span>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={handleVibesToggle}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '6px 11px', borderRadius: 99,
                      background: sortByVibes ? 'rgba(0,240,255,0.12)' : 'transparent',
                      border: `1px solid ${sortByVibes ? '#00f0ff' : 'rgba(255,255,255,0.08)'}`,
                      color: sortByVibes ? '#00f0ff' : 'rgba(255,255,255,0.5)',
                      fontFamily: 'var(--font-mono, monospace)', fontSize: 10.9, fontWeight: 700, letterSpacing: 1.2,
                      cursor: 'pointer',
                    }}
                  >
                    {enriching
                      ? <><span className="vbs-scan-icon">🔍</span> READING VIBES…</>
                      : <><span style={{
                          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                          background: sortByVibes ? '#00f0ff' : 'transparent',
                          border: sortByVibes ? 'none' : '1px solid rgba(255,255,255,0.5)',
                          boxShadow: sortByVibes ? '0 0 6px #00f0ff' : 'none',
                          display: 'inline-block',
                        }} /> HIGHLIGHT BY VIBES</>
                    }
                  </button>
                </div>

                {/* Result rows */}
                {vibeScored.map((result, index) => {
                  const tier = sortByVibes ? (result as SearchResult & { _tier?: string })._tier : undefined;
                  const tc = tier ? tierInfo[tier] : null;

                  return (
                    <button
                      type="button"
                      key={result.spotify_id ?? result.url ?? index}
                      disabled={submitting}
                      onClick={() => handleSelectSong(result)}
                      data-testid="collect-search-result"
                      className={enriching ? 'vbs-scanning' : ''}
                      style={{
                        width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 0,
                        padding: 0, borderRadius: 12, marginBottom: 6,
                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                        color: '#fff', cursor: 'pointer', overflow: 'hidden',
                      }}
                    >
                      {sortByVibes && !enriching && tc && (
                        <div style={{ width: 4, flexShrink: 0, background: tc.rail, alignSelf: 'stretch' }} />
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', flex: 1, minWidth: 0 }}>
                        {result.album_art ? (
                          <img
                            src={result.album_art}
                            alt={result.album ?? result.title}
                            style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                          />
                        ) : (
                          <div style={{
                            width: 44, height: 44, borderRadius: 8, flexShrink: 0,
                            background: 'linear-gradient(135deg, #ff006e, #8338ec)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 13.3, fontWeight: 800, color: '#fff',
                          }}>
                            {`${result.title[0] ?? '?'}${result.artist[0] ?? ''}`.toUpperCase()}
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 16.9, fontWeight: 700, letterSpacing: -0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {result.title}
                          </div>
                          <div style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.5)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {result.artist}
                          </div>
                          {enriching ? (
                            <div className="vbs-analyzing" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 9.7, color: 'rgba(0,240,255,0.6)', letterSpacing: 1, marginTop: 4 }}>
                              ANALYZING…
                            </div>
                          ) : sortByVibes && tc ? (
                            <div className="vbs-tier-in" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 9.7, color: tc.rail, letterSpacing: 1.2, marginTop: 4, fontWeight: 700 }}>
                              {tc.label}
                            </div>
                          ) : null}
                        </div>
                        <div style={{
                          width: enriching ? 0 : 32, height: 32, borderRadius: '50%', flexShrink: 0,
                          background: `conic-gradient(rgba(0,240,255,0.8) ${result.popularity}%, rgba(255,255,255,0.1) ${result.popularity}%)`,
                          display: enriching ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 9.7, fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: 'rgba(255,255,255,0.5)',
                        }} title={`Popularity: ${result.popularity}%`}>
                          {result.popularity}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
```

- [ ] **Step 4: Add missing import**

In `dashboard/app/collect/[code]/page.tsx`, ensure `useMemo` is in the React imports:

```tsx
import { useEffect, useState, useMemo } from 'react';
```

- [ ] **Step 5: TypeScript check**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Run frontend tests**

```bash
cd dashboard && npm test -- --run
```

Expected: all PASS.

- [ ] **Step 7: Run backend CI checks**

```bash
cd server && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/bandit -r app -c pyproject.toml -q && .venv/bin/pytest --tb=short -q
```

Expected: all PASS.

- [ ] **Step 8: Lint the CSS**

```bash
cd dashboard && npm run lint
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add dashboard/app/globals.css dashboard/app/collect/[code]/page.tsx
git commit -m "feat(collect): add vibes toggle with scanline enrichment animation to search"
```

---

## Task 10: Final CI + PR

- [ ] **Step 1: Run full backend CI suite**

```bash
cd server && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/bandit -r app -c pyproject.toml -q && .venv/bin/pytest --tb=short -q
```

Expected: all PASS, coverage ≥ 70%.

- [ ] **Step 2: Run full frontend CI suite**

```bash
cd dashboard && npm run lint && npx tsc --noEmit && npm test -- --run
```

Expected: all PASS.

- [ ] **Step 3: Run bridge CI checks**

```bash
cd bridge && npx tsc --noEmit && npm test -- --run
cd bridge-app && npx tsc --noEmit && npm test -- --run
```

Expected: all PASS (no bridge changes, just confirming no regressions).

- [ ] **Step 4: Check Alembic drift**

```bash
cd server && .venv/bin/alembic upgrade head && .venv/bin/alembic check
```

Expected: `No new upgrade operations detected.` (no migrations added).

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin feat/song-detail-vibes-enrichment
gh pr create \
  --title "feat: song detail panels, vibes enrichment & collect UX polish" \
  --body "$(cat <<'EOF'
## Summary

- Exposes `bpm`/`musical_key`/`genre` in `PublicRequestInfo` and `CollectLeaderboardRow` API responses (fields already in DB — schema-only change, no migration)
- Triggers `enrich_request_metadata` background task on collect picks so BPM/key/genre get populated
- Adds `/api/public/collect/{code}/enrich-preview` for search-time Beatport BPM lookup (no DB writes, 10/min rate limit)
- Caps `SongDetailSheet` artwork at 160px and adds BPM/key pills on the join page
- New `CollectDetailSheet` — tapping a leaderboard row opens a bottom sheet (mobile) or centered dialog (desktop ≥640px) with BPM/key pills and a vote button
- Adds "HIGHLIGHT BY VIBES" toggle to collect search with scanline+ANALYZING… animation during enrichment, tier labels after resolve

## Test plan

- [ ] Local: tap a leaderboard row on `/collect` — detail opens, art 160px, pills visible on enriched tracks
- [ ] Local: tap a leaderboard row on `/join` — art no longer fills screen, pills show if BPM known
- [ ] Local: search on `/collect`, click HIGHLIGHT BY VIBES — scanline animation plays, rows reorder by BPM proximity
- [ ] Local: submit a Spotify pick on `/collect` — confirm enrichment background task fires (check server logs)
- [ ] Desktop browser: resize to >640px on `/collect`, tap a row — centered dialog appears
- [ ] Confirm no regressions on `/join` request sheet vibes toggle

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

