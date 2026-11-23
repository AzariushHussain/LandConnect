import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient, ApiError } from '../src/api/client';
import { ChatApi } from '../src/features/chat/api';
import { Inbox, people } from '../src/features/chat/inbox';
import { Thread } from '../src/features/chat/thread';
import {
  conversation as parseConversation,
  history,
  message as parseMessage,
  permissions,
  person as parsePerson,
  validateBody,
} from '../src/features/chat/types';
import { actor, chatId, conversation, message, other, page, person, third } from './fixtures/chat';
import { deferred, listingId } from './fixtures/listings';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function fixture(fetcher: typeof fetch) {
  let access: { token: string; user: import('../src/features/auth/types').User } | null = {
    token: 'token',
    user: {
      ...person(),
      email: 'private@example.com',
      allow_messages: true,
      allow_calls: true,
      created_at: '2026-11-23T00:00:00Z',
    },
  };
  const rejected: string[] = [];
  return {
    api: new ChatApi(new ApiClient('https://api.example.com', fetcher), {
      access: () => access,
      checkExpiry: () => {},
      rejectToken: async (token) => {
        rejected.push(token);
        if (access?.token === token) access = null;
      },
    }),
    set: (value: typeof access) => {
      access = value;
    },
    rejected,
  };
}

test('people search encodes a trimmed email, authenticates and retains only public identity', async () => {
  const f = fixture(async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/users/search');
    assert.equal(url.searchParams.get('q'), 'seller+land@example.com');
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer token');
    return json({ items: [{ ...person(other), email: 'private@example.com' }], has_more: false });
  });
  const result = await f.api.searchPeople('  seller+land@example.com  ');
  assert.deepEqual(result, { items: [person(other)], hasMore: false });
});

test('people search rejects short input, invalid pages and another sessions late results', async () => {
  let requests = 0;
  const f = fixture(async () => {
    requests++;
    return json({ items: [person(actor)], has_more: false });
  });
  await assert.rejects(f.api.searchPeople('a'));
  await assert.rejects(f.api.searchPeople('x'.repeat(255)));
  assert.equal(requests, 0);
  await assert.rejects(f.api.searchPeople('Name'), /Invalid people search/);
  for (const response of [
    { items: [person(other), person(other)], has_more: false },
    { items: [person(other)], has_more: true },
    { items: [{ id: 'bad' }], has_more: false },
  ]) {
    await assert.rejects(fixture(async () => json(response)).api.searchPeople('Name'));
  }
  const pending = deferred<Response>();
  const switched = fixture(async () => pending.promise);
  const request = switched.api.searchPeople('Name');
  switched.set(null);
  pending.resolve(json({ items: [person(other)], has_more: false }));
  await assert.rejects(request, (e) => e instanceof ApiError && e.status === 401);
});

test('chat parsing strips contact fields and requires the current membership and valid group owner', () => {
  assert.equal('email' in parsePerson({ ...person(), email: 'private@example.com' }), false);
  assert.equal(parseConversation(conversation(), actor).members.length, 2);
  assert.equal(parseConversation(conversation(true), actor).owner_id, actor);
  assert.throws(() => parseConversation(conversation(), third));
  assert.throws(() =>
    parseConversation(
      { ...conversation(), members: [conversation().members[0], conversation().members[0]] },
      actor,
    ),
  );
  assert.throws(() => parseConversation({ ...conversation(true), owner_id: other }, actor));
  assert.throws(() => parseConversation({ ...conversation(), name: 'fake group' }, actor));
});

test('group role controls distinguish owner, admin, ordinary member and marketplace role', () => {
  const group = conversation(true);
  group.members.push({ user: person(third), role: 'member', joined_at: group.created_at });
  assert.equal(permissions(group, actor).canRemove(other), true);
  assert.equal(permissions(group, actor).canRemove(actor), false);
  assert.equal(permissions(group, actor).canLeave, false);
  group.members[1]!.role = 'admin';
  assert.equal(permissions(group, other).canRemove(third), true);
  assert.equal(permissions(group, other).owner, false);
  assert.equal(permissions(group, other).canRemove(actor), false);
  assert.equal(permissions(group, third).admin, false);
  assert.equal(permissions(conversation(), actor).admin, false);
});

test('history validates conversation, ascending IDs and both exclusive cursor directions', () => {
  assert.equal(
    parseMessage({ ...message(1), sender: { ...person(), email: 'private' } }, chatId).sender.id,
    actor,
  );
  assert.deepEqual(
    history(page([message(2), message(3)], true), chatId, {}).items.map((item) => item.id),
    [2, 3],
  );
  assert.equal(history(page([], false, 3), chatId, { after: 3 }).next_after_id, 3);
  for (const value of [
    page([message(3), message(2)]),
    { ...page([message(2)]), next_after_id: 99 },
    page([message(2), message(2)]),
    { ...page([]), has_more: true },
  ])
    assert.throws(() => history(value, chatId, {}));
  assert.throws(() => history(page([message(2)], false, 2), chatId, { after: 2 }));
  assert.throws(() => history(page([message(3)]), chatId, { before: 3 }));
  assert.throws(() => parseMessage({ ...message(1), conversation_id: listingId(999) }, chatId));
  assert.throws(() => parseMessage({ ...message(1), id: 2147483648 }, chatId));
});

test('text validation preserves whitespace and Unicode while rejecting blank or oversized bodies', () => {
  assert.equal(validateBody('  hello\nthere  '), '  hello\nthere  ');
  assert.equal(validateBody('🌳'.repeat(4000)).length, 8000);
  assert.throws(() => validateBody(' \n '));
  assert.throws(() => validateBody('a'.repeat(4001)));
});

test('all chat HTTP requests authenticate explicitly and send retries preserve UUID and body', async () => {
  const calls: RequestInit[] = [];
  const id = listingId(950);
  const f = fixture(async (_url, init) => {
    calls.push(init!);
    return json(message(5, actor, id, '  hello  '), 201);
  });
  await f.api.send(chatId, id, '  hello  ');
  await f.api.send(chatId, id, '  hello  ');
  assert.equal(new Headers(calls[0]!.headers).get('Authorization'), 'Bearer token');
  assert.equal(calls[0]!.body, calls[1]!.body);
  assert.deepEqual(JSON.parse(String(calls[0]!.body)), { client_id: id, body: '  hello  ' });
});

test('chat refuses invalid IDs, cursors, roles and group selections before HTTP', async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return json({});
  });
  await assert.rejects(f.api.detail('../users'));
  await assert.rejects(f.api.history(chatId, { after: 1, before: 2 }));
  await assert.rejects(f.api.history(chatId, { after: -1 }));
  await assert.rejects(f.api.group('Group', [actor]));
  await assert.rejects(f.api.group('Group', [other, other]));
  await assert.rejects(f.api.group(' ', [other]));
  await assert.rejects(f.api.role(chatId, other, 'owner' as 'admin'));
  assert.equal(calls, 0);
  f.set(null);
  await assert.rejects(f.api.list());
  assert.equal(calls, 0);
});

test('session changes and 401 cannot leak a late response into another account', async () => {
  const pending = deferred<Response>();
  const f = fixture(async () => pending.promise);
  const request = f.api.detail(chatId);
  f.set(null);
  pending.resolve(json(conversation()));
  await assert.rejects(request, (e) => e instanceof ApiError && e.status === 401);
  assert.deepEqual(f.rejected, ['token']);
  const invalid = fixture(async () => json({}, 401));
  await assert.rejects(invalid.api.list());
  assert.deepEqual(invalid.rejected, ['token']);
});

test('group creation reports ambiguous network writes without retrying; privacy errors stay actionable', async () => {
  let calls = 0;
  const offline = fixture(async () => {
    calls++;
    throw new Error('native details');
  });
  await assert.rejects(offline.api.group('Group', [other]), /may have succeeded/);
  assert.equal(calls, 1);
  const blocked = fixture(async () => json({}, 403));
  await assert.rejects(blocked.api.direct(other), /Privacy settings/);
  const missing = fixture(async () => json({}, 404));
  await assert.rejects(missing.api.detail(chatId), /no longer available/);
});

test('inbox deduplicates pages, advances by raw rows and builds people without self or duplicates', async () => {
  const a = conversation(),
    b = { ...conversation(true), id: listingId(904) };
  let offset = -1;
  const inbox = new Inbox({
    list: async (value = 0) => {
      offset = value;
      return value === 0
        ? Array.from({ length: 20 }, (_, n) => ({ ...a, id: listingId(n + 1) }))
        : [b];
    },
  });
  await inbox.refresh();
  await inbox.more();
  assert.equal(offset, 20);
  assert.equal(inbox.getSnapshot().items.length, 21);
  assert.equal(inbox.getSnapshot().hasMore, false);
  assert.deepEqual(
    people([a, b], actor).map((peer) => peer.id),
    [other],
  );
});

function threadFixture() {
  const api = {
    detail: async () => conversation(),
    history: async (_id: string, _query: { after?: number; before?: number } = {}) =>
      page([message(10)]),
    send: async (_id: string, clientId: string, body: string) => message(12, actor, clientId, body),
  };
  let ids = 0;
  return {
    api,
    thread: new Thread(chatId, actor, api, () => listingId(++ids + 1000)),
    ids: () => ids,
  };
}
test('a failed send retains its immutable retry identity; rapid taps do not duplicate the request', async () => {
  const f = threadFixture();
  await f.thread.sync();
  f.thread.draft('hello');
  const pending = deferred<ReturnType<typeof message>>();
  const pairs: string[] = [];
  f.api.send = async (_id, id, body) => {
    pairs.push(`${id}:${body}`);
    return pending.promise;
  };
  const sending = f.thread.send();
  await f.thread.send();
  assert.equal(pairs.length, 1);
  pending.reject(new Error('lost confirmation'));
  await sending;
  f.thread.draft('changed');
  assert.equal(f.thread.getSnapshot().draft, 'hello');
  f.api.send = async (_id, id, body) => {
    pairs.push(`${id}:${body}`);
    return message(12, actor, id, body);
  };
  await f.thread.send();
  assert.equal(pairs[0], pairs[1]);
  assert.equal(f.ids(), 1);
  assert.equal(f.thread.getSnapshot().attempt, null);
});

test('a successful send never advances recovery past an unseen incoming message', async () => {
  const f = threadFixture();
  await f.thread.sync();
  f.thread.draft('hello');
  const reads: { after?: number; before?: number }[] = [];
  f.api.history = async (_id, query = {}) => {
    reads.push(query);
    return page([message(11), message(12, actor, listingId(1001), 'hello')], false, query.after);
  };
  await f.thread.send();
  await f.thread.sync();
  assert.equal(reads[0]!.after, 10);
  assert.deepEqual(
    f.thread.getSnapshot().messages.map((item) => item.id),
    [10, 11, 12],
  );
});

test('history recovery can confirm an uncertain send and older pages never move the live cursor backwards', async () => {
  const f = threadFixture();
  f.api.history = async () => page([message(10)], true);
  await f.thread.sync();
  f.thread.draft('hello');
  f.api.send = async () => {
    throw new Error('lost');
  };
  await f.thread.send();
  const id = f.thread.getSnapshot().attempt!.clientId;
  f.api.history = async (_id, query = {}) =>
    query.before ? page([message(5)]) : page([message(12, actor, id, 'hello')], false, query.after);
  await f.thread.sync();
  assert.equal(f.thread.getSnapshot().attempt, null);
  await f.thread.older();
  assert.equal(f.thread.getSnapshot().after, 12);
  assert.deepEqual(
    f.thread.getSnapshot().messages.map((item) => item.id),
    [5, 10, 12],
  );
});

test('catch-up drains multiple pages while a new hint requests another reconciliation', async () => {
  const f = threadFixture();
  await f.thread.sync();
  let calls = 0;
  f.api.history = async (_id, query = {}) => {
    calls++;
    return page([message((query.after ?? 0) + 1)], calls < 3, query.after);
  };
  await f.thread.sync();
  assert.equal(calls, 3);
  assert.equal(f.thread.getSnapshot().after, 13);
});

test('membership removal clears messages and draft; obsolete reads and writes cannot restore them', async () => {
  const f = threadFixture();
  await f.thread.sync();
  f.thread.draft('private draft');
  const pending = deferred<ReturnType<typeof page>>();
  f.api.history = () => pending.promise;
  const sync = f.thread.sync();
  await Promise.resolve();
  f.thread.deny();
  pending.resolve(page([message(20)]));
  await sync;
  assert.equal(f.thread.getSnapshot().unavailable, true);
  assert.equal(f.thread.getSnapshot().messages.length, 0);
  assert.equal(f.thread.getSnapshot().draft, '');
});

test('server denial during send locks access, while 403 preserves text for a later explicit retry', async () => {
  const f = threadFixture();
  await f.thread.sync();
  f.thread.draft('hello');
  f.api.send = async () => {
    throw new ApiError(403, 'Privacy settings');
  };
  await f.thread.send();
  assert.equal(f.thread.getSnapshot().draft, 'hello');
  assert.equal(f.thread.getSnapshot().unavailable, false);
  f.api.send = async () => {
    throw new ApiError(404, 'Removed');
  };
  await f.thread.send();
  assert.equal(f.thread.getSnapshot().unavailable, true);
});
