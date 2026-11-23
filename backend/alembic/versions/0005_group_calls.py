"""Link SFU sessions to group conversations.

Revision ID: 0005_group_calls
Revises: 0004_meetings
"""

import sqlalchemy as sa

from alembic import op

revision = "0005_group_calls"
down_revision = "0004_meetings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("meetings", sa.Column("conversation_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_meetings_conversation_id_conversations",
        "meetings",
        "conversations",
        ["conversation_id"],
        ["id"],
    )
    op.create_index(
        "uq_group_call_open",
        "meetings",
        ["conversation_id"],
        unique=True,
        postgresql_where=sa.text("conversation_id IS NOT NULL AND ended_at IS NULL"),
    )


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text(
            "SELECT count(*) FROM meetings WHERE conversation_id IS NOT NULL "
            "AND (ended_at IS NULL OR retiring_room_name IS NOT NULL)"
        )
    ):
        raise RuntimeError("Cannot downgrade while group calls or their media cleanup remain")
    op.drop_index("uq_group_call_open", table_name="meetings")
    op.drop_constraint("fk_meetings_conversation_id_conversations", "meetings", type_="foreignkey")
    op.drop_column("meetings", "conversation_id")
