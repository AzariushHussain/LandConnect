import uuid

from sqlalchemy import String, Uuid, case, cast, false, literal, null, or_, select, union_all
from sqlalchemy.orm import Session

from app.models import Call, CallStatus, ConversationMember, Meeting, MeetingMember, User
from app.models.enums import MeetingMemberStatus
from app.schemas.call_history import HistoryFilters, HistoryItem, HistoryPage


def history(db: Session, actor: uuid.UUID, filters: HistoryFilters) -> HistoryPage:
    peer_id = case((Call.caller_id == actor, Call.callee_id), else_=Call.caller_id)
    direct = (
        select(
            Call.id.label("id"),
            literal("direct").label("source"),
            User.display_name.label("title"),
            Call.kind.label("kind"),
            cast(Call.status, String).label("status"),
            case((Call.caller_id == actor, "outgoing"), else_="incoming").label("direction"),
            Call.created_at.label("created_at"),
            cast(null(), Uuid).label("conversation_id"),
            User.id.label("peer_id"),
            User.display_name.label("peer_name"),
            cast(User.role, String).label("peer_role"),
        )
        .join(User, User.id == peer_id)
        .where(or_(Call.caller_id == actor, Call.callee_id == actor))
    )
    group = (
        select(
            Meeting.id,
            literal("group"),
            Meeting.title,
            Meeting.kind,
            case((Meeting.ended_at.is_(None), "open"), else_="ended"),
            case((Meeting.owner_id == actor, "outgoing"), else_="incoming"),
            Meeting.created_at,
            Meeting.conversation_id,
            cast(null(), Uuid),
            cast(null(), String),
            cast(null(), String),
        )
        .join(MeetingMember, MeetingMember.meeting_id == Meeting.id)
        .join(
            ConversationMember,
            (ConversationMember.conversation_id == Meeting.conversation_id)
            & (ConversationMember.user_id == actor),
        )
        .where(
            Meeting.conversation_id.is_not(None),
            MeetingMember.user_id == actor,
            MeetingMember.status.in_((MeetingMemberStatus.invited, MeetingMemberStatus.accepted)),
        )
    )
    if filters.missed_only:
        direct = direct.where(Call.callee_id == actor, Call.status == CallStatus.missed)
        group = group.where(false())
    combined = union_all(direct, group).subquery()
    records = (
        db.execute(
            select(combined)
            .order_by(combined.c.created_at.desc(), combined.c.source, combined.c.id.desc())
            .offset(filters.offset)
            .limit(filters.limit + 1)
        )
        .mappings()
        .all()
    )
    items = [
        HistoryItem(
            id=row["id"],
            source=row["source"],
            title=row["title"],
            kind=row["kind"],
            status=row["status"],
            direction=row["direction"],
            created_at=row["created_at"],
            conversation_id=row["conversation_id"],
            peer=(
                {"id": row["peer_id"], "display_name": row["peer_name"], "role": row["peer_role"]}
                if row["source"] == "direct"
                else None
            ),
        )
        for row in records[: filters.limit]
    ]
    return HistoryPage(
        items=items,
        limit=filters.limit,
        offset=filters.offset,
        has_more=len(records) > filters.limit,
    )
