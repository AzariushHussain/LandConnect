"""initial marketplace schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-21 16:00:14.019430

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001_initial"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=80), nullable=False),
        sa.Column(
            "role",
            sa.Enum(
                "buyer", "seller", "broker", name="role", native_enum=False, create_constraint=True
            ),
            nullable=False,
        ),
        sa.Column("allow_messages", sa.Boolean(), nullable=False),
        sa.Column("allow_calls", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )
    op.create_table(
        "blocks",
        sa.Column("blocker_id", sa.Uuid(), nullable=False),
        sa.Column("blocked_id", sa.Uuid(), nullable=False),
        sa.CheckConstraint("blocker_id != blocked_id", name=op.f("ck_blocks_not_self")),
        sa.ForeignKeyConstraint(
            ["blocked_id"], ["users.id"], name=op.f("fk_blocks_blocked_id_users")
        ),
        sa.ForeignKeyConstraint(
            ["blocker_id"], ["users.id"], name=op.f("fk_blocks_blocker_id_users")
        ),
        sa.PrimaryKeyConstraint("blocker_id", "blocked_id", name=op.f("pk_blocks")),
    )
    op.create_table(
        "calls",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("caller_id", sa.Uuid(), nullable=False),
        sa.Column("callee_id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum("audio", "video", name="callkind", native_enum=False, create_constraint=True),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "ringing",
                "accepted",
                "rejected",
                "cancelled",
                "missed",
                "ended",
                name="callstatus",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("caller_id != callee_id", name=op.f("ck_calls_not_self")),
        sa.ForeignKeyConstraint(["callee_id"], ["users.id"], name=op.f("fk_calls_callee_id_users")),
        sa.ForeignKeyConstraint(["caller_id"], ["users.id"], name=op.f("fk_calls_caller_id_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_calls")),
    )
    op.create_index(op.f("ix_calls_callee_id"), "calls", ["callee_id"], unique=False)
    op.create_index(op.f("ix_calls_caller_id"), "calls", ["caller_id"], unique=False)
    op.create_table(
        "conversations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_a_id", sa.Uuid(), nullable=False),
        sa.Column("user_b_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("user_a_id < user_b_id", name=op.f("ck_conversations_ordered_pair")),
        sa.ForeignKeyConstraint(
            ["user_a_id"], ["users.id"], name=op.f("fk_conversations_user_a_id_users")
        ),
        sa.ForeignKeyConstraint(
            ["user_b_id"], ["users.id"], name=op.f("fk_conversations_user_b_id_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_conversations")),
        sa.UniqueConstraint("user_a_id", "user_b_id", name=op.f("uq_conversations_user_a_id")),
    )
    op.create_index(
        op.f("ix_conversations_user_a_id"), "conversations", ["user_a_id"], unique=False
    )
    op.create_index(
        op.f("ix_conversations_user_b_id"), "conversations", ["user_b_id"], unique=False
    )
    op.create_table(
        "listings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=150), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("price", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("area_sq_m", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("address", sa.String(length=300), nullable=False),
        sa.Column("city", sa.String(length=100), nullable=False),
        sa.Column("state", sa.String(length=100), nullable=False),
        sa.Column("country", sa.String(length=2), nullable=False),
        sa.Column("latitude", sa.Numeric(precision=9, scale=6), nullable=False),
        sa.Column("longitude", sa.Numeric(precision=10, scale=6), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "draft",
                "active",
                "sold",
                "archived",
                name="listingstatus",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("area_sq_m > 0", name=op.f("ck_listings_positive_area")),
        sa.CheckConstraint("latitude BETWEEN -90 AND 90", name=op.f("ck_listings_latitude")),
        sa.CheckConstraint("longitude BETWEEN -180 AND 180", name=op.f("ck_listings_longitude")),
        sa.CheckConstraint("price > 0", name=op.f("ck_listings_positive_price")),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name=op.f("fk_listings_owner_id_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_listings")),
    )
    op.create_index(op.f("ix_listings_city"), "listings", ["city"], unique=False)
    op.create_index(op.f("ix_listings_owner_id"), "listings", ["owner_id"], unique=False)
    op.create_index(
        "ix_listings_status_created", "listings", ["status", "created_at"], unique=False
    )
    op.create_table(
        "meetings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=150), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name=op.f("fk_meetings_owner_id_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_meetings")),
    )
    op.create_index(op.f("ix_meetings_owner_id"), "meetings", ["owner_id"], unique=False)
    op.create_table(
        "listing_images",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("listing_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["listing_id"], ["listings.id"], name=op.f("fk_listing_images_listing_id_listings")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_listing_images")),
        sa.UniqueConstraint("filename", name=op.f("uq_listing_images_filename")),
    )
    op.create_index(
        op.f("ix_listing_images_listing_id"), "listing_images", ["listing_id"], unique=False
    )
    op.create_table(
        "meeting_members",
        sa.Column("meeting_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["meeting_id"], ["meetings.id"], name=op.f("fk_meeting_members_meeting_id_meetings")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_meeting_members_user_id_users")
        ),
        sa.PrimaryKeyConstraint("meeting_id", "user_id", name=op.f("pk_meeting_members")),
    )
    op.create_table(
        "messages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("sender_id", sa.Uuid(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name=op.f("fk_messages_conversation_id_conversations"),
        ),
        sa.ForeignKeyConstraint(
            ["sender_id"], ["users.id"], name=op.f("fk_messages_sender_id_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_messages")),
    )
    op.create_index(
        "ix_messages_conversation_id_id", "messages", ["conversation_id", "id"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_messages_conversation_id_id", table_name="messages")
    op.drop_table("messages")
    op.drop_table("meeting_members")
    op.drop_index(op.f("ix_listing_images_listing_id"), table_name="listing_images")
    op.drop_table("listing_images")
    op.drop_index(op.f("ix_meetings_owner_id"), table_name="meetings")
    op.drop_table("meetings")
    op.drop_index("ix_listings_status_created", table_name="listings")
    op.drop_index(op.f("ix_listings_owner_id"), table_name="listings")
    op.drop_index(op.f("ix_listings_city"), table_name="listings")
    op.drop_table("listings")
    op.drop_index(op.f("ix_conversations_user_b_id"), table_name="conversations")
    op.drop_index(op.f("ix_conversations_user_a_id"), table_name="conversations")
    op.drop_table("conversations")
    op.drop_index(op.f("ix_calls_caller_id"), table_name="calls")
    op.drop_index(op.f("ix_calls_callee_id"), table_name="calls")
    op.drop_table("calls")
    op.drop_table("blocks")
    op.drop_table("users")
