"""Add mb_artist_cache table for MusicBrainz artist verification cache.

Caches artist name → MBID + verified boolean so repeated recommendation
runs don't re-query MusicBrainz for the same artists.

Revision ID: 021
Revises: 020
"""

import sqlalchemy as sa

from alembic import op

revision = "021"
down_revision = "020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mb_artist_cache",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("artist_name", sa.String(255), nullable=False),
        sa.Column("mbid", sa.String(36), nullable=True),
        sa.Column("verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_mb_artist_cache_artist_name", "mb_artist_cache", ["artist_name"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_mb_artist_cache_artist_name", table_name="mb_artist_cache")
    op.drop_table("mb_artist_cache")
