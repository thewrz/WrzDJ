"""Tests for the encryption module (Fernet encrypt/decrypt + TypeDecorator)."""

from unittest.mock import patch

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import Column, Integer, create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.core.encryption import (
    _FERNET_PREFIX,
    EncryptedText,
    decrypt_value,
    encrypt_value,
    reset_fernet,
)

# Use a stable test key so encrypt/decrypt are deterministic across calls.
TEST_KEY = Fernet.generate_key().decode()

Base = declarative_base()


class FakeSecret(Base):
    __tablename__ = "fake_secrets"
    id = Column(Integer, primary_key=True)
    token = Column(EncryptedText, nullable=True)


@pytest.fixture(autouse=True)
def _use_test_key():
    """Ensure every test uses a known Fernet key and resets state afterwards."""
    reset_fernet()
    with patch("app.core.encryption._get_fernet", return_value=Fernet(TEST_KEY)):
        yield
    reset_fernet()


class TestEncryptDecrypt:
    def test_round_trip(self):
        plaintext = "my-secret-token-12345"
        encrypted = encrypt_value(plaintext)
        assert encrypted is not None
        assert encrypted != plaintext
        assert encrypted.startswith(_FERNET_PREFIX)
        assert decrypt_value(encrypted) == plaintext

    def test_none_passthrough(self):
        assert encrypt_value(None) is None
        assert decrypt_value(None) is None

    def test_plaintext_fallback(self):
        """Legacy plaintext that doesn't start with the Fernet prefix is returned as-is."""
        legacy = "some-old-plaintext-token"
        assert decrypt_value(legacy) == legacy

    def test_empty_string(self):
        encrypted = encrypt_value("")
        assert encrypted is not None
        assert decrypt_value(encrypted) == ""

    def test_unicode_round_trip(self):
        text = "token-with-unicode-\u00e9\u00e8\u00ea"
        assert decrypt_value(encrypt_value(text)) == text


class TestEncryptedTextTypeDecorator:
    @pytest.fixture
    def session(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        _session = sessionmaker(bind=engine)()
        yield _session
        _session.close()

    def test_write_and_read_encrypted(self, session: Session):
        secret = FakeSecret(id=1, token="super-secret")
        session.add(secret)
        session.commit()

        # Read back via ORM — should be decrypted transparently
        loaded = session.get(FakeSecret, 1)
        assert loaded is not None
        assert loaded.token == "super-secret"

    def test_raw_value_is_encrypted(self, session: Session):
        secret = FakeSecret(id=2, token="plaintext-value")
        session.add(secret)
        session.commit()
        session.expire_all()

        # Read raw from DB to confirm it's actually encrypted
        from sqlalchemy import text

        raw = session.execute(text("SELECT token FROM fake_secrets WHERE id = 2")).scalar()
        assert raw is not None
        assert raw.startswith(_FERNET_PREFIX)
        assert raw != "plaintext-value"

    def test_null_column(self, session: Session):
        secret = FakeSecret(id=3, token=None)
        session.add(secret)
        session.commit()

        loaded = session.get(FakeSecret, 3)
        assert loaded is not None
        assert loaded.token is None
