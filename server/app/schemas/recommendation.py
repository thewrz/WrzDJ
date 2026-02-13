"""Pydantic schemas for the song recommendation system."""

from pydantic import BaseModel


class RecommendedTrack(BaseModel):
    title: str
    artist: str
    bpm: float | None = None
    key: str | None = None
    genre: str | None = None
    score: float
    bpm_score: float
    key_score: float
    genre_score: float
    source: str
    track_id: str | None = None
    url: str | None = None
    cover_url: str | None = None
    duration_seconds: int | None = None


class EventMusicProfile(BaseModel):
    avg_bpm: float | None = None
    bpm_range_low: float | None = None
    bpm_range_high: float | None = None
    dominant_keys: list[str] = []
    dominant_genres: list[str] = []
    track_count: int = 0
    enriched_count: int = 0


class RecommendationResponse(BaseModel):
    suggestions: list[RecommendedTrack] = []
    profile: EventMusicProfile
    services_used: list[str] = []
    total_candidates_searched: int = 0
    llm_available: bool = False
