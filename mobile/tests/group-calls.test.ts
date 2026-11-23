import assert from 'node:assert/strict';
import test from 'node:test';
import { GroupCallController } from '../src/features/calls/group-controller';
import { Meeting, memberStatus } from '../src/features/meetings/api';
import { MeetingSession } from '../src/features/meetings/session';
import { actor, other, person, chatId, third } from './fixtures/chat';
import { deferred, listingId } from './fixtures/listings';

function fixture(who = actor, prepare: () => Promise<void> = async () => {}) {
  let user = who,
    blocked = false;
  let server: Meeting = {
    id: listingId(650),
    client_id: listingId(651),
    conversation_id: chatId,
    owner: person(actor),
    title: 'Site team',
    kind: 'video',
    created_at: '2026-11-23T00:00:00Z',
    ended_at: null,
    room_version: 1,
    media_cleanup_pending: false,
    members: [
      { user: person(actor), status: 'accepted' },
      { user: person(other), status: 'invited' },
    ],
  };
  const actions: string[] = [],
    attempts: string[] = [];
  const api = {
    groupCall: async (attempt: { client_id: string; kind: 'audio' | 'video' }) => {
      actions.push('create');
      attempts.push(attempt.client_id);
      server.kind = attempt.kind;
      return server;
    },
    list: async () => (memberStatus(server, user) === 'invited' ? [server] : []),
    detail: async () => server,
    accept: async () => {
      actions.push('accept');
      server = {
        ...server,
        members: server.members.map((m) => (m.user.id === user ? { ...m, status: 'accepted' } : m)),
      };
      return server;
    },
    end: async () => {
      actions.push('end');
      server = { ...server, ended_at: '2026-11-23T01:00:00Z' };
      return server;
    },
    leave: async () => {
      actions.push('leave');
    },
    invite: async () => server,
    remove: async () => {},
    decline: async () => {},
  };
  const media = new MeetingSession(
    api,
    () => user,
    () => blocked,
  );
  media.foreground(true);
  const controller = new GroupCallController(
    api,
    media,
    () => user,
    () => listingId(652),
    () => blocked,
    async () => {
      actions.push('prepare');
      await prepare();
    },
  );
  return {
    controller,
    media,
    api,
    actions,
    attempts,
    server: () => server,
    user: (next: string) => {
      user = next;
    },
    block: () => {
      blocked = true;
    },
  };
}

test('group audio/video dial connects the initiator without create/join UI actions', async () => {
  for (const kind of ['audio', 'video'] as const) {
    const f = fixture();
    const call = await f.controller.start(chatId, kind);
    assert.equal(call?.kind, kind);
    assert.equal(f.media.getSnapshot().joined, true);
    assert.deepEqual(f.actions, ['prepare', 'create']);
    assert.equal(f.controller.getSnapshot().attempt, null);
  }
});

test('one group answer obtains permission, accepts and enables media automatically', async () => {
  const f = fixture(other);
  assert.equal(f.media.getSnapshot().incomingGroupCall?.id, undefined);
  await f.media.discover();
  assert.equal(f.media.getSnapshot().incomingGroupCall?.id, f.server().id);
  assert.equal(f.media.getSnapshot().invitation, null);
  assert.equal((await f.controller.answer(f.server().id))?.id, f.server().id);
  assert.deepEqual(f.actions, ['prepare', 'accept']);
  assert.equal(f.media.getSnapshot().joined, true);
});

test('permission denial and direct-call busy state send no group creation or acceptance', async () => {
  const f = fixture(other, async () => {
    throw new Error('Permission denied');
  });
  assert.equal(await f.controller.answer(f.server().id), null);
  assert.equal(await f.controller.start(chatId, 'audio'), null);
  assert.deepEqual(f.actions, ['prepare', 'prepare']);
  assert.equal(f.media.getSnapshot().joined, false);
  f.block();
  assert.equal(await f.controller.start(chatId, 'audio'), null);
  assert.equal(f.actions.includes('create'), false);
});

test('sign-out or switching actors during permissions cannot dial or answer', async () => {
  for (const answer of [false, true]) {
    const permission = deferred<void>();
    const f = fixture(other, () => permission.promise);
    const result = answer
      ? f.controller.answer(f.server().id)
      : f.controller.start(chatId, 'video');
    await new Promise<void>((resolve) => setImmediate(resolve));
    f.user(third);
    f.controller.reset();
    f.media.reset();
    permission.resolve();
    assert.equal(await result, null);
    assert.equal(f.actions.includes('create'), false);
    assert.equal(f.actions.includes('accept'), false);
  }
});

test('uncertain group creation retains one attempt and rejects a different call type', async () => {
  const f = fixture();
  let calls = 0;
  const create = f.api.groupCall;
  f.api.groupCall = async (attempt) => {
    if (++calls === 1) {
      f.attempts.push(attempt.client_id);
      throw new Error('Response lost');
    }
    return create(attempt);
  };
  assert.equal(await f.controller.start(chatId, 'video'), null);
  const pending = f.controller.getSnapshot().attempt;
  assert.ok(pending);
  assert.equal(await f.controller.start(chatId, 'audio'), null);
  assert.equal(calls, 1);
  assert.ok(await f.controller.start(chatId, 'video'));
  assert.deepEqual(f.attempts, [pending.client_id, pending.client_id]);
});

test('backgrounding during group acceptance stops connection and disconnects accepted media', async () => {
  const f = fixture(other);
  const accepted = deferred<Meeting>();
  f.api.accept = () => {
    f.actions.push('accept');
    return accepted.promise;
  };
  const answering = f.controller.answer(f.server().id);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(f.actions.includes('accept'));
  f.media.foreground(false);
  accepted.resolve({
    ...f.server(),
    members: f.server().members.map((m) => ({ ...m, status: 'accepted' })),
  });
  assert.equal(await answering, null);
  assert.equal(f.media.getSnapshot().joined, false);
  assert.ok(f.actions.includes('leave'));
});

test('a late join check after sign-out cannot navigate to another sessions group call', async () => {
  const f = fixture();
  const delayed = deferred<Meeting>();
  let reads = 0;
  f.api.detail = async () => (++reads === 2 ? delayed.promise : f.server());
  const starting = f.controller.start(chatId, 'video');
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.controller.reset();
  f.media.reset();
  f.user(third);
  delayed.resolve(f.server());
  assert.equal(await starting, null);
  assert.equal(f.media.getSnapshot().joined, false);
});

test('leaving the group during permission preparation cancels an unsent dial', async () => {
  const permission = deferred<void>();
  const f = fixture(actor, () => permission.promise);
  const pending = f.controller.start(chatId, 'video');
  f.controller.cancelStart();
  permission.resolve();
  assert.equal(await pending, null);
  assert.equal(f.actions.includes('create'), false);
});

test('leaving during group creation ends a late owned call without connecting media', async () => {
  const response = deferred<Meeting>();
  const f = fixture();
  f.api.groupCall = () => response.promise;
  const pending = f.controller.start(chatId, 'video');
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.controller.cancelStart();
  response.resolve(f.server());
  assert.equal(await pending, null);
  assert.ok(f.actions.includes('end'));
  assert.equal(f.media.getSnapshot().joined, false);
});

test('leaving during the final group join check clears a late connected state', async () => {
  const response = deferred<Meeting>();
  const f = fixture();
  let reads = 0;
  f.api.detail = async () => (++reads === 2 ? response.promise : f.server());
  const pending = f.controller.start(chatId, 'video');
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.controller.cancelStart();
  response.resolve(f.server());
  assert.equal(await pending, null);
  assert.equal(f.media.getSnapshot().joined, false);
  assert.ok(f.actions.includes('end'));
});

test('foreground reconciliation during the permission dialog does not require a second Answer tap', async () => {
  const permission = deferred<void>(),
    stale = deferred<Meeting>();
  const f = fixture(other, () => permission.promise);
  const old = f.server();
  let reads = 0;
  f.api.detail = async () => (++reads === 2 ? stale.promise : f.server());
  const answering = f.controller.answer(old.id);
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.media.foreground(false);
  f.media.foreground(true);
  permission.resolve();
  assert.ok(await answering);
  assert.equal(f.media.getSnapshot().joined, true);
  stale.resolve(old);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.media.getSnapshot().joined, true);
});
