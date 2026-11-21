from enum import StrEnum


class Role(StrEnum):
    buyer = "buyer"
    seller = "seller"
    broker = "broker"


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
