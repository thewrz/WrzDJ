from pydantic import BaseModel


class SearchResult(BaseModel):
    artist: str
    title: str
    album: str | None = None
    popularity: int = 0  # 0-100 from Spotify
    spotify_id: str | None = None
    album_art: str | None = None
    preview_url: str | None = None
