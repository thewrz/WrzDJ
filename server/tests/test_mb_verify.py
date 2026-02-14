"""Tests for MusicBrainz artist verification batch service."""

from unittest.mock import patch

from app.models.mb_artist_cache import MbArtistCache
from app.services.recommendation.mb_verify import verify_artists_batch


class TestVerifyArtistsBatch:
    def test_empty_input_returns_empty(self, db):
        result = verify_artists_batch(db, [])
        assert result == {}

    def test_blank_names_ignored(self, db):
        result = verify_artists_batch(db, ["", "  "])
        assert result == {}

    @patch("app.services.recommendation.mb_verify.check_artist_exists")
    def test_calls_api_for_uncached_artist(self, mock_check, db):
        mock_check.return_value = (True, "mbid-123")

        result = verify_artists_batch(db, ["Radiohead"])

        assert result == {"Radiohead": True}
        mock_check.assert_called_once_with("radiohead")

        # Verify cache entry was created
        cached = db.query(MbArtistCache).filter_by(artist_name="radiohead").first()
        assert cached is not None
        assert cached.verified is True
        assert cached.mbid == "mbid-123"

    @patch("app.services.recommendation.mb_verify.check_artist_exists")
    def test_returns_cached_result_without_api_call(self, mock_check, db):
        # Pre-populate cache
        db.add(MbArtistCache(artist_name="radiohead", mbid="mbid-123", verified=True))
        db.commit()

        result = verify_artists_batch(db, ["Radiohead"])

        assert result == {"Radiohead": True}
        mock_check.assert_not_called()

    @patch("app.services.recommendation.mb_verify.check_artist_exists")
    def test_caches_negative_result(self, mock_check, db):
        mock_check.return_value = (False, None)

        result = verify_artists_batch(db, ["AI Generated Music"])

        assert result == {"AI Generated Music": False}

        # Negative result should be cached too
        cached = db.query(MbArtistCache).filter_by(artist_name="ai generated music").first()
        assert cached is not None
        assert cached.verified is False
        assert cached.mbid is None

    @patch("app.services.recommendation.mb_verify.check_artist_exists")
    def test_deduplicates_artist_names(self, mock_check, db):
        mock_check.return_value = (True, "mbid-456")

        result = verify_artists_batch(db, ["deadmau5", "Deadmau5", "DEADMAU5"])

        # All three map to the same normalized name, only one API call
        mock_check.assert_called_once_with("deadmau5")
        assert result["deadmau5"] is True
        assert result["Deadmau5"] is True
        assert result["DEADMAU5"] is True

    @patch("app.services.recommendation.mb_verify.check_artist_exists")
    def test_mixed_cached_and_uncached(self, mock_check, db):
        # Pre-populate one entry
        db.add(MbArtistCache(artist_name="radiohead", mbid="mbid-1", verified=True))
        db.commit()

        mock_check.return_value = (True, "mbid-2")

        result = verify_artists_batch(db, ["Radiohead", "Daft Punk"])

        assert result["Radiohead"] is True
        assert result["Daft Punk"] is True
        # Only Daft Punk should trigger an API call
        mock_check.assert_called_once_with("daft punk")

    @patch("app.services.recommendation.mb_verify.check_artist_exists")
    def test_multiple_uncached_artists(self, mock_check, db):
        mock_check.side_effect = [
            (True, "mbid-a"),
            (False, None),
            (True, "mbid-c"),
        ]

        result = verify_artists_batch(db, ["Artist A", "Artist B", "Artist C"])

        assert result["Artist A"] is True
        assert result["Artist B"] is False
        assert result["Artist C"] is True
        assert mock_check.call_count == 3
