"""Tests for track normalizer — TDD style, tests written first."""

from app.services.track_normalizer import (
    NormalizedTrack,
    fuzzy_match_score,
    normalize_artist,
    normalize_track,
    normalize_track_title,
)


class TestNormalizeTrackTitle:
    """Tests for normalize_track_title()."""

    def test_strips_original_mix(self):
        assert normalize_track_title("Strobe (Original Mix)") == "Strobe"

    def test_strips_extended_mix(self):
        assert normalize_track_title("Strobe (Extended Mix)") == "Strobe"

    def test_strips_radio_edit(self):
        assert normalize_track_title("Strobe (Radio Edit)") == "Strobe"

    def test_strips_club_mix(self):
        assert normalize_track_title("Strobe (Club Mix)") == "Strobe"

    def test_strips_album_version(self):
        assert normalize_track_title("Strobe (Album Version)") == "Strobe"

    def test_strips_brackets(self):
        assert normalize_track_title("Strobe [Original Mix]") == "Strobe"

    def test_strips_dash_suffix(self):
        assert normalize_track_title("Strobe - Original Mix") == "Strobe"

    def test_preserves_named_remix(self):
        assert normalize_track_title("Strobe (Maceo Plex Remix)") == "Strobe (Maceo Plex Remix)"

    def test_preserves_instrumental(self):
        assert normalize_track_title("Strobe (Instrumental)") == "Strobe (Instrumental)"

    def test_preserves_acoustic(self):
        assert normalize_track_title("Strobe (Acoustic)") == "Strobe (Acoustic)"

    def test_preserves_live(self):
        assert normalize_track_title("Strobe (Live at Wembley)") == "Strobe (Live at Wembley)"

    def test_preserves_vip(self):
        assert normalize_track_title("Scary Monsters (VIP)") == "Scary Monsters (VIP)"

    def test_preserves_remaster(self):
        assert normalize_track_title("Bohemian Rhapsody (2011 Remaster)") == (
            "Bohemian Rhapsody (2011 Remaster)"
        )

    def test_plain_title_unchanged(self):
        assert normalize_track_title("Strobe") == "Strobe"


class TestNormalizeArtist:
    """Tests for normalize_artist()."""

    def test_featuring_to_feat(self):
        assert normalize_artist("deadmau5 featuring Kaskade") == "deadmau5 feat. Kaskade"

    def test_feat_already(self):
        assert normalize_artist("deadmau5 feat. Kaskade") == "deadmau5 feat. Kaskade"

    def test_ft_to_feat(self):
        assert normalize_artist("deadmau5 ft. Kaskade") == "deadmau5 feat. Kaskade"

    def test_ft_no_dot_to_feat(self):
        assert normalize_artist("deadmau5 ft Kaskade") == "deadmau5 feat. Kaskade"

    def test_with_to_feat(self):
        assert normalize_artist("deadmau5 with Kaskade") == "deadmau5 feat. Kaskade"

    def test_collapses_spaces(self):
        assert normalize_artist("deadmau5  feat.  Kaskade") == "deadmau5 feat. Kaskade"

    def test_plain_artist_unchanged(self):
        assert normalize_artist("deadmau5") == "deadmau5"


class TestFuzzyMatchScore:
    """Tests for fuzzy_match_score()."""

    def test_identical(self):
        assert fuzzy_match_score("Strobe", "Strobe") == 1.0

    def test_case_insensitive(self):
        assert fuzzy_match_score("Strobe", "strobe") == 1.0

    def test_completely_different(self):
        score = fuzzy_match_score("Strobe", "ZZZZZ")
        assert score < 0.3

    def test_similar(self):
        score = fuzzy_match_score("Strobe", "Strobee")
        assert score > 0.8


class TestNormalizeTrack:
    """Tests for normalize_track() (NormalizedTrack output)."""

    def test_plain_track(self):
        result = normalize_track("Strobe", "deadmau5")
        assert isinstance(result, NormalizedTrack)
        assert result.title == "Strobe"
        assert result.artist == "deadmau5"
        assert result.raw_title == "Strobe"
        assert result.raw_artist == "deadmau5"
        assert result.remix_artist is None
        assert result.remix_type is None
        assert result.has_named_remix is False

    def test_original_mix_stripped(self):
        result = normalize_track("Strobe (Original Mix)", "deadmau5")
        assert result.title == "Strobe"
        assert result.raw_title == "Strobe (Original Mix)"

    def test_named_remix_detected(self):
        result = normalize_track("Strobe (Maceo Plex Remix)", "deadmau5")
        assert result.remix_artist == "Maceo Plex"
        assert result.remix_type == "remix"
        assert result.has_named_remix is True

    def test_named_edit_detected(self):
        result = normalize_track("Losing It (Patrick Topping Edit)", "Fisher")
        assert result.remix_artist == "Patrick Topping"
        assert result.remix_type == "edit"
        assert result.has_named_remix is True

    def test_named_bootleg_detected(self):
        result = normalize_track("One More Time (DJ Snake Bootleg)", "Daft Punk")
        assert result.remix_artist == "DJ Snake"
        assert result.remix_type == "bootleg"
        assert result.has_named_remix is True

    def test_dash_remix_detected(self):
        result = normalize_track("Strobe - Maceo Plex Remix", "deadmau5")
        assert result.remix_artist == "Maceo Plex"
        assert result.remix_type == "remix"
        assert result.has_named_remix is True

    def test_featuring_normalized(self):
        result = normalize_track("Strobe", "deadmau5 featuring Kaskade")
        assert result.artist == "deadmau5 feat. Kaskade"
        assert result.raw_artist == "deadmau5 featuring Kaskade"

    def test_frozen_dataclass(self):
        result = normalize_track("Strobe", "deadmau5")
        try:
            result.title = "Modified"
            assert False, "Should not be able to mutate frozen dataclass"
        except AttributeError:
            pass
