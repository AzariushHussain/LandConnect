import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient, ApiError } from '../src/api/client';
import { Meeting, meetingDto, MeetingsApi } from '../src/features/meetings/api';
import { MeetingCreation } from '../src/features/meetings/creation';
import { MeetingsInbox } from '../src/features/meetings/inbox';
import { MeetingSession } from '../src/features/meetings/session';
import { CallController } from '../src/features/calls/controller';
import { actor, other, person, third } from './fixtures/chat';
import { deferred, listingId } from './fixtures/listings';

const id = listingId(600),
  clientId = listingId(601);
const meeting = (version = 1): Meeting => ({
  id,
  client_id: clientId,
  owner: person(actor),
  title: 'Land discussion',
  kind: 'video',
  created_at: '2026-11-23T00:00:00Z',
  ended_at: null,
  room_version: version,
  media_cleanup_pending: false,
  members: [
    { user: person(actor), status: 'accepted' },
    { user: person(other), status: 'invited' },
  ],
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function apiFixture(fetcher: typeof fetch) {
  let token = 'captured';
  const rejected: string[] = [];
  const api = new MeetingsApi(new ApiClient('https://api.example.com', fetcher), {
    access: () => ({
      token,
      user: { ...person(), email: '', allow_calls: true, allow_messages: true, created_at: '' },
    }),
    checkExpiry() {},
    async rejectToken(value) {
      rejected.push(value);
    },
  });
  return {
    api,
    rejected,
    replace: () => {
      token = 'replacement';
    },
  };
}
function fixture(who = actor) {
  let server = meeting();
  const actions: string[] = [];
  const api = {
    list: async () => [] as Meeting[],
    detail: async () => server,
    accept: async () => {
      actions.push('accept');
      server.members = server.members.map((m) =>
        m.user.id === who ? { ...m, status: 'accepted' } : m,
      );
      return server;
    },
    invite: async () => server,
    remove: async () => {
      actions.push('remove');
      server = { ...server, room_version: server.room_version + 1, media_cleanup_pending: true };
    },
    decline: async () => {
      actions.push('decline');
    },
    leave: async () => {
      actions.push('leave');
    },
    end: async () => {
      actions.push('end');
      server = { ...server, ended_at: '2026-11-23T00:30:00Z' };
      return server;
    },
  };
  let callBusy = false;
  const state = new MeetingSession(
    api,
    () => who,
    () => callBusy,
  );
  state.foreground(true);
  return {
    api,
    state,
    actions,
    set: (value: Meeting) => {
      server = value;
    },
    callBusy: (value: boolean) => {
      callBusy = value;
    },
  };
}

test('meeting parser whitelists public members and allows historical removed/declined members', () => {
  const value = meetingDto(
    {
      ...meeting(),
      owner: { ...person(), email: 'private' },
      retiring_room_name: 'private',
      members: [...meeting().members, { user: person(third), status: 'removed' }],
    },
    actor,
  );
  assert.equal('email' in value.owner, false);
  assert.equal('retiring_room_name' in value, false);
  assert.equal(value.members.length, 3);
});
test('meeting DTO rejects invalid membership, owner, kind and room version', () => {
  for (const value of [
    { ...meeting(), room_version: 0 },
    { ...meeting(), kind: 'screen' },
    { ...meeting(), title: ' ' },
    { ...meeting(), owner: person(third) },
    { ...meeting(), members: [...meeting().members, meeting().members[0]] },
    { ...meeting(), members: [{ user: person(actor), status: 'declined' }] },
  ])
    assert.throws(() => meetingDto(value, actor));
  assert.throws(() => meetingDto(meeting(), third));
});
test('empty 202 and 204 meeting writes are successful authenticated requests', async () => {
  const requests: RequestInit[] = [];
  const f = apiFixture(async (_url, options) => {
    requests.push(options!);
    return new Response(null, { status: requests.length === 1 ? 202 : 204 });
  });
  await f.api.remove(id, other);
  await f.api.decline(id);
  await f.api.leave(id);
  assert.equal(requests[0]!.method, 'DELETE');
  assert.equal(new Headers(requests[0]!.headers).get('Authorization'), 'Bearer captured');
  assert.equal(requests.length, 3);
});
test('meeting token parsing refuses a retired room version', async () => {
  const f = apiFixture(
    async () =>
      new Response(
        JSON.stringify({
          url: 'wss://media.example.com',
          token: 'private',
          room: `meeting-${id}-2`,
          expires_in: 120,
        }),
      ),
  );
  await assert.rejects(f.api.token(id, 1), /verify media/);
  assert.equal((await f.api.token(id, 2)).room, `meeting-${id}-2`);
});
test('a replaced login cannot receive an old meeting response', async () => {
  const pending = deferred<Response>(),
    f = apiFixture(() => pending.promise);
  const read = f.api.detail(id);
  f.replace();
  pending.resolve(new Response(JSON.stringify(meeting())));
  await assert.rejects(read, /session changed/);
  assert.deepEqual(f.rejected, ['captured']);
});
test('creation retries freeze the UUID and initial title/kind/invitation snapshot', async () => {
  const pending = deferred<Meeting>(),
    attempts: unknown[] = [];
  const api = {
    create: async (attempt: unknown) => {
      attempts.push(structuredClone(attempt));
      if (attempts.length === 1) return pending.promise;
      return meeting();
    },
  };
  const create = new MeetingCreation(api, () => clientId);
  const first = create.submit(' Land discussion ', 'video', [other]);
  await create.submit('Different', 'audio', [third]);
  assert.equal(attempts.length, 1);
  pending.reject(new Error('Lost response'));
  await first;
  assert.ok(create.getSnapshot().attempt);
  await create.submit('Different', 'audio', [third]);
  assert.deepEqual(attempts[0], attempts[1]);
  assert.equal(create.getSnapshot().attempt, null);
});
test('a definitive creation rejection unlocks the meeting draft', async () => {
  const create = new MeetingCreation(
    {
      create: async () => {
        throw new ApiError(403, 'Privacy');
      },
    },
    () => clientId,
  );
  await create.submit('Meeting', 'audio', [other]);
  assert.equal(create.getSnapshot().attempt, null);
  assert.match(create.getSnapshot().error, /Privacy/);
});
test('meeting pagination advances by raw rows and deduplicates overlapping pages', async () => {
  const offsets: number[] = [];
  const first = Array.from({ length: 20 }, (_, n) => ({ ...meeting(), id: listingId(n + 100) }));
  const inbox = new MeetingsInbox({
    list: async (offset = 0) => {
      offsets.push(offset);
      return offset ? [first[19]!, { ...meeting(), id: listingId(120) }] : first;
    },
  });
  await inbox.refresh();
  await inbox.more();
  assert.deepEqual(offsets, [0, 20]);
  assert.equal(inbox.getSnapshot().items.length, 21);
  assert.equal(inbox.getSnapshot().next, 22);
});
test('changing meeting filters ignores the previous in-flight page', async () => {
  const pending = deferred<Meeting[]>();
  const inbox = new MeetingsInbox({
    list: async (_offset, status) => (status === 'open' ? pending.promise : []),
  });
  const read = inbox.refresh();
  inbox.filter('ended');
  await flush();
  pending.resolve([meeting()]);
  await read;
  assert.equal(inbox.getSnapshot().status, 'ended');
  assert.equal(inbox.getSnapshot().items.length, 0);
});
test('invited members must accept and explicitly join before media is authorized', async () => {
  const f = fixture(other);
  await f.state.select(id);
  await f.state.join();
  assert.equal(f.state.getSnapshot().joined, false);
  await f.state.change('accept');
  assert.equal(f.state.getSnapshot().joined, false);
  await f.state.join();
  assert.equal(f.state.getSnapshot().joined, true);
});
test('REST room rotation stops old media and requires explicit rejoin', async () => {
  const f = fixture();
  await f.state.select(id);
  await f.state.join();
  f.set(meeting(2));
  await f.state.refresh();
  assert.equal(f.state.getSnapshot().joined, false);
  assert.match(f.state.getSnapshot().notice, /room changed/);
  await f.state.join();
  assert.equal(f.state.getSnapshot().joined, true);
});
test('room-change hints remove media authorization before REST returns', async () => {
  const f = fixture();
  await f.state.select(id);
  await f.state.join();
  const pending = deferred<Meeting>();
  f.api.detail = () => pending.promise;
  f.state.hint({ type: 'meeting.room_changed', meeting_id: id, event_id: clientId });
  assert.equal(f.state.getSnapshot().joined, false);
  pending.resolve(meeting(2));
  await flush();
});
test('removal and inaccessible meetings clear the private detail snapshot', async () => {
  const f = fixture();
  await f.state.select(id);
  await f.state.join();
  f.api.detail = async () => {
    throw new ApiError(404, 'Removed');
  };
  f.state.hint({
    type: 'meeting.member_removed',
    meeting_id: id,
    event_id: clientId,
    target_user_id: actor,
  });
  await flush();
  assert.equal(f.state.getSnapshot().meeting, null);
  assert.equal(f.state.getSnapshot().joined, false);
});
test('failed verification disconnects local media without claiming the meeting ended', async () => {
  const f = fixture();
  await f.state.select(id);
  await f.state.join();
  f.api.detail = async () => {
    throw new Error('Offline');
  };
  await f.state.refresh();
  assert.equal(f.state.getSnapshot().joined, false);
  assert.equal(f.state.getSnapshot().meeting?.ended_at, null);
});
test('owner removal exposes cleanup pending and blocks rejoin', async () => {
  const f = fixture();
  await f.state.select(id);
  await f.state.join();
  assert.equal(await f.state.change('remove', other), true);
  assert.equal(f.state.getSnapshot().meeting?.media_cleanup_pending, true);
  await f.state.join();
  assert.equal(f.state.getSnapshot().joined, false);
});
test('leaving media retains accepted access while withdrawing consent removes it', async () => {
  const f = fixture(other);
  await f.state.select(id);
  await f.state.change('accept');
  await f.state.join();
  await f.state.change('leave');
  assert.equal(f.state.getSnapshot().meeting?.members[1]?.status, 'accepted');
  await f.state.join();
  assert.equal(f.state.getSnapshot().joined, true);
  await f.state.change('decline');
  assert.equal(f.state.getSnapshot().meeting, null);
  assert.deepEqual(f.actions, ['accept', 'leave', 'decline']);
});
test('only the owner can end/remove; owner cannot withdraw their own consent', async () => {
  const member = fixture(other);
  await member.state.select(id);
  assert.equal(await member.state.change('end'), false);
  assert.equal(await member.state.change('remove', actor), false);
  const host = fixture();
  await host.state.select(id);
  assert.equal(await host.state.change('decline'), false);
  assert.equal(await host.state.change('end'), true);
  assert.ok(host.state.getSnapshot().meeting?.ended_at);
});
test('backgrounding leaves media and never automatically republishes on return', async () => {
  const f = fixture();
  await f.state.select(id);
  await f.state.join();
  f.state.foreground(false);
  await flush();
  assert.deepEqual(f.actions, ['leave']);
  f.state.foreground(true);
  await flush();
  assert.equal(f.state.getSnapshot().joined, false);
});
test('session reset rejects late meeting reads', async () => {
  const f = fixture(),
    pending = deferred<Meeting>();
  f.api.detail = () => pending.promise;
  const read = f.state.select(id);
  f.state.reset();
  pending.resolve(meeting());
  await read;
  assert.equal(f.state.getSnapshot().meeting, null);
  assert.equal(f.state.getSnapshot().id, null);
});
test('a live meeting cannot silently switch to a different detail/media session', async () => {
  const f = fixture();
  await f.state.select(id);
  await f.state.join();
  await f.state.select(listingId(700));
  assert.equal(f.state.getSnapshot().id, id);
  assert.equal(f.state.getSnapshot().joined, true);
});
test('meeting and direct-call controllers enforce mutual local media exclusion', async () => {
  const f = fixture();
  await f.state.select(id);
  f.callBusy(true);
  await f.state.join();
  assert.equal(f.state.getSnapshot().joined, false);
  let creates = 0;
  const calls = new CallController(
    {
      list: async () => [],
      detail: async () => {
        throw new Error();
      },
      create: async () => {
        creates++;
        throw new Error();
      },
      change: async () => {
        throw new Error();
      },
    },
    () => actor,
    () => clientId,
    () => true,
  );
  calls.foreground(true);
  await calls.start(other, 'audio');
  assert.equal(creates, 0);
  assert.match(calls.getSnapshot().error, /Leave meeting/);
});
test('background during join verification cannot authorize later media', async () => {
  const f = fixture();
  await f.state.select(id);
  const pending = deferred<Meeting>();
  f.api.detail = () => pending.promise;
  const join = f.state.join();
  f.state.foreground(false);
  pending.resolve(meeting());
  await join;
  await flush();
  assert.equal(f.state.getSnapshot().joined, false);
  assert.deepEqual(f.actions, ['leave']);
});
test('unmounting a meeting detail discards its snapshot and ignores a late REST response', async () => {
  const f = fixture(),
    pending = deferred<Meeting>();
  f.api.detail = () => pending.promise;
  const read = f.state.select(id);
  f.state.detach(id);
  pending.resolve(meeting());
  await read;
  assert.equal(f.state.getSnapshot().id, null);
  assert.equal(f.state.getSnapshot().meeting, null);
});
test('failed verification prevents further invitation edits until a successful refresh', async () => {
  const f = fixture();
  await f.state.select(id);
  f.api.detail = async () => {
    throw new Error('Offline');
  };
  await f.state.refresh();
  assert.equal(await f.state.change('remove', other), false);
  assert.deepEqual(f.actions, []);
});
