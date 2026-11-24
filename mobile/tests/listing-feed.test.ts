import assert from 'node:assert/strict';
import test from 'node:test';
import { ListingFeed } from '../src/features/listings/feed';
import { emptyFilters } from '../src/features/listings/filters';
import { ListingPage } from '../src/features/listings/types';
import { deferred, listing, page } from './fixtures/listings';

test('pull-to-refresh shows a controlled spinner on empty results and retains applied filters', async () => {
  const pending = deferred<ListingPage>();
  let calls = 0;
  const applied = { ...emptyFilters, city: 'Pune', currency: 'INR', min_price: '999999999999.99' };
  const feed = new ListingFeed({
    page: async (filters, offset) => {
      assert.deepEqual(filters, applied);
      assert.equal(offset, 0);
      return ++calls === 1 ? page([], 0) : pending.promise;
    },
  });
  await feed.apply(applied);
  const refresh = feed.refresh(true);
  assert.equal(feed.getSnapshot().status, 'refreshing');
  assert.deepEqual(feed.getSnapshot().filters, applied);
  pending.resolve(page([listing(2)], 1));
  await refresh;
  assert.equal(feed.getSnapshot().status, 'ready');
  assert.equal(feed.getSnapshot().items[0]!.id, listing(2).id);
});

test('first page, load-more and overlapping IDs advance by raw server rows', async () => {
  const offsets: number[] = [];
  const feed = new ListingFeed({
    page: async (_filters, offset) => {
      offsets.push(offset);
      return offset === 0
        ? page([listing(1), listing(2)], 4)
        : page([{ ...listing(2), title: 'Updated' }, listing(3)], 4, offset);
    },
  });
  await feed.refresh();
  await feed.more();
  assert.deepEqual(offsets, [0, 2]);
  assert.equal(feed.getSnapshot().items.length, 3);
  assert.equal(feed.getSnapshot().items[1]!.title, 'Updated');
  assert.equal(feed.getSnapshot().nextOffset, 4);
  assert.equal(feed.getSnapshot().hasMore, false);
});

test('late responses from older searches cannot overwrite newer results', async () => {
  const old = deferred<ListingPage>();
  const feed = new ListingFeed({
    page: async (filters) => (filters.q === 'old' ? old.promise : page([listing(2)], 1)),
  });
  const pending = feed.apply({ ...emptyFilters, q: 'old' });
  await feed.apply({ ...emptyFilters, q: 'new' });
  old.resolve(page([listing(1)], 1));
  await pending;
  assert.equal(feed.getSnapshot().filters.q, 'new');
  assert.equal(feed.getSnapshot().items[0]!.id, listing(2).id);
});

test('repeated load-more presses issue one page request', async () => {
  const next = deferred<ListingPage>();
  let count = 0;
  const feed = new ListingFeed({
    page: async (_filters, offset) => {
      count++;
      return offset ? next.promise : page([listing(1)], 3);
    },
  });
  await feed.refresh();
  const first = feed.more();
  await feed.more();
  assert.equal(count, 2);
  next.resolve(page([listing(2)], 3, 1));
  await first;
});

test('load-more errors preserve cards and retry the same offset', async () => {
  let fail = true;
  const offsets: number[] = [];
  const feed = new ListingFeed({
    page: async (_filters, offset) => {
      offsets.push(offset);
      if (offset && fail) throw new Error('offline');
      return offset ? page([listing(2)], 2, offset) : page([listing(1)], 2);
    },
  });
  await feed.refresh();
  await feed.more();
  assert.equal(feed.getSnapshot().items.length, 1);
  assert.equal(feed.getSnapshot().status, 'ready');
  assert.equal(feed.getSnapshot().error, 'offline');
  fail = false;
  await feed.more();
  assert.deepEqual(offsets, [0, 1, 1]);
  assert.equal(feed.getSnapshot().items.length, 2);
});

test('refresh wins over an in-flight older pagination response', async () => {
  const next = deferred<ListingPage>();
  let refreshed = false;
  const feed = new ListingFeed({
    page: async (_filters, offset) =>
      offset ? next.promise : page([listing(refreshed ? 3 : 1)], 2),
  });
  await feed.refresh();
  const more = feed.more();
  refreshed = true;
  await feed.refresh();
  next.resolve(page([listing(2)], 2, 1));
  await more;
  assert.deepEqual(
    feed.getSnapshot().items.map((item) => item.id),
    [listing(3).id],
  );
  assert.equal(feed.getSnapshot().nextOffset, 1);
});

test('unmounted feeds ignore pending responses and can restart under strict lifecycle checks', async () => {
  const request = deferred<ListingPage>();
  const feed = new ListingFeed({ page: async () => request.promise });
  const pending = feed.refresh();
  feed.invalidate();
  request.resolve(page([listing()], 1));
  await pending;
  assert.equal(feed.getSnapshot().items.length, 0);
  await feed.refresh();
  assert.equal(feed.getSnapshot().items.length, 1);
});

test('refresh failures retain cards; a valid empty response ends pagination', async () => {
  let mode = 'initial';
  const feed = new ListingFeed({
    page: async () => {
      if (mode === 'fail') throw new Error('offline');
      return page(mode === 'empty' ? [] : [listing()], mode === 'empty' ? 100 : 1);
    },
  });
  await feed.refresh();
  mode = 'fail';
  await feed.refresh();
  assert.equal(feed.getSnapshot().status, 'error');
  assert.equal(feed.getSnapshot().items.length, 1);
  mode = 'empty';
  await feed.refresh();
  assert.equal(feed.getSnapshot().items.length, 0);
  assert.equal(feed.getSnapshot().hasMore, false);
});

test('invalid filters leave applied state intact and never reach the API', async () => {
  let calls = 0;
  const feed = new ListingFeed({
    page: async () => {
      calls++;
      return page([listing()], 1);
    },
  });
  await feed.refresh();
  await assert.rejects(feed.apply({ ...emptyFilters, min_area: '-1' }));
  assert.equal(calls, 1);
  assert.equal(feed.getSnapshot().items.length, 1);
});
