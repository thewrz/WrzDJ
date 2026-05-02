"""Tests for app.core.config.Settings derived properties."""

import base64
import secrets

import pytest

from app.core.config import Settings


def _make_settings(**overrides) -> Settings:
    """Build a Settings instance bypassing env, with safe required defaults."""
    defaults = {
        "database_url": "sqlite:///:memory:",
        "jwt_secret": "test-secret-not-default",
        "env": "development",
    }
    defaults.update(overrides)
    return Settings(**defaults)


class TestEffectiveHumanCookieSecret:
    """Regression: secrets.token_urlsafe(32) yields 43-char unpadded base64.

    Production was set with such a value and base64.urlsafe_b64decode without
    padding raised binascii.Error, returning 500 from /verify-human.
    """

    def test_unpadded_43char_token_urlsafe(self) -> None:
        raw = secrets.token_bytes(32)
        unpadded = base64.urlsafe_b64encode(raw).decode().rstrip("=")
        assert len(unpadded) == 43

        s = _make_settings(human_cookie_secret=unpadded)
        assert s.effective_human_cookie_secret == raw

    def test_padded_44char_openssl_rand(self) -> None:
        raw = secrets.token_bytes(32)
        padded = base64.urlsafe_b64encode(raw).decode()
        assert padded.endswith("=")
        assert len(padded) == 44

        s = _make_settings(human_cookie_secret=padded)
        assert s.effective_human_cookie_secret == raw

    def test_invalid_base64_raises(self) -> None:
        s = _make_settings(human_cookie_secret="!!!not-base64!!!")
        with pytest.raises(Exception):  # noqa: B017,PT011
            _ = s.effective_human_cookie_secret

    def test_dev_autogenerates_when_unset(self) -> None:
        s = _make_settings(env="development", human_cookie_secret="")
        key = s.effective_human_cookie_secret
        assert isinstance(key, bytes)
        assert len(key) == 32
        # Cached: subsequent calls return same key
        assert s.effective_human_cookie_secret == key

    def test_production_unset_raises(self) -> None:
        s = _make_settings(env="production", human_cookie_secret="")
        with pytest.raises(RuntimeError, match="HUMAN_COOKIE_SECRET"):
            _ = s.effective_human_cookie_secret
