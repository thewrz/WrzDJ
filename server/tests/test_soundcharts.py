"""Tests for Soundcharts API client and key conversion utilities."""

from unittest.mock import MagicMock, patch

from app.services.soundcharts import (
    SoundchartsTrack,
    _build_request_body,
    discover_songs,
    key_to_soundcharts_filter,
    pitch_class_to_key_string,
)


class TestKeyToSoundchartsFilter:
    def test_c_major(self):
        assert key_to_soundcharts_filter("C Major") == (0, 1)

    def test_g_major(self):
        assert key_to_soundcharts_filter("G Major") == (7, 1)

    def test_a_major(self):
        assert key_to_soundcharts_filter("A Major") == (9, 1)

    def test_d_minor(self):
        assert key_to_soundcharts_filter("D Minor") == (2, 0)

    def test_a_minor(self):
        assert key_to_soundcharts_filter("A Minor") == (9, 0)

    def test_c_minor(self):
        assert key_to_soundcharts_filter("C Minor") == (0, 0)

    def test_f_sharp_minor(self):
        assert key_to_soundcharts_filter("F# Minor") == (6, 0)

    def test_eb_major(self):
        assert key_to_soundcharts_filter("Eb Major") == (3, 1)

    def test_bare_key_defaults_major(self):
        # Bare key "Eb" defaults to Eb major via camelot.py
        assert key_to_soundcharts_filter("Eb") == (3, 1)

    def test_bare_key_f_sharp(self):
        assert key_to_soundcharts_filter("F#") == (6, 1)

    def test_camelot_code(self):
        # 8A = A minor
        assert key_to_soundcharts_filter("8A") == (9, 0)
        # 8B = C major
        assert key_to_soundcharts_filter("8B") == (0, 1)

    def test_none_returns_none(self):
        assert key_to_soundcharts_filter("") is None

    def test_invalid_returns_none(self):
        assert key_to_soundcharts_filter("not a key") is None


class TestPitchClassToKeyString:
    def test_d_minor(self):
        assert pitch_class_to_key_string(2, 0) == "D Minor"

    def test_g_major(self):
        assert pitch_class_to_key_string(7, 1) == "G Major"

    def test_c_major(self):
        assert pitch_class_to_key_string(0, 1) == "C Major"

    def test_c_minor(self):
        assert pitch_class_to_key_string(0, 0) == "C Minor"

    def test_all_pitch_classes(self):
        expected_notes = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
        for pc in range(12):
            result = pitch_class_to_key_string(pc, 1)
            assert result == f"{expected_notes[pc]} Major"
            result = pitch_class_to_key_string(pc, 0)
            assert result == f"{expected_notes[pc]} Minor"


class TestBuildRequestBody:
    def test_genre_only(self):
        body = _build_request_body(genres=["Country", "Pop"])
        filters = body["filters"]
        assert len(filters) == 1
        assert filters[0]["type"] == "songGenres"
        assert filters[0]["data"]["values"] == ["Country", "Pop"]

    def test_genre_and_bpm(self):
        body = _build_request_body(genres=["House"], bpm_min=120, bpm_max=140)
        types = {f["type"] for f in body["filters"]}
        assert "songGenres" in types
        assert "tempo" in types
        tempo = next(f for f in body["filters"] if f["type"] == "tempo")
        assert tempo["data"]["min"] == 120
        assert tempo["data"]["max"] == 140

    def test_genre_bpm_and_keys(self):
        body = _build_request_body(
            genres=["Country"],
            bpm_min=100,
            bpm_max=130,
            keys=["G Major", "D Minor"],
        )
        types = {f["type"] for f in body["filters"]}
        assert "songGenres" in types
        assert "tempo" in types
        assert "songKey" in types
        assert "songMode" in types

        key_filter = next(f for f in body["filters"] if f["type"] == "songKey")
        mode_filter = next(f for f in body["filters"] if f["type"] == "songMode")
        # G Major = pitch 7, D Minor = pitch 2
        assert sorted(key_filter["data"]["values"]) == [2, 7]
        # Major=1, Minor=0
        assert sorted(mode_filter["data"]["values"]) == [0, 1]

    def test_empty_genres(self):
        body = _build_request_body(genres=[])
        assert body["filters"] == []

    def test_invalid_keys_skipped(self):
        body = _build_request_body(genres=["Pop"], keys=["not a key", "also invalid"])
        types = {f["type"] for f in body["filters"]}
        assert "songKey" not in types
        assert "songMode" not in types

    def test_sort_defaults(self):
        body = _build_request_body(genres=["Rock"])
        assert body["sort"]["platform"] == "spotify"
        assert body["sort"]["order"] == "desc"


class TestDiscoverSongs:
    @patch("app.services.soundcharts.get_settings")
    def test_not_configured_returns_empty(self, mock_settings):
        mock_settings.return_value = MagicMock(soundcharts_app_id="", soundcharts_api_key="")
        result = discover_songs(genres=["Country"])
        assert result == []

    @patch("app.services.soundcharts.httpx.post")
    @patch("app.services.soundcharts.get_settings")
    def test_successful_discovery(self, mock_settings, mock_post):
        mock_settings.return_value = MagicMock(
            soundcharts_app_id="test-id",
            soundcharts_api_key="test-key",
        )
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "items": [
                {
                    "song": {
                        "uuid": "abc-123",
                        "name": "Country Roads",
                        "creditName": "John Denver",
                        "imageUrl": "https://example.com/img.jpg",
                        "releaseDate": "1971-01-01",
                    }
                },
                {
                    "song": {
                        "uuid": "def-456",
                        "name": "Jolene",
                        "creditName": "Dolly Parton",
                        "imageUrl": None,
                        "releaseDate": None,
                    }
                },
            ],
            "page": {"total": 2},
        }
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response

        result = discover_songs(genres=["Country"], bpm_min=100, bpm_max=130)
        assert len(result) == 2
        assert result[0] == SoundchartsTrack(
            title="Country Roads",
            artist="John Denver",
            soundcharts_uuid="abc-123",
        )
        assert result[1].title == "Jolene"

    @patch("app.services.soundcharts.httpx.post")
    @patch("app.services.soundcharts.get_settings")
    def test_api_error_returns_empty(self, mock_settings, mock_post):
        mock_settings.return_value = MagicMock(
            soundcharts_app_id="test-id",
            soundcharts_api_key="test-key",
        )
        import httpx

        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_response.text = "Access Denied"
        mock_post.side_effect = httpx.HTTPStatusError(
            "403", request=MagicMock(), response=mock_response
        )

        result = discover_songs(genres=["Country"])
        assert result == []

    @patch("app.services.soundcharts.httpx.post")
    @patch("app.services.soundcharts.get_settings")
    def test_network_error_returns_empty(self, mock_settings, mock_post):
        mock_settings.return_value = MagicMock(
            soundcharts_app_id="test-id",
            soundcharts_api_key="test-key",
        )
        import httpx

        mock_post.side_effect = httpx.ConnectError("Connection refused")

        result = discover_songs(genres=["Country"])
        assert result == []

    @patch("app.services.soundcharts.httpx.post")
    @patch("app.services.soundcharts.get_settings")
    def test_malformed_items_skipped(self, mock_settings, mock_post):
        mock_settings.return_value = MagicMock(
            soundcharts_app_id="test-id",
            soundcharts_api_key="test-key",
        )
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "items": [
                {"song": {"uuid": "abc", "name": None, "creditName": "Artist"}},
                {"song": {"uuid": "def", "name": "Good Song", "creditName": "Good Artist"}},
                {"song": {}},
            ],
            "page": {"total": 3},
        }
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response

        result = discover_songs(genres=["Pop"])
        assert len(result) == 1
        assert result[0].title == "Good Song"

    @patch("app.services.soundcharts.httpx.post")
    @patch("app.services.soundcharts.get_settings")
    def test_credit_name_object_extracts_name(self, mock_settings, mock_post):
        """Regression: creditName can be a dict like {"name": "Artist", "type": "main"}."""
        mock_settings.return_value = MagicMock(
            soundcharts_app_id="test-id",
            soundcharts_api_key="test-key",
        )
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "items": [
                {
                    "song": {
                        "uuid": "abc-123",
                        "name": "Some Song",
                        "creditName": {"name": "Object Artist", "type": "main"},
                    }
                },
            ],
            "page": {"total": 1},
        }
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response

        result = discover_songs(genres=["Pop"])
        assert len(result) == 1
        assert result[0].artist == "Object Artist"
        assert isinstance(result[0].artist, str)

    @patch("app.services.soundcharts.httpx.post")
    @patch("app.services.soundcharts.get_settings")
    def test_credit_name_object_without_name_skipped(self, mock_settings, mock_post):
        """creditName dict with no 'name' key should be skipped (empty string)."""
        mock_settings.return_value = MagicMock(
            soundcharts_app_id="test-id",
            soundcharts_api_key="test-key",
        )
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "items": [
                {
                    "song": {
                        "uuid": "abc-123",
                        "name": "Some Song",
                        "creditName": {"type": "main"},
                    }
                },
            ],
            "page": {"total": 1},
        }
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response

        result = discover_songs(genres=["Pop"])
        assert len(result) == 0  # Skipped because artist is empty
