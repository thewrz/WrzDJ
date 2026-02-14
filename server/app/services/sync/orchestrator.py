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
import re
import statistics
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.models.request import Request, RequestStatus, TidalSyncStatus
from app.services.intent_parser import parse_intent
from app.services.musicbrainz import lookup_artist_genre
from app.services.request import normalize_key
from app.services.sync.base import SyncResult, SyncStatus, TrackMatch, sanitize_sync_error
from app.services.sync.registry import get_connected_adapters
from app.services.track_normalizer import (
    artist_match_score,
    fuzzy_match_score,
    is_original_mix_name,
    is_remix_title,
    normalize_bpm_to_context,
    normalize_track,
    primary_artist,
)

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
            logger.error(f"Adapter {adapter.service_name} failed: {type(e).__name__}")
            multi_result.results.append(
                SyncResult(
                    service=adapter.service_name,
                    status=SyncStatus.ERROR,
                    error=sanitize_sync_error(e),
                )
            )

    # Persist results and log activity
    for result in multi_result.results:
        _persist_sync_result(request, result)
        if result.status in (SyncStatus.NOT_FOUND, SyncStatus.ERROR):
            try:
                from app.services.activity_log import log_activity

                level = "warning" if result.status == SyncStatus.NOT_FOUND else "error"
                msg = (
                    f"Sync {result.status.value}: "
                    f"{request.artist} - {request.song_title} on {result.service}"
                )
                if result.error:
                    msg += f" ({result.error})"
                log_activity(
                    db,
                    level,
                    result.service,
                    msg[:500],
                    event_code=event.code,
                    user_id=user.id,
                )
            except Exception:
                pass  # nosec B110

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
                logger.error(f"Search failed for {adapter.service_name}: {type(e).__name__}")
                error_reqs.append((request, sanitize_sync_error(e)))

        # Phase 2: Ensure playlist exists (once, not per-request)
        playlist_id = None
        if found:
            try:
                playlist_id = adapter.ensure_playlist(db, user, event)
            except Exception as e:
                svc = adapter.service_name
                logger.error("Playlist creation failed for %s: %s", svc, type(e).__name__)
                err_msg = f"Failed to ensure playlist: {sanitize_sync_error(e)}"
                for request, _match in found:
                    error_reqs.append((request, err_msg))
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
            parsed = json.loads(request.sync_results_json)
            if isinstance(parsed, list):
                return any(
                    r.get("service") == service_name and r.get("status") == "added" for r in parsed
                )
        except (json.JSONDecodeError, TypeError):
            pass

    return False


def _find_best_match(
    results,
    title: str,
    artist: str,
    min_score: float = 0.4,
    min_artist_score: float = 0.35,
    prefer_original: bool = True,
):
    """Find the best fuzzy match from search results.

    Scores each result by title (60%) + artist (40%) similarity.
    Returns the best match above min_score, or None if no good match.

    A separate min_artist_score floor prevents a perfect title match
    from carrying a completely wrong artist (e.g., "Feel the Beat" by
    LB aka LABAT matching a request for Darude).

    When prefer_original is True, applies a small bonus (+0.1) for
    results that look like the original version (Beatport mix_name
    matches "Original Mix", "Extended Mix", etc.) and a penalty (-0.1)
    for results with detected remix patterns in the title (Tidal).
    This breaks ties between "Surrender (Original Mix)" at 132 BPM and
    "Surrender (Hardstyle Remix)" at 165 BPM without overriding a
    genuinely better title/artist match.

    When multiple results have identical scores, a BPM consensus
    tiebreaker (+0.01) favors the version whose BPM matches the most
    common BPM among all results.
    """
    logger.info(
        "_find_best_match: title='%s' artist='%s' prefer_original=%s (%d results)",
        title,
        artist,
        prefer_original,
        len(results),
    )

    # Compute modal BPM for consensus tiebreaker
    bpm_counts: dict[int, int] = {}
    for result in results:
        bpm = getattr(result, "bpm", None)
        if bpm:
            rounded = round(float(bpm))
            bpm_counts[rounded] = bpm_counts.get(rounded, 0) + 1
    modal_bpm = max(bpm_counts, key=bpm_counts.get) if bpm_counts else None

    best = None
    best_score = 0.0
    for i, result in enumerate(results):
        title_score = fuzzy_match_score(title, result.title)
        artist_score = artist_match_score(artist, result.artist)
        if artist_score < min_artist_score:
            logger.info(
                "  [%d] SKIP artist_score=%.3f < %.2f | title=%s artist=%s",
                i,
                artist_score,
                min_artist_score,
                result.title,
                result.artist,
            )
            continue
        combined = title_score * 0.6 + artist_score * 0.4
        version_adj = 0.0

        if prefer_original:
            mix_name = getattr(result, "mix_name", None)
            if mix_name:
                # Beatport: structured mix_name available
                if is_original_mix_name(mix_name):
                    version_adj = 0.1
                    combined += 0.1
                # Named remix/bootleg/rework in mix_name → no bonus
            else:
                # Tidal/other: check title for remix patterns
                if is_remix_title(result.title):
                    version_adj = -0.1
                    combined -= 0.1

        # BPM consensus tiebreaker: prefer modal BPM among results
        bpm_adj = 0.0
        result_bpm = getattr(result, "bpm", None)
        if modal_bpm and result_bpm and round(float(result_bpm)) == modal_bpm:
            bpm_adj = 0.01
            combined += 0.01

        logger.info(
            "  [%d] title=%s artist=%s bpm=%s mix=%s | "
            "title_sc=%.3f artist_sc=%.3f ver_adj=%+.2f bpm_adj=%+.3f => combined=%.4f",
            i,
            result.title,
            result.artist,
            getattr(result, "bpm", "?"),
            getattr(result, "mix_name", None) or "-",
            title_score,
            artist_score,
            version_adj,
            bpm_adj,
            combined,
        )

        if combined > best_score:
            best_score = combined
            best = result

    if best and best_score >= min_score:
        logger.info(
            "  BEST: title=%s artist=%s bpm=%s (score=%.4f)",
            best.title,
            best.artist,
            getattr(best, "bpm", "?"),
            best_score,
        )
        return best

    logger.info("  NO MATCH (best_score=%.4f < min=%.2f)", best_score, min_score)
    return None


# URL patterns for extracting track IDs from source URLs
_SPOTIFY_URL_RE = re.compile(r"open\.spotify\.com/track/(\w+)")
_BEATPORT_URL_RE = re.compile(r"beatport\.com/track/[^/]+/(\d+)")
_TIDAL_URL_RE = re.compile(r"tidal\.com/(?:browse/)?track/(\d+)")


def _extract_source_track_id(source_url: str | None) -> tuple[str | None, str | None]:
    """Extract (service, track_id) from a source URL.

    Returns:
        ("spotify", "4uLU6hMCjMI75M1A2tKUQC") for Spotify URLs
        ("beatport", "12345") for Beatport URLs
        ("tidal", "67890") for Tidal URLs
        (None, None) for unrecognized URLs
    """
    if not source_url:
        return None, None
    for name, pattern in [
        ("spotify", _SPOTIFY_URL_RE),
        ("beatport", _BEATPORT_URL_RE),
        ("tidal", _TIDAL_URL_RE),
    ]:
        m = pattern.search(source_url)
        if m:
            return name, m.group(1)
    return None, None


def _get_isrc_from_spotify(source_url: str | None) -> str | None:
    """Extract ISRC from a Spotify track URL via the Spotify API.

    ISRC (International Standard Recording Code) uniquely identifies a
    recording across services, enabling deterministic cross-service matching.
    """
    if not source_url:
        return None
    m = _SPOTIFY_URL_RE.search(source_url)
    if not m:
        return None
    try:
        from app.services.spotify import _get_spotify_client

        sp = _get_spotify_client()
        track = sp.track(m.group(1))
        return track.get("external_ids", {}).get("isrc")
    except Exception:
        logger.warning("Failed to fetch ISRC from Spotify for %s", source_url)
        return None


def _apply_enrichment_result(request: Request, best, *, with_genre: bool = False) -> None:
    """Apply BPM/key (and optionally genre) from a matched result to a request."""
    if with_genre and not request.genre and getattr(best, "genre", None):
        request.genre = best.genre
    if not request.bpm and best.bpm:
        request.bpm = float(best.bpm)
    if not request.musical_key and getattr(best, "key", None):
        request.musical_key = normalize_key(best.key)


def enrich_request_metadata(db: Session, request_id: int) -> None:
    """Background task: fill missing genre/BPM/key on a request.

    Sources (in priority order):
    0. Direct fetch via source_url (Beatport/Tidal URL → exact track)
    0b. ISRC matching (Spotify URL → ISRC → exact Tidal match)
    1. MusicBrainz artist lookup (genre — artist-level, 1 req/sec rate limit)
    2. Beatport search (BPM + key, backfill genre if MusicBrainz missed)
    3. Tidal search (BPM + key backup when Beatport unavailable)

    Only queries sources for missing fields. Skips if all fields present.
    Results are fuzzy-matched against the request to avoid enriching
    with metadata from a wrong track.
    """
    # Re-fetch request in this background task's context
    request = db.query(Request).filter(Request.id == request_id).first()
    if not request:
        return

    if request.genre and request.bpm and request.musical_key:
        return  # Already complete

    user = request.event.created_by
    search_query = f"{primary_artist(request.artist)} {request.song_title}"
    prefer_original = not is_remix_title(request.song_title)

    # Identify the source service and track ID from source_url
    source_svc, source_track_id = _extract_source_track_id(request.source_url)

    logger.info(
        "Enriching request %d: '%s' by '%s' | query='%s' prefer_original=%s | "
        "source_url=%s (svc=%s, id=%s) | existing: genre=%s bpm=%s key=%s",
        request_id,
        request.song_title,
        request.artist,
        search_query,
        prefer_original,
        request.source_url,
        source_svc,
        source_track_id,
        request.genre,
        request.bpm,
        request.musical_key,
    )

    # 0. Direct fetch: when source_url points to Beatport or Tidal, skip search entirely
    if source_svc == "beatport" and source_track_id:
        if user and user.beatport_access_token and (not request.bpm or not request.musical_key):
            try:
                from app.services.beatport import get_beatport_track

                direct = get_beatport_track(db, user, source_track_id)
                if direct:
                    logger.info(
                        "Beatport direct fetch for %d: '%s' bpm=%s key=%s",
                        request_id,
                        direct.title,
                        direct.bpm,
                        direct.key,
                    )
                    _apply_enrichment_result(request, direct, with_genre=True)
            except Exception:
                logger.warning("Beatport direct fetch failed for request %d", request_id)

    if source_svc == "tidal" and source_track_id:
        if user and user.tidal_access_token and (not request.bpm or not request.musical_key):
            try:
                from app.services.tidal import get_tidal_track_by_id

                direct = get_tidal_track_by_id(db, user, source_track_id)
                if direct:
                    logger.info(
                        "Tidal direct fetch for %d: '%s' bpm=%s key=%s",
                        request_id,
                        direct.title,
                        direct.bpm,
                        direct.key,
                    )
                    _apply_enrichment_result(request, direct)
            except Exception:
                logger.warning("Tidal direct fetch failed for request %d", request_id)

    # 0b. ISRC matching: Spotify URL → fetch ISRC → exact Tidal lookup
    if source_svc == "spotify" and (not request.bpm or not request.musical_key):
        if user and user.tidal_access_token:
            try:
                isrc = _get_isrc_from_spotify(request.source_url)
                if isrc:
                    from app.services.tidal import search_tidal_by_isrc

                    isrc_match = search_tidal_by_isrc(db, user, isrc)
                    if isrc_match:
                        logger.info(
                            "ISRC match for %d: '%s' by '%s' bpm=%s key=%s (ISRC=%s)",
                            request_id,
                            isrc_match.title,
                            isrc_match.artist,
                            isrc_match.bpm,
                            isrc_match.key,
                            isrc,
                        )
                        _apply_enrichment_result(request, isrc_match)
            except Exception:
                logger.warning("ISRC enrichment failed for request %d", request_id)

    # 1. MusicBrainz for genre (artist-level, free, rate-limited)
    if not request.genre and request.artist:
        try:
            genre = lookup_artist_genre(request.artist)
            if genre:
                request.genre = genre
        except Exception:
            logger.warning("MusicBrainz enrichment failed for request %d", request_id)

    # 2. Beatport for BPM + key (and genre backfill if MusicBrainz missed)
    if not request.bpm or not request.musical_key or not request.genre:
        if user and user.beatport_access_token:
            try:
                from app.services.beatport import search_beatport_tracks

                results = search_beatport_tracks(db, user, search_query, limit=5)
                logger.info(
                    "Beatport returned %d results for request %d",
                    len(results) if results else 0,
                    request_id,
                )
                if results:
                    best = _find_best_match(
                        results,
                        request.song_title,
                        request.artist,
                        prefer_original=prefer_original,
                    )
                    if best:
                        logger.info(
                            "Beatport best for %d: '%s' by '%s' bpm=%s key=%s mix=%s",
                            request_id,
                            best.title,
                            best.artist,
                            best.bpm,
                            best.key,
                            best.mix_name,
                        )
                        _apply_enrichment_result(request, best, with_genre=True)
                    else:
                        logger.info("Beatport: no match for request %d", request_id)
            except Exception:
                logger.warning("Beatport enrichment failed for request %d", request_id)

    # 3. Tidal for BPM + key (backup when Beatport didn't find them)
    if not request.bpm or not request.musical_key:
        if user and user.tidal_access_token:
            try:
                from app.services.tidal import search_tidal_tracks

                results = search_tidal_tracks(db, user, search_query, limit=5)
                logger.info(
                    "Tidal returned %d results for request %d",
                    len(results) if results else 0,
                    request_id,
                )
                if results:
                    best = _find_best_match(
                        results,
                        request.song_title,
                        request.artist,
                        prefer_original=prefer_original,
                    )
                    if best:
                        logger.info(
                            "Tidal best for %d: '%s' by '%s' bpm=%s key=%s",
                            request_id,
                            best.title,
                            best.artist,
                            best.bpm,
                            getattr(best, "key", None),
                        )
                        _apply_enrichment_result(request, best)
                    else:
                        logger.info("Tidal: no match for request %d", request_id)
            except Exception:
                logger.warning("Tidal enrichment failed for request %d", request_id)

    # Normalize key if we got one from enrichment
    if request.musical_key:
        request.musical_key = normalize_key(request.musical_key)

    # 4. BPM context correction: detect half-time/double-time from other event tracks
    if request.bpm:
        context_bpms = [
            float(r.bpm)
            for r in db.query(Request)
            .filter(
                Request.event_id == request.event_id,
                Request.id != request.id,
                Request.bpm.isnot(None),
                Request.status.in_(
                    [
                        RequestStatus.ACCEPTED.value,
                        RequestStatus.PLAYING.value,
                        RequestStatus.PLAYED.value,
                    ]
                ),
            )
            .all()
        ]
        corrected = normalize_bpm_to_context(request.bpm, context_bpms)
        if corrected != request.bpm:
            logger.info(
                "BPM corrected for request %d: %.1f → %.1f (median context: %.1f)",
                request_id,
                request.bpm,
                corrected,
                statistics.median(context_bpms),
            )
            request.bpm = corrected

    db.commit()
    logger.info(
        "Enriched request %d: genre=%s, bpm=%s, key=%s",
        request_id,
        request.genre,
        request.bpm,
        request.musical_key,
    )


def _persist_sync_result(request: Request, result: SyncResult) -> None:
    """Persist a sync result to a request's JSON and legacy columns.

    Replaces any existing result for the same service (upsert semantics).
    """
    # Update sync_results_json (upsert per-service)
    existing: list[dict] = []
    if request.sync_results_json:
        try:
            parsed = json.loads(request.sync_results_json)
            existing = parsed if isinstance(parsed, list) else []
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
            "url": result.track_match.url if result.track_match else None,
            "duration_seconds": result.track_match.duration_seconds if result.track_match else None,
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
