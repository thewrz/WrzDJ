"""Add beatport_playlist_id to events.

Revision ID: 016
Revises: 015
"""

import sqlalchemy as sa

from alembic import op

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("beatport_playlist_id", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("events", "beatport_playlist_id")
