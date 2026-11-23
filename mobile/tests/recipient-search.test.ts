import assert from 'node:assert/strict';
import test from 'node:test';
import { RecipientSearch } from '../src/features/chat/recipient-search';
import { actor, conversation, other, person, third } from './fixtures/chat';
import { deferred } from './fixtures/listings';

test('people search ignores older results and failures after a query changes or clears', async () => {
  const old = deferred<{ items: ReturnType<typeof person>[]; hasMore: boolean }>();
  const search = new RecipientSearch({
    searchPeople: async (query) =>
      query === 'old' ? old.promise : { items: [person(other)], hasMore: false },
    direct: async () => conversation(),
  });
  search.setQuery('old');
  const pending = search.search();
  search.setQuery('new');
  await search.search();
  old.reject(new Error('Old query failed'));
  await pending;
  assert.equal(search.getSnapshot().items[0]?.id, other);
  assert.equal(search.getSnapshot().error, '');
  search.setQuery('old');
  const late = search.search();
  search.setQuery('');
  await late;
  assert.deepEqual(search.getSnapshot().items, []);
  assert.equal(search.getSnapshot().loading, false);
});

test('leaving the tab invalidates a pending search or chat navigation', async () => {
  const found = deferred<{ items: ReturnType<typeof person>[]; hasMore: boolean }>();
  const opened = deferred<ReturnType<typeof conversation>>();
  const search = new RecipientSearch({
    searchPeople: () => found.promise,
    direct: () => opened.promise,
  });
  search.setQuery('Person');
  const pending = search.search();
  search.stop();
  found.resolve({ items: [person(other)], hasMore: false });
  await pending;
  assert.deepEqual(search.getSnapshot().items, []);
  search.setQuery('Person');
  await search.search();
  const chat = search.open(other);
  search.stop();
  opened.resolve(conversation());
  assert.equal(await chat, null);
  assert.equal(search.getSnapshot().query, '');
});

test('selecting a person serializes taps and uses the direct create-or-open result', async () => {
  let calls = 0;
  const pending = deferred<ReturnType<typeof conversation>>();
  const search = new RecipientSearch({
    searchPeople: async () => ({ items: [person(other), person(third)], hasMore: false }),
    direct: async (id) => {
      calls++;
      assert.equal(id, other);
      return pending.promise;
    },
  });
  search.setQuery('Person');
  await search.search();
  assert.equal(await search.open(actor), null);
  const opening = search.open(other);
  assert.equal(await search.open(third), null);
  search.setQuery('Another person');
  assert.equal(search.getSnapshot().query, 'Person');
  pending.resolve(conversation());
  assert.equal((await opening)?.id, conversation().id);
  assert.equal(calls, 1);
  assert.equal(search.getSnapshot().opening, null);
});

test('short queries make no request and lookup/open errors permit an explicit retry', async () => {
  let queries = 0,
    opens = 0;
  const search = new RecipientSearch({
    searchPeople: async () => {
      if (++queries === 1) throw new Error('Search unavailable');
      return { items: [person(other)], hasMore: false };
    },
    direct: async () => {
      if (++opens === 1) throw new Error('Privacy settings changed');
      return conversation();
    },
  });
  search.setQuery('a');
  await search.search();
  assert.equal(queries, 0);
  search.setQuery('Person');
  await search.search();
  assert.match(search.getSnapshot().error, /Search unavailable/);
  await search.search();
  assert.equal(await search.open(other), null);
  assert.match(search.getSnapshot().error, /Privacy settings/);
  assert.equal((await search.open(other))?.id, conversation().id);
});
