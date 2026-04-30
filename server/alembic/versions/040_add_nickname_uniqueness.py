"""add per-event nickname uniqueness index

Revision ID: 040_nickname_unique
Revises: 039
Create Date: 2026-04-30
"""

from alembic import op

revision = "040_nickname_unique"
down_revision = "039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE UNIQUE INDEX uq_guest_profile_event_nickname "
        "ON guest_profiles (event_id, lower(nickname)) "
        "WHERE nickname IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_guest_profile_event_nickname")
