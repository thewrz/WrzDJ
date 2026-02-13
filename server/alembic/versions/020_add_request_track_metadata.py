"""Add genre, bpm, musical_key columns to requests.

Stores track metadata from search sources (Beatport, Tidal) at request time
so the recommendation engine can use it without re-fetching.

Revision ID: 020
Revises: 019
"""

import sqlalchemy as sa

from alembic import op

revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("requests", sa.Column("genre", sa.String(100), nullable=True))
    op.add_column("requests", sa.Column("bpm", sa.Float(), nullable=True))
    op.add_column("requests", sa.Column("musical_key", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("requests", "musical_key")
    op.drop_column("requests", "bpm")
    op.drop_column("requests", "genre")
