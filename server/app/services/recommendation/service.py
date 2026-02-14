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
from app.services.track_normalizer import artist_match_score, fuzzy_match_score, split_artists
from app.services.version_filter import is_unwanted_version

logger = logging.getLogger(__name__)

# Maximum number of search queries per source
MAX_SEARCH_QUERIES = 3
# Maximum results per search query
SEARCH_LIMIT = 10

# Penalty multiplier for candidates matching a source artist
SOURCE_ARTIST_PENALTY = 0.92
# Base penalty for repeated artists among candidates (compounds per occurrence)
REPEAT_ARTIST_BASE_PENALTY = 0.90
# Fuzzy match threshold for artist matching
ARTIST_MATCH_THRESHOLD = 0.85

# Genres that indicate non-music or DJ utility tracks
BLOCKED_GENRES = {
    "dj tools",
    "dj tool",
    "acapellas",
    "acapella",
    "acapellas/dj tools",
    "karaoke",
    "sound effects",
    "stems",
    "samples",
}


def _is_blocked_genre(genre: str | None) -> bool:
    """Check if a genre matches or contains a blocked genre keyword."""
    if not genre:
        return False
    genre_lower = genre.lower()
    if genre_lower in BLOCKED_GENRES:
        return True
    return any(blocked in genre_lower for blocked in BLOCKED_GENRES)


# Title/artist substrings that indicate non-music or utility tracks
BLOCKED_TITLE_KEYWORDS = [
    "backing track",
    "drumless",
    "drum track",
    "jam track",
    "click track",
    "no click",
    "practice track",
    "minus one",
]


def _is_junk_candidate(title: str, artist: str) -> bool:
    """Check if a candidate is a non-music utility track based on title/artist."""
    title_lower = title.lower()
    artist_lower = artist.lower()
    combined = f"{title_lower} {artist_lower}"
    return any(kw in combined for kw in BLOCKED_TITLE_KEYWORDS)


def _apply_artist_diversity(
    scored: list[ScoredTrack],
    source_artists: set[str],
) -> list[ScoredTrack]:
    """Apply artist diversity penalties and re-rank.

    Two-layer penalty keeps the scorer module pure (musical compatibility only)
    while the orchestrator promotes variety across artists.

    Layer 1 — Source artist penalty: if a candidate's artist matches an artist
    already in the source material (accepted requests or template playlist),
    apply SOURCE_ARTIST_PENALTY to its score.

    Layer 2 — Repetition penalty: among candidates sharing an artist, the 2nd
    occurrence gets REPEAT_ARTIST_BASE_PENALTY, 3rd gets 0.80, etc.
    """
    artist_seen_count: dict[str, int] = {}
    adjusted: list[ScoredTrack] = []

    for st in scored:
        multiplier = 1.0
        candidate_artist = st.profile.artist.lower() if st.profile.artist else ""

        # Layer 1: penalize if artist is already in the source material
        if candidate_artist:
            for src in source_artists:
                if artist_match_score(candidate_artist, src) >= ARTIST_MATCH_THRESHOLD:
                    multiplier *= SOURCE_ARTIST_PENALTY
                    break

        # Layer 2: penalize repeated artists among candidates
        if candidate_artist:
            count = artist_seen_count.get(candidate_artist, 0)
            # Find the canonical key (handles slight case variations already
            # normalised by .lower(), but also check fuzzy against seen keys)
            matched_key = candidate_artist
            for seen_key in artist_seen_count:
                if artist_match_score(candidate_artist, seen_key) >= ARTIST_MATCH_THRESHOLD:
                    matched_key = seen_key
                    count = artist_seen_count[seen_key]
                    break

            if count > 0:
                # 1st dup → 0.90, 2nd dup → 0.80, 3rd → 0.70, floor at 0.50
                penalty = max(REPEAT_ARTIST_BASE_PENALTY - 0.10 * (count - 1), 0.50)
                multiplier *= penalty

            artist_seen_count[matched_key] = count + 1

        new_score = st.score * multiplier
        adjusted.append(
            ScoredTrack(
                profile=st.profile,
                score=new_score,
                bpm_score=st.bpm_score,
                key_score=st.key_score,
                genre_score=st.genre_score,
            )
        )

    adjusted.sort(key=lambda s: s.score, reverse=True)
    return adjusted


@dataclass
class RecommendationResult:
    """Result of generating recommendations for an event."""

    suggestions: list[ScoredTrack]
    event_profile: EventProfile
    enriched_count: int
    total_candidates_searched: int
    services_used: list[str]
    mb_verified: dict[str, bool] = None  # type: ignore[assignment]

    def __post_init__(self):
        if self.mb_verified is None:
            self.mb_verified = {}


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


def _build_beatport_queries(
    profile: EventProfile,
    template_tracks: list[TrackProfile] | None = None,
) -> list[str]:
    """Generate search queries for Beatport from an event profile.

    Genre-based text queries work well for Beatport (genre catalog).
    Falls back to artist names from template tracks when genres are
    unavailable (e.g., Tidal playlists).
    """
    queries = []

    # Genre-based queries (best signal)
    for genre in profile.dominant_genres[:MAX_SEARCH_QUERIES]:
        queries.append(genre)

    # If we have no genres but have template tracks, use top artists
    if not queries and template_tracks:
        artist_counts: dict[str, int] = {}
        for t in template_tracks:
            if t.artist and t.artist.lower() not in ("unknown", "various artists"):
                artist_counts[t.artist] = artist_counts.get(t.artist, 0) + 1
        # Sort by frequency, take top artists as search queries
        top_artists = sorted(artist_counts, key=artist_counts.get, reverse=True)  # type: ignore[arg-type]
        for artist in top_artists[:MAX_SEARCH_QUERIES]:
            queries.append(artist)

    # If we have BPM info and still have room, add a BPM-targeted query
    if profile.avg_bpm and len(queries) < MAX_SEARCH_QUERIES:
        bpm_str = str(int(profile.avg_bpm))
        if profile.dominant_genres:
            queries.append(f"{profile.dominant_genres[0]} {bpm_str} bpm")

    return queries[:MAX_SEARCH_QUERIES]


def _build_tidal_queries(
    profile: EventProfile,
    requests: list | None = None,
    template_tracks: list[TrackProfile] | None = None,
) -> list[str]:
    """Generate artist-based search queries for Tidal text search.

    Tidal's search API is a general text search — genre strings like
    "Country" produce irrelevant results.  Use artist names instead.
    """
    artist_counts: dict[str, int] = {}

    # Collect artists from accepted requests (split multi-artist strings)
    if requests:
        for req in requests:
            artist = getattr(req, "artist", None)
            if artist:
                for individual in split_artists(artist):
                    key = individual.strip().lower()
                    if key not in ("unknown", "various artists", ""):
                        artist_counts[individual.strip()] = (
                            artist_counts.get(individual.strip(), 0) + 1
                        )

    # Collect artists from template tracks (split multi-artist strings)
    if template_tracks:
        for t in template_tracks:
            if t.artist:
                for individual in split_artists(t.artist):
                    key = individual.strip().lower()
                    if key not in ("unknown", "various artists", ""):
                        artist_counts[individual.strip()] = (
                            artist_counts.get(individual.strip(), 0) + 1
                        )

    top_artists = sorted(artist_counts, key=artist_counts.get, reverse=True)  # type: ignore[arg-type]
    return top_artists[:MAX_SEARCH_QUERIES]


def _search_candidates(
    db: Session,
    user: User,
    queries: list[str],
    profile: EventProfile | None = None,
    tidal_queries: list[str] | None = None,
) -> tuple[list[TrackProfile], list[str], int]:
    """Search connected services for candidate tracks.

    For Beatport: uses genre-based text queries (works well with their catalog).
    For Tidal: prefers Soundcharts discovery (genre+BPM+key filtered) when
    configured, falls back to text search otherwise.

    Returns (candidates, services_used, total_searched).
    """
    candidates: list[TrackProfile] = []
    services_used: set[str] = set()
    total_searched = 0

    # Search Beatport if connected
    if user.beatport_access_token:
        from app.services.beatport import search_beatport_tracks

        beatport_failures = 0
        for query in queries:
            results = search_beatport_tracks(db, user, query, limit=SEARCH_LIMIT)
            if not results:
                beatport_failures += 1
                if beatport_failures >= 2:
                    logger.warning("Beatport failing repeatedly, skipping remaining queries")
                    break
                continue
            for r in results:
                if is_unwanted_version(r.title):
                    continue
                if _is_blocked_genre(r.genre):
                    continue
                if _is_junk_candidate(r.title, r.artist):
                    continue
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
            services_used.add("beatport")

    # Search Tidal if connected
    if user.tidal_access_token:
        used_soundcharts = False

        # Try Soundcharts discovery first (genre+BPM+key filtered, 1 API call)
        if profile and profile.dominant_genres:
            from app.core.config import get_settings
            from app.services.recommendation.soundcharts_candidates import (
                search_candidates_via_soundcharts,
            )

            settings = get_settings()
            if settings.soundcharts_app_id and settings.soundcharts_api_key:
                sc_candidates, sc_searched = search_candidates_via_soundcharts(db, user, profile)
                sc_filtered = [
                    c
                    for c in sc_candidates
                    if not is_unwanted_version(c.title)
                    and not _is_blocked_genre(c.genre)
                    and not _is_junk_candidate(c.title, c.artist)
                ]
                candidates.extend(sc_filtered)
                total_searched += sc_searched
                if sc_filtered:
                    services_used.add("tidal")
                    used_soundcharts = True

        # Fallback: Tidal text search (when Soundcharts not configured/no genres/failed)
        if not used_soundcharts:
            from app.services.tidal import search_tidal_tracks

            # Infer genre from profile for Tidal results (Tidal API has no genre)
            inferred_genre = (
                profile.dominant_genres[0] if profile and profile.dominant_genres else None
            )

            # Use artist-based queries for Tidal (genre strings produce garbage)
            tidal_search_queries = tidal_queries or queries
            for query in tidal_search_queries:
                results = search_tidal_tracks(db, user, query, limit=SEARCH_LIMIT)
                for r in results:
                    if is_unwanted_version(r.title):
                        continue
                    if _is_junk_candidate(r.title, r.artist):
                        continue
                    candidates.append(
                        TrackProfile(
                            title=r.title,
                            artist=r.artist,
                            bpm=r.bpm,
                            key=r.key,
                            genre=inferred_genre,
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
    """Remove candidates that are already requested or are likely covers.

    Catches both exact duplicates (same title + artist) and cover/tribute
    versions where the title matches but the artist is different (e.g.,
    "Big" performing "Save A Horse" when "Big & Rich" already has it).
    """
    if not existing_requests:
        return candidates

    deduped = []
    for candidate in candidates:
        is_dupe = False
        is_cover = False
        for req in existing_requests:
            title_score = fuzzy_match_score(candidate.title, req.song_title)
            artist_score = artist_match_score(candidate.artist, req.artist)
            combined = title_score * 0.6 + artist_score * 0.4
            if combined >= 0.8:
                is_dupe = True
                break
            # Cover detection: same title but different artist
            if title_score >= 0.85 and artist_score < 0.6:
                is_cover = True
                break
        if not is_dupe and not is_cover:
            deduped.append(candidate)
    return deduped


def _deduplicate_against_template(
    candidates: list[TrackProfile],
    template_tracks: list[TrackProfile],
) -> list[TrackProfile]:
    """Remove candidates that already appear in the template playlist."""
    if not template_tracks:
        return candidates

    deduped = []
    for candidate in candidates:
        is_dupe = False
        for tmpl in template_tracks:
            title_score = fuzzy_match_score(candidate.title, tmpl.title)
            artist_score = artist_match_score(candidate.artist, tmpl.artist)
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
            artist_score = artist_match_score(candidate.artist, existing.artist)
            combined = title_score * 0.6 + artist_score * 0.4
            if combined >= 0.8:
                is_dupe = True
                break
        if not is_dupe:
            seen.append(candidate)
    return seen


@dataclass
class LLMRecommendationResult:
    """Result of LLM-powered recommendations."""

    suggestions: list[ScoredTrack]
    event_profile: EventProfile
    enriched_count: int
    total_candidates_searched: int
    services_used: list[str]
    llm_queries: list  # list of LLMSuggestionQuery
    mb_verified: dict[str, bool] = None  # type: ignore[assignment]

    def __post_init__(self):
        if self.mb_verified is None:
            self.mb_verified = {}


async def generate_recommendations_from_llm(
    db: Session,
    user: User,
    event: Event,
    prompt: str,
    max_results: int = 20,
) -> LLMRecommendationResult:
    """Generate recommendations using LLM-generated search queries.

    Pipeline:
    1. Build EventProfile from accepted/played requests
    2. Call LLM with profile + DJ prompt → structured search queries
    3. Search Tidal/Beatport with LLM query strings
    4. Deduplicate, score, rank, apply artist diversity
    """
    from app.services.recommendation.llm_hooks import generate_llm_suggestions

    # Step 1: Build event profile (same as algorithmic path)
    requests = _get_accepted_played_requests(db, event)
    enriched = enrich_event_tracks(db, user, requests) if requests else []
    profile = build_event_profile(enriched)

    # Step 2: Call LLM (pass enriched tracks so it can see actual song names)
    llm_result = await generate_llm_suggestions(profile, prompt, tracks=enriched or None)

    if not llm_result.queries:
        return LLMRecommendationResult(
            suggestions=[],
            event_profile=profile,
            enriched_count=len(enriched),
            total_candidates_searched=0,
            services_used=[],
            llm_queries=[],
        )

    # Step 3: Use LLM query strings as search queries
    llm_query_strings = [q.search_query for q in llm_result.queries]

    candidates, services_used, total_searched = _search_candidates(
        db, user, llm_query_strings, profile=profile, tidal_queries=llm_query_strings
    )

    # Step 4: Deduplicate
    candidates = _deduplicate_candidates(candidates)
    all_requests = db.query(Request).filter(Request.event_id == event.id).all()
    candidates = _deduplicate_against_requests(candidates, all_requests)
    # Also deduplicate against enriched tracks (catches songs referenced in
    # the prompt that are already in the set, even if stored slightly differently)
    if enriched:
        candidates = _deduplicate_against_template(candidates, enriched)

    # Step 5: Score and rank
    ranked = rank_candidates(candidates, profile, max_results)

    # Step 6: Artist diversity
    source_artists = {req.artist.lower() for req in requests if req.artist}
    ranked = _apply_artist_diversity(ranked, source_artists)

    # Step 7: MusicBrainz artist verification
    from app.services.recommendation.mb_verify import verify_artists_batch

    artist_names = [s.profile.artist for s in ranked if s.profile.artist]
    mb_verified = verify_artists_batch(db, artist_names) if artist_names else {}

    logger.info(
        "Generated %d LLM recommendations for event %s (prompt=%s, queries=%d, candidates=%d)",
        len(ranked),
        event.code,
        prompt[:50],
        len(llm_result.queries),
        len(candidates),
    )

    return LLMRecommendationResult(
        suggestions=ranked,
        event_profile=profile,
        enriched_count=len(enriched),
        total_candidates_searched=total_searched,
        services_used=services_used,
        llm_queries=llm_result.queries,
        mb_verified=mb_verified,
    )


def generate_recommendations_from_template(
    db: Session,
    user: User,
    event: Event,
    template_source: str,
    template_id: str,
    max_results: int = 20,
) -> RecommendationResult:
    """Generate recommendations using a template playlist as the profile source.

    The template playlist's tracks build the EventProfile instead of the
    event's accepted requests. The rest of the pipeline is reused.
    """
    from app.services.recommendation.template import (
        tracks_from_beatport_playlist,
        tracks_from_tidal_playlist,
    )

    if template_source == "tidal":
        template_tracks = tracks_from_tidal_playlist(db, user, template_id)
    elif template_source == "beatport":
        template_tracks = tracks_from_beatport_playlist(db, user, template_id)
    else:
        raise ValueError(f"Invalid template source: {template_source}")

    if not template_tracks:
        return RecommendationResult(
            suggestions=[],
            event_profile=EventProfile(track_count=0),
            enriched_count=0,
            total_candidates_searched=0,
            services_used=[],
        )

    # Build profile from template tracks (no enrichment needed — data is direct)
    profile = build_event_profile(template_tracks)

    # Generate search queries from profile (pass template tracks for artist fallback)
    search_queries = _build_beatport_queries(profile, template_tracks=template_tracks)
    if not search_queries:
        search_queries = ["top tracks", "popular tracks"]

    # Build artist-based queries for Tidal text search (genre strings don't work)
    tidal_queries = _build_tidal_queries(profile, template_tracks=template_tracks)

    # Search for candidates
    candidates, services_used, total_searched = _search_candidates(
        db, user, search_queries, profile=profile, tidal_queries=tidal_queries or None
    )

    # Deduplicate candidates among themselves
    candidates = _deduplicate_candidates(candidates)

    # Deduplicate against event's existing requests (not the template)
    all_requests = db.query(Request).filter(Request.event_id == event.id).all()
    candidates = _deduplicate_against_requests(candidates, all_requests)

    # Also deduplicate against the template tracks themselves
    candidates = _deduplicate_against_template(candidates, template_tracks)

    # Score and rank
    ranked = rank_candidates(candidates, profile, max_results)

    # Apply artist diversity penalties
    source_artists = {t.artist.lower() for t in template_tracks if t.artist}
    ranked = _apply_artist_diversity(ranked, source_artists)

    # MusicBrainz artist verification
    from app.services.recommendation.mb_verify import verify_artists_batch

    artist_names = [s.profile.artist for s in ranked if s.profile.artist]
    mb_verified = verify_artists_batch(db, artist_names) if artist_names else {}

    logger.info(
        "Generated %d template recommendations for event %s "
        "(template=%s:%s, queries=%s, candidates=%d, searched=%d)",
        len(ranked),
        event.code,
        template_source,
        template_id,
        search_queries,
        len(candidates),
        total_searched,
    )

    return RecommendationResult(
        suggestions=ranked,
        event_profile=profile,
        enriched_count=len(template_tracks),
        total_candidates_searched=total_searched,
        services_used=services_used,
        mb_verified=mb_verified,
    )


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

    # Step 4: Generate search queries (for Beatport)
    search_queries = _build_beatport_queries(profile)

    # If no queries can be generated (no genre, no BPM), use generic queries
    if not search_queries:
        search_queries = ["top tracks", "popular tracks"]

    # Build artist-based queries for Tidal text search (genre strings don't work)
    tidal_queries = _build_tidal_queries(profile, requests=requests)

    # Step 5: Search for candidates
    candidates, services_used, total_searched = _search_candidates(
        db, user, search_queries, profile=profile, tidal_queries=tidal_queries or None
    )

    # Step 6a: Deduplicate candidates among themselves
    candidates = _deduplicate_candidates(candidates)

    # Step 6b: Deduplicate against existing requests
    all_requests = db.query(Request).filter(Request.event_id == event.id).all()
    candidates = _deduplicate_against_requests(candidates, all_requests)

    # Step 7: Score and rank
    ranked = rank_candidates(candidates, profile, max_results)

    # Step 8: Apply artist diversity penalties
    source_artists = {req.artist.lower() for req in requests if req.artist}
    ranked = _apply_artist_diversity(ranked, source_artists)

    # Step 9: MusicBrainz artist verification
    from app.services.recommendation.mb_verify import verify_artists_batch

    artist_names = [s.profile.artist for s in ranked if s.profile.artist]
    mb_verified = verify_artists_batch(db, artist_names) if artist_names else {}

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
        mb_verified=mb_verified,
    )
