"""Remove now_playing_request_id FK from events table.

The NowPlaying table (with matched_request_id) is now the single source
of truth for now-playing state.  The Event-level FK was "System A" and
is no longer needed.

Revision ID: 028
Revises: 027
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "028"
down_revision = "027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_constraint("fk_events_now_playing_request_id", type_="foreignkey")
        batch_op.drop_column("now_playing_request_id")
        batch_op.drop_column("now_playing_updated_at")


def downgrade() -> None:
    with op.batch_alter_table("events") as batch_op:
        batch_op.add_column(sa.Column("now_playing_updated_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("now_playing_request_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_events_now_playing_request_id",
            "requests",
            ["now_playing_request_id"],
            ["id"],
            ondelete="SET NULL",
        )
