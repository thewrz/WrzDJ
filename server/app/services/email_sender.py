"""SMTP email sending for verification codes."""

import logging
import smtplib
from email.message import EmailMessage

from app.core.config import get_settings

_logger = logging.getLogger("app.email")


class EmailNotConfiguredError(Exception):
    """Raised when SMTP settings are missing."""


class EmailSendError(Exception):
    """Raised when SMTP connection or sending fails."""


def send_verification_email(to_address: str, code: str) -> None:
    """Send a 6-digit verification code via SMTP."""
    settings = get_settings()

    if not settings.smtp_host:
        raise EmailNotConfiguredError("SMTP is not configured (smtp_host is empty)")

    msg = EmailMessage()
    msg["Subject"] = "Your WrzDJ verification code"
    msg["From"] = f"WrzDJ <{settings.smtp_from_address}>"
    msg["To"] = to_address
    msg.set_content(
        f"Your verification code is: {code}\n\n"
        f"Enter this code on the WrzDJ page. It expires in 15 minutes.\n\n"
        f"If you didn't request this, you can safely ignore this email.\n"
    )

    try:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port) as smtp:
            smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(msg)
    except (OSError, smtplib.SMTPException) as exc:
        _logger.error("email.send_failed to_hash=%s error=%s", to_address[:3] + "***", exc)
        raise EmailSendError(str(exc)) from exc

    _logger.info("email.sent to_hash=%s", to_address[:3] + "***")
