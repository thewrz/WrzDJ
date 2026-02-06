"""Add play_history table

Revision ID: 004
Revises: 003
Create Date: 2026-02-05 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "play_history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("event_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("artist", sa.String(length=255), nullable=False),
        sa.Column("album_art_url", sa.String(length=500), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("source_request_id", sa.Integer(), nullable=True),
        sa.Column("played_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_request_id"], ["requests.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_play_history_event_id", "play_history", ["event_id"])
    op.create_index("ix_play_history_played_at", "play_history", ["played_at"])
    op.create_index("ix_play_history_source_request_id", "play_history", ["source_request_id"])
    op.create_index("ix_play_history_event_played", "play_history", ["event_id", "played_at"])


def downgrade() -> None:
    op.drop_index("ix_play_history_event_played", table_name="play_history")
    op.drop_index("ix_play_history_source_request_id", table_name="play_history")
    op.drop_index("ix_play_history_played_at", table_name="play_history")
    op.drop_index("ix_play_history_event_id", table_name="play_history")
    op.drop_table("play_history")
