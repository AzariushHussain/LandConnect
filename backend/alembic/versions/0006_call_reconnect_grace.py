"""Persist a reconnect grace period for accepted calls.

Revision ID: 0006_call_reconnect
Revises: 0005_group_calls
"""

import sqlalchemy as sa

from alembic import op

revision = "0006_call_reconnect"
down_revision = "0005_group_calls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "calls", sa.Column("media_missing_since", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM calls WHERE status = 'accepted'")):
        raise RuntimeError("Cannot downgrade while active calls remain")
    op.drop_column("calls", "media_missing_since")
