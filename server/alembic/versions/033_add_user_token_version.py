"""Add token_version column to users table.

SECURITY (CRIT-2): enables JWT revocation. Every JWT carries a `tv` claim
that must match the user's token_version. Bumping the version (via logout
or admin action) invalidates all outstanding tokens for that user.

Revision ID: 033
Revises: 032
"""

import sqlalchemy as sa

from alembic import op

revision = "033"
down_revision = "032"


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("users", "token_version")
