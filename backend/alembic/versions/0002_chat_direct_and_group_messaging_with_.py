"""direct and group messaging with transactional outbox

Revision ID: 0002_chat
Revises: 0001_initial
Create Date: 2026-11-21 22:28:48.612103

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002_chat"
down_revision: str | Sequence[str] | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "chat_outbox",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event", sa.JSON(), nullable=False),
        sa.Column("recipient_ids", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_chat_outbox")),
    )
    op.create_index(
        "ix_chat_outbox_pending", "chat_outbox", ["published_at", "created_at"], unique=False
    )
    op.create_table(
        "conversation_members",
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "role",
            sa.Enum(
                "member", "admin", name="memberrole", native_enum=False, create_constraint=True
            ),
            nullable=False,
        ),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name=op.f("fk_conversation_members_conversation_id_conversations"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_conversation_members_user_id_users")
        ),
        sa.PrimaryKeyConstraint("conversation_id", "user_id", name=op.f("pk_conversation_members")),
    )
    op.create_index(
        op.f("ix_conversation_members_user_id"), "conversation_members", ["user_id"], unique=False
    )
    op.add_column(
        "conversations",
        sa.Column("kind", sa.String(length=6), server_default="direct", nullable=False),
    )
    op.add_column("conversations", sa.Column("name", sa.String(length=100), nullable=True))
    op.add_column("conversations", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.alter_column("conversations", "user_a_id", existing_type=sa.UUID(), nullable=True)
    op.alter_column("conversations", "user_b_id", existing_type=sa.UUID(), nullable=True)
    op.create_index(op.f("ix_conversations_owner_id"), "conversations", ["owner_id"], unique=False)
    op.create_foreign_key(
        op.f("fk_conversations_owner_id_users"), "conversations", "users", ["owner_id"], ["id"]
    )
    op.create_check_constraint(
        op.f("ck_conversations_conversationkind"), "conversations", "kind IN ('direct', 'group')"
    )
    op.create_check_constraint(
        op.f("ck_conversations_conversation_shape"),
        "conversations",
        "(kind = 'direct' AND user_a_id IS NOT NULL AND user_b_id IS NOT NULL "
        "AND owner_id IS NULL AND name IS NULL) OR "
        "(kind = 'group' AND user_a_id IS NULL AND user_b_id IS NULL "
        "AND owner_id IS NOT NULL AND name IS NOT NULL)",
    )
    op.execute(
        sa.text(
            "INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) "
            "SELECT id, user_a_id, 'member', created_at FROM conversations UNION ALL "
            "SELECT id, user_b_id, 'member', created_at FROM conversations"
        )
    )
    op.alter_column("conversations", "kind", server_default=None)
    op.add_column("messages", sa.Column("client_id", sa.Uuid(), nullable=True))
    op.create_unique_constraint(
        "uq_messages_conversation_sender_client",
        "messages",
        ["conversation_id", "sender_id", "client_id"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM conversations WHERE kind = 'group'")):
        raise RuntimeError("Cannot downgrade while group conversations exist")
    op.drop_constraint(op.f("ck_conversations_conversation_shape"), "conversations", type_="check")
    op.drop_constraint(op.f("ck_conversations_conversationkind"), "conversations", type_="check")
    op.drop_constraint("uq_messages_conversation_sender_client", "messages", type_="unique")
    op.drop_column("messages", "client_id")
    op.drop_constraint(op.f("fk_conversations_owner_id_users"), "conversations", type_="foreignkey")
    op.drop_index(op.f("ix_conversations_owner_id"), table_name="conversations")
    op.alter_column("conversations", "user_b_id", existing_type=sa.UUID(), nullable=False)
    op.alter_column("conversations", "user_a_id", existing_type=sa.UUID(), nullable=False)
    op.drop_column("conversations", "owner_id")
    op.drop_column("conversations", "name")
    op.drop_column("conversations", "kind")
    op.drop_index(op.f("ix_conversation_members_user_id"), table_name="conversation_members")
    op.drop_table("conversation_members")
    op.drop_index("ix_chat_outbox_pending", table_name="chat_outbox")
    op.drop_table("chat_outbox")
