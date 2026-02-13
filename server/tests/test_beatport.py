"""Tests for Beatport service layer."""

import base64
import hashlib
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import httpx
import pytest
from sqlalchemy.orm import Session

from app.models.user import User
from app.services.auth import get_password_hash
from app.services.beatport import (
    BEATPORT_AUTH_URL,
    BEATPORT_SEARCH_URL,
    BEATPORT_TOKEN_URL,
    DEFAULT_TOKEN_EXPIRY,
    _generate_pkce_pair,
    _parse_duration,
    _refresh_token_if_needed,
    disconnect_beatport,
    exchange_code_for_tokens,
    get_auth_url,
    save_tokens,
    search_beatport_tracks,
)


@pytest.fixture
def beatport_user(db: Session) -> User:
    """User with Beatport tokens."""
    user = User(
        username="beatport_user",
        password_hash=get_password_hash("testpassword123"),
        beatport_access_token="bp_access_token_123",
        beatport_refresh_token="bp_refresh_token_456",
        beatport_token_expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def beatport_user_expired(db: Session) -> User:
    """User with expired Beatport tokens."""
    user = User(
        username="beatport_expired",
        password_hash=get_password_hash("testpassword123"),
        beatport_access_token="bp_expired_token",
        beatport_refresh_token="bp_refresh_token_789",
        beatport_token_expires_at=datetime.now(UTC) - timedelta(hours=1),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def beatport_user_no_token(db: Session) -> User:
    """User without Beatport tokens."""
    user = User(
        username="beatport_notoken",
        password_hash=get_password_hash("testpassword123"),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


MOCK_SEARCH_RESPONSE = {
    "results": [
        {
            "id": 12345,
            "name": "Strobe",
            "slug": "strobe",
            "mix_name": "Original Mix",
            "artists": [{"name": "deadmau5"}],
            "label": {"name": "mau5trap"},
            "genre": {"name": "Progressive House"},
            "bpm": 128,
            "key": {"name": "A min"},
            "length": "10:33",
            "image": {"uri": "https://geo-media.beatport.com/image/12345.jpg"},
            "new_release_date": "2009-09-14",
        }
    ]
}


class TestSearchBeatportTracks:
    @patch("app.services.beatport.httpx.Client")
    def test_search_success(self, mock_client_cls, db: Session, beatport_user: User):
        """Successful search returns parsed results."""
        mock_response = MagicMock()
        mock_response.json.return_value = MOCK_SEARCH_RESPONSE
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get.return_value = mock_response
        mock_client_cls.return_value = mock_client

        results = search_beatport_tracks(db, beatport_user, "deadmau5 Strobe")

        assert len(results) == 1
        assert results[0].track_id == "12345"
        assert results[0].title == "Strobe"
        assert results[0].artist == "deadmau5"
        assert results[0].mix_name == "Original Mix"
        assert results[0].label == "mau5trap"
        assert results[0].genre == "Progressive House"
        assert results[0].bpm == 128
        assert results[0].key == "A min"
        assert results[0].duration_seconds == 633
        assert "beatport.com/track/strobe/12345" in results[0].beatport_url

    @patch("app.services.beatport.httpx.Client")
    def test_search_uses_dedicated_search_url(
        self, mock_client_cls, db: Session, beatport_user: User
    ):
        """Search uses the dedicated search endpoint, not the catalog endpoint."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"results": []}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get.return_value = mock_response
        mock_client_cls.return_value = mock_client

        search_beatport_tracks(db, beatport_user, "test")

        call_args = mock_client.get.call_args
        assert call_args.args[0] == BEATPORT_SEARCH_URL

    @patch("app.services.beatport.httpx.Client")
    def test_search_empty(self, mock_client_cls, db: Session, beatport_user: User):
        """Empty search results return empty list."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"results": []}
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get.return_value = mock_response
        mock_client_cls.return_value = mock_client

        results = search_beatport_tracks(db, beatport_user, "nonexistent track xyz")
        assert results == []

    def test_search_no_token(self, db: Session, beatport_user_no_token: User):
        """No token returns empty list without making API calls."""
        results = search_beatport_tracks(db, beatport_user_no_token, "deadmau5 Strobe")
        assert results == []


class TestBeatportUrlFormat:
    def test_url_format(self):
        """Beatport URL has correct format."""
        from app.services.beatport import BEATPORT_TRACK_URL

        url = BEATPORT_TRACK_URL.format(slug="strobe", track_id="12345")
        assert url == "https://www.beatport.com/track/strobe/12345"


class TestDisconnect:
    def test_disconnect_clears_tokens(self, db: Session, beatport_user: User):
        """Disconnect clears all Beatport token columns."""
        assert beatport_user.beatport_access_token is not None

        disconnect_beatport(db, beatport_user)

        db.refresh(beatport_user)
        assert beatport_user.beatport_access_token is None
        assert beatport_user.beatport_refresh_token is None
        assert beatport_user.beatport_token_expires_at is None

    def test_disconnect_clears_code_verifier(self, db: Session, beatport_user: User):
        """Disconnect also clears the PKCE code_verifier."""
        beatport_user.beatport_oauth_code_verifier = "test-verifier"
        db.commit()

        disconnect_beatport(db, beatport_user)

        db.refresh(beatport_user)
        assert beatport_user.beatport_oauth_code_verifier is None


class TestSearchIncludesMixName:
    @patch("app.services.beatport.httpx.Client")
    def test_mix_name_captured(self, mock_client_cls, db: Session, beatport_user: User):
        """Beatport-specific mix_name field is captured."""
        response_data = {
            "results": [
                {
                    "id": 99999,
                    "name": "Levels",
                    "slug": "levels",
                    "mix_name": "Extended Mix",
                    "artists": [{"name": "Avicii"}],
                    "length": "6:30",
                },
            ]
        }
        mock_response = MagicMock()
        mock_response.json.return_value = response_data
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get.return_value = mock_response
        mock_client_cls.return_value = mock_client

        results = search_beatport_tracks(db, beatport_user, "Avicii Levels")
        assert results[0].mix_name == "Extended Mix"


class TestTokenRefresh:
    @patch("app.services.beatport.httpx.Client")
    def test_refresh_on_expiry(self, mock_client_cls, db: Session, beatport_user_expired: User):
        """Expired token triggers refresh, then search succeeds."""
        refresh_response = MagicMock()
        refresh_response.json.return_value = {
            "access_token": "new_access_token",
            "refresh_token": "new_refresh_token",
            "expires_in": 600,
        }
        refresh_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = refresh_response
        mock_client_cls.return_value = mock_client

        result = _refresh_token_if_needed(db, beatport_user_expired)

        assert result is True
        db.refresh(beatport_user_expired)
        assert beatport_user_expired.beatport_access_token == "new_access_token"
        assert beatport_user_expired.beatport_refresh_token == "new_refresh_token"
        # SQLite returns naive datetimes, so compare without timezone
        expires = beatport_user_expired.beatport_token_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=UTC)
        assert expires > datetime.now(UTC)


class TestParseDuration:
    def test_minutes_seconds(self):
        assert _parse_duration("5:30") == 330

    def test_hours_minutes_seconds(self):
        assert _parse_duration("1:05:30") == 3930

    def test_none(self):
        assert _parse_duration(None) is None

    def test_invalid(self):
        assert _parse_duration("invalid") is None


class TestCorrectApiUrls:
    def test_auth_url_uses_account_domain(self):
        """Auth URL uses the Beatport Identity Service domain."""
        assert BEATPORT_AUTH_URL == "https://account.beatport.com/o/authorize/"

    def test_token_url_uses_account_domain(self):
        """Token URL uses the Beatport Identity Service domain."""
        assert BEATPORT_TOKEN_URL == "https://account.beatport.com/o/token/"

    @patch("app.services.beatport.get_settings")
    def test_get_auth_url_starts_with_correct_base(self, mock_settings):
        """get_auth_url() returns a URL starting with the correct base."""
        mock_settings.return_value.beatport_client_id = "test-client-id"
        mock_settings.return_value.beatport_redirect_uri = "http://localhost:3000/callback"
        url = get_auth_url("test-state", "test-challenge")
        assert url.startswith("https://account.beatport.com/o/authorize/")

    @patch("app.services.beatport.get_settings")
    def test_get_auth_url_includes_pkce_params(self, mock_settings):
        """get_auth_url() includes PKCE code_challenge and method."""
        mock_settings.return_value.beatport_client_id = "test-client-id"
        mock_settings.return_value.beatport_redirect_uri = "http://localhost:3000/callback"
        url = get_auth_url("test-state", "test-challenge-value")
        assert "code_challenge=test-challenge-value" in url
        assert "code_challenge_method=S256" in url


class TestPKCE:
    def test_generate_pkce_pair_format(self):
        """PKCE pair has correct format — verifier is URL-safe, challenge is base64url."""
        verifier, challenge = _generate_pkce_pair()
        assert len(verifier) >= 43  # token_urlsafe(32) produces 43 chars
        assert len(challenge) > 0
        # Verify no padding characters
        assert "=" not in challenge

    def test_pkce_s256_hash_matches(self):
        """code_challenge is the S256 hash of code_verifier."""
        verifier, challenge = _generate_pkce_pair()
        # Recompute
        digest = hashlib.sha256(verifier.encode("ascii")).digest()
        expected = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
        assert challenge == expected

    @patch("app.services.beatport.get_settings")
    @patch("app.services.beatport.httpx.Client")
    def test_exchange_includes_code_verifier(self, mock_client_cls, mock_settings):
        """Token exchange POST includes code_verifier in body."""
        mock_settings.return_value.beatport_client_id = "test-id"
        mock_settings.return_value.beatport_client_secret = ""
        mock_settings.return_value.beatport_redirect_uri = "http://localhost:3000/callback"

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "access_token": "tok",
            "expires_in": 600,
        }
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_cls.return_value = mock_client

        exchange_code_for_tokens("auth-code", "my-verifier-123")

        call_kwargs = mock_client.post.call_args
        post_data = call_kwargs.kwargs.get("data", {})
        assert post_data["code_verifier"] == "my-verifier-123"


class TestDefaultTokenExpiry:
    def test_default_expiry_is_600(self):
        """Default token expiry constant is 600 seconds (10 minutes)."""
        assert DEFAULT_TOKEN_EXPIRY == 600

    def test_save_tokens_uses_600_default(self, db: Session, beatport_user_no_token: User):
        """save_tokens uses 600s default when expires_in is missing."""
        token_data = {"access_token": "tok", "refresh_token": "ref"}
        before = datetime.now(UTC)
        save_tokens(db, beatport_user_no_token, token_data)
        after = datetime.now(UTC)

        db.refresh(beatport_user_no_token)
        expires = beatport_user_no_token.beatport_token_expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=UTC)

        # Should be ~600s from now, not 3600s
        expected_min = before + timedelta(seconds=590)
        expected_max = after + timedelta(seconds=610)
        assert expected_min <= expires <= expected_max


class TestTokenRefreshNoAuthHeader:
    @patch("app.services.beatport.httpx.Client")
    def test_refresh_does_not_send_auth_header(
        self, mock_client_cls, db: Session, beatport_user_expired: User
    ):
        """Token refresh POST does NOT include Authorization header."""
        refresh_response = MagicMock()
        refresh_response.json.return_value = {
            "access_token": "new_token",
            "expires_in": 600,
        }
        refresh_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = refresh_response
        mock_client_cls.return_value = mock_client

        _refresh_token_if_needed(db, beatport_user_expired)

        call_kwargs = mock_client.post.call_args
        headers = call_kwargs.kwargs.get("headers")
        assert headers is None


class TestDisconnectRevokesToken:
    @patch("app.services.beatport.httpx.Client")
    def test_disconnect_calls_revoke(self, mock_client_cls, db: Session, beatport_user: User):
        """Disconnect calls Beatport token revocation endpoint."""
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_cls.return_value = mock_client

        disconnect_beatport(db, beatport_user)

        # Verify POST to revocation endpoint was called
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert "/o/revoke_token/" in call_args.args[0]

    @patch("app.services.beatport.httpx.Client")
    def test_disconnect_revoke_uses_post_body(
        self, mock_client_cls, db: Session, beatport_user: User
    ):
        """Disconnect sends revocation params as POST body, not query params."""
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client_cls.return_value = mock_client

        disconnect_beatport(db, beatport_user)

        call_kwargs = mock_client.post.call_args
        # Should use data= (POST body), not params= (query string)
        assert "data" in call_kwargs.kwargs
        assert "params" not in call_kwargs.kwargs

    @patch("app.services.beatport.httpx.Client")
    def test_disconnect_succeeds_if_revocation_fails(
        self, mock_client_cls, db: Session, beatport_user: User
    ):
        """Tokens are cleared even if revocation request fails."""
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.side_effect = httpx.ConnectError("Connection refused")
        mock_client_cls.return_value = mock_client

        disconnect_beatport(db, beatport_user)

        db.refresh(beatport_user)
        assert beatport_user.beatport_access_token is None
        assert beatport_user.beatport_refresh_token is None
        assert beatport_user.beatport_token_expires_at is None


class TestExchangeCodeWithoutSecret:
    @patch("app.services.beatport.get_settings")
    @patch("app.services.beatport.httpx.Client")
    def test_exchange_omits_secret_when_empty(self, mock_client_cls, mock_settings):
        """Token exchange excludes client_secret when it's empty."""
        mock_settings.return_value.beatport_client_id = "public-client-id"
        mock_settings.return_value.beatport_client_secret = ""
        mock_settings.return_value.beatport_redirect_uri = "http://localhost:3000/callback"

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "access_token": "new_token",
            "refresh_token": "new_refresh",
            "expires_in": 600,
        }
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_cls.return_value = mock_client

        result = exchange_code_for_tokens("auth-code-123", "test-verifier")

        assert result["access_token"] == "new_token"

        call_kwargs = mock_client.post.call_args
        post_data = call_kwargs.kwargs.get("data", {})
        assert "client_secret" not in post_data
        assert post_data["client_id"] == "public-client-id"
        assert post_data["code_verifier"] == "test-verifier"

    @patch("app.services.beatport.get_settings")
    @patch("app.services.beatport.httpx.Client")
    def test_exchange_includes_secret_when_set(self, mock_client_cls, mock_settings):
        """Token exchange includes client_secret when configured."""
        mock_settings.return_value.beatport_client_id = "my-client-id"
        mock_settings.return_value.beatport_client_secret = "my-secret"
        mock_settings.return_value.beatport_redirect_uri = "http://localhost:3000/callback"

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "access_token": "tok",
            "expires_in": 600,
        }
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_cls.return_value = mock_client

        exchange_code_for_tokens("auth-code-456", "test-verifier")

        call_kwargs = mock_client.post.call_args
        post_data = call_kwargs.kwargs.get("data", {})
        assert post_data["client_secret"] == "my-secret"


class TestRefreshWithoutSecret:
    @patch("app.services.beatport.get_settings")
    @patch("app.services.beatport.httpx.Client")
    def test_refresh_omits_secret_when_empty(
        self, mock_client_cls, mock_settings, db: Session, beatport_user_expired: User
    ):
        """Token refresh excludes client_secret when it's empty."""
        mock_settings.return_value.beatport_client_id = "public-client-id"
        mock_settings.return_value.beatport_client_secret = ""

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "access_token": "refreshed_token",
            "expires_in": 600,
        }
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_response
        mock_client_cls.return_value = mock_client

        result = _refresh_token_if_needed(db, beatport_user_expired)

        assert result is True
        db.refresh(beatport_user_expired)
        assert beatport_user_expired.beatport_access_token == "refreshed_token"

        call_kwargs = mock_client.post.call_args
        post_data = call_kwargs.kwargs.get("data", {})
        assert "client_secret" not in post_data


class TestLoggerSanitization:
    @patch("app.services.beatport.httpx.Client")
    @patch("app.services.beatport.logger")
    def test_search_error_does_not_log_token(
        self, mock_logger, mock_client_cls, db: Session, beatport_user: User
    ):
        """Search error logs type name, not full exception with tokens."""
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get.side_effect = httpx.ConnectError(
            "with Bearer sk-secret-token-123 in headers"
        )
        mock_client_cls.return_value = mock_client

        search_beatport_tracks(db, beatport_user, "test query")

        # Verify the logger was called with just the type name, not the full message
        mock_logger.error.assert_called_once()
        log_msg = str(mock_logger.error.call_args)
        assert "Bearer" not in log_msg
        assert "sk-secret" not in log_msg

    @patch("app.services.beatport.httpx.Client")
    @patch("app.services.beatport.logger")
    def test_refresh_error_does_not_log_secret(
        self, mock_logger, mock_client_cls, db: Session, beatport_user_expired: User
    ):
        """Token refresh error logs type name, not credentials."""
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.side_effect = httpx.ConnectError("client_secret=super-secret-value")
        mock_client_cls.return_value = mock_client

        _refresh_token_if_needed(db, beatport_user_expired)

        mock_logger.error.assert_called_once()
        log_msg = str(mock_logger.error.call_args)
        assert "super-secret" not in log_msg
        assert "client_secret" not in log_msg
