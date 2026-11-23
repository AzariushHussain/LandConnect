import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient, ApiError } from '../src/api/client';
import { active, Call, callDto, CallsApi, roomToken } from '../src/features/calls/api';
import { CallController } from '../src/features/calls/controller';
import { MediaLifetime } from '../src/features/calls/media-lifetime';
import { actor, other, person, third } from './fixtures/chat';
import { deferred, listingId } from './fixtures/listings';

const callId = listingId(700),
  clientId = listingId(701);
const call = (status: Call['status'] = 'ringing'): Call => ({
  id: callId,
  client_id: clientId,
  caller: person(actor),
  callee: person(other),
  kind: 'video',
  status,
  created_at: '2026-11-23T00:00:00Z',
  expires_at: '2026-11-23T00:01:00Z',
  media_cleanup_pending: false,
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function controller(who = actor) {
  let server: Call | null = null;
  const changes: string[] = [];
  const api = {
    list: async (status: 'ringing' | 'accepted') => (server?.status === status ? [server] : []),
    detail: async () => server!,
    create: async () => {
      server = call();
      return server;
    },
    change: async (_id: string, action: 'accept' | 'reject' | 'cancel' | 'end') => {
      changes.push(action);
      server = call(
        ({ accept: 'accepted', reject: 'rejected', cancel: 'cancelled', end: 'ended' } as const)[
          action
        ],
      );
      return server;
    },
  };
  const state = new CallController(
    api,
    () => who,
    () => clientId,
  );
  state.foreground(true);
  return {
    state,
    api,
    changes,
    set: (value: Call | null) => {
      server = value;
    },
  };
}

test('call parser verifies participants and whitelists public call data', () => {
  const dto = callDto(
    { ...call(), caller: { ...person(), email: 'private' }, token: 'secret' },
    actor,
  );
  assert.equal('token' in dto, false);
  assert.equal('email' in dto.caller, false);
  for (const bad of [
    { ...call(), status: 'joined' },
    { ...call(), caller: person(third) },
    { ...call(), kind: 'screen' },
    { ...call(), expires_at: 'bad' },
    { ...call(), id: 'bad' },
    { ...call(), media_cleanup_pending: 'false' },
    { ...call(), callee: person() },
  ])
    assert.throws(() => callDto(bad, actor));
  assert.equal(active(call('ended')), false);
});
test('media tokens require the exact call room, short TTL and secure or local-development origin', () => {
  const token = {
    url: 'wss://media.example.com',
    token: 'sensitive',
    room: `call-${callId}`,
    expires_in: 300,
  };
  assert.equal(roomToken(token, callId, false).token, 'sensitive');
  assert.equal(
    roomToken({ ...token, url: 'ws://192.168.1.2:7880' }, callId, true).url,
    'ws://192.168.1.2:7880/',
  );
  for (const bad of [
    { ...token, room: 'other' },
    { ...token, expires_in: 0 },
    { ...token, url: 'https://media.example.com' },
    { ...token, url: 'wss://user:secret@media.example.com' },
    { ...token, url: 'wss://media.example.com/?token=secret' },
    { ...token, url: 'ws://media.example.com' },
  ])
    assert.throws(() => roomToken(bad, callId, true));
  assert.throws(() => roomToken({ ...token, url: 'ws://192.168.1.2:7880' }, callId, false));
});
test('authenticated call actions verify response IDs and preserve the idempotency key', async () => {
  const requests: { url: string; options: RequestInit }[] = [];
  const api = new CallsApi(
    new ApiClient('https://api.example.com', async (url, options) => {
      requests.push({ url: String(url), options: options! });
      return new Response(JSON.stringify(call()), { status: 200 });
    }),
    {
      access: () => ({
        token: 'private',
        user: { ...person(), email: '', allow_calls: true, allow_messages: true, created_at: '' },
      }),
      checkExpiry() {},
      async rejectToken() {},
    },
  );
  await api.create({ client_id: clientId, callee_id: other, kind: 'video' });
  assert.equal(requests[0]!.url, 'https://api.example.com/calls');
  assert.equal(new Headers(requests[0]!.options.headers).get('Authorization'), 'Bearer private');
  assert.equal(JSON.parse(String(requests[0]!.options.body)).client_id, clientId);
  await assert.rejects(api.detail(listingId(999)), /Mismatched/);
  await assert.rejects(api.change(callId, 'end'), /not confirm/);
});
test('old call responses cannot enter a replacement login session', async () => {
  const pending = deferred<Response>();
  let token = 'old';
  const rejected: string[] = [];
  const api = new CallsApi(new ApiClient('https://api.example.com', () => pending.promise), {
    access: () => ({
      token,
      user: { ...person(), email: '', allow_calls: true, allow_messages: true, created_at: '' },
    }),
    checkExpiry() {},
    async rejectToken(value) {
      rejected.push(value);
    },
  });
  const read = api.detail(callId);
  token = 'new';
  pending.resolve(new Response(JSON.stringify(call())));
  await assert.rejects(read, /session changed/);
  assert.deepEqual(rejected, ['old']);
});
test('outgoing retries keep one identifier and coalesce repeated taps', async () => {
  const f = controller();
  await flush();
  const pending = deferred<Call>();
  let creates = 0;
  f.api.create = async () => {
    creates++;
    return pending.promise;
  };
  const first = f.state.start(other, 'video');
  await f.state.start(other, 'video');
  assert.equal(creates, 1);
  pending.reject(new Error('lost response'));
  await first;
  assert.equal(f.state.getSnapshot().attempt?.client_id, clientId);
  f.api.create = async () => {
    creates++;
    return call();
  };
  await f.state.retry();
  assert.equal(creates, 2);
  assert.equal(f.state.getSnapshot().attempt, null);
});
test('incoming discovery uses REST and acceptance does not automatically open media', async () => {
  const f = controller(other);
  await flush();
  f.set(call());
  await f.state.refresh();
  assert.equal(f.state.getSnapshot().call?.id, callId);
  await f.state.accept();
  assert.deepEqual(f.changes, ['accept']);
  assert.equal(f.state.getSnapshot().joined, false);
  await f.state.join();
  assert.equal(f.state.getSnapshot().joined, true);
});
test('a stale poll cannot overwrite a successful outgoing action', async () => {
  const f = controller();
  await flush();
  const pending = deferred<Call[]>();
  f.api.list = () => pending.promise;
  const poll = f.state.refresh();
  await f.state.start(other, 'video');
  pending.resolve([]);
  await poll;
  assert.equal(f.state.getSnapshot().call?.id, callId);
});
test('failed REST verification immediately removes media authorization', async () => {
  const f = controller();
  await flush();
  f.set(call('accepted'));
  await f.state.refresh();
  await f.state.join();
  assert.equal(f.state.getSnapshot().joined, true);
  f.api.detail = async () => {
    throw new Error('offline');
  };
  await f.state.refresh();
  assert.equal(f.state.getSnapshot().verified, false);
  assert.equal(f.state.getSnapshot().joined, false);
  f.api.detail = async () => {
    throw new ApiError(404, 'Unavailable');
  };
  await f.state.refresh();
  assert.equal(f.state.getSnapshot().call, null);
});
test('terminal PubSub hint stops media before the reconciliation request finishes', async () => {
  const f = controller();
  await flush();
  f.set(call('accepted'));
  await f.state.refresh();
  await f.state.join();
  const pending = deferred<Call>();
  f.api.detail = () => pending.promise;
  f.state.hint(callId, true);
  assert.equal(f.state.getSnapshot().joined, false);
  pending.resolve(call('ended'));
  await flush();
  assert.equal(f.state.getSnapshot().call?.status, 'ended');
});
test('background ends accepted calls and never resumes media automatically', async () => {
  const f = controller();
  await flush();
  f.set(call('accepted'));
  await f.state.refresh();
  await f.state.join();
  f.state.foreground(false);
  assert.equal(f.state.getSnapshot().joined, false);
  await flush();
  assert.deepEqual(f.changes, ['end']);
  f.state.foreground(true);
  await flush();
  assert.equal(f.state.getSnapshot().joined, false);
});
test('background during an accept request finishes the newly accepted call', async () => {
  const f = controller(other);
  await flush();
  f.set(call());
  await f.state.refresh();
  const pending = deferred<Call>();
  const change = f.api.change;
  f.api.change = async (id, action) => (action === 'accept' ? pending.promise : change(id, action));
  const accept = f.state.accept();
  f.state.foreground(false);
  pending.resolve(call('accepted'));
  await accept;
  assert.deepEqual(f.changes, ['end']);
  assert.equal(f.state.getSnapshot().call?.status, 'ended');
});
test('a cancel racing with remote acceptance reconciles and ends the accepted call', async () => {
  const f = controller();
  await flush();
  f.set(call());
  await f.state.refresh();
  const change = f.api.change;
  f.api.change = async (id, action) => {
    if (action === 'cancel') {
      f.set(call('accepted'));
      throw new ApiError(409, 'Changed');
    }
    return change(id, action);
  };
  await f.state.finish();
  assert.deepEqual(f.changes, ['end']);
});
test('failed end keeps media stopped and exposes retry instead of claiming success', async () => {
  const f = controller();
  await flush();
  f.set(call('accepted'));
  await f.state.refresh();
  await f.state.join();
  f.api.change = async () => {
    throw new Error('offline');
  };
  await f.state.finish();
  assert.equal(f.state.getSnapshot().call?.status, 'accepted');
  assert.equal(f.state.getSnapshot().joined, false);
  assert.match(f.state.getSnapshot().error, /not confirm/);
});
test('sign-out reset ignores late outgoing requests', async () => {
  const f = controller();
  await flush();
  const pending = deferred<Call>();
  f.api.create = () => pending.promise;
  const start = f.state.start(other, 'video');
  f.state.reset();
  pending.resolve(call());
  await start;
  assert.equal(f.state.getSnapshot().call, null);
  assert.equal(f.state.getSnapshot().attempt, null);
});
test('closing during a permission dialog prevents connect and publication', async () => {
  const permission = deferred<void>();
  const events: string[] = [];
  const lifetime = new MediaLifetime(
    [
      () => permission.promise,
      async () => {
        events.push('publish');
      },
    ],
    async () => {
      events.push('stop');
    },
    () => {
      events.push('error');
    },
  );
  const close = lifetime.close();
  permission.resolve();
  await close;
  assert.equal(events.includes('publish'), false);
  assert.equal(events.includes('error'), false);
  assert.ok(events.filter((event) => event === 'stop').length >= 2);
});
test('closing during native publication stops tracks again after the late operation completes', async () => {
  const publish = deferred<void>();
  let tracks = 0;
  const lifetime = new MediaLifetime(
    [
      async () => {
        await publish.promise;
        tracks++;
      },
    ],
    async () => {
      tracks = 0;
    },
    () => {},
  );
  const close = lifetime.close();
  publish.resolve();
  await close;
  assert.equal(tracks, 0);
});
test('media startup failure calls the safe error handler without exposing SDK details', async () => {
  let failed = 0,
    later = 0;
  const lifetime = new MediaLifetime(
    [
      async () => {
        throw new Error('secret token in upstream error');
      },
      async () => {
        later++;
      },
    ],
    async () => {},
    () => {
      failed++;
    },
  );
  await lifetime.done;
  assert.equal(failed, 1);
  assert.equal(later, 0);
  await lifetime.close();
});
