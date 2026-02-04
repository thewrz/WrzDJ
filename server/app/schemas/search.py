from pydantic import BaseModel


class SearchResult(BaseModel):
    artist: str
    title: str
    mbid: str | None = None
    score: float = 0.0
