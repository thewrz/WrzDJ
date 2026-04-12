"""TDD guard for H-A4 — password fields must enforce max_length.

bcrypt silently truncates passwords to 72 bytes. Without max_length,
an attacker can submit arbitrarily large passwords (DoS via bcrypt
compute), and users with passwords >72 bytes get silently weaker security.

See docs/security/audit-2026-04-08.md H-A4.
"""

import pytest
from pydantic import ValidationError

from app.schemas.user import AdminUserCreate, AdminUserUpdate, RegisterRequest


class TestPasswordMaxLength:
    def test_admin_create_rejects_overlong_password(self):
        with pytest.raises(ValidationError, match="string_too_long|max_length"):
            AdminUserCreate(username="test", password="x" * 129)

    def test_admin_create_accepts_128_char_password(self):
        user = AdminUserCreate(username="test", password="x" * 128)
        assert len(user.password) == 128

    def test_admin_update_rejects_overlong_password(self):
        with pytest.raises(ValidationError, match="string_too_long|max_length"):
            AdminUserUpdate(password="x" * 129)

    def test_register_rejects_overlong_password(self):
        with pytest.raises(ValidationError, match="string_too_long|max_length"):
            RegisterRequest(
                username="test",
                email="t@t.com",
                password="x" * 129,
                confirm_password="x" * 129,
            )

    def test_register_accepts_128_char_password(self):
        req = RegisterRequest(
            username="testuser",
            email="t@t.com",
            password="x" * 128,
            confirm_password="x" * 128,
        )
        assert len(req.password) == 128
