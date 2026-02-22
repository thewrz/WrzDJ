"""Drop legacy tidal_track_id and tidal_sync_status from requests.

These columns are superseded by sync_results_json which stores per-service
sync results in a JSON array.

Revision ID: 029
Revises: 028
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "029"
down_revision = "028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("requests") as batch_op:
        batch_op.drop_column("tidal_track_id")
        batch_op.drop_column("tidal_sync_status")


def downgrade() -> None:
    with op.batch_alter_table("requests") as batch_op:
        batch_op.add_column(sa.Column("tidal_sync_status", sa.String(20), nullable=True))
        batch_op.add_column(sa.Column("tidal_track_id", sa.String(100), nullable=True))
