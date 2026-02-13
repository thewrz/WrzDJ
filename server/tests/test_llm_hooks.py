"""Tests for LLM hooks stub module."""

import pytest

from app.services.recommendation.llm_hooks import (
    LLMSuggestionQuery,
    LLMSuggestionResult,
    generate_llm_suggestions,
    is_llm_available,
)
from app.services.recommendation.scorer import EventProfile


class TestIsLLMAvailable:
    def test_returns_false(self):
        assert is_llm_available() is False


class TestGenerateLLMSuggestions:
    @pytest.mark.asyncio
    async def test_raises_not_implemented(self):
        profile = EventProfile(track_count=0)
        with pytest.raises(NotImplementedError, match="Phase 3"):
            await generate_llm_suggestions(profile, "chill vibes")


class TestDataClasses:
    def test_suggestion_query_is_frozen(self):
        q = LLMSuggestionQuery(
            search_query="deadmau5 progressive house",
            target_bpm=128.0,
            target_key="8A",
            target_genre="Progressive House",
            reasoning="Matches event profile",
        )
        assert q.search_query == "deadmau5 progressive house"
        with pytest.raises(AttributeError):
            q.search_query = "something else"  # type: ignore[misc]

    def test_suggestion_result_is_frozen(self):
        result = LLMSuggestionResult(
            queries=[LLMSuggestionQuery(search_query="test", reasoning="test reason")],
            raw_response='{"queries": []}',
        )
        assert len(result.queries) == 1
        assert result.raw_response == '{"queries": []}'
        with pytest.raises(AttributeError):
            result.raw_response = "other"  # type: ignore[misc]

    def test_query_defaults(self):
        q = LLMSuggestionQuery(search_query="test")
        assert q.target_bpm is None
        assert q.target_key is None
        assert q.target_genre is None
        assert q.reasoning == ""
