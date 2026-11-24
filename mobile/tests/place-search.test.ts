import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../src/api/client';
import { ManagementApi } from '../src/features/management/api';
import { parsePlaces, placeQuery, PlaceSearch } from '../src/features/maps/place-search';
import type { SessionController } from '../src/features/auth/session';
import { deferred } from './fixtures/listings';

const place = {
  id: 'N:123',
  name: 'Pune',
  label: 'Pune, Maharashtra, India',
  longitude: 73.8545071,
  latitude: 18.5213738,
};

test('place query and result parser reject invalid coordinates, duplicates and oversized responses', () => {
  assert.equal(placeQuery('  Pune   city '), 'Pune city');
  for (const query of ['x', ' ', 'a'.repeat(201)]) assert.throws(() => placeQuery(query));
  assert.deepEqual(parsePlaces({ items: [{ ...place, extra: 'not forwarded' }] }), [place]);
  for (const items of [
    [{ ...place, longitude: NaN }],
    [{ ...place, latitude: 91 }],
    [{ ...place, longitude: '73' }],
    [{ ...place, label: '' }],
    [place, place],
    Array(6).fill(place),
  ])
    assert.throws(() => parsePlaces({ items }));
});

test('place search runs on submit, coalesces taps, and ignores results after editing or dismissing', async () => {
  const old = deferred<(typeof place)[]>();
  let requests = 0;
  const search = new PlaceSearch(async () => {
    requests++;
    return old.promise;
  });
  search.setQuery('Pune');
  assert.equal(requests, 0);
  const pending = search.search();
  await search.search();
  assert.equal(requests, 1);
  search.setQuery('Mumbai');
  old.resolve([place]);
  await pending;
  assert.deepEqual(search.getSnapshot().items, []);
  assert.equal(search.getSnapshot().query, 'Mumbai');
  const late = search.search();
  search.dismiss();
  await late;
  assert.deepEqual(search.getSnapshot().items, []);
  assert.equal(search.getSnapshot().busy, false);
});

test('place search distinguishes no results from failures and supports explicit retry', async () => {
  let requests = 0;
  const search = new PlaceSearch(async () => {
    if (++requests === 1) throw new Error('Unavailable');
    return [];
  });
  search.setQuery('a');
  await search.search();
  assert.equal(requests, 0);
  search.setQuery('Pune');
  await search.search();
  assert.equal(search.getSnapshot().error, 'Unavailable');
  assert.equal(search.getSnapshot().searched, false);
  await search.search();
  assert.equal(search.getSnapshot().searched, true);
  assert.equal(search.getSnapshot().error, '');
  assert.deepEqual(search.getSnapshot().items, []);
});

test('place API uses authenticated POST and rejects results from an older session', async () => {
  let token = 'owner-token';
  const response = deferred<Response>();
  const session = {
    access: () => ({ token, user: { id: 'owner', role: 'seller' } }),
    checkExpiry: () => {},
    rejectToken: async () => {},
  } as unknown as SessionController;
  const api = new ManagementApi(
    new ApiClient('https://api.example.test', async (url, init) => {
      assert.equal(String(url), 'https://api.example.test/locations/search');
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer owner-token');
      assert.deepEqual(JSON.parse(String(init?.body)), { q: 'Pune city' });
      return response.promise;
    }),
    session,
  );
  const searching = api.searchPlaces('  Pune  city ');
  token = 'replacement';
  response.resolve(new Response(JSON.stringify({ items: [place] })));
  await assert.rejects(searching, /session changed/);
});
