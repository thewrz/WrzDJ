"""Add pre-event collection columns + guest_profiles table.

Revision ID: 034
Revises: 033
"""

import sqlalchemy as sa

from alembic import op

revision = "034"
down_revision = "033"


def upgrade() -> None:
    # events columns
    op.add_column(
        "events",
        sa.Column("collection_opens_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "events",
        sa.Column("live_starts_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "events",
        sa.Column(
            "submission_cap_per_guest",
            sa.Integer(),
            nullable=False,
            server_default="15",
        ),
    )
    op.add_column(
        "events",
        sa.Column("collection_phase_override", sa.String(length=20), nullable=True),
    )

    # requests column
    op.add_column(
        "requests",
        sa.Column(
            "submitted_during_collection",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index(
        "ix_requests_submitted_during_collection",
        "requests",
        ["submitted_during_collection"],
    )

    # guest_profiles table
    op.create_table(
        "guest_profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "event_id",
            sa.Integer(),
            sa.ForeignKey("events.id"),
            nullable=False,
        ),
        sa.Column("client_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("nickname", sa.String(length=30), nullable=True),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column(
            "submission_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "event_id",
            "client_fingerprint",
            name="uq_guest_profile_event_fingerprint",
        ),
    )
    op.create_index("ix_guest_profiles_event_id", "guest_profiles", ["event_id"])
    op.create_index(
        "ix_guest_profiles_client_fingerprint",
        "guest_profiles",
        ["client_fingerprint"],
    )


def downgrade() -> None:
    op.drop_index("ix_guest_profiles_client_fingerprint", table_name="guest_profiles")
    op.drop_index("ix_guest_profiles_event_id", table_name="guest_profiles")
    op.drop_table("guest_profiles")
    op.drop_index("ix_requests_submitted_during_collection", table_name="requests")
    op.drop_column("requests", "submitted_during_collection")
    op.drop_column("events", "collection_phase_override")
    op.drop_column("events", "submission_cap_per_guest")
    op.drop_column("events", "live_starts_at")
    op.drop_column("events", "collection_opens_at")
