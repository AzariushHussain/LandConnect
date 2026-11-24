from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models import ConversationMember, MeetingMember, MeetingMemberStatus
from tests.history_fixtures import seed_history


def test_history_combines_private_direct_and_group_calls_with_stable_pagination(auth_client):
    client, engine = auth_client
    data = seed_history(engine)
    headers = {"Authorization": "Bearer " + create_access_token(data.users[0])[0]}
    response = client.get("/calls/history", headers=headers)
    assert response.status_code == 200 and response.headers["Cache-Control"] == "no-store"
    rows = response.json()["items"]
    assert [row["id"] for row in rows] == [str(data.missed), str(data.group_call), str(data.direct)]
    assert rows[0]["direction"] == "incoming" and rows[-1]["direction"] == "outgoing"
    assert rows[1]["source"] == "group" and rows[1]["peer"] is None
    assert set(rows[0]["peer"]) == {"id", "display_name", "role"}
    assert "members" not in rows[1] and "token" not in str(rows)
    for offset, expected in enumerate((data.missed, data.group_call, data.direct)):
        page = client.get(f"/calls/history?limit=1&offset={offset}", headers=headers).json()
        assert page["items"][0]["id"] == str(expected)
        assert page["has_more"] == (offset < 2)
    assert client.get("/calls/history?missed_only=true", headers=headers).json()["items"] == [
        rows[0]
    ]


def test_history_requires_auth_and_current_group_access(auth_client):
    client, engine = auth_client
    data = seed_history(engine)
    assert client.get("/calls/history").status_code == 401
    headers = {"Authorization": "Bearer " + create_access_token(data.users[1])[0]}
    assert str(data.group_call) in {
        row["id"] for row in client.get("/calls/history", headers=headers).json()["items"]
    }
    with Session(engine) as db:
        member = db.get(MeetingMember, (data.group_call, data.users[1]))
        member.status = MeetingMemberStatus.declined
        db.commit()
    assert str(data.group_call) not in {
        row["id"] for row in client.get("/calls/history", headers=headers).json()["items"]
    }
    with Session(engine) as db:
        db.get(
            MeetingMember, (data.group_call, data.users[1])
        ).status = MeetingMemberStatus.accepted
        db.delete(db.get(ConversationMember, (data.group, data.users[1])))
        db.commit()
    assert str(data.group_call) not in {
        row["id"] for row in client.get("/calls/history", headers=headers).json()["items"]
    }
    stranger = {"Authorization": "Bearer " + create_access_token(data.users[2])[0]}
    assert [
        row["id"] for row in client.get("/calls/history", headers=stranger).json()["items"]
    ] == [str(data.unrelated)]
    assert client.get("/calls/history?offset=-1", headers=headers).status_code == 422
