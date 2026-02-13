"""Tests for BPM/key/genre scoring algorithm."""

import pytest

from app.services.recommendation.scorer import (
    EventProfile,
    ScoredTrack,
    TrackProfile,
    build_event_profile,
    rank_candidates,
    score_candidate,
)


class TestBuildEventProfile:
    def test_empty_tracks(self):
        profile = build_event_profile([])
        assert profile.track_count == 0
        assert profile.avg_bpm is None
        assert profile.bpm_range is None
        assert list(profile.dominant_keys) == []
        assert list(profile.dominant_genres) == []

    def test_single_track(self):
        tracks = [TrackProfile(title="Track", artist="Artist", bpm=128.0, key="8A", genre="House")]
        profile = build_event_profile(tracks)
        assert profile.track_count == 1
        assert profile.avg_bpm == 128.0
        assert profile.bpm_range == (128.0, 128.0)
        assert list(profile.dominant_keys) == ["8A"]
        assert list(profile.dominant_genres) == ["House"]

    def test_multiple_tracks_avg_bpm(self):
        tracks = [
            TrackProfile(title="T1", artist="A", bpm=120.0),
            TrackProfile(title="T2", artist="A", bpm=130.0),
            TrackProfile(title="T3", artist="A", bpm=140.0),
        ]
        profile = build_event_profile(tracks)
        assert profile.avg_bpm == pytest.approx(130.0)
        assert profile.bpm_range == (120.0, 140.0)

    def test_bpm_range(self):
        tracks = [
            TrackProfile(title="T1", artist="A", bpm=100.0),
            TrackProfile(title="T2", artist="A", bpm=150.0),
        ]
        profile = build_event_profile(tracks)
        assert profile.bpm_range == (100.0, 150.0)

    def test_all_none_bpms(self):
        tracks = [
            TrackProfile(title="T1", artist="A"),
            TrackProfile(title="T2", artist="A"),
        ]
        profile = build_event_profile(tracks)
        assert profile.avg_bpm is None
        assert profile.bpm_range is None
        assert profile.track_count == 2

    def test_dominant_keys(self):
        tracks = [
            TrackProfile(title="T1", artist="A", key="8A"),
            TrackProfile(title="T2", artist="A", key="8A"),
            TrackProfile(title="T3", artist="A", key="9A"),
            TrackProfile(title="T4", artist="A", key="7A"),
            TrackProfile(title="T5", artist="A", key="8A"),
        ]
        profile = build_event_profile(tracks)
        # 8A appears 3 times, should be first
        assert profile.dominant_keys[0] == "8A"
        assert len(profile.dominant_keys) <= 3

    def test_dominant_genres(self):
        tracks = [
            TrackProfile(title="T1", artist="A", genre="Tech House"),
            TrackProfile(title="T2", artist="A", genre="Tech House"),
            TrackProfile(title="T3", artist="A", genre="Progressive House"),
            TrackProfile(title="T4", artist="A", genre="Tech House"),
        ]
        profile = build_event_profile(tracks)
        assert profile.dominant_genres[0] == "Tech House"

    def test_max_three_dominant(self):
        tracks = [
            TrackProfile(title="T1", artist="A", genre="A"),
            TrackProfile(title="T2", artist="A", genre="B"),
            TrackProfile(title="T3", artist="A", genre="C"),
            TrackProfile(title="T4", artist="A", genre="D"),
        ]
        profile = build_event_profile(tracks)
        assert len(profile.dominant_genres) == 3


class TestScoreCandidate:
    def _make_profile(self, **kwargs):
        defaults = {
            "avg_bpm": 128.0,
            "bpm_range": (120.0, 136.0),
            "dominant_keys": ["8A"],
            "dominant_genres": ["Tech House"],
            "track_count": 5,
        }
        defaults.update(kwargs)
        return EventProfile(**defaults)

    def test_perfect_match(self):
        """Candidate matching all criteria should score high."""
        profile = self._make_profile()
        candidate = TrackProfile(
            title="Track", artist="Artist", bpm=128.0, key="8A", genre="Tech House"
        )
        scored = score_candidate(candidate, profile)
        assert scored.bpm_score == 1.0
        assert scored.key_score == 1.0
        assert scored.genre_score == 1.0
        assert scored.score == pytest.approx(1.0)

    def test_bpm_in_range(self):
        profile = self._make_profile()
        candidate = TrackProfile(title="T", artist="A", bpm=129.0)
        scored = score_candidate(candidate, profile)
        assert scored.bpm_score == 1.0  # Within +/-2

    def test_bpm_out_of_range(self):
        profile = self._make_profile()
        candidate = TrackProfile(title="T", artist="A", bpm=160.0)
        scored = score_candidate(candidate, profile)
        assert scored.bpm_score == 0.0  # More than 20 away

    def test_bpm_moderate_falloff(self):
        profile = self._make_profile()
        candidate = TrackProfile(title="T", artist="A", bpm=138.0)
        scored = score_candidate(candidate, profile)
        # diff=10, falloff = 1.0 - (10-2)/18 = 1.0 - 8/18 ≈ 0.5556
        assert 0.5 < scored.bpm_score < 0.6

    def test_bpm_missing_candidate(self):
        profile = self._make_profile()
        candidate = TrackProfile(title="T", artist="A", bpm=None)
        scored = score_candidate(candidate, profile)
        assert scored.bpm_score == 0.5

    def test_key_compatible(self):
        profile = self._make_profile(dominant_keys=["8A"])
        candidate = TrackProfile(title="T", artist="A", key="9A")  # Adjacent
        scored = score_candidate(candidate, profile)
        assert scored.key_score == 0.8

    def test_key_incompatible(self):
        profile = self._make_profile(dominant_keys=["8A"])
        candidate = TrackProfile(title="T", artist="A", key="3B")
        scored = score_candidate(candidate, profile)
        assert scored.key_score == 0.0

    def test_key_missing(self):
        profile = self._make_profile(dominant_keys=["8A"])
        candidate = TrackProfile(title="T", artist="A", key=None)
        scored = score_candidate(candidate, profile)
        assert scored.key_score == 0.5

    def test_genre_exact_match(self):
        profile = self._make_profile(dominant_genres=["Tech House"])
        candidate = TrackProfile(title="T", artist="A", genre="Tech House")
        scored = score_candidate(candidate, profile)
        assert scored.genre_score == 1.0

    def test_genre_partial_match(self):
        profile = self._make_profile(dominant_genres=["Progressive House"])
        candidate = TrackProfile(title="T", artist="A", genre="House")
        scored = score_candidate(candidate, profile)
        assert scored.genre_score == 0.5

    def test_genre_mismatch(self):
        profile = self._make_profile(dominant_genres=["Techno"])
        candidate = TrackProfile(title="T", artist="A", genre="Hip Hop")
        scored = score_candidate(candidate, profile)
        assert scored.genre_score == 0.0

    def test_genre_missing(self):
        profile = self._make_profile(dominant_genres=["House"])
        candidate = TrackProfile(title="T", artist="A", genre=None)
        scored = score_candidate(candidate, profile)
        assert scored.genre_score == 0.25

    def test_no_genre_data_weights_redistribute(self):
        """When event has no genre data, weights should be BPM 0.5, key 0.5."""
        profile = self._make_profile(dominant_genres=[])
        candidate = TrackProfile(title="T", artist="A", bpm=128.0, key="8A")
        scored = score_candidate(candidate, profile)
        # BPM=1.0 * 0.5 + Key=1.0 * 0.5 + Genre=0.25*0.0 = 1.0
        assert scored.score == pytest.approx(1.0)


class TestRankCandidates:
    def _make_profile(self):
        return EventProfile(
            avg_bpm=128.0,
            bpm_range=(120.0, 136.0),
            dominant_keys=["8A"],
            dominant_genres=["Tech House"],
            track_count=5,
        )

    def test_correct_ordering(self):
        profile = self._make_profile()
        candidates = [
            TrackProfile(title="Bad", artist="A", bpm=200.0, key="3B", genre="Hip Hop"),
            TrackProfile(title="Perfect", artist="A", bpm=128.0, key="8A", genre="Tech House"),
            TrackProfile(title="OK", artist="A", bpm=130.0, key="9A", genre="House"),
        ]
        ranked = rank_candidates(candidates, profile)
        assert ranked[0].profile.title == "Perfect"
        assert ranked[-1].profile.title == "Bad"

    def test_max_results_cap(self):
        profile = self._make_profile()
        candidates = [TrackProfile(title=f"T{i}", artist="A", bpm=128.0) for i in range(50)]
        ranked = rank_candidates(candidates, profile, max_results=10)
        assert len(ranked) == 10

    def test_empty_candidates(self):
        profile = self._make_profile()
        ranked = rank_candidates([], profile)
        assert ranked == []

    def test_returns_scored_tracks(self):
        profile = self._make_profile()
        candidates = [TrackProfile(title="T", artist="A", bpm=128.0)]
        ranked = rank_candidates(candidates, profile)
        assert len(ranked) == 1
        assert isinstance(ranked[0], ScoredTrack)
        assert ranked[0].profile.title == "T"
