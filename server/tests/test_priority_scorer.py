"""Tests for DJ priority scoring of song requests.

TDD Phase 1: RED — all tests written before implementation.
Scoring dimensions: vote count, wait time, harmonic key fit, BPM energy fit.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.services.priority_scorer import (
    PriorityScore,
    RequestScoreInput,
    _score_energy_fit,
    _score_harmonic_fit,
    _score_votes,
    _score_wait_time,
    compute_priority_score,
    rank_requests_by_priority,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_input(
    request_id: int = 1,
    vote_count: int = 0,
    created_at: datetime | None = None,
    musical_key: str | None = None,
    bpm: float | None = None,
) -> RequestScoreInput:
    return RequestScoreInput(
        request_id=request_id,
        vote_count=vote_count,
        created_at=created_at or datetime(2026, 3, 13, 22, 0, 0, tzinfo=UTC),
        musical_key=musical_key,
        bpm=bpm,
    )


# ---------------------------------------------------------------------------
# Vote scoring
# ---------------------------------------------------------------------------


class TestScoreVotes:
    def test_zero_votes_returns_zero(self):
        assert _score_votes(0, max_votes=10) == 0.0

    def test_max_votes_returns_one(self):
        assert _score_votes(10, max_votes=10) == 1.0

    def test_mid_votes_logarithmic_scaling(self):
        """5 votes out of 10 should score > 0.5 due to log scaling."""
        score = _score_votes(5, max_votes=10)
        assert 0.7 < score < 0.9

    def test_single_vote_nonzero(self):
        assert _score_votes(1, max_votes=10) > 0.0

    def test_max_votes_zero_returns_zero(self):
        """When no requests have any votes, score should be 0."""
        assert _score_votes(0, max_votes=0) == 0.0

    def test_negative_votes_clamped(self):
        assert _score_votes(-1, max_votes=10) == 0.0


# ---------------------------------------------------------------------------
# Wait time scoring
# ---------------------------------------------------------------------------


class TestScoreWaitTime:
    def test_zero_seconds_returns_zero(self):
        assert _score_wait_time(0, max_wait=3600) == 0.0

    def test_max_wait_returns_one(self):
        assert _score_wait_time(3600, max_wait=3600) == 1.0

    def test_linear_scaling(self):
        assert _score_wait_time(1800, max_wait=3600) == pytest.approx(0.5)

    def test_max_wait_zero_returns_zero(self):
        """All requests submitted at same time."""
        assert _score_wait_time(0, max_wait=0) == 0.0

    def test_exceeds_max_clamped_to_one(self):
        assert _score_wait_time(7200, max_wait=3600) == 1.0


# ---------------------------------------------------------------------------
# Harmonic fit scoring
# ---------------------------------------------------------------------------


class TestScoreHarmonicFit:
    def test_same_key_returns_one(self):
        assert _score_harmonic_fit("8A", "8A") == 1.0

    def test_adjacent_key_returns_high(self):
        assert _score_harmonic_fit("9A", "8A") == 0.8

    def test_parallel_key_returns_high(self):
        assert _score_harmonic_fit("8B", "8A") == 0.8

    def test_two_away_returns_medium(self):
        assert _score_harmonic_fit("10A", "8A") == 0.5

    def test_incompatible_key_returns_zero(self):
        assert _score_harmonic_fit("3B", "8A") == 0.0

    def test_missing_request_key_returns_neutral(self):
        assert _score_harmonic_fit(None, "8A") == 0.5

    def test_missing_now_playing_key_returns_neutral(self):
        assert _score_harmonic_fit("8A", None) == 0.5

    def test_both_missing_returns_neutral(self):
        assert _score_harmonic_fit(None, None) == 0.5


# ---------------------------------------------------------------------------
# Energy (BPM) fit scoring
# ---------------------------------------------------------------------------


class TestScoreEnergyFit:
    def test_exact_bpm_match_returns_one(self):
        assert _score_energy_fit(128.0, 128.0) == 1.0

    def test_within_tolerance_returns_one(self):
        """BPM within ±3 of now-playing is a perfect energy match."""
        assert _score_energy_fit(130.0, 128.0) == 1.0

    def test_moderate_difference_linear_falloff(self):
        """10 BPM diff → partial score between tolerance and max."""
        score = _score_energy_fit(138.0, 128.0)
        assert 0.6 < score < 0.75

    def test_large_difference_returns_zero(self):
        """25+ BPM diff → incompatible energy."""
        assert _score_energy_fit(180.0, 128.0) == 0.0

    def test_half_time_recognized(self):
        """Half-time BPM match (64 vs 128) should score > 0.5."""
        assert _score_energy_fit(64.0, 128.0) > 0.5

    def test_missing_request_bpm_returns_neutral(self):
        assert _score_energy_fit(None, 128.0) == 0.5

    def test_missing_now_playing_bpm_returns_neutral(self):
        assert _score_energy_fit(128.0, None) == 0.5

    def test_both_missing_returns_neutral(self):
        assert _score_energy_fit(None, None) == 0.5


# ---------------------------------------------------------------------------
# Composite priority score
# ---------------------------------------------------------------------------


class TestComputePriorityScore:
    def test_perfect_match_scores_near_one(self):
        """Max votes, longest wait, perfect key+BPM match → ~1.0."""
        score = compute_priority_score(
            vote_count=10,
            max_votes=10,
            seconds_waiting=3600,
            max_wait=3600,
            request_key="8A",
            request_bpm=128.0,
            now_playing_key="8A",
            now_playing_bpm=128.0,
        )
        assert score.score >= 0.95

    def test_no_metadata_falls_back_to_votes_and_time(self):
        """No key/BPM/now-playing → score from votes+time only."""
        score = compute_priority_score(
            vote_count=5,
            max_votes=10,
            seconds_waiting=1800,
            max_wait=3600,
            request_key=None,
            request_bpm=None,
            now_playing_key=None,
            now_playing_bpm=None,
        )
        # Harmonic and energy both get 0.5 (neutral)
        assert score.harmonic_score == 0.5
        assert score.energy_score == 0.5
        # Overall score should be meaningful (not zero)
        assert score.score > 0.3

    def test_high_votes_beats_old_request_with_no_votes(self):
        """10 votes / 60s wait should beat 0 votes / 3600s wait."""
        popular = compute_priority_score(
            vote_count=10,
            max_votes=10,
            seconds_waiting=60,
            max_wait=3600,
            request_key=None,
            request_bpm=None,
            now_playing_key=None,
            now_playing_bpm=None,
        )
        old = compute_priority_score(
            vote_count=0,
            max_votes=10,
            seconds_waiting=3600,
            max_wait=3600,
            request_key=None,
            request_bpm=None,
            now_playing_key=None,
            now_playing_bpm=None,
        )
        assert popular.score > old.score

    def test_harmonic_match_breaks_tie(self):
        """Same votes/time, compatible key beats incompatible."""
        compatible = compute_priority_score(
            vote_count=5,
            max_votes=10,
            seconds_waiting=1800,
            max_wait=3600,
            request_key="8A",
            request_bpm=128.0,
            now_playing_key="8A",
            now_playing_bpm=128.0,
        )
        incompatible = compute_priority_score(
            vote_count=5,
            max_votes=10,
            seconds_waiting=1800,
            max_wait=3600,
            request_key="3B",
            request_bpm=180.0,
            now_playing_key="8A",
            now_playing_bpm=128.0,
        )
        assert compatible.score > incompatible.score

    def test_all_zeros_returns_near_zero(self):
        """0 everything + incompatible key/BPM → near 0."""
        score = compute_priority_score(
            vote_count=0,
            max_votes=10,
            seconds_waiting=0,
            max_wait=3600,
            request_key="3B",
            request_bpm=180.0,
            now_playing_key="8A",
            now_playing_bpm=128.0,
        )
        assert score.score < 0.1

    def test_weight_redistribution_no_now_playing(self):
        """When both now_playing_key and bpm are None, harmonic+energy are neutral."""
        score = compute_priority_score(
            vote_count=10,
            max_votes=10,
            seconds_waiting=3600,
            max_wait=3600,
            request_key="8A",
            request_bpm=128.0,
            now_playing_key=None,
            now_playing_bpm=None,
        )
        assert score.harmonic_score == 0.5
        assert score.energy_score == 0.5
        # Votes and time are maxed, so overall should still be high
        assert score.score > 0.6

    def test_returns_priority_score_dataclass(self):
        score = compute_priority_score(
            vote_count=5,
            max_votes=10,
            seconds_waiting=900,
            max_wait=3600,
            request_key="8A",
            request_bpm=128.0,
            now_playing_key="9A",
            now_playing_bpm=130.0,
        )
        assert isinstance(score, PriorityScore)
        assert hasattr(score, "score")
        assert hasattr(score, "vote_score")
        assert hasattr(score, "wait_score")
        assert hasattr(score, "harmonic_score")
        assert hasattr(score, "energy_score")


# ---------------------------------------------------------------------------
# Ranking
# ---------------------------------------------------------------------------


class TestRankRequestsByPriority:
    def test_sorts_descending_by_score(self):
        now = datetime(2026, 3, 13, 23, 0, 0, tzinfo=UTC)
        requests = [
            _make_input(request_id=1, vote_count=0, created_at=now),
            _make_input(request_id=2, vote_count=10, created_at=now - timedelta(hours=1)),
            _make_input(request_id=3, vote_count=5, created_at=now - timedelta(minutes=30)),
        ]
        ranked = rank_requests_by_priority(
            requests,
            now_playing_key=None,
            now_playing_bpm=None,
            now=now,
        )
        assert len(ranked) == 3
        # Most votes + longest wait should be first
        assert ranked[0].request_id == 2

    def test_empty_list_returns_empty(self):
        ranked = rank_requests_by_priority(
            [],
            now_playing_key=None,
            now_playing_bpm=None,
        )
        assert ranked == []

    def test_stable_sort_on_equal_scores(self):
        """Identical attributes → original order preserved."""
        now = datetime(2026, 3, 13, 23, 0, 0, tzinfo=UTC)
        base_time = now - timedelta(minutes=30)
        requests = [
            _make_input(request_id=1, vote_count=3, created_at=base_time),
            _make_input(request_id=2, vote_count=3, created_at=base_time),
        ]
        ranked = rank_requests_by_priority(
            requests,
            now_playing_key=None,
            now_playing_bpm=None,
            now=now,
        )
        assert ranked[0].request_id == 1
        assert ranked[1].request_id == 2

    def test_harmonic_fit_affects_ranking(self):
        """Request matching now-playing key should rank higher."""
        now = datetime(2026, 3, 13, 23, 0, 0, tzinfo=UTC)
        base_time = now - timedelta(minutes=30)
        requests = [
            _make_input(
                request_id=1, vote_count=3, created_at=base_time, musical_key="3B", bpm=180.0
            ),
            _make_input(
                request_id=2, vote_count=3, created_at=base_time, musical_key="8A", bpm=128.0
            ),
        ]
        ranked = rank_requests_by_priority(
            requests,
            now_playing_key="8A",
            now_playing_bpm=128.0,
            now=now,
        )
        # Request 2 has perfect harmonic+energy match → should rank first
        assert ranked[0].request_id == 2
