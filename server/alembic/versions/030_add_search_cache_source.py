"""Add source column to search_cache for multi-service caching.

Allows caching results from Spotify, Beatport, and other search providers
independently per query.

Revision ID: 030
Revises: 029
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "030"
down_revision = "029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("search_cache") as batch_op:
        batch_op.add_column(
            sa.Column("source", sa.String(20), nullable=False, server_default="spotify")
        )
        # Drop old unique index on query alone
        batch_op.drop_index("ix_search_cache_query")
        # Create composite unique index on (query, source)
        batch_op.create_index("ix_search_cache_query_source", ["query", "source"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("search_cache") as batch_op:
        batch_op.drop_index("ix_search_cache_query_source")
        batch_op.create_index("ix_search_cache_query", ["query"], unique=True)
        batch_op.drop_column("source")
