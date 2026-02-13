"""Recommendation engine orchestrator.

Coordinates enrichment, profiling, candidate search, scoring,
and deduplication to generate track suggestions for an event.
"""

import logging
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.request import Request, RequestStatus
from app.models.user import User
from app.services.recommendation.enrichment import enrich_event_tracks
from app.services.recommendation.scorer import (
    EventProfile,
    ScoredTrack,
    TrackProfile,
    build_event_profile,
    rank_candidates,
)
from app.services.track_normalizer import fuzzy_match_score

logger = logging.getLogger(__name__)

# Maximum number of search queries per source
MAX_SEARCH_QUERIES = 3
# Maximum results per search query
SEARCH_LIMIT = 10


@dataclass
class RecommendationResult:
    """Result of generating recommendations for an event."""

    suggestions: list[ScoredTrack]
    event_profile: EventProfile
    enriched_count: int
    total_candidates_searched: int
    services_used: list[str]


def _get_accepted_played_requests(db: Session, event: Event) -> list[Request]:
    """Fetch accepted and played requests for the event, most recent first."""
    return (
        db.query(Request)
        .filter(
            Request.event_id == event.id,
            Request.status.in_([RequestStatus.ACCEPTED.value, RequestStatus.PLAYED.value]),
        )
        .order_by(Request.created_at.desc())
        .all()
    )


def _build_search_queries(profile: EventProfile) -> list[str]:
    """Generate search queries from an event profile.

    Uses dominant genres and creates general queries that
    should return tracks matching the event's vibe.
    """
    queries = []

    # Genre-based queries
    for genre in profile.dominant_genres[:MAX_SEARCH_QUERIES]:
        queries.append(genre)

    # If we have BPM info, add a BPM-targeted query
    if profile.avg_bpm and len(queries) < MAX_SEARCH_QUERIES:
        bpm_str = str(int(profile.avg_bpm))
        if profile.dominant_genres:
            queries.append(f"{profile.dominant_genres[0]} {bpm_str} bpm")
        else:
            queries.append(f"{bpm_str} bpm")

    return queries[:MAX_SEARCH_QUERIES]


def _search_candidates(
    db: Session,
    user: User,
    queries: list[str],
) -> tuple[list[TrackProfile], list[str], int]:
    """Search connected services for candidate tracks.

    Returns (candidates, services_used, total_searched).
    """
    candidates: list[TrackProfile] = []
    services_used: set[str] = set()
    total_searched = 0

    # Search Beatport if connected
    if user.beatport_access_token:
        from app.services.beatport import search_beatport_tracks

        for query in queries:
            results = search_beatport_tracks(db, user, query, limit=SEARCH_LIMIT)
            for r in results:
                candidates.append(
                    TrackProfile(
                        title=r.title,
                        artist=r.artist,
                        bpm=float(r.bpm) if r.bpm else None,
                        key=r.key,
                        genre=r.genre,
                        source="beatport",
                        track_id=r.track_id,
                        url=r.beatport_url,
                        cover_url=r.cover_url,
                        duration_seconds=r.duration_seconds,
                    )
                )
            total_searched += len(results)
            if results:
                services_used.add("beatport")

    # Search Tidal if connected
    if user.tidal_access_token:
        from app.services.tidal import search_tidal_tracks

        for query in queries:
            results = search_tidal_tracks(db, user, query, limit=SEARCH_LIMIT)
            for r in results:
                candidates.append(
                    TrackProfile(
                        title=r.title,
                        artist=r.artist,
                        source="tidal",
                        track_id=r.track_id,
                        url=r.tidal_url,
                        cover_url=r.cover_url,
                        duration_seconds=r.duration_seconds,
                    )
                )
            total_searched += len(results)
            if results:
                services_used.add("tidal")

    return candidates, sorted(services_used), total_searched


def _deduplicate_against_requests(
    candidates: list[TrackProfile],
    existing_requests: list[Request],
) -> list[TrackProfile]:
    """Remove candidates that are already requested for this event."""
    if not existing_requests:
        return candidates

    deduped = []
    for candidate in candidates:
        is_dupe = False
        for req in existing_requests:
            title_score = fuzzy_match_score(candidate.title, req.song_title)
            artist_score = fuzzy_match_score(candidate.artist, req.artist)
            combined = title_score * 0.6 + artist_score * 0.4
            if combined >= 0.8:
                is_dupe = True
                break
        if not is_dupe:
            deduped.append(candidate)
    return deduped


def _deduplicate_candidates(candidates: list[TrackProfile]) -> list[TrackProfile]:
    """Remove duplicate candidates (same track from different queries)."""
    seen: list[TrackProfile] = []
    for candidate in candidates:
        is_dupe = False
        for existing in seen:
            title_score = fuzzy_match_score(candidate.title, existing.title)
            artist_score = fuzzy_match_score(candidate.artist, existing.artist)
            combined = title_score * 0.6 + artist_score * 0.4
            if combined >= 0.8:
                is_dupe = True
                break
        if not is_dupe:
            seen.append(candidate)
    return seen


def generate_recommendations(
    db: Session,
    user: User,
    event: Event,
    max_results: int = 20,
) -> RecommendationResult:
    """Generate track recommendations for an event.

    Pipeline:
    1. Fetch accepted/played requests
    2. Enrich with BPM/key/genre from Tidal/Beatport
    3. Build EventProfile
    4. Generate search queries from profile
    5. Search connected services for candidates
    6. Deduplicate against existing requests
    7. Score and rank candidates
    8. Return top N
    """
    # Step 1: Fetch existing requests
    requests = _get_accepted_played_requests(db, event)

    # Check if any services are connected
    has_tidal = bool(user.tidal_access_token)
    has_beatport = bool(user.beatport_access_token)

    if not has_tidal and not has_beatport:
        return RecommendationResult(
            suggestions=[],
            event_profile=EventProfile(track_count=0),
            enriched_count=0,
            total_candidates_searched=0,
            services_used=[],
        )

    # Step 2: Enrich tracks
    enriched = enrich_event_tracks(db, user, requests) if requests else []

    # Step 3: Build profile
    profile = build_event_profile(enriched)

    # Step 4: Generate search queries
    search_queries = _build_search_queries(profile)

    # If no queries can be generated (no genre, no BPM), use generic queries
    if not search_queries:
        search_queries = ["top tracks", "popular tracks"]

    # Step 5: Search for candidates
    candidates, services_used, total_searched = _search_candidates(db, user, search_queries)

    # Step 6a: Deduplicate candidates among themselves
    candidates = _deduplicate_candidates(candidates)

    # Step 6b: Deduplicate against existing requests
    all_requests = db.query(Request).filter(Request.event_id == event.id).all()
    candidates = _deduplicate_against_requests(candidates, all_requests)

    # Step 7: Score and rank
    ranked = rank_candidates(candidates, profile, max_results)

    logger.info(
        "Generated %d recommendations for event %s (enriched=%d, candidates=%d, searched=%d)",
        len(ranked),
        event.code,
        len(enriched),
        len(candidates),
        total_searched,
    )

    return RecommendationResult(
        suggestions=ranked,
        event_profile=profile,
        enriched_count=len(enriched),
        total_candidates_searched=total_searched,
        services_used=services_used,
    )
