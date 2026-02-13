"""Tests for LLM hooks module."""

from unittest.mock import patch

import pytest

from app.services.recommendation.llm_hooks import (
    LLMSuggestionQuery,
    LLMSuggestionResult,
    generate_llm_suggestions,
    is_llm_available,
)
from app.services.recommendation.scorer import EventProfile


class TestIsLLMAvailable:
    @patch("app.core.config.get_settings")
    def test_returns_true_when_key_set(self, mock_settings):
        mock_settings.return_value.anthropic_api_key = "sk-ant-test"
        assert is_llm_available() is True

    @patch("app.core.config.get_settings")
    def test_returns_false_when_key_empty(self, mock_settings):
        mock_settings.return_value.anthropic_api_key = ""
        assert is_llm_available() is False


class TestGenerateLLMSuggestions:
    @pytest.mark.asyncio
    @patch("app.services.recommendation.llm_client.call_llm")
    async def test_delegates_to_llm_client(self, mock_call_llm):
        expected = LLMSuggestionResult(
            queries=[LLMSuggestionQuery(search_query="chill house", reasoning="test")],
            raw_response="{}",
        )
        mock_call_llm.return_value = expected

        profile = EventProfile(track_count=5)
        result = await generate_llm_suggestions(profile, "chill vibes", max_queries=3)

        assert result is expected
        mock_call_llm.assert_called_once_with(profile, "chill vibes", 3, tracks=None)

    @pytest.mark.asyncio
    @patch("app.services.recommendation.llm_client.call_llm")
    async def test_passes_tracks_to_llm_client(self, mock_call_llm):
        from app.services.recommendation.scorer import TrackProfile

        expected = LLMSuggestionResult(
            queries=[LLMSuggestionQuery(search_query="house", reasoning="test")],
            raw_response="{}",
        )
        mock_call_llm.return_value = expected

        profile = EventProfile(track_count=1)
        tracks = [TrackProfile(title="Strobe", artist="deadmau5")]
        result = await generate_llm_suggestions(profile, "more like this", tracks=tracks)

        assert result is expected
        mock_call_llm.assert_called_once_with(profile, "more like this", 5, tracks=tracks)


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
