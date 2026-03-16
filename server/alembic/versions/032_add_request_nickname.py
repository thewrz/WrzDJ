"""Add nickname column to requests table.

Optional 30-char guest nickname per request, shown on DJ dashboard,
kiosk display, and guest request list.

Revision ID: 032
Revises: 031
"""

import sqlalchemy as sa

from alembic import op

revision = "032"
down_revision = "031"


def upgrade() -> None:
    op.add_column("requests", sa.Column("nickname", sa.String(30), nullable=True))


def downgrade() -> None:
    op.drop_column("requests", "nickname")
