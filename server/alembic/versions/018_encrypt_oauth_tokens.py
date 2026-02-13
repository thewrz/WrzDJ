"""Encrypt existing plaintext OAuth tokens with Fernet.

Reads all non-null token values, encrypts them, and writes back.
The downgrade reverses this by decrypting back to plaintext.

Revision ID: 018
Revises: 017
"""

import sqlalchemy as sa

from alembic import op
from app.core.encryption import decrypt_value, encrypt_value

revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None

TOKEN_COLUMNS = [
    "tidal_access_token",
    "tidal_refresh_token",
]


def upgrade() -> None:
    conn = op.get_bind()
    users = conn.execute(sa.text("SELECT id, {} FROM users".format(", ".join(TOKEN_COLUMNS))))
    for row in users:
        updates = {}
        for col in TOKEN_COLUMNS:
            val = getattr(row, col, None)
            if val is not None:
                encrypted = encrypt_value(val)
                if encrypted != val:
                    updates[col] = encrypted
        if updates:
            set_clause = ", ".join(f"{col} = :{col}" for col in updates)
            conn.execute(
                sa.text(f"UPDATE users SET {set_clause} WHERE id = :id"),
                {**updates, "id": row.id},
            )


def downgrade() -> None:
    conn = op.get_bind()
    users = conn.execute(sa.text("SELECT id, {} FROM users".format(", ".join(TOKEN_COLUMNS))))
    for row in users:
        updates = {}
        for col in TOKEN_COLUMNS:
            val = getattr(row, col, None)
            if val is not None:
                decrypted = decrypt_value(val)
                if decrypted != val:
                    updates[col] = decrypted
        if updates:
            set_clause = ", ".join(f"{col} = :{col}" for col in updates)
            conn.execute(
                sa.text(f"UPDATE users SET {set_clause} WHERE id = :id"),
                {**updates, "id": row.id},
            )
