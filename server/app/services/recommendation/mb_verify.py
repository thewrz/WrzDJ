"""MusicBrainz artist verification for recommendation results.

Checks each artist against MusicBrainz to confirm they are a real,
community-curated artist (not AI-generated filler).  Results are
cached in the mb_artist_cache table so subsequent runs are instant.
"""

import logging
from collections.abc import Iterable

from sqlalchemy.orm import Session

from app.models.mb_artist_cache import MbArtistCache
from app.services.musicbrainz import check_artist_exists
from app.services.track_normalizer import split_artists

logger = logging.getLogger(__name__)


def _normalize(name: str) -> str:
    return name.lower().strip()


def verify_artists_batch(db: Session, artist_names: Iterable[str]) -> dict[str, bool]:
    """Verify a batch of artist names against MusicBrainz.

    Returns a mapping of original artist name -> verified boolean.
    Deduplicates names, checks the DB cache first, then calls the
    MusicBrainz API for any uncached artists (1 req/sec throttled).
    """
    # Build mapping: normalized -> set of original names
    # Split multi-artist strings so each individual gets verified separately
    normalized_map: dict[str, list[str]] = {}
    composite_originals: dict[str, list[str]] = {}  # original composite -> individual names
    for name in artist_names:
        if not name or not name.strip():
            continue
        individuals = split_artists(name)
        if len(individuals) > 1:
            composite_originals[name] = individuals
        for individual in individuals:
            key = _normalize(individual)
            if not key:
                continue
            if key not in normalized_map:
                normalized_map[key] = []
            normalized_map[key].append(individual)

    if not normalized_map:
        return {}

    # Query cache for all normalized names
    cached = (
        db.query(MbArtistCache)
        .filter(MbArtistCache.artist_name.in_(list(normalized_map.keys())))
        .all()
    )
    cached_map = {c.artist_name: c.verified for c in cached}

    cached_count = 0
    api_count = 0
    result: dict[str, bool] = {}

    for norm_name, original_names in normalized_map.items():
        if norm_name in cached_map:
            verified = cached_map[norm_name]
            cached_count += 1
        else:
            # Call MusicBrainz API (throttled to 1 req/sec)
            verified, mbid = check_artist_exists(norm_name)
            api_count += 1
            # Cache the result (both positive and negative)
            entry = MbArtistCache(
                artist_name=norm_name,
                mbid=mbid,
                verified=verified,
            )
            db.add(entry)

        for orig in original_names:
            result[orig] = verified

    # For composite artist names, mark as verified if ANY constituent is verified
    for composite, individuals in composite_originals.items():
        any_verified = any(result.get(ind, False) for ind in individuals)
        result[composite] = any_verified

    if api_count > 0:
        db.commit()

    logger.info(
        "MB verification: %d cached, %d API calls, %d unique artists",
        cached_count,
        api_count,
        len(normalized_map),
    )

    return result
