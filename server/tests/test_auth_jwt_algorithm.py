"""TDD guard for CRIT-1 — JWT algorithm must be hardcoded, not config-sourced.

An operator (or attacker with env write access) setting JWT_ALGORITHM=none
must NOT silently disable signature verification. The accepted-algorithm list
is a security invariant and must never come from config.
"""

import jwt

from app.core.config import get_settings
from app.services.auth import create_access_token, decode_token

settings = get_settings()


class TestJwtAlgorithmHardcoded:
    """CRIT-1 guard: decode only accepts HS256, regardless of settings."""

    def test_decode_rejects_none_algorithm(self):
        """A token signed with alg=none must be rejected."""
        unsigned = jwt.encode({"sub": "attacker"}, "", algorithm="none")
        assert decode_token(unsigned) is None

    def test_decode_rejects_hs512_token(self):
        """Only HS256 is accepted. An HS512 token (even forged with the
        real secret) must be rejected — the algorithm whitelist is the
        security boundary, not the secret."""
        token = jwt.encode({"sub": "attacker"}, settings.jwt_secret, algorithm="HS512")
        assert decode_token(token) is None

    def test_encode_uses_hs256_regardless_of_setting(self, monkeypatch):
        """Even if settings.jwt_algorithm is mutated at runtime to an
        insecure value, encode must still emit HS256."""
        monkeypatch.setattr(settings, "jwt_algorithm", "none", raising=False)
        token = create_access_token({"sub": "alice"})
        header = jwt.get_unverified_header(token)
        assert header["alg"] == "HS256"

    def test_decode_accepts_valid_hs256(self):
        """Sanity: a legitimate HS256 token still decodes."""
        token = create_access_token({"sub": "alice"})
        td = decode_token(token)
        assert td is not None
        assert td.username == "alice"

    def test_decode_rejects_none_alg_even_if_setting_mutated(self, monkeypatch):
        """Even if an attacker could flip settings.jwt_algorithm to 'none'
        at runtime, the decode path must still reject unsigned tokens."""
        monkeypatch.setattr(settings, "jwt_algorithm", "none", raising=False)
        unsigned = jwt.encode({"sub": "attacker"}, "", algorithm="none")
        assert decode_token(unsigned) is None
