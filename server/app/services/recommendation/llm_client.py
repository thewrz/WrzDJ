"""LLM client for generating recommendation search queries via Claude Haiku.

Sends the event's musical profile and the DJ's prompt to Claude,
which returns structured search queries (with target BPM/key/genre)
that feed into the existing Tidal/Beatport search pipeline.
"""

import json
import logging

from anthropic import AsyncAnthropic

from app.core.config import get_settings
from app.services.recommendation.llm_hooks import LLMSuggestionQuery, LLMSuggestionResult
from app.services.recommendation.scorer import EventProfile, TrackProfile

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are a DJ assistant helping curate song suggestions for a live event.

You understand music theory concepts relevant to DJing:
- BPM (beats per minute) and how tracks at similar tempos mix well
- Musical keys and the Camelot wheel for harmonic mixing
- Genre taxonomy (House, Tech House, Techno, Hip Hop, Pop, etc.)
- Artist-genre associations

You will receive:
- The DJ's natural language prompt
- A statistical profile of the event (average BPM, dominant keys/genres)
- The actual track list the DJ has accepted/played (with metadata)

Use ALL of this context to understand the DJ's current direction
and taste. When the DJ says things like "more of the same",
"based on these tracks", or "something similar", refer to the
track list to understand what they mean.

Generate 1-5 search queries that would find matching tracks on
Tidal or Beatport. Each query should be a realistic search string
(artist name, track name, or genre keywords).

For each query, optionally include target BPM, key, and genre
when you can infer them from context. Include brief reasoning
explaining why you chose each query."""

SEARCH_QUERIES_TOOL = {
    "name": "search_queries",
    "description": (
        "Return structured search queries for finding tracks that match the DJ's intent."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "queries": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "search_query": {
                            "type": "string",
                            "description": (
                                "Search string for Tidal/Beatport"
                                " (artist, track, or genre keywords)"
                            ),
                        },
                        "target_bpm": {
                            "type": "number",
                            "description": "Target BPM if inferable from context",
                        },
                        "target_key": {
                            "type": "string",
                            "description": "Target musical key in Camelot notation (e.g. 8A, 11B)",
                        },
                        "target_genre": {
                            "type": "string",
                            "description": "Target genre if inferable from context",
                        },
                        "reasoning": {
                            "type": "string",
                            "description": "Brief explanation of why this query was chosen",
                        },
                    },
                    "required": ["search_query", "reasoning"],
                },
                "minItems": 1,
                "maxItems": 5,
            },
        },
        "required": ["queries"],
    },
}


def build_user_prompt(
    profile: EventProfile,
    dj_prompt: str,
    tracks: list[TrackProfile] | None = None,
) -> str:
    """Build the user message from an event profile, track list, and DJ prompt."""
    parts = [f"DJ's request: {dj_prompt}", "", "Current event profile:"]

    if profile.track_count == 0:
        parts.append("  No tracks accepted yet (empty profile)")
    else:
        parts.append(f"  Tracks analyzed: {profile.track_count}")
        if profile.avg_bpm:
            parts.append(f"  Average BPM: {profile.avg_bpm:.0f}")
        if profile.bpm_range:
            parts.append(f"  BPM range: {profile.bpm_range[0]:.0f}-{profile.bpm_range[1]:.0f}")
        if profile.dominant_keys:
            parts.append(f"  Dominant keys: {', '.join(profile.dominant_keys)}")
        if profile.dominant_genres:
            parts.append(f"  Dominant genres: {', '.join(profile.dominant_genres)}")

    if tracks:
        parts.append("")
        parts.append("Tracks in the set:")
        for t in tracks[:30]:  # Cap at 30 to keep prompt manageable
            line = f"  - {t.artist} — {t.title}"
            meta = []
            if t.bpm:
                meta.append(f"{t.bpm:.0f} BPM")
            if t.key:
                meta.append(t.key)
            if t.genre:
                meta.append(t.genre)
            if meta:
                line += f" ({', '.join(meta)})"
            parts.append(line)

    return "\n".join(parts)


def _parse_tool_response(response) -> LLMSuggestionResult:
    """Parse the Claude API response into an LLMSuggestionResult."""
    raw_text = ""
    queries: list[LLMSuggestionQuery] = []

    for block in response.content:
        if block.type == "text":
            raw_text += block.text
        elif block.type == "tool_use" and block.name == "search_queries":
            raw_text += json.dumps(block.input)
            for q in block.input.get("queries", []):
                queries.append(
                    LLMSuggestionQuery(
                        search_query=q["search_query"],
                        target_bpm=q.get("target_bpm"),
                        target_key=q.get("target_key"),
                        target_genre=q.get("target_genre"),
                        reasoning=q.get("reasoning", ""),
                    )
                )

    return LLMSuggestionResult(queries=queries, raw_response=raw_text)


async def call_llm(
    profile: EventProfile,
    dj_prompt: str,
    max_queries: int = 5,
    tracks: list[TrackProfile] | None = None,
) -> LLMSuggestionResult:
    """Call Claude Haiku to generate search queries from a DJ prompt.

    Returns an LLMSuggestionResult with 1-max_queries structured queries.
    Raises on API failure (caller should handle).
    """
    settings = get_settings()

    client = AsyncAnthropic(
        api_key=settings.anthropic_api_key,
        timeout=settings.anthropic_timeout_seconds,
    )

    user_message = build_user_prompt(profile, dj_prompt, tracks=tracks)

    response = await client.messages.create(
        model=settings.anthropic_model,
        max_tokens=settings.anthropic_max_tokens,
        system=SYSTEM_PROMPT,
        tools=[SEARCH_QUERIES_TOOL],
        tool_choice={"type": "tool", "name": "search_queries"},
        messages=[{"role": "user", "content": user_message}],
    )

    result = _parse_tool_response(response)

    # Trim to max_queries
    if len(result.queries) > max_queries:
        result = LLMSuggestionResult(
            queries=result.queries[:max_queries],
            raw_response=result.raw_response,
        )

    logger.info(
        "LLM generated %d search queries for prompt: %s",
        len(result.queries),
        dj_prompt[:80],
    )

    return result
