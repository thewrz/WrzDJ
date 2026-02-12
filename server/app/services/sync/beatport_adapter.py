"""Beatport adapter — search-only sync (no playlist write).

Beatport's API v4 is read-only for third-party apps. This adapter:
1. Searches the Beatport catalog for the requested track
2. Returns MATCHED (not ADDED) when found — the DJ gets a purchase link
3. Returns NOT_FOUND when no match
4. Stubs ensure_playlist() and add_to_playlist() — they do nothing

When Beatport opens write APIs, override sync_track() to use the
full search->playlist->add pipeline from the base class.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.services import beatport as beatport_service
from app.services.sync.base import PlaylistSyncAdapter, SyncResult, SyncStatus, TrackMatch
from app.services.track_normalizer import fuzzy_match_score
from app.services.version_filter import is_unwanted_version

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app.models.event import Event
    from app.models.user import User
    from app.services.intent_parser import IntentContext
    from app.services.track_normalizer import NormalizedTrack

logger = logging.getLogger(__name__)

MATCH_THRESHOLD = 0.5


class BeatportSyncAdapter(PlaylistSyncAdapter):
    """Playlist sync adapter for Beatport (search-only)."""

    @property
    def service_name(self) -> str:
        return "beatport"

    def is_connected(self, user: User) -> bool:
        return bool(user.beatport_access_token)

    def is_sync_enabled(self, event: Event) -> bool:
        return bool(event.beatport_sync_enabled)

    def search_track(
        self,
        db: Session,
        user: User,
        normalized: NormalizedTrack,
        intent: IntentContext | None = None,
    ) -> TrackMatch | None:
        """Search Beatport with version filtering and fuzzy scoring."""
        candidates = beatport_service.search_beatport_tracks(
            db, user, f"{normalized.raw_artist} {normalized.raw_title}", limit=10
        )

        if not candidates:
            return None

        best_match: TrackMatch | None = None
        best_score = 0.0

        for candidate in candidates:
            # Build a display title including mix_name for version filtering
            display_title = candidate.title
            if candidate.mix_name:
                display_title = f"{candidate.title} ({candidate.mix_name})"

            if is_unwanted_version(display_title, intent):
                continue

            title_score = fuzzy_match_score(normalized.title, candidate.title)
            artist_score = fuzzy_match_score(normalized.artist, candidate.artist)
            combined = title_score * 0.7 + artist_score * 0.3

            if combined > best_score and combined >= MATCH_THRESHOLD:
                best_score = combined
                best_match = TrackMatch(
                    service="beatport",
                    track_id=candidate.track_id,
                    title=display_title,
                    artist=candidate.artist,
                    match_confidence=combined,
                    url=candidate.beatport_url,
                    duration_seconds=candidate.duration_seconds,
                )

        if best_match:
            logger.info(
                "Beatport match: '%s' by '%s' (confidence: %.2f)",
                best_match.title,
                best_match.artist,
                best_match.match_confidence,
            )

        return best_match

    def ensure_playlist(
        self,
        db: Session,
        user: User,
        event: Event,
    ) -> str | None:
        """Stub — Beatport has no playlist API."""
        return None

    def add_to_playlist(
        self,
        db: Session,
        user: User,
        playlist_id: str,
        track_id: str,
    ) -> bool:
        """Stub — Beatport has no playlist API."""
        return False

    def sync_track(
        self,
        db: Session,
        user: User,
        event: Event,
        normalized: NormalizedTrack,
        intent: IntentContext | None = None,
    ) -> SyncResult:
        """Search-only sync: returns MATCHED (not ADDED) when found.

        Overrides the base class pipeline to skip playlist creation/addition.
        """
        try:
            track_match = self.search_track(db, user, normalized, intent)
            if not track_match:
                return SyncResult(
                    service=self.service_name,
                    status=SyncStatus.NOT_FOUND,
                )
            return SyncResult(
                service=self.service_name,
                status=SyncStatus.MATCHED,
                track_match=track_match,
            )
        except Exception as e:
            logger.error("Beatport sync failed: %s", e)
            return SyncResult(
                service=self.service_name,
                status=SyncStatus.ERROR,
                error=str(e),
            )
