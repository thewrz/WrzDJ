"""Add ListenBrainz popularity columns to mb_artist_cache and expire all rows.

Adds lb_listen_count and lb_user_count nullable Integer columns for caching
ListenBrainz popularity data. Expires all existing cache rows by setting
created_at to epoch so the TTL mechanism forces re-verification with the
new disambiguation and LB checks.

Revision ID: 031
Revises: 030
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "031"
down_revision = "030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("mb_artist_cache") as batch_op:
        batch_op.add_column(sa.Column("lb_listen_count", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("lb_user_count", sa.Integer(), nullable=True))

    # Expire all cached rows so they get re-verified with new checks
    op.execute(sa.text("UPDATE mb_artist_cache SET created_at = '2000-01-01T00:00:00'"))


def downgrade() -> None:
    with op.batch_alter_table("mb_artist_cache") as batch_op:
        batch_op.drop_column("lb_user_count")
        batch_op.drop_column("lb_listen_count")
