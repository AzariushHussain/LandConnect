"""call lifecycle and media cleanup

Revision ID: 0003_calls
Revises: 0002_chat
Create Date: 2026-11-22 11:24:13.512020

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_calls"
down_revision: str | Sequence[str] | None = "0002_chat"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("calls", sa.Column("client_id", sa.Uuid(), nullable=True))
    op.add_column("calls", sa.Column("room_sid", sa.String(length=64), nullable=True))
    op.add_column("calls", sa.Column("room_closed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("calls", sa.Column("media_checked_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_calls_status_expires", "calls", ["status", "expires_at"], unique=False)
    op.create_index(
        "ix_calls_status_media_checked", "calls", ["status", "media_checked_at"], unique=False
    )
    op.create_unique_constraint("uq_calls_caller_client", "calls", ["caller_id", "client_id"])
    op.execute(
        sa.text(
            "UPDATE calls SET accepted_at = COALESCE(accepted_at, created_at) "
            "WHERE status = 'accepted'"
        )
    )
    op.execute(
        sa.text(
            "UPDATE calls SET room_closed_at = COALESCE(ended_at, created_at) "
            "WHERE status NOT IN ('ringing', 'accepted')"
        )
    )


def downgrade() -> None:
    """Downgrade schema."""
    if op.get_bind().scalar(
        sa.text(
            "SELECT count(*) FROM calls WHERE status IN ('ringing', 'accepted') "
            "OR (room_sid IS NOT NULL AND room_closed_at IS NULL)"
        )
    ):
        raise RuntimeError("Cannot downgrade while active calls or media cleanup remain")
    op.drop_constraint("uq_calls_caller_client", "calls", type_="unique")
    op.drop_index("ix_calls_status_media_checked", table_name="calls")
    op.drop_index("ix_calls_status_expires", table_name="calls")
    op.drop_column("calls", "media_checked_at")
    op.drop_column("calls", "room_closed_at")
    op.drop_column("calls", "room_sid")
    op.drop_column("calls", "client_id")
