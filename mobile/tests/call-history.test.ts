import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../src/api/client';
import { CallsApi, historyPage } from '../src/features/calls/api';
import { CallHistory, HistoryItem, historyLabel, HistoryPage } from '../src/features/calls/history';
import { actor, chatId, other, person } from './fixtures/chat';
import { deferred, listingId } from './fixtures/listings';

const entry = (n = 1): HistoryItem => ({
  id: listingId(n),
  source: 'direct',
  title: person(other).display_name,
  kind: 'video',
  status: 'ended',
  direction: 'incoming',
  created_at: new Date(Date.UTC(2026, 10, 24) - n * 1000).toISOString(),
  conversation_id: null,
  peer: person(other),
});
const group = (): HistoryItem => ({
  ...entry(2),
  source: 'group',
  title: 'Land group',
  status: 'ended',
  conversation_id: chatId,
  peer: null,
});
const dto = (items: HistoryItem[], offset = 0, has_more = false) => ({
  items,
  offset,
  limit: 20,
  has_more,
});

test('history parsing retains only public peer/record fields for direct and group calls', () => {
  const value = {
    ...entry(),
    token: 'private-token',
    peer: { ...person(other), email: 'private@example.com' },
  };
  const parsed = historyPage(dto([value, group()]), actor, 0);
  assert.deepEqual(parsed.items, [entry(), group()]);
  assert.equal(historyLabel(group()), 'Group call · Ended');
  assert.equal(historyLabel({ ...entry(), status: 'missed' }), 'Incoming · Missed');
});

test('invalid history membership shape, status, order, duplicates and paging are rejected', () => {
  for (const item of [
    { ...entry(), peer: person(actor) },
    { ...entry(), status: 'open' },
    { ...group(), peer: person(other) },
    { ...group(), conversation_id: null },
    { ...entry(), id: 'bad' },
    { ...entry(), created_at: 'yesterday' },
  ])
    assert.throws(() => historyPage(dto([item as HistoryItem]), actor, 0));
  assert.throws(() => historyPage(dto([entry(), entry()]), actor, 0));
  assert.throws(() => historyPage(dto([group(), entry()]), actor, 0));
  assert.throws(() => historyPage(dto([], 20), actor, 0));
  assert.throws(() => historyPage(dto([entry()], 0, true), actor, 0));
});

function apiFixture(fetcher: typeof fetch) {
  let token: string | null = 'token';
  const api = new CallsApi(new ApiClient('https://api.example.com', fetcher), {
    access: () =>
      token
        ? {
            token,
            user: {
              ...person(actor),
              email: 'private@example.com',
              allow_calls: true,
              allow_messages: true,
              created_at: '2026-11-24T00:00:00Z',
            },
          }
        : null,
    checkExpiry: () => {},
    rejectToken: async () => {
      token = null;
    },
  });
  return {
    api,
    change: () => {
      token = 'replacement';
    },
  };
}

test('history requests authenticate, validate pagination and enforce the incoming-missed filter', async () => {
  let requests = 0;
  const f = apiFixture(async (input, options) => {
    requests++;
    const url = new URL(String(input));
    assert.equal(url.pathname, '/calls/history');
    assert.equal(url.searchParams.get('missed_only'), 'true');
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer token');
    return new Response(JSON.stringify(dto([entry()])));
  });
  await assert.rejects(f.api.history(-1));
  await assert.rejects(f.api.history(10001));
  assert.equal(requests, 0);
  await assert.rejects(f.api.history(0, true), /missed call history/);
});

test('late history responses from an earlier login session cannot be displayed', async () => {
  const pending = deferred<Response>();
  const f = apiFixture(async () => pending.promise);
  const request = f.api.history();
  f.change();
  pending.resolve(new Response(JSON.stringify(dto([entry()]))));
  await assert.rejects(request, /session changed/);
});

test('changing history filters invalidates an older in-flight page', async () => {
  const pending = deferred<HistoryPage>();
  const history = new CallHistory({
    history: async (_offset, missed) =>
      missed ? { items: [{ ...entry(), status: 'missed' }], hasMore: false } : pending.promise,
  });
  const old = history.refresh();
  await history.filter(true);
  pending.resolve({ items: [group()], hasMore: false });
  await old;
  assert.equal(history.getSnapshot().missed, true);
  assert.equal(history.getSnapshot().items[0]!.status, 'missed');
});

test('refresh supersedes pagination and repeated load-more calls issue only one request', async () => {
  const pending = deferred<HistoryPage>();
  let more = 0,
    first = 0;
  const history = new CallHistory({
    history: async (offset) => {
      if (offset) {
        more++;
        return pending.promise;
      }
      return { items: [entry(++first)], hasMore: true };
    },
  });
  await history.refresh();
  const old = history.more();
  await history.more();
  await history.refresh();
  pending.resolve({ items: [entry(3)], hasMore: false });
  await old;
  assert.equal(more, 1);
  assert.deepEqual(history.getSnapshot().items, [entry(2)]);
});

test('membership revocation removes group history immediately and invalidates pending results', async () => {
  const pending = deferred<HistoryPage>();
  let calls = 0;
  const history = new CallHistory({
    history: async () =>
      ++calls === 1 ? { items: [entry(), group()], hasMore: false } : pending.promise,
  });
  await history.refresh();
  const old = history.refresh();
  history.revoke(chatId);
  assert.deepEqual(history.getSnapshot().items, [entry()]);
  pending.resolve({ items: [group()], hasMore: false });
  await old;
  assert.deepEqual(history.getSnapshot().items, [entry()]);
});

test('history failures clear private cached rows, and stopped screens ignore late reads', async () => {
  let fail = false;
  const history = new CallHistory({
    history: async () => {
      if (fail) throw new Error('Session expired');
      return { items: [entry()], hasMore: false };
    },
  });
  await history.refresh();
  fail = true;
  await history.refresh();
  assert.deepEqual(history.getSnapshot().items, []);
  assert.equal(history.getSnapshot().status, 'error');
  const pending = deferred<HistoryPage>(),
    stopped = new CallHistory({ history: () => pending.promise });
  const old = stopped.refresh();
  stopped.stop();
  pending.resolve({ items: [entry()], hasMore: false });
  await old;
  assert.deepEqual(stopped.getSnapshot().items, []);
});
