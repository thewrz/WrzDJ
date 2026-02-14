"""Add activity_log table.

Revision ID: 023
"""

import sqlalchemy as sa

from alembic import op

revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activity_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("level", sa.String(10), nullable=False),
        sa.Column("source", sa.String(30), nullable=False),
        sa.Column("message", sa.String(500), nullable=False),
        sa.Column("event_code", sa.String(10), nullable=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_activity_log_created_at", "activity_log", ["created_at"])
    op.create_index("ix_activity_log_event_code", "activity_log", ["event_code"])


def downgrade() -> None:
    op.drop_index("ix_activity_log_event_code")
    op.drop_index("ix_activity_log_created_at")
    op.drop_table("activity_log")
