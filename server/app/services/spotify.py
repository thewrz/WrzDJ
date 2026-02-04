import json
from datetime import datetime, timedelta

import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.search_cache import SearchCache
from app.schemas.search import SearchResult

settings = get_settings()

# Initialize Spotify client with client credentials flow
_sp: spotipy.Spotify | None = None


def _get_spotify_client() -> spotipy.Spotify:
    """Get or create the Spotify client."""
    global _sp
    if _sp is None:
        if not settings.spotify_client_id or not settings.spotify_client_secret:
            raise ValueError(
                "Spotify credentials not configured. "
                "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in your .env file."
            )
        auth_manager = SpotifyClientCredentials(
            client_id=settings.spotify_client_id,
            client_secret=settings.spotify_client_secret,
        )
        _sp = spotipy.Spotify(auth_manager=auth_manager)
    return _sp


async def search_songs(db: Session, query: str) -> list[SearchResult]:
    """Search for songs using Spotify API with caching."""
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

    # Call Spotify API
    results = _call_spotify_api(query)

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


def _call_spotify_api(query: str) -> list[SearchResult]:
    """Make the actual API call to Spotify."""
    sp = _get_spotify_client()

    try:
        response = sp.search(q=query, type="track", limit=20)
    except Exception:
        return []

    results = []
    for track in response.get("tracks", {}).get("items", []):
        title = track.get("name", "")
        spotify_id = track.get("id")
        popularity = track.get("popularity", 0)
        preview_url = track.get("preview_url")

        # Get artist name
        artists = track.get("artists", [])
        artist = artists[0].get("name", "Unknown Artist") if artists else "Unknown Artist"

        # Get album info
        album = track.get("album", {})
        album_name = album.get("name")

        # Get album art (prefer 300x300, fall back to first available)
        album_art = None
        images = album.get("images", [])
        if images:
            # Images are sorted by size descending, try to get medium size
            for img in images:
                if img.get("width") == 300 or img.get("height") == 300:
                    album_art = img.get("url")
                    break
            if not album_art:
                album_art = images[0].get("url")

        if title and artist:
            results.append(
                SearchResult(
                    artist=artist,
                    title=title,
                    album=album_name,
                    popularity=popularity,
                    spotify_id=spotify_id,
                    album_art=album_art,
                    preview_url=preview_url,
                )
            )

    return results
