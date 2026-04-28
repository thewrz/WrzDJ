"""Tests for verification email sending via Resend API."""

from unittest.mock import MagicMock, patch

import pytest

from app.services.email_sender import (
    EmailNotConfiguredError,
    EmailSendError,
    send_verification_email,
)


def test_send_verification_email_uses_resend():
    """Resend.Emails.send called with correct from/to/subject/body."""
    with patch("app.services.email_sender.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(
            resend_api_key="test_resend_key",
            email_from_address="WrzDJ <noreply@send.wrzdj.com>",
        )
        with patch("app.services.email_sender.resend.Emails.send") as mock_send:
            send_verification_email("fan@gmail.com", "847293")

            mock_send.assert_called_once()
            payload = mock_send.call_args[0][0]
            assert payload["from"] == "WrzDJ <noreply@send.wrzdj.com>"
            assert payload["to"] == ["fan@gmail.com"]
            assert payload["subject"] == "Your WrzDJ verification code"
            assert "847293" in payload["text"]
            assert "15 minutes" in payload["text"]


def test_email_not_configured_when_api_key_missing():
    """Empty resend_api_key -> clear error."""
    with patch("app.services.email_sender.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(resend_api_key="", email_from_address="from@x.com")
        with pytest.raises(EmailNotConfiguredError):
            send_verification_email("fan@gmail.com", "123456")


def test_email_not_configured_when_from_missing():
    """Empty email_from_address -> clear error."""
    with patch("app.services.email_sender.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(resend_api_key="key", email_from_address="")
        with pytest.raises(EmailNotConfiguredError):
            send_verification_email("fan@gmail.com", "123456")


def test_resend_failure_wrapped_in_email_send_error():
    """Resend exceptions get wrapped so callers can distinguish from config issues."""
    with patch("app.services.email_sender.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(
            resend_api_key="key",
            email_from_address="from@x.com",
        )
        with patch(
            "app.services.email_sender.resend.Emails.send",
            side_effect=RuntimeError("API down"),
        ):
            with pytest.raises(EmailSendError):
                send_verification_email("fan@gmail.com", "123456")


def test_email_content_no_pii_leak():
    """Body contains code and expiry, no recipient address."""
    with patch("app.services.email_sender.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(
            resend_api_key="key",
            email_from_address="from@x.com",
        )
        with patch("app.services.email_sender.resend.Emails.send") as mock_send:
            send_verification_email("fan@gmail.com", "999888")
            payload = mock_send.call_args[0][0]
            body = payload["text"]
            assert "999888" in body
            assert "fan@gmail.com" not in body
