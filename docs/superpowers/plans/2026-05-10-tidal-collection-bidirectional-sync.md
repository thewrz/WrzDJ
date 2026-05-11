# Tidal Collection Playlist Bidirectional Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bidirectional sync between WrzDJ's pre-event collection list and its Tidal collection playlist — rejecting in WrzDJ removes the track from Tidal, and (opt-in) removing from Tidal auto-rejects in WrzDJ via a periodic background poll.

**Architecture:** Store the matched Tidal track ID on each synced collection request (`Request.tidal_collection_track_id`). On rejection, fire a background task calling `playlist.remove_by_id()`. An asyncio lifespan task polls every 5 minutes for events with `tidal_collection_bidirectional=True`, comparing current playlist tracks against synced requests and rejecting any that were removed. A new checkbox in the collection settings UI exposes the opt-in flag.

**Tech Stack:** FastAPI BackgroundTasks, asyncio (lifespan), tidalapi `UserPlaylist.remove_by_id()`, SQLAlchemy 2.0, Alembic, Next.js TypeScript

---

## File Map

**Create:**
- `server/alembic/versions/044_add_tidal_collection_bidir.py`

**Modify (backend):**
- `server/app/models/event.py` — add `tidal_collection_bidirectional: Mapped[bool]`
- `server/app/models/request.py` — add `tidal_collection_track_id: Mapped[str | None]`
- `server/app/services/tidal.py` — update `sync_collection_requests_batch`; add `remove_track_from_collection_playlist`, `remove_collection_tracks_batch`, `poll_tidal_collection_removals`
- `server/app/services/collect.py` — `execute_bulk_review` returns 4-tuple including rejected rows
- `server/app/schemas/collect.py` — add `tidal_collection_bidirectional` to `UpdateCollectionSettings`
- `server/app/api/events.py` — `bulk_review` fires removal background task; `collection_settings_payload` includes new field
- `server/app/api/requests.py` — PATCH fires removal task for rejected collection requests
- `server/app/main.py` — add lifespan context manager with asyncio poll loop

**Modify (frontend):**
- `dashboard/lib/api.ts` — add `tidal_collection_bidirectional` to `CollectionSettingsResponse` and patch payload
- `dashboard/app/events/[code]/components/PreEventVotingTab.tsx` — add bidirectional checkbox

**Tests:**
- `server/tests/test_tidal.py`
- `server/tests/test_collect_dj.py`
- `server/tests/test_collect_service.py`
- `server/tests/test_requests.py`

---

### Task 1: Migration and Model Columns

**Files:**
- Create: `server/alembic/versions/044_add_tidal_collection_bidir.py`
- Modify: `server/app/models/event.py`
- Modify: `server/app/models/request.py`

- [ ] **Step 1: Create the Alembic migration**

Create `server/alembic/versions/044_add_tidal_collection_bidir.py`:

```python
"""Add tidal_collection_track_id to requests and tidal_collection_bidirectional to events.

Revision ID: 044
Revises: 043
Create Date: 2026-05-11
"""

from alembic import op
import sqlalchemy as sa

revision: str = "044"
down_revision: str | None = "043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "requests",
        sa.Column("tidal_collection_track_id", sa.String(50), nullable=True),
    )
    op.add_column(
        "events",
        sa.Column(
            "tidal_collection_bidirectional",
            sa.Boolean,
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("requests", "tidal_collection_track_id")
    op.drop_column("events", "tidal_collection_bidirectional")
```

- [ ] **Step 2: Add `tidal_collection_track_id` to `Request` model**

In `server/app/models/request.py`, after the `vote_count` field, add:

```python
    # Tidal collection playlist tracking — set when a request is successfully synced
    tidal_collection_track_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
```

- [ ] **Step 3: Add `tidal_collection_bidirectional` to `Event` model**

In `server/app/models/event.py`, after the `tidal_collection_playlist_id` line, add:

```python
    tidal_collection_bidirectional: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="0"
    )
```

Verify `Boolean` is already imported from `sqlalchemy` at the top of `event.py`. If not, add it to the existing `from sqlalchemy import ...` line.

- [ ] **Step 4: Run the migration and verify no drift**

```bash
cd server && .venv/bin/alembic upgrade head && .venv/bin/alembic check
```

Expected: `No new upgrade operations detected.`

- [ ] **Step 5: Commit**

```bash
git add server/alembic/versions/044_add_tidal_collection_bidir.py \
        server/app/models/request.py \
        server/app/models/event.py
git commit -m "feat: add tidal_collection_track_id and tidal_collection_bidirectional columns"
```

---

### Task 2: Store Track ID in `sync_collection_requests_batch`

**Files:**
- Modify: `server/app/services/tidal.py` (function `sync_collection_requests_batch`)
- Test: `server/tests/test_tidal.py`

- [ ] **Step 1: Write the failing test**

Add to `server/tests/test_tidal.py`:

```python
def test_sync_collection_stores_track_id(db, test_event, test_user, mocker):
    from app.models.request import Request as SongRequest, RequestStatus
    from app.services.tidal import sync_collection_requests_batch

    row = SongRequest(
        event_id=test_event.id,
        song_title="Acid Rain",
        artist="Objekt",
        status=RequestStatus.NEW.value,
        dedupe_key="objekt-acid-rain",
        submitted_during_collection=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    mock_track = mocker.MagicMock()
    mock_track.id = 99887766
    mock_track.name = "Acid Rain"
    mock_track.artist = mocker.MagicMock()
    mock_track.artist.name = "Objekt"
    mock_track.artists = []
    mock_track.album = None
    mock_track.bpm = None
    mock_track.key = None
    mock_track.duration = None
    mock_track.popularity = 0
    mock_track.isrc = None
    mock_track.version = None
    mock_track.explicit = False

    mock_session = mocker.MagicMock()
    mock_session.search.return_value = {"tracks": [mock_track]}

    mocker.patch("app.services.tidal.get_tidal_session", return_value=mock_session)
    mocker.patch("app.services.tidal.ensure_collection_playlist", return_value="playlist-abc")
    mocker.patch("app.services.tidal.add_tracks_to_playlist", return_value=True)

    sync_collection_requests_batch(db, test_user, test_event, [row])
    db.refresh(row)

    assert row.tidal_collection_track_id == "99887766"
```

- [ ] **Step 2: Verify test fails**

```bash
cd server && .venv/bin/pytest tests/test_tidal.py::test_sync_collection_stores_track_id -v
```

Expected: FAIL — `tidal_collection_track_id` is `None` (not yet stored).

- [ ] **Step 3: Update `sync_collection_requests_batch` in `tidal.py`**

Replace the existing `sync_collection_requests_batch` function:

```python
def sync_collection_requests_batch(
    db: Session,
    user: User,
    event: Event,
    requests: list,
) -> None:
    """Batch-sync pre-event collection requests to the collection playlist.

    Searches tracks sequentially, adds all found IDs in one API call, and
    stores the matched Tidal track ID on each request for bidirectional sync.
    Tidal's allow_duplicates=False deduplicates silently at the API layer.
    """
    if not requests:
        return

    playlist_id = ensure_collection_playlist(db, user, event)
    if not playlist_id:
        return

    track_ids: list[str] = []
    matched: list[tuple] = []  # (request, track_id)
    for req in requests:
        try:
            results = search_tidal_tracks(db, user, f"{req.song_title} {req.artist}")
            if results:
                track_id = results[0].track_id
                track_ids.append(track_id)
                matched.append((req, track_id))
        except Exception as e:
            logger.error(f"Collection sync search failed for '{req.song_title}': {e}")

    if track_ids:
        if add_tracks_to_playlist(db, user, playlist_id, track_ids):
            for req, track_id in matched:
                req.tidal_collection_track_id = track_id
            db.commit()
```

- [ ] **Step 4: Verify test passes**

```bash
cd server && .venv/bin/pytest tests/test_tidal.py::test_sync_collection_stores_track_id -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app/services/tidal.py server/tests/test_tidal.py
git commit -m "feat: store tidal_collection_track_id after batch sync"
```

---

### Task 3: Remove Functions in `tidal.py`

**Files:**
- Modify: `server/app/services/tidal.py`
- Test: `server/tests/test_tidal.py`

- [ ] **Step 1: Write the failing tests**

Add to `server/tests/test_tidal.py`:

```python
def test_remove_track_from_collection_playlist_success(test_event, test_user, mocker):
    from app.services.tidal import remove_track_from_collection_playlist

    mock_playlist = mocker.MagicMock()
    mock_playlist.remove_by_id.return_value = True
    mock_session = mocker.MagicMock()
    mock_session.playlist.return_value = mock_playlist
    mocker.patch("app.services.tidal.get_tidal_session", return_value=mock_session)

    test_event.tidal_collection_playlist_id = "pl-123"
    db_mock = mocker.MagicMock()

    result = remove_track_from_collection_playlist(db_mock, test_user, test_event, "track-456")

    mock_session.playlist.assert_called_once_with("pl-123")
    mock_playlist.remove_by_id.assert_called_once_with("track-456")
    assert result is True


def test_remove_track_from_collection_playlist_no_playlist(test_event, test_user, mocker):
    from app.services.tidal import remove_track_from_collection_playlist

    mock_session = mocker.MagicMock()
    mocker.patch("app.services.tidal.get_tidal_session", return_value=mock_session)
    test_event.tidal_collection_playlist_id = None
    db_mock = mocker.MagicMock()

    result = remove_track_from_collection_playlist(db_mock, test_user, test_event, "track-456")

    mock_session.playlist.assert_not_called()
    assert result is False


def test_remove_collection_tracks_batch_calls_per_track(test_event, test_user, mocker):
    from app.services.tidal import remove_collection_tracks_batch

    mock_remove = mocker.patch(
        "app.services.tidal.remove_track_from_collection_playlist", return_value=True
    )
    test_event.tidal_collection_playlist_id = "pl-123"
    db_mock = mocker.MagicMock()

    remove_collection_tracks_batch(db_mock, test_user, test_event, ["t1", "t2", "t3"])

    assert mock_remove.call_count == 3
```

- [ ] **Step 2: Verify tests fail**

```bash
cd server && .venv/bin/pytest \
  tests/test_tidal.py::test_remove_track_from_collection_playlist_success \
  tests/test_tidal.py::test_remove_track_from_collection_playlist_no_playlist \
  tests/test_tidal.py::test_remove_collection_tracks_batch_calls_per_track -v
```

Expected: FAIL — functions not defined.

- [ ] **Step 3: Add the two functions to `tidal.py`**

Add after `add_tracks_to_playlist` and before `sync_request_to_tidal`:

```python
def remove_track_from_collection_playlist(
    db: Session,
    user: User,
    event: Event,
    track_id: str,
) -> bool:
    """Remove a single track from the event's Tidal collection playlist.

    Returns True on success, False if the playlist doesn't exist or the API call fails.
    Failures are logged but not raised — removal is best-effort.
    """
    playlist_id = event.tidal_collection_playlist_id
    if not playlist_id:
        return False

    session = get_tidal_session(db, user)
    if not session:
        return False

    try:
        playlist = session.playlist(playlist_id)
        return bool(playlist.remove_by_id(track_id))
    except Exception as e:
        logger.error(f"Failed to remove track {track_id} from collection playlist: {e}")
        return False


def remove_collection_tracks_batch(
    db: Session,
    user: User,
    event: Event,
    track_ids: list[str],
) -> None:
    """Remove multiple tracks from the collection playlist, one by one.

    Best-effort: logs failures per track but does not abort on error.
    """
    for track_id in track_ids:
        remove_track_from_collection_playlist(db, user, event, track_id)
```

- [ ] **Step 4: Verify tests pass**

```bash
cd server && .venv/bin/pytest \
  tests/test_tidal.py::test_remove_track_from_collection_playlist_success \
  tests/test_tidal.py::test_remove_track_from_collection_playlist_no_playlist \
  tests/test_tidal.py::test_remove_collection_tracks_batch_calls_per_track -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app/services/tidal.py server/tests/test_tidal.py
git commit -m "feat: add remove_track_from_collection_playlist and batch variant"
```

---

### Task 4: `poll_tidal_collection_removals`

**Files:**
- Modify: `server/app/services/tidal.py`
- Test: `server/tests/test_tidal.py`

- [ ] **Step 1: Write the failing tests**

Add to `server/tests/test_tidal.py`:

```python
def test_poll_tidal_collection_removals_rejects_missing_track(db, test_event, test_user, mocker):
    from app.models.request import Request as SongRequest, RequestStatus
    from app.services.tidal import poll_tidal_collection_removals

    test_event.tidal_collection_playlist_id = "pl-xyz"
    test_event.created_by = test_user

    kept = SongRequest(
        event_id=test_event.id,
        song_title="Track A",
        artist="Artist A",
        status=RequestStatus.NEW.value,
        dedupe_key="track-a",
        submitted_during_collection=True,
        tidal_collection_track_id="111",
    )
    removed = SongRequest(
        event_id=test_event.id,
        song_title="Track B",
        artist="Artist B",
        status=RequestStatus.NEW.value,
        dedupe_key="track-b",
        submitted_during_collection=True,
        tidal_collection_track_id="222",
    )
    db.add_all([kept, removed])
    db.commit()

    mock_track = mocker.MagicMock()
    mock_track.id = 111  # only "111" still in playlist; "222" was removed

    mocker.patch("app.services.tidal.get_playlist_tracks", return_value=[mock_track])

    count = poll_tidal_collection_removals(db, test_event)

    db.refresh(kept)
    db.refresh(removed)

    assert count == 1
    assert kept.status == RequestStatus.NEW.value
    assert removed.status == RequestStatus.REJECTED.value


def test_poll_tidal_collection_removals_no_playlist_returns_zero(db, test_event, test_user, mocker):
    from app.services.tidal import poll_tidal_collection_removals

    test_event.tidal_collection_playlist_id = None
    test_event.created_by = test_user

    mock_get = mocker.patch("app.services.tidal.get_playlist_tracks")

    count = poll_tidal_collection_removals(db, test_event)

    mock_get.assert_not_called()
    assert count == 0


def test_poll_tidal_collection_removals_skips_already_rejected(db, test_event, test_user, mocker):
    from app.models.request import Request as SongRequest, RequestStatus
    from app.services.tidal import poll_tidal_collection_removals

    test_event.tidal_collection_playlist_id = "pl-xyz"
    test_event.created_by = test_user

    already_rejected = SongRequest(
        event_id=test_event.id,
        song_title="Old Track",
        artist="Artist",
        status=RequestStatus.REJECTED.value,
        dedupe_key="old-track",
        submitted_during_collection=True,
        tidal_collection_track_id="333",
    )
    db.add(already_rejected)
    db.commit()

    mocker.patch("app.services.tidal.get_playlist_tracks", return_value=[])

    count = poll_tidal_collection_removals(db, test_event)

    assert count == 0  # already rejected — not double-counted
```

- [ ] **Step 2: Verify tests fail**

```bash
cd server && .venv/bin/pytest \
  tests/test_tidal.py::test_poll_tidal_collection_removals_rejects_missing_track \
  tests/test_tidal.py::test_poll_tidal_collection_removals_no_playlist_returns_zero \
  tests/test_tidal.py::test_poll_tidal_collection_removals_skips_already_rejected -v
```

Expected: FAIL — function not defined.

- [ ] **Step 3: Add `poll_tidal_collection_removals` to `tidal.py`**

The existing import at the top of `tidal.py` reads:
```python
from app.models.request import Request, TidalSyncStatus
```

Update it to:
```python
from app.models.request import Request, RequestStatus, TidalSyncStatus
```

Append after `remove_collection_tracks_batch`:

```python
def poll_tidal_collection_removals(db: Session, event: Event) -> int:
    """Detect tracks removed from the Tidal collection playlist and reject them in WrzDJ.

    Fetches current playlist contents, finds collection requests whose
    tidal_collection_track_id is no longer present, and marks them rejected.
    Only runs when the event has a collection playlist configured.

    Returns the count of newly rejected requests.
    """
    if not event.tidal_collection_playlist_id:
        return 0

    user = event.created_by
    playlist_tracks = get_playlist_tracks(db, user, event.tidal_collection_playlist_id)
    current_ids = {str(t.id) for t in playlist_tracks}

    synced = (
        db.query(Request)
        .filter(
            Request.event_id == event.id,
            Request.submitted_during_collection == True,  # noqa: E712
            Request.tidal_collection_track_id.isnot(None),
            Request.status != RequestStatus.REJECTED.value,
        )
        .all()
    )

    count = 0
    for req in synced:
        if req.tidal_collection_track_id not in current_ids:
            req.status = RequestStatus.REJECTED.value
            count += 1

    if count > 0:
        db.commit()
        logger.info("Tidal poll: rejected %d removed track(s) for event %s", count, event.code)

    return count
```

- [ ] **Step 4: Verify tests pass**

```bash
cd server && .venv/bin/pytest \
  tests/test_tidal.py::test_poll_tidal_collection_removals_rejects_missing_track \
  tests/test_tidal.py::test_poll_tidal_collection_removals_no_playlist_returns_zero \
  tests/test_tidal.py::test_poll_tidal_collection_removals_skips_already_rejected -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app/services/tidal.py server/tests/test_tidal.py
git commit -m "feat: add poll_tidal_collection_removals"
```

---

### Task 5: Direction 1 — Bulk Review Rejection Fires Removal Task

**Files:**
- Modify: `server/app/services/collect.py` (`execute_bulk_review`)
- Modify: `server/app/api/events.py` (`bulk_review` endpoint)
- Test: `server/tests/test_collect_service.py`
- Test: `server/tests/test_collect_dj.py`

- [ ] **Step 1: Write the failing tests**

Add to `server/tests/test_collect_service.py`:

```python
def test_execute_bulk_review_returns_rejected_rows(db, test_event):
    from app.models.request import Request as SongRequest, RequestStatus
    from app.schemas.collect import BulkReviewRequest
    from app.services.collect import execute_bulk_review

    req = SongRequest(
        event_id=test_event.id,
        song_title="Track",
        artist="Artist",
        status=RequestStatus.NEW.value,
        dedupe_key="track-artist",
        submitted_during_collection=True,
        tidal_collection_track_id="tid-1",
    )
    db.add(req)
    db.commit()

    payload = BulkReviewRequest(action="reject_ids", request_ids=[req.id])
    accepted, rejected, accepted_rows, rejected_rows = execute_bulk_review(
        db, test_event.id, payload
    )

    assert accepted == 0
    assert rejected == 1
    assert len(rejected_rows) == 1
    assert rejected_rows[0].id == req.id
```

Add to `server/tests/test_collect_dj.py`:

```python
def test_bulk_reject_queues_tidal_removal_for_synced_requests(
    client, db, auth_headers, test_event, mocker
):
    from app.models.request import Request as SongRequest, RequestStatus

    req = SongRequest(
        event_id=test_event.id,
        song_title="Gone Track",
        artist="DJ X",
        status=RequestStatus.NEW.value,
        dedupe_key="gone-track",
        submitted_during_collection=True,
        tidal_collection_track_id="tid-999",
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    test_event.tidal_sync_enabled = True
    db.commit()

    mock_remove = mocker.patch("app.api.events.remove_collection_tracks_batch")

    resp = client.post(
        f"/api/events/{test_event.code}/bulk-review",
        json={"action": "reject_ids", "request_ids": [req.id]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    mock_remove.assert_called_once()
    _, _, _, track_ids = mock_remove.call_args[0]
    assert "tid-999" in track_ids


def test_bulk_reject_skips_tidal_removal_when_no_track_id(
    client, db, auth_headers, test_event, mocker
):
    from app.models.request import Request as SongRequest, RequestStatus

    req = SongRequest(
        event_id=test_event.id,
        song_title="Unsynced",
        artist="DJ X",
        status=RequestStatus.NEW.value,
        dedupe_key="unsynced",
        submitted_during_collection=True,
        tidal_collection_track_id=None,
    )
    db.add(req)
    db.commit()

    test_event.tidal_sync_enabled = True
    db.commit()

    mock_remove = mocker.patch("app.api.events.remove_collection_tracks_batch")

    resp = client.post(
        f"/api/events/{test_event.code}/bulk-review",
        json={"action": "reject_ids", "request_ids": [req.id]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    mock_remove.assert_not_called()
```

- [ ] **Step 2: Verify tests fail**

```bash
cd server && .venv/bin/pytest \
  tests/test_collect_service.py::test_execute_bulk_review_returns_rejected_rows \
  tests/test_collect_dj.py::test_bulk_reject_queues_tidal_removal_for_synced_requests \
  tests/test_collect_dj.py::test_bulk_reject_skips_tidal_removal_when_no_track_id -v
```

Expected: FAIL.

- [ ] **Step 3: Update `execute_bulk_review` in `collect.py`**

Replace the entire function with the updated version that adds a `rejected_rows` accumulator and returns it:

```python
def execute_bulk_review(
    db: Session, event_id: int, payload: BulkReviewRequest
) -> tuple[int, int, list[SongRequest], list[SongRequest]]:
    """Apply a bulk-review action to collection-phase pending requests.

    Returns (accepted_count, rejected_count, accepted_rows, rejected_rows). Caller is expected
    to pass accepted_rows to sync_requests_batch() and rejected_rows to
    remove_collection_tracks_batch() as FastAPI background tasks.
    """
    pending_q = (
        db.query(SongRequest)
        .filter(SongRequest.event_id == event_id)
        .filter(SongRequest.submitted_during_collection == True)  # noqa: E712
        .filter(SongRequest.status == "new")
    )

    accepted = 0
    rejected = 0
    accepted_rows: list[SongRequest] = []
    rejected_rows: list[SongRequest] = []

    if payload.action == "accept_top_n":
        if payload.n is None:
            raise HTTPException(status_code=400, detail="n is required")
        rows = (
            pending_q.order_by(SongRequest.vote_count.desc(), SongRequest.created_at.asc())
            .limit(payload.n)
            .all()
        )
        for r in rows:
            r.status = "accepted"
            accepted += 1
            accepted_rows.append(r)
    elif payload.action == "accept_threshold":
        if payload.min_votes is None:
            raise HTTPException(status_code=400, detail="min_votes is required")
        rows = pending_q.filter(SongRequest.vote_count >= payload.min_votes).all()
        for r in rows:
            r.status = "accepted"
            accepted += 1
            accepted_rows.append(r)
    elif payload.action == "accept_ids":
        if not payload.request_ids:
            raise HTTPException(status_code=400, detail="request_ids is required")
        rows = pending_q.filter(SongRequest.id.in_(payload.request_ids)).all()
        for r in rows:
            r.status = "accepted"
            accepted += 1
            accepted_rows.append(r)
    elif payload.action == "reject_ids":
        if not payload.request_ids:
            raise HTTPException(status_code=400, detail="request_ids is required")
        rows = pending_q.filter(SongRequest.id.in_(payload.request_ids)).all()
        for r in rows:
            r.status = "rejected"
            rejected += 1
            rejected_rows.append(r)
    elif payload.action == "reject_remaining":
        rows = pending_q.all()
        for r in rows:
            r.status = "rejected"
            rejected += 1
            rejected_rows.append(r)

    db.commit()
    return accepted, rejected, accepted_rows, rejected_rows
```

- [ ] **Step 4: Update the `bulk_review` endpoint in `events.py`**

Update the import line (find the existing `from app.services.tidal import sync_collection_requests_batch` near line 99):

```python
from app.services.tidal import (
    remove_collection_tracks_batch,
    sync_collection_requests_batch,
)
```

Replace the `bulk_review` function body:

```python
@router.post("/{code}/bulk-review", response_model=BulkReviewResponse)
def bulk_review(
    payload: BulkReviewRequest,
    background_tasks: BackgroundTasks,
    event: Event = Depends(get_event_for_dj_or_admin),
    db: Session = Depends(get_db),
):
    accepted, rejected, accepted_rows, rejected_rows = execute_bulk_review(db, event.id, payload)
    if accepted_rows:
        for row in accepted_rows:
            background_tasks.add_task(enrich_request_metadata, db, row.id)
        background_tasks.add_task(sync_requests_batch, db, accepted_rows)

    # Direction 1: remove rejected+synced tracks from the Tidal collection playlist
    if event.tidal_sync_enabled:
        track_ids_to_remove = [
            r.tidal_collection_track_id
            for r in rejected_rows
            if r.tidal_collection_track_id
        ]
        if track_ids_to_remove:
            background_tasks.add_task(
                remove_collection_tracks_batch,
                db,
                event.created_by,
                event,
                track_ids_to_remove,
            )

    return BulkReviewResponse(accepted=accepted, rejected=rejected, unchanged=0)
```

- [ ] **Step 5: Verify tests pass**

```bash
cd server && .venv/bin/pytest \
  tests/test_collect_service.py::test_execute_bulk_review_returns_rejected_rows \
  tests/test_collect_dj.py::test_bulk_reject_queues_tidal_removal_for_synced_requests \
  tests/test_collect_dj.py::test_bulk_reject_skips_tidal_removal_when_no_track_id -v
```

Expected: PASS.

- [ ] **Step 6: Run the full backend suite to catch any callers of `execute_bulk_review` that need the updated destructuring**

```bash
cd server && .venv/bin/pytest --tb=short -q
```

Fix any failures from the changed 3-tuple → 4-tuple return before continuing.

- [ ] **Step 7: Commit**

```bash
git add server/app/services/collect.py server/app/api/events.py \
        server/tests/test_collect_service.py server/tests/test_collect_dj.py
git commit -m "feat: bulk review rejection removes tracks from Tidal collection playlist"
```

---

### Task 6: Direction 1 — Individual PATCH Rejection Fires Removal Task

**Files:**
- Modify: `server/app/api/requests.py`
- Test: `server/tests/test_requests.py`

- [ ] **Step 1: Write the failing tests**

Add to `server/tests/test_requests.py`:

```python
def test_rejecting_synced_collection_request_queues_tidal_removal(
    client, db, auth_headers, test_event, mocker
):
    from app.models.request import Request as SongRequest, RequestStatus

    test_event.tidal_sync_enabled = True
    db.commit()

    req = SongRequest(
        event_id=test_event.id,
        song_title="Synced Track",
        artist="DJ Y",
        status=RequestStatus.NEW.value,
        dedupe_key="synced-track-dj-y",
        submitted_during_collection=True,
        tidal_collection_track_id="tid-555",
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    mock_remove = mocker.patch("app.api.requests.remove_track_from_collection_playlist")

    resp = client.patch(
        f"/api/events/{test_event.code}/requests/{req.id}",
        json={"status": "rejected"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    mock_remove.assert_called_once()


def test_rejecting_unsynced_collection_request_skips_tidal(
    client, db, auth_headers, test_event, mocker
):
    from app.models.request import Request as SongRequest, RequestStatus

    req = SongRequest(
        event_id=test_event.id,
        song_title="Unsynced Track",
        artist="DJ Z",
        status=RequestStatus.NEW.value,
        dedupe_key="unsynced-track-dj-z",
        submitted_during_collection=True,
        tidal_collection_track_id=None,
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    mock_remove = mocker.patch("app.api.requests.remove_track_from_collection_playlist")

    resp = client.patch(
        f"/api/events/{test_event.code}/requests/{req.id}",
        json={"status": "rejected"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    mock_remove.assert_not_called()
```

- [ ] **Step 2: Verify tests fail**

```bash
cd server && .venv/bin/pytest \
  tests/test_requests.py::test_rejecting_synced_collection_request_queues_tidal_removal \
  tests/test_requests.py::test_rejecting_unsynced_collection_request_skips_tidal -v
```

Expected: FAIL.

- [ ] **Step 3: Update `requests.py`**

Add the import near the top of `server/app/api/requests.py`:

```python
from app.services.tidal import remove_track_from_collection_playlist
```

In the `PATCH /{request_id}` handler, find the existing block that checks `update_data.status == RequestStatus.ACCEPTED`. After it, add:

```python
    if (
        update_data.status == RequestStatus.REJECTED
        and request.submitted_during_collection
        and request.tidal_collection_track_id
        and request.event.tidal_sync_enabled
    ):
        background_tasks.add_task(
            remove_track_from_collection_playlist,
            db,
            request.event.created_by,
            request.event,
            request.tidal_collection_track_id,
        )
```

Note: `request` in `requests.py` refers to the `SongRequest` ORM object (not the FastAPI `Request`). The FastAPI request is named differently in that handler — check the existing variable names before editing to avoid shadowing. If the handler uses `req` for the ORM object, use `req.event` and `req.submitted_during_collection` etc.

- [ ] **Step 4: Verify tests pass**

```bash
cd server && .venv/bin/pytest \
  tests/test_requests.py::test_rejecting_synced_collection_request_queues_tidal_removal \
  tests/test_requests.py::test_rejecting_unsynced_collection_request_skips_tidal -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/app/api/requests.py server/tests/test_requests.py
git commit -m "feat: individual request rejection removes track from Tidal collection playlist"
```

---

### Task 7: Asyncio Lifespan Poller

**Files:**
- Modify: `server/app/main.py`

- [ ] **Step 1: Add the lifespan and poll loop to `main.py`**

The current `main.py` creates `app = FastAPI(...)` without a `lifespan` argument. Update the file to add the following **before** the `app = FastAPI(...)` line:

```python
import asyncio
import contextlib
from contextlib import asynccontextmanager
```

Add these at module level (after imports, before `app = FastAPI(...)`):

```python
TIDAL_COLLECTION_POLL_INTERVAL_SECONDS = 300  # 5 minutes


def _run_tidal_collection_poll() -> None:
    """Synchronous poll, executed in a thread to avoid blocking the event loop."""
    from app.db.session import SessionLocal
    from app.models.event import Event
    from app.services.tidal import poll_tidal_collection_removals

    db = SessionLocal()
    try:
        events = (
            db.query(Event)
            .filter(
                Event.tidal_sync_enabled == True,  # noqa: E712
                Event.tidal_collection_bidirectional == True,  # noqa: E712
                Event.tidal_collection_playlist_id.isnot(None),
            )
            .all()
        )
        for event in events:
            if event.phase == "collection":
                try:
                    poll_tidal_collection_removals(db, event)
                except Exception:
                    logger.exception(
                        "Tidal collection poll failed for event %s", event.code
                    )
    finally:
        db.close()


async def _tidal_collection_poll_loop() -> None:
    while True:
        await asyncio.sleep(TIDAL_COLLECTION_POLL_INTERVAL_SECONDS)
        try:
            await asyncio.to_thread(_run_tidal_collection_poll)
        except Exception:
            logger.exception("Tidal collection poll loop error")


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_tidal_collection_poll_loop())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
```

Then update the `app = FastAPI(...)` call to pass `lifespan=lifespan`:

```python
app = FastAPI(
    title="WrzDJ API",
    description="Song request system for DJs",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)
```

- [ ] **Step 2: Verify the app starts cleanly**

```bash
cd server && source .venv/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 8001 &
sleep 3 && curl -s http://localhost:8001/api/health && kill %1
```

Expected: health endpoint responds (JSON with `"status":"ok"` or equivalent). No import errors or startup exceptions in uvicorn output.

- [ ] **Step 3: Run the full test suite**

```bash
cd server && .venv/bin/pytest --tb=short -q
```

Expected: all passing. The lifespan task does not fire during pytest (no ASGI lifespan is triggered by the default TestClient unless explicitly configured).

- [ ] **Step 4: Commit**

```bash
git add server/app/main.py
git commit -m "feat: asyncio lifespan task polls Tidal collection playlists every 5 minutes"
```

---

### Task 8: Schema + API for `tidal_collection_bidirectional`

**Files:**
- Modify: `server/app/schemas/collect.py`
- Modify: `server/app/services/collect.py` (`collection_settings_payload`, `update_collection_settings`)
- Test: `server/tests/test_collect_dj.py`

- [ ] **Step 1: Write the failing tests**

Add to `server/tests/test_collect_dj.py`:

```python
def test_collection_settings_response_includes_bidirectional(client, auth_headers, test_event):
    resp = client.get(
        f"/api/events/{test_event.code}/collection",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert "tidal_collection_bidirectional" in resp.json()
    assert resp.json()["tidal_collection_bidirectional"] is False  # default


def test_patch_collection_settings_sets_bidirectional(client, db, auth_headers, test_event):
    resp = client.patch(
        f"/api/events/{test_event.code}/collection",
        json={"tidal_collection_bidirectional": True},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["tidal_collection_bidirectional"] is True

    db.refresh(test_event)
    assert test_event.tidal_collection_bidirectional is True
```

- [ ] **Step 2: Verify tests fail**

```bash
cd server && .venv/bin/pytest \
  tests/test_collect_dj.py::test_collection_settings_response_includes_bidirectional \
  tests/test_collect_dj.py::test_patch_collection_settings_sets_bidirectional -v
```

Expected: FAIL.

- [ ] **Step 3: Update `UpdateCollectionSettings` schema in `collect.py`**

In `server/app/schemas/collect.py`, find `UpdateCollectionSettings` and add the new field:

```python
class UpdateCollectionSettings(BaseModel):
    collection_opens_at: datetime | None = None
    live_starts_at: datetime | None = None
    submission_cap_per_guest: int | None = None
    collection_phase_override: str | None = None
    tidal_sync_enabled: bool | None = None
    tidal_collection_bidirectional: bool | None = None
```

- [ ] **Step 4: Update `collection_settings_payload` in `collect.py` service**

In `server/app/services/collect.py`, update `collection_settings_payload`:

```python
def collection_settings_payload(event: Event) -> dict:
    return {
        "collection_opens_at": event.collection_opens_at,
        "live_starts_at": event.live_starts_at,
        "submission_cap_per_guest": event.submission_cap_per_guest,
        "collection_phase_override": event.collection_phase_override,
        "phase": event.phase,
        "tidal_sync_enabled": event.tidal_sync_enabled,
        "tidal_collection_playlist_id": event.tidal_collection_playlist_id,
        "tidal_collection_bidirectional": event.tidal_collection_bidirectional,
    }
```

In `update_collection_settings`, after the `tidal_sync_enabled` block, add:

```python
    if payload.tidal_collection_bidirectional is not None:
        event.tidal_collection_bidirectional = payload.tidal_collection_bidirectional
```

- [ ] **Step 5: Verify tests pass**

```bash
cd server && .venv/bin/pytest \
  tests/test_collect_dj.py::test_collection_settings_response_includes_bidirectional \
  tests/test_collect_dj.py::test_patch_collection_settings_sets_bidirectional -v
```

Expected: PASS.

- [ ] **Step 6: Run full backend CI checks**

```bash
cd server
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/bandit -r app -c pyproject.toml -q
.venv/bin/pytest --tb=short -q
```

Fix any lint issues before committing.

- [ ] **Step 7: Commit**

```bash
git add server/app/schemas/collect.py server/app/services/collect.py \
        server/tests/test_collect_dj.py
git commit -m "feat: expose tidal_collection_bidirectional in collection settings API"
```

---

### Task 9: Frontend Checkbox

**Files:**
- Modify: `dashboard/lib/api.ts`
- Modify: `dashboard/app/events/[code]/components/PreEventVotingTab.tsx`

- [ ] **Step 1: Update `CollectionSettingsResponse` and patch payload in `api.ts`**

In `dashboard/lib/api.ts`, find `CollectionSettingsResponse` and add the new field:

```typescript
export interface CollectionSettingsResponse {
  collection_opens_at: string | null;
  live_starts_at: string | null;
  submission_cap_per_guest: number;
  collection_phase_override: 'force_collection' | 'force_live' | null;
  phase: 'pre_announce' | 'collection' | 'live' | 'closed';
  tidal_sync_enabled: boolean;
  tidal_collection_playlist_id: string | null;
  tidal_collection_bidirectional: boolean;
}
```

Find `patchCollectionSettings` and add the new field to the settings parameter type:

```typescript
async patchCollectionSettings(
  code: string,
  settings: {
    collection_opens_at?: string | null;
    live_starts_at?: string | null;
    submission_cap_per_guest?: number;
    collection_phase_override?: string | null;
    tidal_sync_enabled?: boolean;
    tidal_collection_bidirectional?: boolean;
  },
): Promise<CollectionSettingsResponse>
```

- [ ] **Step 2: Add `tidal_collection_bidirectional` to `EventShape` in `PreEventVotingTab.tsx`**

Update the `EventShape` interface (lines 7–17):

```typescript
interface EventShape {
  code: string;
  name: string;
  collection_opens_at: string | null;
  live_starts_at: string | null;
  submission_cap_per_guest: number;
  collection_phase_override: 'force_collection' | 'force_live' | null;
  phase: 'pre_announce' | 'collection' | 'live' | 'closed';
  tidal_sync_enabled: boolean;
  tidal_collection_playlist_id: string | null;
  tidal_collection_bidirectional: boolean;
}
```

- [ ] **Step 3: Add the handler function**

After `handleToggleTidalSync` (around line 176), add:

```typescript
  async function handleToggleBidirectional(enabled: boolean) {
    setSyncError(null);
    try {
      const resp = await apiClient.patchCollectionSettings(event.code, {
        tidal_collection_bidirectional: enabled,
      });
      onEventChange(resp);
    } catch (err) {
      setSyncError(
        err instanceof Error ? err.message : 'Failed to update bidirectional sync setting',
      );
    }
  }
```

- [ ] **Step 4: Add the checkbox to the JSX**

Replace the existing `{event.tidal_sync_enabled && (...)}` block (lines 328–355) with the updated version that adds the checkbox as a second row:

```tsx
          {event.tidal_sync_enabled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ background: '#1db954', color: '#fff' }}
                  disabled={syncing}
                  onClick={handleSyncToTidal}
                >
                  {syncing ? 'Syncing…' : 'Sync collection to Tidal'}
                </button>
                {event.tidal_collection_playlist_id && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Pre-event playlist linked ✓
                  </span>
                )}
                {syncResult !== null && (
                  <span style={{ fontSize: '0.875rem', color: '#4ade80' }}>
                    {syncResult.queued === 0
                      ? 'All tracks already synced.'
                      : `Queued ${syncResult.queued} track${syncResult.queued === 1 ? '' : 's'} for sync.`}
                  </span>
                )}
                {syncError && (
                  <span style={{ fontSize: '0.875rem', color: '#f87171' }}>{syncError}</span>
                )}
              </div>
              <label className="collection-fieldset-toggle">
                <input
                  type="checkbox"
                  checked={event.tidal_collection_bidirectional}
                  onChange={(e) => handleToggleBidirectional(e.target.checked)}
                />
                Songs removed from Tidal playlist are auto-rejected
              </label>
            </div>
          )}
```

- [ ] **Step 5: Fix any TypeScript errors from callers that construct `EventShape`**

Run:

```bash
cd dashboard && npx tsc --noEmit 2>&1 | head -40
```

For any error that says an object literal is missing `tidal_collection_bidirectional`, add `tidal_collection_bidirectional: false` (or the real value from the API response) to that object. Common locations: `page.tsx` in `app/events/[code]/`, test fixtures in `__tests__/`.

- [ ] **Step 6: Run frontend CI checks**

```bash
cd dashboard
npm run lint
npx tsc --noEmit
npm test -- --run
```

Expected: all passing.

- [ ] **Step 7: Commit**

```bash
git add dashboard/lib/api.ts \
        "dashboard/app/events/[code]/components/PreEventVotingTab.tsx"
git commit -m "feat: bidirectional Tidal sync checkbox in collection settings"
```

---

### Task 10: Final CI Pass and PR

- [ ] **Step 1: Full backend CI**

```bash
cd server
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/bandit -r app -c pyproject.toml -q
.venv/bin/pytest --tb=short -q
.venv/bin/alembic upgrade head && .venv/bin/alembic check
```

- [ ] **Step 2: Full frontend CI**

```bash
cd dashboard && npm run lint && npx tsc --noEmit && npm test -- --run
```

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin <your-branch>
gh pr create \
  --title "feat: Tidal collection playlist bidirectional sync" \
  --body "$(cat <<'EOF'
## Summary
- Rejecting a collection song in WrzDJ dashboard removes it from the Tidal collection playlist (direction 1, always on when Tidal sync enabled)
- New opt-in: removing a track from the Tidal playlist auto-rejects it in WrzDJ via a 5-minute asyncio background poller (direction 2)
- New checkbox in collection settings: "Songs removed from Tidal playlist are auto-rejected"
- `Request.tidal_collection_track_id` persists the Tidal match for reliable bidirectional mapping without re-searching

## Test plan
- [ ] Enable Tidal sync on a collection event; submit songs via guest page; verify `tidal_collection_track_id` is populated on each synced request
- [ ] Reject via bulk-review; verify track disappears from Tidal collection playlist
- [ ] Reject via individual song PATCH; verify same Tidal removal
- [ ] Enable bidirectional checkbox; remove a track directly in Tidal; wait up to 5 min; verify song appears as rejected in WrzDJ dashboard
- [ ] Verify public guest leaderboard still shows all songs regardless of reject status
- [ ] Verify requests with no `tidal_collection_track_id` do not trigger any Tidal API call on rejection
EOF
)"
```
