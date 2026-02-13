"""Add beatport_subscription to users.

Revision ID: 017
Revises: 016
"""

import sqlalchemy as sa

from alembic import op

revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("beatport_subscription", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "beatport_subscription")
