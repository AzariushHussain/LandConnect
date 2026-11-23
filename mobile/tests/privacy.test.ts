import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient, ApiError } from '../src/api/client';
import { Preferences, preferences, privacyChanges, PrivacyApi } from '../src/features/privacy/api';
import { PrivacyPreferences } from '../src/features/privacy/preferences';
import { BlockedAccounts } from '../src/features/privacy/blocks';
import { actor, other, person } from './fixtures/chat';
import { deferred, listingId } from './fixtures/listings';

const flags = { allow_messages: true, allow_calls: true };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function fixture(fetcher: typeof fetch) {
  let access: { token: string; user: import('../src/features/auth/types').User } | null = {
    token: 'token',
    user: {
      ...person(),
      email: 'private@example.com',
      ...flags,
      created_at: '2026-11-23T00:00:00Z',
    },
  };
  const applied: Preferences[] = [],
    rejected: string[] = [];
  const api = new PrivacyApi(new ApiClient('https://api.example.com', fetcher), {
    access: () => access,
    checkExpiry: () => {},
    rejectToken: async (token) => {
      rejected.push(token);
      if (access?.token === token) access = null;
    },
    updatePrivacy: (token, owner, value) => {
      if (access?.token !== token || access.user.id !== owner) return false;
      applied.push(value);
      return true;
    },
  });
  return {
    api,
    applied,
    rejected,
    set: (value: typeof access) => {
      access = value;
    },
  };
}

test('privacy parser requires the signed-in actor and actual booleans, retaining only the two flags', () => {
  assert.deepEqual(
    preferences({ id: actor, ...flags, email: 'private', role: 'broker' }, actor),
    flags,
  );
  for (const data of [
    { id: other, ...flags },
    { id: actor, ...flags, allow_calls: 'false' },
    { id: actor, allow_calls: true },
    null,
  ])
    assert.throws(() => preferences(data, actor));
  assert.deepEqual(
    privacyChanges(flags, { ...flags, allow_messages: false, role: 'seller' } as Preferences),
    { allow_messages: false },
  );
  assert.throws(() =>
    privacyChanges(flags, { ...flags, allow_calls: null } as unknown as Preferences),
  );
});

test('settings GET/PATCH use bearer authentication; only confirmed responses update the session', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const f = fixture(async (url, init) => {
    requests.push({ url: String(url), init: init! });
    return json({ id: actor, ...flags, allow_messages: false });
  });
  await f.api.current();
  await f.api.save({ allow_messages: false });
  assert.equal(requests[0]!.url, 'https://api.example.com/users/me');
  assert.equal(requests[1]!.init.method, 'PATCH');
  assert.equal(new Headers(requests[1]!.init.headers).get('Authorization'), 'Bearer token');
  assert.deepEqual(JSON.parse(String(requests[1]!.init.body)), { allow_messages: false });
  assert.equal(f.applied.length, 2);
  const invalid = fixture(async () => json({ id: other, ...flags }));
  await assert.rejects(invalid.api.current());
  assert.equal(invalid.applied.length, 0);
});

test('privacy input and blocked account IDs are validated before HTTP, including self blocks', async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return json({});
  });
  for (const value of [{}, { role: 'seller' }, { allow_calls: null }, { allow_calls: 'false' }])
    await assert.rejects(f.api.save(value as Partial<Preferences>));
  await assert.rejects(f.api.block(actor));
  await assert.rejects(f.api.unblock('../me'));
  await assert.rejects(f.api.blocks(10001));
  assert.equal(calls, 0);
  f.set(null);
  await assert.rejects(f.api.current());
  assert.equal(calls, 0);
});

test('an earlier profile GET cannot overwrite a newer confirmed settings PATCH', async () => {
  const old = deferred<Response>();
  let calls = 0;
  const f = fixture(async () =>
    ++calls === 1 ? old.promise : json({ id: actor, ...flags, allow_calls: false }),
  );
  const get = f.api.current();
  await f.api.save({ allow_calls: false });
  old.resolve(json({ id: actor, ...flags }));
  await assert.rejects(get, /changed during/);
  assert.deepEqual(f.applied, [{ ...flags, allow_calls: false }]);
});

test('expired or changed sessions cannot apply privacy snapshots to another account', async () => {
  const result = deferred<Response>();
  const f = fixture(async () => result.promise);
  const request = f.api.current();
  f.set(null);
  result.resolve(json({ id: actor, ...flags }));
  await assert.rejects(request, (e) => e instanceof ApiError && e.status === 401);
  assert.equal(f.applied.length, 0);
  const expired = fixture(async () => json({}, 401));
  await assert.rejects(expired.api.current());
  assert.deepEqual(expired.rejected, ['token']);
});

test('blocked pages validate pagination, omit contacts and reject duplicates or self', async () => {
  let value: unknown = { items: [{ ...person(other), email: 'private' }], limit: 20, offset: 0 };
  const f = fixture(async () => json(value));
  assert.equal('email' in (await f.api.blocks())[0]!, false);
  for (const items of [[person()], [person(other), person(other)]]) {
    value = { items, limit: 20, offset: 0 };
    await assert.rejects(f.api.blocks());
  }
  value = { items: [], limit: 20, offset: 1 };
  await assert.rejects(f.api.blocks());
});

test('block PUT and unblock DELETE accept empty 204 without JSON bodies', async () => {
  const calls: RequestInit[] = [];
  const f = fixture(async (_url, init) => {
    calls.push(init!);
    return new Response(null, { status: 204 });
  });
  await f.api.block(other);
  await f.api.unblock(other);
  assert.equal(calls[0]!.method, 'PUT');
  assert.equal(calls[1]!.method, 'DELETE');
  assert.equal(calls[0]!.body, undefined);
  assert.equal(new Headers(calls[0]!.headers).get('Authorization'), 'Bearer token');
});

test('settings controller sends only changed flags and suppresses repeated save taps', async () => {
  const response = deferred<Preferences>();
  const bodies: Partial<Preferences>[] = [];
  const controller = new PrivacyPreferences({
    current: async () => flags,
    save: async (body) => {
      bodies.push(body);
      return response.promise;
    },
  });
  await controller.refresh();
  controller.edit('allow_messages', false);
  const saving = controller.save();
  await controller.save();
  controller.edit('allow_calls', false);
  assert.deepEqual(bodies, [{ allow_messages: false }]);
  assert.equal(controller.getSnapshot().draft!.allow_calls, true);
  response.resolve({ ...flags, allow_messages: false });
  await saving;
  assert.equal(controller.dirty(), false);
  assert.equal(controller.getSnapshot().notice, 'Privacy settings saved.');
});

test('uncertain saves retain the draft and require a successful refresh before another change', async () => {
  let current = flags,
    calls = 0;
  const controller = new PrivacyPreferences({
    current: async () => current,
    save: async () => {
      calls++;
      throw new Error('lost response');
    },
  });
  await controller.refresh();
  controller.edit('allow_calls', false);
  await controller.save();
  assert.equal(controller.getSnapshot().saved!.allow_calls, true);
  assert.equal(controller.getSnapshot().draft!.allow_calls, false);
  assert.equal(controller.getSnapshot().uncertain, true);
  await controller.save();
  assert.equal(calls, 1);
  controller.edit('allow_messages', false);
  assert.equal(controller.getSnapshot().draft!.allow_messages, true);
  current = { ...flags, allow_calls: false };
  await controller.refresh();
  assert.equal(controller.getSnapshot().uncertain, false);
  assert.equal(controller.dirty(), false);
});

test('a rejected save or failed refresh does not silently discard the current form', async () => {
  let failRead = false;
  const controller = new PrivacyPreferences({
    current: async () => {
      if (failRead) throw new Error('offline');
      return flags;
    },
    save: async () => {
      throw new ApiError(422, 'Check details');
    },
  });
  await controller.refresh();
  controller.edit('allow_calls', false);
  await controller.save();
  assert.equal(controller.getSnapshot().uncertain, false);
  assert.equal(controller.dirty(), true);
  failRead = true;
  await controller.refresh();
  assert.equal(controller.getSnapshot().draft!.allow_calls, false);
});

test('old settings reads and unmounted saves cannot overwrite newer controller state', async () => {
  const first = deferred<Preferences>();
  let count = 0;
  const controller = new PrivacyPreferences({
    current: async () => (++count === 1 ? first.promise : { ...flags, allow_calls: false }),
    save: async () => flags,
  });
  const old = controller.refresh();
  await controller.refresh();
  first.resolve(flags);
  await old;
  assert.equal(controller.getSnapshot().saved!.allow_calls, false);
  const pending = deferred<Preferences>();
  const closed = new PrivacyPreferences({
    current: async () => flags,
    save: () => pending.promise,
  });
  await closed.refresh();
  closed.edit('allow_messages', false);
  const saving = closed.save();
  closed.stop();
  pending.resolve({ ...flags, allow_messages: false });
  await saving;
  assert.equal(closed.getSnapshot().saved!.allow_messages, true);
});

test('blocked pagination uses raw offsets and a refresh supersedes old page results', async () => {
  const calls: number[] = [];
  const oldPage = deferred<ReturnType<typeof person>[]>();
  const controller = new BlockedAccounts({
    blocks: async (offset = 0) => {
      calls.push(offset);
      return offset === 0
        ? Array.from({ length: 20 }, (_, n) => person(listingId(n + 1)))
        : oldPage.promise;
    },
    unblock: async () => {},
  });
  await controller.refresh();
  const more = controller.more();
  await controller.refresh();
  oldPage.resolve([person(other)]);
  await more;
  assert.deepEqual(calls, [0, 20, 0]);
  assert.equal(controller.getSnapshot().items.length, 20);
  assert.equal(controller.getSnapshot().next, 20);
});

test('confirmed unblock survives a failed follow-up refresh and invalidates shifted pagination', async () => {
  let reads = 0,
    writes = 0;
  const pending = deferred<void>();
  const controller = new BlockedAccounts({
    blocks: async () => {
      if (++reads > 1) throw new Error('Read failed');
      return [person(other)];
    },
    unblock: async () => {
      writes++;
      await pending.promise;
    },
  });
  await controller.refresh();
  const operation = controller.unblock(other);
  await controller.unblock(other);
  assert.equal(writes, 1);
  pending.resolve();
  await operation;
  await Promise.resolve();
  assert.equal(controller.getSnapshot().items.length, 0);
  assert.equal(controller.getSnapshot().hasMore, false);
  assert.match(controller.getSnapshot().notice, /Account unblocked/);
  assert.match(controller.getSnapshot().error, /Read failed/);
});

test('a failed unblock preserves its row, while unmounting discards late success', async () => {
  let reject = true;
  const pending = deferred<void>();
  const controller = new BlockedAccounts({
    blocks: async () => [person(other)],
    unblock: async () => {
      if (reject) throw new Error('network');
      await pending.promise;
    },
  });
  await controller.refresh();
  await controller.unblock(other);
  assert.equal(controller.getSnapshot().items.length, 1);
  reject = false;
  const request = controller.unblock(other);
  controller.stop();
  pending.resolve();
  await request;
  assert.equal(controller.getSnapshot().items.length, 1);
});
