"""Encrypt beatport OAuth state columns at rest.

Changes beatport_oauth_state (String 64) and beatport_oauth_code_verifier
(String 128) to Text to accommodate Fernet ciphertext.  Existing plaintext
values are NULLed (they represent abandoned OAuth flows).

Revision ID: 027
Revises: 026
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "027"
down_revision = "026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # NULL any leftover plaintext values (abandoned OAuth flows)
    op.execute("UPDATE users SET beatport_oauth_state = NULL, beatport_oauth_code_verifier = NULL")

    # Widen columns from String(64)/String(128) to Text for Fernet ciphertext
    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column(
            "beatport_oauth_state",
            existing_type=sa.String(64),
            type_=sa.Text(),
            existing_nullable=True,
        )
        batch_op.alter_column(
            "beatport_oauth_code_verifier",
            existing_type=sa.String(128),
            type_=sa.Text(),
            existing_nullable=True,
        )


def downgrade() -> None:
    # NULL encrypted values before narrowing columns
    op.execute("UPDATE users SET beatport_oauth_state = NULL, beatport_oauth_code_verifier = NULL")

    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column(
            "beatport_oauth_code_verifier",
            existing_type=sa.Text(),
            type_=sa.String(128),
            existing_nullable=True,
        )
        batch_op.alter_column(
            "beatport_oauth_state",
            existing_type=sa.Text(),
            type_=sa.String(64),
            existing_nullable=True,
        )
