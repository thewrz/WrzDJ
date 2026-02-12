"""Sync orchestrator — coordinates multi-service playlist sync.

Replaces the single-service sync_request_to_tidal with a pipeline that:
1. Parses intent from the raw search query
2. Normalizes the track title/artist
3. Fans out to all connected adapters
4. Persists results and maintains backward compat with Tidal columns

Provides both single-request sync (for manual sync button) and batch sync
(for accept-all) to avoid Tidal API rate limiting.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.models.request import Request, TidalSyncStatus
from app.services.intent_parser import parse_intent
from app.services.sync.base import SyncResult, SyncStatus, TrackMatch
from app.services.sync.registry import get_connected_adapters
from app.services.track_normalizer import normalize_track

logger = logging.getLogger(__name__)


@dataclass
class MultiSyncResult:
    """Aggregate result from syncing to all connected services."""

    results: list[SyncResult] = field(default_factory=list)

    @property
    def any_added(self) -> bool:
        return any(r.status == SyncStatus.ADDED for r in self.results)

    @property
    def all_not_found(self) -> bool:
        return all(r.status == SyncStatus.NOT_FOUND for r in self.results) and len(self.results) > 0


def sync_request_to_services(db: Session, request: Request) -> MultiSyncResult:
    """Sync an accepted request to all connected music services.

    Used for single-request sync (manual sync button, individual accept).

    1. Parse IntentContext from request.raw_search_query
    2. Normalize artist/title
    3. Get connected adapters for the event's DJ
    4. Fan out: each adapter.sync_track(...)
    5. Persist per-service results as JSON on request
    6. Backward compat: populate tidal_track_id/tidal_sync_status
    """
    event = request.event
    user = event.created_by
    multi_result = MultiSyncResult()

    # Parse intent from raw search query (None-safe)
    intent = parse_intent(request.raw_search_query) if request.raw_search_query else None

    # Normalize the requested track
    normalized = normalize_track(request.song_title, request.artist)

    # Get all adapters where the user has an active connection
    adapters = get_connected_adapters(user)
    if not adapters:
        logger.info(f"No connected sync adapters for user {user.id}")
        return multi_result

    # Fan out to each adapter (each independently failable)
    for adapter in adapters:
        # Respect per-event sync settings (e.g., tidal_sync_enabled)
        if not adapter.is_sync_enabled(event):
            continue

        try:
            result = adapter.sync_track(db, user, event, normalized, intent)
            multi_result.results.append(result)
        except Exception as e:
            logger.error(f"Adapter {adapter.service_name} failed: {e}")
            multi_result.results.append(
                SyncResult(
                    service=adapter.service_name,
                    status=SyncStatus.ERROR,
                    error=str(e),
                )
            )

    # Persist results
    for result in multi_result.results:
        _persist_sync_result(request, result)

    db.commit()
    return multi_result


def sync_requests_batch(db: Session, requests: list[Request]) -> None:
    """Sync a batch of accepted requests to all services.

    Used by accept-all to avoid Tidal API rate limiting. Instead of N
    independent background tasks each creating a session + searching + adding,
    this function:
    1. Searches tracks sequentially (reusing one session)
    2. Batch-adds all found tracks in a single API call
    3. Skips requests already synced (dedup)

    This reduces API calls from ~4N to ~N+2 (N searches + 1 playlist + 1 batch add).
    """
    if not requests:
        return

    event = requests[0].event
    user = event.created_by

    adapters = get_connected_adapters(user)
    if not adapters:
        logger.info(f"No connected sync adapters for user {user.id}")
        return

    for adapter in adapters:
        if not adapter.is_sync_enabled(event):
            continue

        # Filter out requests already synced to this service
        pending = [r for r in requests if not _is_already_synced(r, adapter.service_name)]
        if not pending:
            logger.info(f"All {len(requests)} requests already synced to {adapter.service_name}")
            continue

        # Phase 1: Search for all tracks (sequentially to share one session)
        found: list[tuple[Request, TrackMatch]] = []
        not_found_reqs: list[Request] = []
        error_reqs: list[tuple[Request, str]] = []

        for request in pending:
            intent = parse_intent(request.raw_search_query) if request.raw_search_query else None
            normalized = normalize_track(request.song_title, request.artist)

            try:
                match = adapter.search_track(db, user, normalized, intent)
                if match:
                    found.append((request, match))
                else:
                    not_found_reqs.append(request)
            except Exception as e:
                logger.error(f"Search failed for {adapter.service_name}: {e}")
                error_reqs.append((request, str(e)))

        # Phase 2: Ensure playlist exists (once, not per-request)
        playlist_id = None
        if found:
            try:
                playlist_id = adapter.ensure_playlist(db, user, event)
            except Exception as e:
                logger.error(f"Playlist creation failed for {adapter.service_name}: {e}")
                for request, _match in found:
                    error_reqs.append((request, f"Failed to ensure playlist: {e}"))
                found = []

            if found and not playlist_id:
                for request, _match in found:
                    error_reqs.append((request, "Failed to create playlist"))
                found = []

        # Phase 3: Batch add all found tracks in one API call
        if found and playlist_id:
            track_ids = [match.track_id for _, match in found]
            try:
                success = adapter.add_tracks_to_playlist(db, user, playlist_id, track_ids)
            except Exception as e:
                success = False
                logger.error(f"Batch add failed for {adapter.service_name}: {e}")

            for request, match in found:
                _persist_sync_result(
                    request,
                    SyncResult(
                        service=adapter.service_name,
                        status=SyncStatus.ADDED if success else SyncStatus.ERROR,
                        track_match=match,
                        playlist_id=playlist_id,
                        error=None if success else "Failed to add tracks to playlist",
                    ),
                )

        # Persist NOT_FOUND results
        for request in not_found_reqs:
            _persist_sync_result(
                request,
                SyncResult(service=adapter.service_name, status=SyncStatus.NOT_FOUND),
            )

        # Persist ERROR results
        for request, error in error_reqs:
            _persist_sync_result(
                request,
                SyncResult(service=adapter.service_name, status=SyncStatus.ERROR, error=error),
            )

    db.commit()


def _is_already_synced(request: Request, service_name: str) -> bool:
    """Check if a request is already successfully synced to a service."""
    # Check legacy Tidal column
    if service_name == "tidal" and request.tidal_sync_status == TidalSyncStatus.SYNCED.value:
        return True

    # Check multi-service JSON results
    if request.sync_results_json:
        try:
            results = json.loads(request.sync_results_json)
            return any(
                r.get("service") == service_name and r.get("status") == "added" for r in results
            )
        except (json.JSONDecodeError, TypeError):
            pass

    return False


def _persist_sync_result(request: Request, result: SyncResult) -> None:
    """Persist a sync result to a request's JSON and legacy columns.

    Replaces any existing result for the same service (upsert semantics).
    """
    # Update sync_results_json (upsert per-service)
    existing: list[dict] = []
    if request.sync_results_json:
        try:
            existing = json.loads(request.sync_results_json)
        except (json.JSONDecodeError, TypeError):
            existing = []

    # Remove old result for this service, add new one
    existing = [r for r in existing if r.get("service") != result.service]
    existing.append(
        {
            "service": result.service,
            "status": result.status.value,
            "track_id": result.track_match.track_id if result.track_match else None,
            "track_title": result.track_match.title if result.track_match else None,
            "track_artist": result.track_match.artist if result.track_match else None,
            "confidence": result.track_match.match_confidence if result.track_match else None,
            "playlist_id": result.playlist_id,
            "error": result.error,
        }
    )
    request.sync_results_json = json.dumps(existing)

    # Backward compat: populate legacy Tidal columns
    if result.service == "tidal":
        if result.status == SyncStatus.ADDED and result.track_match:
            request.tidal_track_id = result.track_match.track_id
            request.tidal_sync_status = TidalSyncStatus.SYNCED.value
        elif result.status == SyncStatus.NOT_FOUND:
            request.tidal_sync_status = TidalSyncStatus.NOT_FOUND.value
        else:
            request.tidal_sync_status = TidalSyncStatus.ERROR.value
