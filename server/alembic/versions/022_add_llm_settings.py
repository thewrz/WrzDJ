"""Add LLM settings to system_settings.

Revision ID: 022
"""

import sqlalchemy as sa

from alembic import op

revision = "022"
down_revision = "021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "system_settings",
        sa.Column("llm_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "llm_model",
            sa.String(100),
            nullable=False,
            server_default="claude-haiku-4-5-20251001",
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "llm_rate_limit_per_minute",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("3"),
        ),
    )


def downgrade() -> None:
    op.drop_column("system_settings", "llm_rate_limit_per_minute")
    op.drop_column("system_settings", "llm_model")
    op.drop_column("system_settings", "llm_enabled")
