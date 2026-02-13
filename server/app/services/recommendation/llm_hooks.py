"""Stub hooks for future LLM-powered recommendation enhancement.

Future workflow:
1. Algorithmic engine builds EventProfile from accepted/played tracks
2. LLM receives profile + DJ's natural language prompt
3. LLM returns JSON: suggested search queries with target BPM/key/genre
4. Queries run through existing search infrastructure (Tidal/Beatport)
5. Results scored by existing algorithm and merged into suggestions list

This module provides the interface stubs. Phase 3 will implement
the actual LLM integration (Claude Haiku via Anthropic API).
"""

from dataclasses import dataclass

from app.services.recommendation.scorer import EventProfile


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
) -> LLMSuggestionResult:
    """Generate search queries via LLM. NOT YET IMPLEMENTED.

    Will call Claude Haiku to interpret DJ's prompt in context of
    the event's musical profile, returning structured search queries
    that feed into the existing search + scoring pipeline.

    Raises NotImplementedError until Phase 3.
    """
    raise NotImplementedError("LLM recommendations not yet implemented. Coming in Phase 3.")


def is_llm_available() -> bool:
    """Check if LLM recommendations are configured and available."""
    return False  # Will check for ANTHROPIC_API_KEY in Phase 3
