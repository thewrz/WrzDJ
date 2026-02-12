"""Abstract base for playlist sync adapters.

Each adapter wraps a single music service (Tidal, Beatport, etc.)
and provides a uniform interface for searching, playlist management,
and track syncing.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app.models.event import Event
    from app.models.user import User
    from app.services.intent_parser import IntentContext
    from app.services.track_normalizer import NormalizedTrack

logger = logging.getLogger(__name__)


class SyncStatus(str, Enum):
    MATCHED = "matched"
    NOT_FOUND = "not_found"
    ADDED = "added"
    ERROR = "error"


@dataclass(frozen=True)
class TrackMatch:
    """A track found on a music service."""

    service: str
    track_id: str
    title: str
    artist: str
    match_confidence: float
    url: str | None = None
    duration_seconds: int | None = None


@dataclass(frozen=True)
class SyncResult:
    """Result of syncing a single request to a single service."""

    service: str
    status: SyncStatus
    track_match: TrackMatch | None = None
    playlist_id: str | None = None
    error: str | None = None


class PlaylistSyncAdapter(ABC):
    """Abstract base for playlist sync adapters."""

    @property
    @abstractmethod
    def service_name(self) -> str:
        """Unique identifier for this service (e.g., 'tidal')."""

    @abstractmethod
    def is_connected(self, user: User) -> bool:
        """Check if the user has an active connection to this service."""

    def is_sync_enabled(self, event: Event) -> bool:
        """Check if sync is enabled for this event. Default: True.

        Adapters override to check per-event settings (e.g., tidal_sync_enabled).
        """
        return True

    @abstractmethod
    def search_track(
        self,
        db: Session,
        user: User,
        normalized: NormalizedTrack,
        intent: IntentContext | None = None,
    ) -> TrackMatch | None:
        """Search for a track on this service.

        Returns the best matching track, or None if not found.
        """

    @abstractmethod
    def ensure_playlist(
        self,
        db: Session,
        user: User,
        event: Event,
    ) -> str | None:
        """Ensure a playlist exists for the event, return playlist ID."""

    @abstractmethod
    def add_to_playlist(
        self,
        db: Session,
        user: User,
        playlist_id: str,
        track_id: str,
    ) -> bool:
        """Add a track to a playlist. Returns True on success."""

    def sync_track(
        self,
        db: Session,
        user: User,
        event: Event,
        normalized: NormalizedTrack,
        intent: IntentContext | None = None,
    ) -> SyncResult:
        """Full sync pipeline: search -> ensure playlist -> add track.

        Default implementation calls the abstract methods in sequence.
        Adapters can override for custom behavior.
        """
        try:
            track_match = self.search_track(db, user, normalized, intent)
            if not track_match:
                return SyncResult(
                    service=self.service_name,
                    status=SyncStatus.NOT_FOUND,
                )

            playlist_id = self.ensure_playlist(db, user, event)
            if not playlist_id:
                return SyncResult(
                    service=self.service_name,
                    status=SyncStatus.ERROR,
                    error="Failed to create playlist",
                )

            if self.add_to_playlist(db, user, playlist_id, track_match.track_id):
                return SyncResult(
                    service=self.service_name,
                    status=SyncStatus.ADDED,
                    track_match=track_match,
                    playlist_id=playlist_id,
                )
            else:
                return SyncResult(
                    service=self.service_name,
                    status=SyncStatus.ERROR,
                    track_match=track_match,
                    error="Failed to add track to playlist",
                )

        except Exception as e:
            logger.error(f"Sync failed for {self.service_name}: {e}")
            return SyncResult(
                service=self.service_name,
                status=SyncStatus.ERROR,
                error=str(e),
            )
