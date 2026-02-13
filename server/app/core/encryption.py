"""Fernet encryption for OAuth tokens stored in the database.

Provides transparent encrypt-on-write / decrypt-on-read via a SQLAlchemy
TypeDecorator.  The encryption key comes from the TOKEN_ENCRYPTION_KEY env var.
In development, a key is auto-generated if not set.  In production, a missing
key is a fatal startup error (enforced in config.py).
"""

import logging

import sqlalchemy as sa
from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

# Module-level Fernet instance, lazily initialised on first use.
_fernet: Fernet | None = None

# Fernet ciphertexts always start with this prefix (base64 version byte).
_FERNET_PREFIX = "gAAAAA"


def _get_fernet() -> Fernet:
    """Return (or create) the module-level Fernet instance."""
    global _fernet  # noqa: PLW0603
    if _fernet is not None:
        return _fernet

    from app.core.config import get_settings

    settings = get_settings()
    key = settings.token_encryption_key

    if not key:
        # Dev/test fallback — generate an ephemeral key.
        key = Fernet.generate_key().decode()
        logger.warning("TOKEN_ENCRYPTION_KEY not set — using auto-generated ephemeral key")

    _fernet = Fernet(key.encode() if isinstance(key, str) else key)
    return _fernet


def encrypt_value(plaintext: str | None) -> str | None:
    """Encrypt a string value using Fernet.  Returns None for None input."""
    if plaintext is None:
        return None
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_value(ciphertext: str | None) -> str | None:
    """Decrypt a Fernet-encrypted value.

    If the value does not look like Fernet ciphertext (e.g. legacy plaintext),
    it is returned as-is so that pre-migration data still works.
    """
    if ciphertext is None:
        return None

    if not ciphertext.startswith(_FERNET_PREFIX):
        return ciphertext

    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        logger.error("Failed to decrypt value — returning as-is")
        return ciphertext


def reset_fernet() -> None:
    """Reset the cached Fernet instance (for testing only)."""
    global _fernet  # noqa: PLW0603
    _fernet = None


class EncryptedText(sa.types.TypeDecorator):
    """SQLAlchemy column type that transparently encrypts/decrypts via Fernet."""

    impl = sa.Text
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect: sa.Dialect) -> str | None:
        """Encrypt before writing to the database."""
        return encrypt_value(value)

    def process_result_value(self, value: str | None, dialect: sa.Dialect) -> str | None:
        """Decrypt after reading from the database."""
        return decrypt_value(value)
