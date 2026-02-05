"""Add archived_at field to events

Revision ID: 003
Revises: 002
Create Date: 2026-02-04 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("archived_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("events", "archived_at")
