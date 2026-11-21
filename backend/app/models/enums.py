from enum import StrEnum


class Role(StrEnum):
    buyer = "buyer"
    seller = "seller"
    broker = "broker"


class ConversationKind(StrEnum):
    direct = "direct"
    group = "group"


class MemberRole(StrEnum):
    member = "member"
    admin = "admin"


class ListingStatus(StrEnum):
    draft = "draft"
    active = "active"
    sold = "sold"
    archived = "archived"


class CallKind(StrEnum):
    audio = "audio"
    video = "video"


class CallStatus(StrEnum):
    ringing = "ringing"
    accepted = "accepted"
    rejected = "rejected"
    cancelled = "cancelled"
    missed = "missed"
    ended = "ended"
