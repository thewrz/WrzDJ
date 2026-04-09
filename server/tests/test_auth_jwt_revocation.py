"""TDD guard for CRIT-2 — JWT revocation via token_version.

Before the fix, JWTs had no revocation mechanism. A stolen token was
valid for the full 24-hour TTL, regardless of password change, logout,
or role demotion. No jti, no token_version, no deny-list.

The fix embeds a `tv` (token_version) claim in every JWT. On decode,
the claim is compared against the user's `token_version` column. A
POST /api/auth/logout bumps the counter, invalidating all outstanding
tokens for that user.

See docs/security/audit-2026-04-08.md CRIT-2.
"""

import jwt
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.user import User
from app.services.auth import _JWT_ALGORITHM

settings = get_settings()


class TestJwtTokenVersion:
    """CRIT-2 guard: JWTs must be revocable via token_version."""

    def test_fresh_login_includes_token_version_claim(
        self,
        client: TestClient,
        test_user: User,
    ):
        """Every JWT must carry a 'tv' claim matching the user's token_version."""
        resp = client.post(
            "/api/auth/login",
            data={"username": "testuser", "password": "testpassword123"},
        )
        assert resp.status_code == 200
        token = resp.json()["access_token"]
        claims = jwt.decode(token, settings.jwt_secret, algorithms=[_JWT_ALGORITHM])
        assert "tv" in claims, "JWT must include 'tv' (token_version) claim"
        assert claims["tv"] == 0

    def test_logout_invalidates_existing_token(
        self,
        client: TestClient,
        test_user: User,
    ):
        """After calling /api/auth/logout, that same token must be rejected."""
        login = client.post(
            "/api/auth/login",
            data={"username": "testuser", "password": "testpassword123"},
        )
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Token works before logout
        assert client.get("/api/auth/me", headers=headers).status_code == 200

        # Logout bumps token_version
        resp = client.post("/api/auth/logout", headers=headers)
        assert resp.status_code == 200

        # Same token no longer works
        assert client.get("/api/auth/me", headers=headers).status_code == 401

    def test_old_token_rejected_after_db_version_bump(
        self,
        client: TestClient,
        test_user: User,
        db: Session,
    ):
        """Server-side bump of token_version (e.g., admin force-logout)
        must invalidate all outstanding tokens for that user."""
        login = client.post(
            "/api/auth/login",
            data={"username": "testuser", "password": "testpassword123"},
        )
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Bump directly in DB (simulates admin action)
        user = db.query(User).filter(User.username == "testuser").first()
        user.token_version += 1
        db.commit()

        resp = client.get("/api/auth/me", headers=headers)
        assert resp.status_code == 401

    def test_token_without_tv_claim_rejected(
        self,
        client: TestClient,
        test_user: User,
    ):
        """Legacy tokens (without tv claim) from a pre-fix build
        must be rejected after deployment."""
        legacy = jwt.encode(
            {"sub": "testuser"},
            settings.jwt_secret,
            algorithm=_JWT_ALGORITHM,
        )
        resp = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {legacy}"},
        )
        assert resp.status_code == 401

    def test_new_login_after_logout_works(
        self,
        client: TestClient,
        test_user: User,
    ):
        """After logout, a fresh login must produce a valid token."""
        login1 = client.post(
            "/api/auth/login",
            data={"username": "testuser", "password": "testpassword123"},
        )
        headers1 = {"Authorization": f"Bearer {login1.json()['access_token']}"}

        # Logout first session
        client.post("/api/auth/logout", headers=headers1)

        # Login again
        login2 = client.post(
            "/api/auth/login",
            data={"username": "testuser", "password": "testpassword123"},
        )
        assert login2.status_code == 200
        headers2 = {"Authorization": f"Bearer {login2.json()['access_token']}"}

        # New token works
        assert client.get("/api/auth/me", headers=headers2).status_code == 200

        # Old token still doesn't
        assert client.get("/api/auth/me", headers=headers1).status_code == 401
