"""LLM-powered recommendation hooks.

Workflow:
1. Algorithmic engine builds EventProfile from accepted/played tracks
2. LLM receives profile + DJ's natural language prompt
3. LLM returns JSON: suggested search queries with target BPM/key/genre
4. Queries run through existing search infrastructure (Tidal/Beatport)
5. Results scored by existing algorithm and merged into suggestions list
"""

from dataclasses import dataclass

from app.services.recommendation.scorer import EventProfile, TrackProfile


@dataclass(frozen=True)
class LLMSuggestionQuery:
    """A search query suggested by an LLM."""

    search_query: str  # e.g., "deadmau5 progressive house"
    target_bpm: float | None = None
    target_key: str | None = None
    target_genre: str | None = None
    reasoning: str = ""  # LLM's explanation


@dataclass(frozen=True)
class LLMSuggestionResult:
    """Result from LLM suggestion generation."""

    queries: list[LLMSuggestionQuery]
    raw_response: str  # Full LLM response for debugging


async def generate_llm_suggestions(
    event_profile: EventProfile,
    prompt: str,
    max_queries: int = 5,
    tracks: list[TrackProfile] | None = None,
) -> LLMSuggestionResult:
    """Generate search queries via LLM (Claude Haiku).

    Calls Claude to interpret the DJ's prompt in context of the event's
    musical profile and track list, returning structured search queries
    that feed into the existing search + scoring pipeline.
    """
    from app.services.recommendation.llm_client import call_llm

    return await call_llm(event_profile, prompt, max_queries, tracks=tracks)


def is_llm_available() -> bool:
    """Check if LLM recommendations are configured and available."""
    from app.core.config import get_settings

    return bool(get_settings().anthropic_api_key)
