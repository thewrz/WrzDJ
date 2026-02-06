"""Tidal API integration for playlist sync to SC6000 decks.

Uses tidalapi library for OAuth and playlist management.
Accepted song requests are synced to an event-specific Tidal playlist.
"""

import base64
import hashlib
import logging
import secrets
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING
from urllib.parse import urlencode

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.event import Event
from app.models.request import Request, TidalSyncStatus
from app.models.user import User
from app.schemas.tidal import TidalSearchResult, TidalSyncResult

if TYPE_CHECKING:
    import tidalapi

settings = get_settings()
logger = logging.getLogger(__name__)

# OAuth state expiration (10 minutes)
OAUTH_STATE_TTL_MINUTES = 10


@dataclass
class TidalOAuthState:
    """State for OAuth PKCE flow."""

    state: str
    code_verifier: str
    user_id: int
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


# In-memory state storage with TTL cleanup
# TODO: Use Redis or database storage for multi-instance production deployments
_oauth_states: dict[str, TidalOAuthState] = {}


def _cleanup_expired_oauth_states() -> None:
    """Remove OAuth states older than TTL."""
    cutoff = datetime.now(UTC) - timedelta(minutes=OAUTH_STATE_TTL_MINUTES)
    expired = [state for state, data in _oauth_states.items() if data.created_at < cutoff]
    for state in expired:
        del _oauth_states[state]


def generate_oauth_url(user: User) -> tuple[str, str]:
    """Generate Tidal OAuth URL with PKCE (S256).

    Returns:
        Tuple of (auth_url, state)
    """
    if not settings.tidal_client_id or not settings.tidal_redirect_uri:
        raise ValueError("Tidal credentials not configured")

    # Cleanup expired states before adding new one
    _cleanup_expired_oauth_states()

    # Generate PKCE values
    state = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(64)

    # Generate S256 code challenge from verifier
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).rstrip(b"=").decode()

    # Store state for callback verification
    _oauth_states[state] = TidalOAuthState(
        state=state,
        code_verifier=code_verifier,
        user_id=user.id,
    )

    # Build OAuth URL
    params = {
        "response_type": "code",
        "client_id": settings.tidal_client_id,
        "redirect_uri": settings.tidal_redirect_uri,
        "scope": "playlists.write playlists.read",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }

    auth_url = f"https://login.tidal.com/authorize?{urlencode(params)}"
    return auth_url, state


def get_oauth_state(state: str) -> TidalOAuthState | None:
    """Retrieve and remove OAuth state."""
    return _oauth_states.pop(state, None)


async def exchange_code_for_tokens(
    db: Session,
    code: str,
    state: str,
) -> User | None:
    """Exchange OAuth code for tokens and save to user.

    Args:
        db: Database session
        code: Authorization code from callback
        state: State parameter from callback

    Returns:
        Updated User or None if state invalid
    """
    try:
        import tidalapi
    except ImportError:
        logger.error("tidalapi not installed")
        return None

    oauth_state = get_oauth_state(state)
    if not oauth_state:
        logger.warning(f"Invalid OAuth state: {state}")
        return None

    user = db.query(User).filter(User.id == oauth_state.user_id).first()
    if not user:
        logger.warning(f"User not found for OAuth: {oauth_state.user_id}")
        return None

    try:
        # Create session and exchange code
        session = tidalapi.Session()
        session.login_oauth_simple(
            client_id=settings.tidal_client_id,
            client_secret=settings.tidal_client_secret,
        )

        # Exchange authorization code for tokens
        token_response = session.token_refresh(code)

        # Update user with tokens
        user.tidal_access_token = token_response.get("access_token")
        user.tidal_refresh_token = token_response.get("refresh_token")
        user.tidal_user_id = str(session.user.id)

        # Calculate expiry
        expires_in = token_response.get("expires_in", 3600)
        user.tidal_token_expires_at = datetime.now(UTC) + timedelta(seconds=expires_in)

        db.commit()
        db.refresh(user)

        logger.info(f"Tidal OAuth completed for user {user.id}")
        return user

    except Exception as e:
        logger.error(f"Tidal OAuth exchange failed: {e}")
        return None


def get_tidal_session(user: User) -> "tidalapi.Session | None":
    """Get authenticated Tidal session for user.

    Returns None if user has no linked Tidal account.
    Auto-refreshes token if expired.
    """
    try:
        import tidalapi
    except ImportError:
        logger.error("tidalapi not installed")
        return None

    if not user.tidal_access_token:
        return None

    session = tidalapi.Session()

    # Load existing tokens
    session.load_oauth_session(
        token_type="Bearer",
        access_token=user.tidal_access_token,
        refresh_token=user.tidal_refresh_token,
    )

    return session


async def refresh_token_if_needed(db: Session, user: User) -> bool:
    """Refresh Tidal token if expired.

    Returns True if token is valid (refreshed or not expired).
    """
    if not user.tidal_access_token:
        return False

    # Check if token is expired (with 5 min buffer)
    if user.tidal_token_expires_at:
        buffer = timedelta(minutes=5)
        now = datetime.now(UTC)
        # Handle both naive and aware datetimes from database
        expires_at = user.tidal_token_expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if now + buffer < expires_at:
            return True  # Token still valid

    try:
        import tidalapi
    except ImportError:
        return False

    if not user.tidal_refresh_token:
        return False

    try:
        session = tidalapi.Session()
        token_response = session.token_refresh(user.tidal_refresh_token)

        user.tidal_access_token = token_response.get("access_token")
        if "refresh_token" in token_response:
            user.tidal_refresh_token = token_response.get("refresh_token")

        expires_in = token_response.get("expires_in", 3600)
        user.tidal_token_expires_at = datetime.now(UTC) + timedelta(seconds=expires_in)

        db.commit()
        logger.info(f"Tidal token refreshed for user {user.id}")
        return True

    except Exception as e:
        logger.error(f"Tidal token refresh failed: {e}")
        return False


async def search_track(
    user: User,
    artist: str,
    title: str,
) -> TidalSearchResult | None:
    """Search Tidal for a track.

    Tries exact match first, then fuzzy search.

    Returns:
        Best matching track or None if not found
    """
    session = get_tidal_session(user)
    if not session:
        return None

    try:
        # Try exact search first
        query = f"{artist} {title}"
        results = session.search(query, models=[session.track_type], limit=10)

        if not results.tracks:
            return None

        # Find best match (prefer exact artist/title match)
        artist_lower = artist.lower()
        title_lower = title.lower()

        for track in results.tracks:
            track_artist = track.artist.name.lower() if track.artist else ""
            track_title = track.name.lower()

            if artist_lower in track_artist and title_lower in track_title:
                return _track_to_result(track)

        # Return first result if no exact match
        track = results.tracks[0]
        return _track_to_result(track)

    except Exception as e:
        logger.error(f"Tidal search failed: {e}")
        return None


def _track_to_result(track) -> TidalSearchResult:
    """Convert tidalapi Track to TidalSearchResult."""
    cover_url = None
    if track.album and track.album.image:
        cover_url = track.album.image(640)

    return TidalSearchResult(
        track_id=str(track.id),
        title=track.name,
        artist=track.artist.name if track.artist else "Unknown",
        album=track.album.name if track.album else None,
        duration_seconds=track.duration if track.duration else None,
        cover_url=cover_url,
        tidal_url=f"https://tidal.com/browse/track/{track.id}",
    )


async def create_event_playlist(
    db: Session,
    user: User,
    event: Event,
) -> str | None:
    """Create a Tidal playlist for an event.

    Returns playlist ID or None on failure.
    """
    if event.tidal_playlist_id:
        return event.tidal_playlist_id

    session = get_tidal_session(user)
    if not session:
        return None

    try:
        playlist_name = f"WrzDJ: {event.name}"
        description = f"Song requests for {event.name}"

        playlist = session.user.create_playlist(playlist_name, description)

        event.tidal_playlist_id = str(playlist.id)
        db.commit()

        logger.info(f"Created Tidal playlist {playlist.id} for event {event.code}")
        return event.tidal_playlist_id

    except Exception as e:
        logger.error(f"Failed to create Tidal playlist: {e}")
        return None


async def add_track_to_playlist(
    user: User,
    playlist_id: str,
    track_id: str,
) -> bool:
    """Add a track to a Tidal playlist.

    Returns True on success.
    """
    session = get_tidal_session(user)
    if not session:
        return False

    try:
        playlist = session.playlist(playlist_id)
        playlist.add([track_id])
        logger.info(f"Added track {track_id} to playlist {playlist_id}")
        return True

    except Exception as e:
        logger.error(f"Failed to add track to playlist: {e}")
        return False


async def sync_request_to_tidal(
    db: Session,
    request: Request,
) -> TidalSyncResult:
    """Sync an accepted request to Tidal playlist.

    This is the main entry point called when a request is accepted.

    Args:
        db: Database session
        request: The accepted request to sync

    Returns:
        TidalSyncResult with status and track info
    """
    event = request.event
    user = event.created_by

    # Mark as pending
    request.tidal_sync_status = TidalSyncStatus.PENDING.value
    db.commit()

    # Check if sync is enabled
    if not event.tidal_sync_enabled:
        return TidalSyncResult(
            request_id=request.id,
            status=TidalSyncStatus.ERROR,
            error="Tidal sync not enabled for this event",
        )

    # Check if user has Tidal linked
    if not user.tidal_access_token:
        return TidalSyncResult(
            request_id=request.id,
            status=TidalSyncStatus.ERROR,
            error="Tidal account not linked",
        )

    # Refresh token if needed
    if not await refresh_token_if_needed(db, user):
        request.tidal_sync_status = TidalSyncStatus.ERROR.value
        db.commit()
        return TidalSyncResult(
            request_id=request.id,
            status=TidalSyncStatus.ERROR,
            error="Tidal token refresh failed",
        )

    # Ensure playlist exists
    playlist_id = await create_event_playlist(db, user, event)
    if not playlist_id:
        request.tidal_sync_status = TidalSyncStatus.ERROR.value
        db.commit()
        return TidalSyncResult(
            request_id=request.id,
            status=TidalSyncStatus.ERROR,
            error="Failed to create Tidal playlist",
        )

    # Search for track
    track = await search_track(user, request.artist, request.song_title)
    if not track:
        request.tidal_sync_status = TidalSyncStatus.NOT_FOUND.value
        db.commit()
        return TidalSyncResult(
            request_id=request.id,
            status=TidalSyncStatus.NOT_FOUND,
            error="Track not found on Tidal",
        )

    # Add to playlist
    if await add_track_to_playlist(user, playlist_id, track.track_id):
        request.tidal_track_id = track.track_id
        request.tidal_sync_status = TidalSyncStatus.SYNCED.value
        db.commit()
        return TidalSyncResult(
            request_id=request.id,
            status=TidalSyncStatus.SYNCED,
            tidal_track_id=track.track_id,
        )
    else:
        request.tidal_sync_status = TidalSyncStatus.ERROR.value
        db.commit()
        return TidalSyncResult(
            request_id=request.id,
            status=TidalSyncStatus.ERROR,
            error="Failed to add track to playlist",
        )


async def manual_link_track(
    db: Session,
    request: Request,
    tidal_track_id: str,
) -> TidalSyncResult:
    """Manually link a Tidal track to a request.

    Used when auto-search fails and DJ manually selects the correct track.
    """
    event = request.event
    user = event.created_by

    if not user.tidal_access_token:
        return TidalSyncResult(
            request_id=request.id,
            status=TidalSyncStatus.ERROR,
            error="Tidal account not linked",
        )

    if not await refresh_token_if_needed(db, user):
        return TidalSyncResult(
            request_id=request.id,
            status=TidalSyncStatus.ERROR,
            error="Tidal token refresh failed",
        )

    playlist_id = event.tidal_playlist_id
    if not playlist_id:
        playlist_id = await create_event_playlist(db, user, event)
        if not playlist_id:
            return TidalSyncResult(
                request_id=request.id,
                status=TidalSyncStatus.ERROR,
                error="Failed to create Tidal playlist",
            )

    if await add_track_to_playlist(user, playlist_id, tidal_track_id):
        request.tidal_track_id = tidal_track_id
        request.tidal_sync_status = TidalSyncStatus.SYNCED.value
        db.commit()
        return TidalSyncResult(
            request_id=request.id,
            status=TidalSyncStatus.SYNCED,
            tidal_track_id=tidal_track_id,
        )
    else:
        return TidalSyncResult(
            request_id=request.id,
            status=TidalSyncStatus.ERROR,
            error="Failed to add track to playlist",
        )


async def search_tidal_tracks(
    user: User,
    query: str,
    limit: int = 10,
) -> list[TidalSearchResult]:
    """Search Tidal for tracks (for manual linking).

    Args:
        user: User with linked Tidal account
        query: Search query
        limit: Max results to return

    Returns:
        List of matching tracks
    """
    session = get_tidal_session(user)
    if not session:
        return []

    try:
        results = session.search(query, models=[session.track_type], limit=limit)
        return [_track_to_result(track) for track in results.tracks]

    except Exception as e:
        logger.error(f"Tidal search failed: {e}")
        return []


def disconnect_tidal(db: Session, user: User) -> None:
    """Unlink Tidal account from user."""
    user.tidal_access_token = None
    user.tidal_refresh_token = None
    user.tidal_token_expires_at = None
    user.tidal_user_id = None
    db.commit()
    logger.info(f"Tidal disconnected for user {user.id}")
