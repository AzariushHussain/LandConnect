from types import SimpleNamespace

from app.services.livekit import LiveKitRooms, MediaUnavailable, meeting_room_name


class FakeRooms(LiveKitRooms):
    def __init__(self, settings):
        super().__init__(settings)
        self.live = {}
        self.fail = set()
        self.deleted = []

    def create(self, call):
        if "create" in self.fail:
            raise MediaUnavailable
        self.live.setdefault(call.id, SimpleNamespace(sid="RM_" + call.id.hex, num_participants=0))
        return self.live[call.id].sid

    def close(self, call_id):
        if "close" in self.fail:
            raise MediaUnavailable
        self.deleted.append(call_id)
        self.live.pop(call_id, None)

    def list(self, ids):
        if "list" in self.fail:
            raise MediaUnavailable
        return {i: self.live[i] for i in ids if i in self.live}

    def create_meeting(self, meeting):
        if "create" in self.fail:
            raise MediaUnavailable
        name = meeting_room_name(meeting)
        self.live.setdefault(
            name,
            SimpleNamespace(
                sid="RM_" + meeting.id.hex + str(meeting.room_version), num_participants=0
            ),
        )
        return self.live[name].sid

    def close_named(self, name):
        if "close" in self.fail:
            raise MediaUnavailable
        self.deleted.append(name)
        self.live.pop(name, None)

    def list_named(self, names):
        if "list" in self.fail:
            raise MediaUnavailable
        return {name: self.live[name] for name in names if name in self.live}

    def leave_meeting(self, meeting, actor):
        if "leave" in self.fail:
            raise MediaUnavailable
