"""Bootstrap script to create initial admin user if configured."""

import sys

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.user import User
from app.services.auth import create_user


def bootstrap_admin() -> None:
    """Create admin user if no users exist and bootstrap credentials are set."""
    settings = get_settings()

    if not settings.bootstrap_admin_username or not settings.bootstrap_admin_password:
        print("Bootstrap: No admin credentials configured, skipping.")
        return

    db = SessionLocal()
    try:
        user_count = db.query(User).count()
        if user_count > 0:
            print(f"Bootstrap: {user_count} user(s) already exist, skipping.")
            return

        user = create_user(
            db, settings.bootstrap_admin_username, settings.bootstrap_admin_password, role="admin"
        )
        print(f"Bootstrap: Created admin user '{user.username}' with ID {user.id}")
    finally:
        db.close()


def main() -> None:
    try:
        bootstrap_admin()
    except Exception as e:
        print(f"Bootstrap error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
