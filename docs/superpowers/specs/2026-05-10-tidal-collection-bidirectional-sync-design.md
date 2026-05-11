# Tidal Collection Playlist Bidirectional Sync

**Date:** 2026-05-10  
**Status:** Approved

## Summary

Adds bidirectional sync between WrzDJ's pre-event collection list and its Tidal collection playlist.

- **Direction 1 (always on):** Rejecting a collection song in the WrzDJ dashboard removes it from the Tidal collection playlist.
- **Direction 2 (opt-in):** Removing a track from the Tidal collection playlist auto-rejects it in WrzDJ, via a periodic background poll.

The public guest leaderboard is unaffected — it always shows all collection submissions regardless of accept/reject status. Accept/reject is a DJ-only concern.

## Data Model

### New column: `Request.tidal_collection_track_id`

```python
tidal_collection_track_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
```

- Set when `sync_collection_requests_batch` successfully matches and adds a track to the Tidal collection playlist.
- Used by direction 1 (know what to remove) and direction 2 (know which requests are synced).
- `None` means the request was never successfully synced to Tidal — no removal attempted.

### New column: `Event.tidal_collection_bidirectional`

```python
tidal_collection_bidirectional: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
```

- Guards direction 2 polling. Default `False` — opt-in, not automatic.
- Only meaningful when `tidal_sync_enabled=True` and a collection playlist exists.

### Migration

`server/alembic/versions/044_add_tidal_collection_bidir.py`

Adds both columns. `tidal_collection_track_id` on `requests`, `tidal_collection_bidirectional` on `events`.

## Direction 1: Reject in WrzDJ → Remove from Tidal

Triggered from two entry points. Both fire a background task.

### Entry point 1: Bulk review (`POST /events/{code}/bulk-review`)

After `execute_bulk_review` returns rejected rows, any row with `tidal_collection_track_id` set is queued for removal.

```python
if rejected_rows_with_track_id:
    background_tasks.add_task(
        remove_collection_tracks_batch, db, user, event, track_ids
    )
```

### Entry point 2: Individual status change (`PATCH /requests/{request_id}`)

When status transitions to `rejected` and the request has `submitted_during_collection=True` and `tidal_collection_track_id` set:

```python
if update_data.status == RequestStatus.REJECTED and req.tidal_collection_track_id:
    background_tasks.add_task(
        remove_track_from_collection_playlist, db, user, event, req.tidal_collection_track_id
    )
```

### New Tidal service functions

```python
def remove_track_from_collection_playlist(
    db: Session, user: User, event: Event, track_id: str
) -> bool:
    """Remove a single track from the event's Tidal collection playlist."""

def remove_collection_tracks_batch(
    db: Session, user: User, event: Event, track_ids: list[str]
) -> None:
    """Remove multiple tracks from the collection playlist. Best-effort per track."""
```

Both call `playlist.remove_by_id()` from tidalapi. Failures are logged, not raised — removal is best-effort.

### `sync_collection_requests_batch` update

After successfully adding a track, store the Tidal track ID on the request:

```python
req.tidal_collection_track_id = results[0].track_id
db.commit()
```

## Direction 2: Remove from Tidal → Auto-reject in WrzDJ

### New Tidal service function

```python
def poll_tidal_collection_removals(db: Session, event: Event) -> int:
    """
    Compares current Tidal collection playlist tracks against synced WrzDJ requests.
    Rejects any request whose tidal_collection_track_id is no longer in the playlist.
    Returns count of newly rejected requests.
    """
```

Logic:
1. Fetch current track IDs from `event.tidal_collection_playlist_id` via `get_playlist_tracks()`
2. Query all non-rejected collection requests for the event where `tidal_collection_track_id IS NOT NULL`
3. Any request whose `tidal_collection_track_id` is not in the current playlist → set `status = "rejected"`
4. Commit and return count

### Asyncio lifespan poller

Added to `main.py` via FastAPI's lifespan context manager:

```python
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

Poll loop:
- Runs every 5 minutes
- Opens its own `SessionLocal()` per cycle (does not reuse request-scoped session)
- Queries events where: `tidal_sync_enabled=True`, `tidal_collection_bidirectional=True`, `tidal_collection_playlist_id IS NOT NULL`, and `phase='collection'`
- Calls `poll_tidal_collection_removals(db, event)` for each
- Logs count of rejections per event; errors per event are caught and logged, do not abort the loop

## API Changes

### Collection settings schema

`UpdateCollectionSettings` and `collection_settings_payload()` gain:

```python
tidal_collection_bidirectional: bool | None = None  # in UpdateCollectionSettings
tidal_collection_bidirectional: bool              # in payload response
```

### `update_collection_settings` service

Handles the new field alongside existing ones:

```python
if payload.tidal_collection_bidirectional is not None:
    event.tidal_collection_bidirectional = payload.tidal_collection_bidirectional
```

## Frontend

### Collection settings panel

New checkbox below the existing Tidal sync toggle:

> ☑ Songs removed from Tidal playlist are auto-rejected

- Maps to `tidal_collection_bidirectional`
- Disabled (greyed out) when `tidal_sync_enabled` is false
- `PATCH /{code}/collection` saves it

## What Does Not Change

- **Public leaderboard** (`GET /collect/{code}/leaderboard`): returns all `submitted_during_collection` requests with no status filter. Guests always see the full static list.
- **Guest "My Picks"**: shows submitted and upvoted songs regardless of DJ accept/reject status.
- **Collection submission**: guests can still submit during collection regardless of other songs' statuses.
- **Main event playlist** (`tidal_playlist_id`): unaffected. This feature only touches the collection playlist.

## Error Handling

- Tidal API failures in direction 1 are logged and do not roll back the WrzDJ status change. The reject is permanent; the Tidal removal is best-effort.
- Tidal API failures in direction 2 polling are logged per-event and do not abort other events' polls.
- If `tidal_collection_track_id` is `None` on a rejected request (track was never synced), no Tidal call is made.

## Testing

- Unit: `remove_track_from_collection_playlist` with mock tidalapi session
- Unit: `poll_tidal_collection_removals` — request present in playlist (no change), request absent (rejected)
- Unit: `sync_collection_requests_batch` stores `tidal_collection_track_id` after successful add
- Integration: `POST /events/{code}/bulk-review` with `reject_ids` — verifies background task queued
- Integration: `PATCH /requests/{request_id}` to rejected — verifies background task queued for collection requests
- Integration: `PATCH /{code}/collection` saves `tidal_collection_bidirectional`
- Poll loop: verify it skips events with `tidal_collection_bidirectional=False`
