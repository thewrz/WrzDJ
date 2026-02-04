import json
from datetime import datetime, timedelta

import httpx
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.search_cache import SearchCache
from app.schemas.search import SearchResult

settings = get_settings()

MUSICBRAINZ_API_URL = "https://musicbrainz.org/ws/2/recording"


async def search_songs(db: Session, query: str) -> list[SearchResult]:
    """Search for songs using MusicBrainz API with caching."""
    query = query.strip().lower()
    if not query:
        return []

    # Check cache first
    cached = (
        db.query(SearchCache)
        .filter(SearchCache.query == query, SearchCache.expires_at > datetime.utcnow())
        .first()
    )
    if cached:
        results_data = json.loads(cached.results_json)
        return [SearchResult(**r) for r in results_data]

    # Call MusicBrainz API
    results = await _call_musicbrainz_api(query)

    # Cache the results
    expires_at = datetime.utcnow() + timedelta(hours=settings.search_cache_hours)
    results_json = json.dumps([r.model_dump() for r in results])

    # Upsert cache entry
    existing = db.query(SearchCache).filter(SearchCache.query == query).first()
    if existing:
        existing.results_json = results_json
        existing.expires_at = expires_at
        existing.created_at = datetime.utcnow()
    else:
        cache_entry = SearchCache(
            query=query, results_json=results_json, expires_at=expires_at
        )
        db.add(cache_entry)
    db.commit()

    return results


async def _call_musicbrainz_api(query: str) -> list[SearchResult]:
    """Make the actual API call to MusicBrainz."""
    headers = {"User-Agent": settings.musicbrainz_user_agent, "Accept": "application/json"}

    params = {"query": query, "fmt": "json", "limit": 20}

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                MUSICBRAINZ_API_URL, params=params, headers=headers, timeout=10.0
            )
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, json.JSONDecodeError):
            return []

    results = []
    for recording in data.get("recordings", []):
        title = recording.get("title", "")
        score = recording.get("score", 0) / 100.0
        mbid = recording.get("id")

        # Get artist name from artist-credit
        artist_credit = recording.get("artist-credit", [])
        if artist_credit:
            artist = artist_credit[0].get("name", "") or artist_credit[0].get(
                "artist", {}
            ).get("name", "")
        else:
            artist = "Unknown Artist"

        if title and artist:
            results.append(
                SearchResult(artist=artist, title=title, mbid=mbid, score=score)
            )

    return results
