"""Add Tidal sync fields

Revision ID: 005
Revises: 004
Create Date: 2026-02-06 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "005"
down_revision: str | None = "004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # User Tidal OAuth tokens
    op.add_column(
        "users",
        sa.Column("tidal_access_token", sa.Text(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("tidal_refresh_token", sa.Text(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("tidal_token_expires_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("tidal_user_id", sa.String(100), nullable=True),
    )

    # Event Tidal playlist sync
    op.add_column(
        "events",
        sa.Column("tidal_playlist_id", sa.String(100), nullable=True),
    )
    op.add_column(
        "events",
        sa.Column("tidal_sync_enabled", sa.Boolean(), nullable=False, server_default="false"),
    )

    # Request Tidal track reference
    op.add_column(
        "requests",
        sa.Column("tidal_track_id", sa.String(100), nullable=True),
    )
    op.add_column(
        "requests",
        sa.Column("tidal_sync_status", sa.String(20), nullable=True),
    )


def downgrade() -> None:
    # Request
    op.drop_column("requests", "tidal_sync_status")
    op.drop_column("requests", "tidal_track_id")

    # Event
    op.drop_column("events", "tidal_sync_enabled")
    op.drop_column("events", "tidal_playlist_id")

    # User
    op.drop_column("users", "tidal_user_id")
    op.drop_column("users", "tidal_token_expires_at")
    op.drop_column("users", "tidal_refresh_token")
    op.drop_column("users", "tidal_access_token")
