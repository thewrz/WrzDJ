from pydantic import BaseModel


class SearchResult(BaseModel):
    artist: str
    title: str
    album: str | None = None
    popularity: int = 0  # 0-100 from Spotify
    spotify_id: str | None = None
    album_art: str | None = None
    preview_url: str | None = None
    url: str | None = None  # Link to Spotify or Beatport
    source: str = "spotify"  # "spotify" or "beatport"
    # Track metadata (populated from Beatport search results)
    genre: str | None = None
    bpm: int | None = None
    key: str | None = None
