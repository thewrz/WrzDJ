"""Add integration toggle columns to system_settings.

Revision ID: 019
Revises: 018
"""

import sqlalchemy as sa

from alembic import op

revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "system_settings",
        sa.Column("spotify_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "system_settings",
        sa.Column("tidal_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "system_settings",
        sa.Column("beatport_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "system_settings",
        sa.Column("bridge_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("system_settings", "bridge_enabled")
    op.drop_column("system_settings", "beatport_enabled")
    op.drop_column("system_settings", "tidal_enabled")
    op.drop_column("system_settings", "spotify_enabled")
