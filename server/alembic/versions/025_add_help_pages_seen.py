"""Add help_pages_seen to users table

Revision ID: 025
Revises: 024
Create Date: 2026-02-16 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "025"
down_revision: str | None = "024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("help_pages_seen", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "help_pages_seen")
