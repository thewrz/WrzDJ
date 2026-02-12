"""Add raw_search_query and sync_results_json to requests table

Revision ID: 012
Revises: 011
Create Date: 2026-02-12 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "012"
down_revision: str | None = "011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "requests",
        sa.Column("raw_search_query", sa.String(200), nullable=True),
    )
    op.add_column(
        "requests",
        sa.Column("sync_results_json", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("requests", "sync_results_json")
    op.drop_column("requests", "raw_search_query")
