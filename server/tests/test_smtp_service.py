"""Tests for SMTP email sending service."""

from unittest.mock import MagicMock, patch

import pytest

from app.services.email_sender import EmailNotConfiguredError, send_verification_email


def test_send_verification_email():
    """SMTP called with correct from/to/subject/body."""
    with patch("app.services.email_sender.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(
            smtp_host="mail.example.com",
            smtp_port=465,
            smtp_username="noreply@example.com",
            smtp_password="secret",
            smtp_from_address="noreply@example.com",
        )
        with patch("app.services.email_sender.smtplib.SMTP_SSL") as mock_smtp:
            instance = mock_smtp.return_value.__enter__.return_value
            send_verification_email("fan@gmail.com", "847293")

            instance.login.assert_called_once_with("noreply@example.com", "secret")
            instance.send_message.assert_called_once()
            msg = instance.send_message.call_args[0][0]
            assert msg["To"] == "fan@gmail.com"
            assert msg["From"] == "WrzDJ <noreply@example.com>"
            assert "847293" in msg.get_payload()
            assert "15 minutes" in msg.get_payload()


def test_smtp_not_configured_raises():
    """Empty smtp_host -> clear error."""
    with patch("app.services.email_sender.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(smtp_host="", smtp_port=465)
        with pytest.raises(EmailNotConfiguredError):
            send_verification_email("fan@gmail.com", "123456")


def test_email_content_no_pii_leak():
    """Body contains code and expiry, no other personal data."""
    with patch("app.services.email_sender.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(
            smtp_host="mail.example.com",
            smtp_port=465,
            smtp_username="noreply@example.com",
            smtp_password="secret",
            smtp_from_address="noreply@example.com",
        )
        with patch("app.services.email_sender.smtplib.SMTP_SSL") as mock_smtp:
            instance = mock_smtp.return_value.__enter__.return_value
            send_verification_email("fan@gmail.com", "999888")

            msg = instance.send_message.call_args[0][0]
            body = msg.get_payload()
            assert "999888" in body
            assert "fan@gmail.com" not in body
