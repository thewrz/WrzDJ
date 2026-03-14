from pydantic import BaseModel


class SearchResult(BaseModel):
    artist: str
    title: str
    album: str | None = None
    popularity: int = 0  # 0-100 ranking signal (Tidal or Spotify)
    spotify_id: str | None = None
    album_art: str | None = None
    preview_url: str | None = None
    url: str | None = None  # Link to Spotify, Beatport, or Tidal
    source: str = "spotify"  # "spotify", "beatport", or "tidal"
    # Track metadata (populated from Beatport/Tidal search results)
    genre: str | None = None
    bpm: int | None = None
    key: str | None = None
    isrc: str | None = None
