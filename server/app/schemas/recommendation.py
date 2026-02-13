"""Pydantic schemas for the song recommendation system."""

from pydantic import BaseModel, Field


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


class LLMPromptRequest(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=500)


class LLMQueryInfo(BaseModel):
    search_query: str
    target_bpm: float | None = None
    target_key: str | None = None
    target_genre: str | None = None
    reasoning: str = ""


class LLMRecommendationResponse(BaseModel):
    suggestions: list[RecommendedTrack] = []
    profile: EventMusicProfile
    services_used: list[str] = []
    total_candidates_searched: int = 0
    llm_queries: list[LLMQueryInfo] = []
    llm_available: bool = True


class PlaylistInfo(BaseModel):
    id: str
    name: str
    num_tracks: int
    description: str | None = None
    cover_url: str | None = None
    source: str


class PlaylistListResponse(BaseModel):
    playlists: list[PlaylistInfo] = []


class TemplatePlaylistRequest(BaseModel):
    source: str = Field(..., pattern=r"^(tidal|beatport)$")
    playlist_id: str = Field(..., min_length=1, max_length=200)
