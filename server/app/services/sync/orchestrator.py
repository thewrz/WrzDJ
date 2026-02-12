"""Sync orchestrator — coordinates multi-service playlist sync.

Replaces the single-service sync_request_to_tidal with a pipeline that:
1. Parses intent from the raw search query
2. Normalizes the track title/artist
3. Fans out to all connected adapters
4. Persists results and maintains backward compat with Tidal columns
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.models.request import Request, TidalSyncStatus
from app.services.intent_parser import parse_intent
from app.services.sync.base import SyncResult, SyncStatus
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

    # Persist results as JSON
    results_data = [
        {
            "service": r.service,
            "status": r.status.value,
            "track_id": r.track_match.track_id if r.track_match else None,
            "track_title": r.track_match.title if r.track_match else None,
            "track_artist": r.track_match.artist if r.track_match else None,
            "confidence": r.track_match.match_confidence if r.track_match else None,
            "playlist_id": r.playlist_id,
            "error": r.error,
        }
        for r in multi_result.results
    ]
    request.sync_results_json = json.dumps(results_data)

    # Backward compat: populate legacy Tidal columns
    tidal_result = next((r for r in multi_result.results if r.service == "tidal"), None)
    if tidal_result:
        if tidal_result.status == SyncStatus.ADDED and tidal_result.track_match:
            request.tidal_track_id = tidal_result.track_match.track_id
            request.tidal_sync_status = TidalSyncStatus.SYNCED.value
        elif tidal_result.status == SyncStatus.NOT_FOUND:
            request.tidal_sync_status = TidalSyncStatus.NOT_FOUND.value
        else:
            request.tidal_sync_status = TidalSyncStatus.ERROR.value

    db.commit()
    return multi_result
