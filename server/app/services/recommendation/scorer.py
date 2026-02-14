"""BPM, key, and genre scoring algorithm for track recommendations.

Scores candidate tracks against an event's musical profile built
from its accepted/played requests.
"""

from collections import Counter
from dataclasses import dataclass

from app.services.recommendation.camelot import compatibility_score, parse_key


@dataclass(frozen=True)
class TrackProfile:
    """A track with metadata for scoring."""

    title: str
    artist: str
    bpm: float | None = None
    key: str | None = None
    genre: str | None = None
    source: str = "unknown"
    track_id: str | None = None
    url: str | None = None
    cover_url: str | None = None
    duration_seconds: int | None = None


@dataclass(frozen=True)
class EventProfile:
    """Musical profile of an event built from its requests."""

    avg_bpm: float | None = None
    bpm_range: tuple[float, float] | None = None
    dominant_keys: list[str] = ()  # type: ignore[assignment]
    dominant_genres: list[str] = ()  # type: ignore[assignment]
    track_count: int = 0


@dataclass(frozen=True)
class ScoredTrack:
    """A candidate track with its computed scores."""

    profile: TrackProfile
    score: float
    bpm_score: float
    key_score: float
    genre_score: float


DEFAULT_WEIGHTS: dict[str, float] = {"bpm": 0.40, "key": 0.40, "genre": 0.20}


def build_event_profile(tracks: list[TrackProfile]) -> EventProfile:
    """Build an EventProfile from a list of enriched tracks.

    Computes average BPM, BPM range, dominant keys (top 3),
    and dominant genres (top 3).
    """
    if not tracks:
        return EventProfile(track_count=0)

    bpms = [t.bpm for t in tracks if t.bpm is not None]
    keys = [t.key for t in tracks if t.key]
    genres = [t.genre for t in tracks if t.genre]

    avg_bpm = sum(bpms) / len(bpms) if bpms else None
    bpm_range = (min(bpms), max(bpms)) if bpms else None

    # Top 3 most common keys and genres
    dominant_keys = [k for k, _ in Counter(keys).most_common(3)]
    dominant_genres = [g for g, _ in Counter(genres).most_common(3)]

    return EventProfile(
        avg_bpm=avg_bpm,
        bpm_range=bpm_range,
        dominant_keys=dominant_keys,
        dominant_genres=dominant_genres,
        track_count=len(tracks),
    )


def _score_bpm(candidate_bpm: float | None, avg_bpm: float | None) -> float:
    """Score BPM compatibility.

    1.0 within +/-2 BPM of average, linear falloff to 0.0 at +/-20.
    Half-time (0.5x) and double-time (2.0x) matches are recognized
    as compatible but scored at 70% of normal (standard DJ technique).
    0.5 if either BPM is missing.
    """
    if candidate_bpm is None or avg_bpm is None:
        return 0.5

    diff = abs(candidate_bpm - avg_bpm)
    half_diff = abs(candidate_bpm - avg_bpm * 0.5)
    double_diff = abs(candidate_bpm - avg_bpm * 2.0)

    # Use the best (smallest) effective difference
    use_alt = False
    effective_diff = diff
    if half_diff < diff or double_diff < diff:
        best_alt = min(half_diff, double_diff)
        if best_alt < diff:
            effective_diff = best_alt
            use_alt = True

    if effective_diff <= 2.0:
        base = 1.0
    elif effective_diff >= 20.0:
        base = 0.0
    else:
        base = 1.0 - (effective_diff - 2.0) / 18.0

    # Half/double-time matches scored at 70% of normal
    if use_alt:
        return round(base * 0.7, 4)
    return base


def _score_key(
    candidate_key: str | None,
    dominant_keys: list[str],
) -> float:
    """Score key compatibility against dominant keys.

    Returns the best compatibility score against any dominant key.
    0.5 if candidate key is missing.
    """
    if not candidate_key:
        return 0.5

    candidate_pos = parse_key(candidate_key)
    if candidate_pos is None:
        return 0.5

    if not dominant_keys:
        return 0.5

    best = 0.0
    for dk in dominant_keys:
        dk_pos = parse_key(dk)
        score = compatibility_score(candidate_pos, dk_pos)
        if score > best:
            best = score
    return best


GENRE_FAMILIES: dict[str, str] = {
    # House family
    "house": "house",
    "deep house": "house",
    "tech house": "house",
    "progressive house": "house",
    "electro house": "house",
    "bass house": "house",
    "acid house": "house",
    "funky house": "house",
    "afro house": "house",
    "minimal house": "house",
    # Techno family
    "techno": "techno",
    "minimal techno": "techno",
    "acid techno": "techno",
    "hard techno": "techno",
    "melodic techno": "techno",
    "peak time techno": "techno",
    "industrial techno": "techno",
    # Trance family
    "trance": "trance",
    "progressive trance": "trance",
    "uplifting trance": "trance",
    "psytrance": "trance",
    "vocal trance": "trance",
    # Bass family
    "drum and bass": "bass",
    "dubstep": "bass",
    "jungle": "bass",
    "breakbeat": "bass",
    "garage": "bass",
    "uk garage": "bass",
    # Hip-hop / R&B family
    "hip hop": "hip-hop",
    "hip-hop": "hip-hop",
    "rap": "hip-hop",
    "trap": "hip-hop",
    "r&b": "hip-hop",
    "rnb": "hip-hop",
    # Pop / mainstream
    "pop": "pop",
    "dance pop": "pop",
    "synth pop": "pop",
    "indie pop": "pop",
    # Rock family
    "rock": "rock",
    "alternative rock": "rock",
    "indie rock": "rock",
    "punk": "rock",
    "metal": "rock",
    # Country / folk
    "country": "country",
    "folk": "country",
    "americana": "country",
    "bluegrass": "country",
    # Electronic (broad umbrella)
    "electronic": "electronic",
    "electronica": "electronic",
    "ambient": "electronic",
    "downtempo": "electronic",
    "idm": "electronic",
}

# Cross-family affinity: families that mix well together (tuples must be sorted)
FAMILY_AFFINITY: dict[tuple[str, str], float] = {
    ("house", "techno"): 0.4,
    ("house", "trance"): 0.3,
    ("techno", "trance"): 0.3,
    ("electronic", "house"): 0.3,
    ("electronic", "techno"): 0.3,
    ("electronic", "trance"): 0.3,
    ("bass", "electronic"): 0.3,
    ("hip-hop", "pop"): 0.3,
    ("pop", "rock"): 0.2,
}


def _score_genre(candidate_genre: str | None, dominant_genres: list[str]) -> float:
    """Score genre compatibility using exact, substring, family, and affinity matching.

    1.0 = exact match, 0.5 = substring match, 0.4 = same genre family,
    0.2-0.4 = related families, 0.25 if missing, 0.0 if no relation.
    """
    if not candidate_genre:
        return 0.25

    if not dominant_genres:
        return 0.25

    candidate_lower = candidate_genre.lower()

    # 1.0 = exact match
    for dg in dominant_genres:
        if candidate_lower == dg.lower():
            return 1.0

    # 0.5 = substring match (e.g. "house" in "deep house")
    for dg in dominant_genres:
        dg_lower = dg.lower()
        if candidate_lower in dg_lower or dg_lower in candidate_lower:
            return 0.5

    # 0.4 = same genre family (e.g. "deep house" + "tech house" both → "house")
    candidate_family = GENRE_FAMILIES.get(candidate_lower)
    if candidate_family:
        for dg in dominant_genres:
            dg_family = GENRE_FAMILIES.get(dg.lower())
            if dg_family and candidate_family == dg_family:
                return 0.4

    # 0.2-0.4 = related families (e.g. "house" family + "techno" family)
    if candidate_family:
        best_affinity = 0.0
        for dg in dominant_genres:
            dg_family = GENRE_FAMILIES.get(dg.lower())
            if dg_family:
                pair = tuple(sorted([candidate_family, dg_family]))
                affinity = FAMILY_AFFINITY.get(pair, 0.0)
                if affinity > best_affinity:
                    best_affinity = affinity
        if best_affinity > 0:
            return best_affinity

    return 0.0


def _compute_weights(event_profile: EventProfile) -> dict[str, float]:
    """Compute dynamic weights based on available data.

    If no genre data, redistribute: BPM 0.50, key 0.50, genre 0.0.
    """
    if not event_profile.dominant_genres:
        return {"bpm": 0.50, "key": 0.50, "genre": 0.0}
    return dict(DEFAULT_WEIGHTS)


def score_candidate(
    candidate: TrackProfile,
    event_profile: EventProfile,
    weights: dict[str, float] | None = None,
) -> ScoredTrack:
    """Score a single candidate track against an event profile."""
    if weights is None:
        weights = _compute_weights(event_profile)

    bpm_s = _score_bpm(candidate.bpm, event_profile.avg_bpm)
    key_s = _score_key(candidate.key, event_profile.dominant_keys)
    genre_s = _score_genre(candidate.genre, event_profile.dominant_genres)

    total = weights["bpm"] * bpm_s + weights["key"] * key_s + weights["genre"] * genre_s

    return ScoredTrack(
        profile=candidate,
        score=round(total, 4),
        bpm_score=round(bpm_s, 4),
        key_score=round(key_s, 4),
        genre_score=round(genre_s, 4),
    )


def rank_candidates(
    candidates: list[TrackProfile],
    event_profile: EventProfile,
    max_results: int = 20,
) -> list[ScoredTrack]:
    """Score and rank candidates, returning top N by score descending."""
    if not candidates:
        return []

    weights = _compute_weights(event_profile)
    scored = [score_candidate(c, event_profile, weights) for c in candidates]
    scored.sort(key=lambda s: s.score, reverse=True)
    return scored[:max_results]
