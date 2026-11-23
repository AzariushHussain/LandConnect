import uuid
from datetime import timedelta
from types import SimpleNamespace

import jwt
import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.main import app
from app.models import ChatOutbox, Meeting, MeetingMember, MeetingMemberStatus, Role, User
from app.models.common import now
from app.schemas.meeting import MeetingCreate
from app.services import meetings
from app.services.meeting_worker import maintain_meetings
from tests.fakes import FakeRooms


@pytest.fixture
def people(auth_client):
    from app.core.security import create_access_token

    client, engine = auth_client
    ids, headers = {}, {}
    with Session(engine, expire_on_commit=False) as db:
        for name in ("a", "b", "c", "d"):
            user = User(
                email=name + "@example.com",
                display_name=name,
                role=Role.buyer,
                password_hash="unused",
            )
            db.add(user)
            db.flush()
            ids[name] = str(user.id)
            headers[name] = {"Authorization": "Bearer " + create_access_token(user.id)[0]}
        db.commit()
    rooms = FakeRooms(get_settings())
    app.state.calls.rooms = rooms
    return SimpleNamespace(client=client, engine=engine, ids=ids, headers=headers, rooms=rooms)


def create(p, kind="video", client_id=None):
    return p.client.post(
        "/meetings",
        headers=p.headers["a"],
        json={
            "title": " Land discussion ",
            "kind": kind,
            "client_id": client_id or str(uuid.uuid4()),
            "member_ids": [p.ids["b"], p.ids["c"]],
        },
    )


def act(p, meeting_id, action, actor="a"):
    return p.client.post(f"/meetings/{meeting_id}/{action}", headers=p.headers[actor])


def invite(p, meeting_id, actor="a", target="d"):
    return p.client.post(
        f"/meetings/{meeting_id}/members", headers=p.headers[actor], json={"user_id": p.ids[target]}
    )


def remove(p, meeting_id, target="b", actor="a"):
    return p.client.delete(
        f"/meetings/{meeting_id}/members/{p.ids[target]}", headers=p.headers[actor]
    )


def chat_group(p):
    response = p.client.post(
        "/conversations/groups",
        headers=p.headers["a"],
        json={"name": "Site team", "member_ids": [p.ids["b"], p.ids["c"]]},
    )
    assert response.status_code == 201
    return response.json()["id"]


def dial_group(p, gid, actor="a", kind="video", client_id=None):
    return p.client.post(
        f"/conversations/{gid}/calls",
        headers=p.headers[actor],
        json={"kind": kind, "client_id": client_id or str(uuid.uuid4())},
    )


def test_group_call_derives_members_and_reuses_one_active_call(people):
    p = people
    gid, attempt = chat_group(p), str(uuid.uuid4())
    response = dial_group(p, gid, client_id=attempt)
    assert response.status_code == 201, response.text
    call = response.json()
    assert call["conversation_id"] == gid and call["title"] == "Site team"
    assert {m["user"]["id"] for m in call["members"]} == {p.ids[k] for k in ("a", "b", "c")}
    assert next(m for m in call["members"] if m["user"]["id"] == p.ids["a"])["status"] == "accepted"
    assert dial_group(p, gid, client_id=attempt).json()["id"] == call["id"]
    joined = dial_group(p, gid, actor="b")
    assert joined.status_code == 200 and joined.json()["id"] == call["id"]
    assert dial_group(p, gid, kind="audio").status_code == 409
    assert act(p, call["id"], "token", "b").status_code == 403
    assert act(p, call["id"], "accept", "b").status_code == 200
    assert act(p, call["id"], "token", "b").status_code == 200
    assert dial_group(p, gid, actor="d").status_code == 404
    assert invite(p, call["id"]).status_code == 403
    assert act(p, call["id"], "end").status_code == 200
    fresh = dial_group(p, gid, kind="audio")
    assert fresh.status_code == 201 and fresh.json()["id"] != call["id"]
    assert dial_group(p, gid, client_id=attempt).json()["ended_at"] is not None


def test_group_call_checks_privacy_and_rejects_direct_conversation(people):
    p = people
    gid = chat_group(p)
    with Session(p.engine) as db:
        db.get(User, uuid.UUID(p.ids["b"])).allow_calls = False
        db.commit()
    assert dial_group(p, gid).status_code == 403
    direct = p.client.post(
        "/conversations/direct", headers=p.headers["a"], json={"recipient_id": p.ids["b"]}
    ).json()["id"]
    assert dial_group(p, direct).status_code == 409


def test_group_removal_revokes_call_tokens_and_rotates_issued_room(people):
    p = people
    gid = chat_group(p)
    mid = dial_group(p, gid).json()["id"]
    assert act(p, mid, "accept", "b").status_code == 200
    assert act(p, mid, "token", "b").status_code == 200
    removed = p.client.delete(f"/conversations/{gid}/members/{p.ids['b']}", headers=p.headers["a"])
    assert removed.status_code == 204
    assert act(p, mid, "token", "b").status_code == 404
    assert p.client.get(f"/meetings/{mid}", headers=p.headers["b"]).status_code == 404
    detail = p.client.get(f"/meetings/{mid}", headers=p.headers["a"]).json()
    assert detail["room_version"] == 2 and detail["media_cleanup_pending"]
    maintain_meetings(lambda: Session(p.engine), p.rooms)
    assert act(p, mid, "token").status_code == 200


def test_group_call_initiator_removal_ends_the_call(people):
    p = people
    gid = chat_group(p)
    mid = dial_group(p, gid, actor="b").json()["id"]
    response = p.client.delete(f"/conversations/{gid}/members/{p.ids['b']}", headers=p.headers["a"])
    assert response.status_code == 204
    assert p.client.get(f"/meetings/{mid}", headers=p.headers["a"]).json()["ended_at"] is not None


def test_unanswered_group_call_expires_before_accept_and_in_worker(people):
    p = people
    gid = chat_group(p)
    mid = dial_group(p, gid).json()["id"]
    with Session(p.engine) as db:
        db.get(Meeting, uuid.UUID(mid)).created_at = now() - timedelta(seconds=121)
        db.commit()
    assert act(p, mid, "accept", "b").status_code == 409
    assert p.client.get(f"/meetings/{mid}", headers=p.headers["a"]).json()["ended_at"] is not None
    next_id = dial_group(p, gid).json()["id"]
    with Session(p.engine) as db:
        db.get(Meeting, uuid.UUID(next_id)).created_at = now() - timedelta(seconds=121)
        db.commit()
    maintain_meetings(lambda: Session(p.engine), p.rooms)
    assert (
        p.client.get(f"/meetings/{next_id}", headers=p.headers["a"]).json()["ended_at"] is not None
    )


def test_private_creation_retry_and_member_lists(people):
    p = people
    client_id = str(uuid.uuid4())
    first = create(p, client_id=client_id)
    assert first.status_code == 201 and first.json()["title"] == "Land discussion"
    mid = first.json()["id"]
    assert "@example.com" not in first.text and "retiring_room_name" not in first.json()
    assert first.headers["cache-control"] == "no-store"
    assert create(p, client_id=client_id).json()["id"] == mid
    assert create(p, "audio", client_id).status_code == 409
    assert (
        p.client.get("/meetings?invitation=invited", headers=p.headers["b"]).json()["items"][0][
            "id"
        ]
        == mid
    )
    assert p.client.get("/meetings", headers=p.headers["d"]).json()["items"] == []
    assert p.client.get(f"/meetings/{mid}", headers=p.headers["d"]).status_code == 404
    assert act(p, mid, "token", "d").status_code == 404
    assert p.client.get("/meetings").status_code == 401
    assert invite(p, mid).status_code == 200
    assert create(p, client_id=client_id).status_code == 200


@pytest.mark.parametrize(
    "kind,sources", [("audio", ["microphone"]), ("video", ["microphone", "camera"])]
)
def test_consent_and_scoped_tokens(people, kind, sources):
    p = people
    mid = create(p, kind).json()["id"]
    assert act(p, mid, "token", "b").status_code == 403
    assert act(p, mid, "accept", "b").status_code == 200
    assert act(p, mid, "accept", "b").status_code == 200
    a = act(p, mid, "token").json()
    b = act(p, mid, "token", "b").json()
    assert a["room"] == b["room"] == f"meeting-{mid}-1"
    claims = jwt.decode(b["token"], get_settings().livekit_api_secret, algorithms=["HS256"])
    assert claims["sub"] == p.ids["b"]
    assert claims["video"]["canPublishSources"] == sources
    assert claims["video"]["roomAdmin"] is False and claims["video"]["roomCreate"] is False
    assert claims["video"]["canPublishData"] is False


def test_owner_permissions_decline_and_reinvitation(people):
    p = people
    mid = create(p).json()["id"]
    assert invite(p, mid, actor="b").status_code == 403
    assert act(p, mid, "end", "b").status_code == 403
    assert remove(p, mid, "c", "b").status_code == 403
    assert remove(p, mid, "a").status_code == 409
    assert act(p, mid, "decline").status_code == 409
    assert act(p, mid, "decline", "b").status_code == 204
    assert act(p, mid, "decline", "b").status_code == 204
    assert act(p, mid, "accept", "b").status_code == 404
    assert p.client.get(f"/meetings/{mid}", headers=p.headers["b"]).status_code == 404
    assert invite(p, mid, actor="a").status_code == 200
    assert (
        p.client.post(
            f"/meetings/{mid}/members", headers=p.headers["a"], json={"user_id": p.ids["b"]}
        ).status_code
        == 200
    )
    assert act(p, mid, "accept", "b").status_code == 200


def test_removal_rotates_media_and_keeps_old_tokens_out(people):
    p = people
    mid = create(p).json()["id"]
    for actor in ("b", "c"):
        act(p, mid, "accept", actor)
    old = act(p, mid, "token", "b").json()
    assert act(p, mid, "token").json()["room"] == old["room"]
    assert remove(p, mid, "b").status_code == 204
    assert old["room"] not in p.rooms.live
    assert act(p, mid, "token", "b").status_code == 404
    assert p.client.get(f"/meetings/{mid}", headers=p.headers["b"]).status_code == 404
    new = act(p, mid, "token").json()
    assert new["room"] == f"meeting-{mid}-2" and new["room"] != old["room"]
    assert act(p, mid, "token", "c").json()["room"] == new["room"]
    assert remove(p, mid, "b").status_code == 204
    assert act(p, mid, "token").json()["room"] == new["room"]


def test_removing_unissued_invitation_does_not_disconnect_others(people):
    p = people
    mid = create(p).json()["id"]
    room = act(p, mid, "token").json()["room"]
    assert remove(p, mid, "b").status_code == 204
    assert room in p.rooms.live and act(p, mid, "token").json()["room"] == room


def test_failed_rotation_blocks_new_tokens_until_worker_cleanup(people):
    p = people
    mid = create(p).json()["id"]
    act(p, mid, "accept", "b")
    old = act(p, mid, "token", "b").json()["room"]
    p.rooms.fail.add("close")
    assert remove(p, mid, "b").status_code == 202
    assert p.client.get(f"/meetings/{mid}", headers=p.headers["a"]).json()["media_cleanup_pending"]
    assert act(p, mid, "token").status_code == 503
    assert act(p, mid, "token", "b").status_code == 404
    maintain_meetings(sessionmaker(p.engine), p.rooms)
    assert old in p.rooms.live
    p.rooms.fail.clear()
    maintain_meetings(sessionmaker(p.engine), p.rooms)
    assert old not in p.rooms.live
    assert act(p, mid, "token").json()["room"] == f"meeting-{mid}-2"


def test_owner_end_retries_media_closure_and_cannot_reopen(people):
    p = people
    mid = create(p).json()["id"]
    room = act(p, mid, "token").json()["room"]
    p.rooms.fail.add("close")
    result = act(p, mid, "end")
    assert result.status_code == 200 and result.json()["media_cleanup_pending"]
    assert act(p, mid, "token").status_code == 409
    p.rooms.fail.clear()
    maintain_meetings(sessionmaker(p.engine), p.rooms)
    assert room not in p.rooms.live
    assert not act(p, mid, "end").json()["media_cleanup_pending"]


def test_leaving_preserves_invitation_and_room_access(people):
    p = people
    mid = create(p).json()["id"]
    act(p, mid, "accept", "b")
    room = act(p, mid, "token", "b").json()["room"]
    assert act(p, mid, "leave", "b").status_code == 204
    assert room in p.rooms.live
    assert act(p, mid, "token", "b").json()["room"] == room
    assert act(p, mid, "leave").status_code == 204
    assert p.client.get(f"/meetings/{mid}", headers=p.headers["a"]).json()["ended_at"] is None


@pytest.mark.parametrize(
    "blocker,target,removed", [("a", "b", "b"), ("b", "a", "b"), ("b", "c", "b")]
)
def test_blocks_revoke_affected_access_without_ending_everyones_meeting(
    people, blocker, target, removed
):
    p = people
    mid = create(p).json()["id"]
    act(p, mid, "accept", "b")
    old = act(p, mid, "token", "b").json()["room"]
    p.client.put("/users/me/blocks/" + p.ids[target], headers=p.headers[blocker])
    assert act(p, mid, "token", removed).status_code == 404
    maintain_meetings(sessionmaker(p.engine), p.rooms)
    assert old not in p.rooms.live
    assert act(p, mid, "token").json()["room"] == f"meeting-{mid}-2"


def test_incoming_preference_revokes_invites_but_owner_can_host(people):
    p = people
    mid = create(p).json()["id"]
    p.client.patch("/users/me/privacy", headers=p.headers["b"], json={"allow_calls": False})
    assert act(p, mid, "accept", "b").status_code == 404
    assert create(p).status_code == 403
    p.client.patch("/users/me/privacy", headers=p.headers["a"], json={"allow_calls": False})
    assert act(p, mid, "token").status_code == 200


def test_missing_room_ends_meeting_and_never_reuses_old_name(people):
    p = people
    mid = create(p).json()["id"]
    room = act(p, mid, "token").json()["room"]
    p.rooms.live.pop(room)
    assert act(p, mid, "token").status_code == 409
    assert act(p, mid, "token").status_code == 409


def test_worker_ignores_outage_and_single_participant_then_reconciles_room_loss(people):
    p = people
    mid = create(p).json()["id"]
    room = act(p, mid, "token").json()["room"]
    p.rooms.live[room].num_participants = 1
    maintain_meetings(sessionmaker(p.engine), p.rooms)
    assert p.client.get(f"/meetings/{mid}", headers=p.headers["a"]).json()["ended_at"] is None
    p.rooms.fail.add("list")
    maintain_meetings(sessionmaker(p.engine), p.rooms)
    assert p.client.get(f"/meetings/{mid}", headers=p.headers["a"]).json()["ended_at"] is None
    p.rooms.fail.clear()
    p.rooms.live.clear()
    maintain_meetings(sessionmaker(p.engine), p.rooms)
    assert p.client.get(f"/meetings/{mid}", headers=p.headers["a"]).json()["ended_at"]


def test_failed_creation_commit_keeps_meeting_and_event_atomic(people, monkeypatch):
    p = people
    with Session(p.engine) as db:

        def fail():
            raise SQLAlchemyError("test failure")

        monkeypatch.setattr(db, "commit", fail)
        with pytest.raises(SQLAlchemyError):
            meetings.create(
                db,
                uuid.UUID(p.ids["a"]),
                MeetingCreate(client_id=uuid.uuid4(), title="Test", member_ids=[p.ids["b"]]),
            )
    with Session(p.engine) as db:
        assert db.scalar(select(func.count(Meeting.id))) == 0
        assert db.scalar(select(func.count(ChatOutbox.id))) == 0


def test_meeting_capacity_counts_current_invitations(people):
    p = people
    mid = uuid.UUID(create(p).json()["id"])
    with Session(p.engine) as db:
        for i in range(47):
            user = User(
                email=f"limit{i}@example.com",
                display_name="Member",
                role=Role.buyer,
                password_hash="unused",
            )
            db.add(user)
            db.flush()
            db.add(
                MeetingMember(meeting_id=mid, user_id=user.id, status=MeetingMemberStatus.invited)
            )
        db.commit()
    assert invite(p, mid).status_code == 409


@pytest.mark.parametrize("change", [{"title": " "}, {"member_ids": []}, {"kind": "screen"}])
def test_invalid_meeting_inputs_are_rejected(people, change):
    p = people
    data = {"client_id": str(uuid.uuid4()), "title": "Meeting", "member_ids": [p.ids["b"]]} | change
    assert p.client.post("/meetings", headers=p.headers["a"], json=data).status_code == 422
