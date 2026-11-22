"""Invite-only meetings and secure room rotation.

Revision ID: 0004_meetings
Revises: 0003_calls
"""

import sqlalchemy as sa

from alembic import op

revision = "0004_meetings"
down_revision = "0003_calls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "meeting_members",
        sa.Column("status", sa.String(8), nullable=False, server_default="accepted"),
    )
    op.add_column("meeting_members", sa.Column("responded_at", sa.DateTime(timezone=True)))
    op.add_column("meeting_members", sa.Column("token_issued_at", sa.DateTime(timezone=True)))
    op.create_check_constraint(
        op.f("ck_meeting_members_meetingmemberstatus"),
        "meeting_members",
        "status IN ('invited', 'accepted', 'declined', 'removed')",
    )
    op.create_index("ix_meeting_members_user_status", "meeting_members", ["user_id", "status"])
    op.add_column("meetings", sa.Column("client_id", sa.Uuid()))
    op.add_column(
        "meetings", sa.Column("kind", sa.String(5), nullable=False, server_default="video")
    )
    op.add_column("meetings", sa.Column("initial_member_ids", sa.JSON()))
    op.add_column(
        "meetings", sa.Column("room_version", sa.Integer(), nullable=False, server_default="1")
    )
    op.add_column("meetings", sa.Column("room_sid", sa.String(64)))
    op.add_column("meetings", sa.Column("retiring_room_name", sa.String(150)))
    op.add_column("meetings", sa.Column("room_closed_at", sa.DateTime(timezone=True)))
    op.add_column("meetings", sa.Column("media_checked_at", sa.DateTime(timezone=True)))
    op.create_check_constraint(
        op.f("ck_meetings_callkind"), "meetings", "kind IN ('audio', 'video')"
    )
    op.create_check_constraint(
        op.f("ck_meetings_positive_room_version"), "meetings", "room_version >= 1"
    )
    op.create_index("ix_meetings_cleanup", "meetings", ["retiring_room_name"])
    op.create_index("ix_meetings_state_checked", "meetings", ["ended_at", "media_checked_at"])
    op.create_unique_constraint("uq_meetings_owner_client", "meetings", ["owner_id", "client_id"])
    op.execute(
        sa.text(
            "UPDATE meeting_members SET responded_at = meetings.created_at FROM meetings "
            "WHERE meeting_members.meeting_id = meetings.id"
        )
    )
    op.execute(
        sa.text(
            "INSERT INTO meeting_members (meeting_id, user_id, status, responded_at) "
            "SELECT id, owner_id, 'accepted', created_at FROM meetings "
            "ON CONFLICT (meeting_id, user_id) DO UPDATE SET status = 'accepted'"
        )
    )
    op.execute(sa.text("UPDATE meetings SET room_closed_at = ended_at WHERE ended_at IS NOT NULL"))
    op.alter_column("meeting_members", "status", server_default=None)
    op.alter_column("meetings", "kind", server_default=None)
    op.alter_column("meetings", "room_version", server_default=None)


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text(
            "SELECT count(*) FROM meetings WHERE ended_at IS NULL OR retiring_room_name IS NOT NULL"
        )
    ):
        raise RuntimeError("Cannot downgrade while open meetings or media cleanup remain")
    op.drop_constraint("uq_meetings_owner_client", "meetings", type_="unique")
    op.drop_constraint(op.f("ck_meetings_positive_room_version"), "meetings", type_="check")
    op.drop_constraint(op.f("ck_meetings_callkind"), "meetings", type_="check")
    op.drop_index("ix_meetings_state_checked", table_name="meetings")
    op.drop_index("ix_meetings_cleanup", table_name="meetings")
    for column in (
        "media_checked_at",
        "room_closed_at",
        "retiring_room_name",
        "room_sid",
        "room_version",
        "initial_member_ids",
        "kind",
        "client_id",
    ):
        op.drop_column("meetings", column)
    op.drop_index("ix_meeting_members_user_status", table_name="meeting_members")
    op.drop_constraint(
        op.f("ck_meeting_members_meetingmemberstatus"), "meeting_members", type_="check"
    )
    for column in ("token_issued_at", "responded_at", "status"):
        op.drop_column("meeting_members", column)
