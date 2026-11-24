import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../src/api/client';
import { ManagementApi } from '../src/features/management/api';
import type { SessionController } from '../src/features/auth/session';
import {
  AddressLookup,
  LocationAddress,
  parseAddress,
  locationFields,
} from '../src/features/maps/address-lookup';
import { deferred } from './fixtures/listings';

test('new point replaces an old city and clears missing location fields instead of retaining Hyderabad', () => {
  const form = { city: 'Hyderabad', state: 'Telangana', country: 'IN', address: 'Old road' };
  const point = { latitude: '12.911622', longitude: '77.638862' };
  const filled = {
    ...form,
    ...locationFields({
      point,
      address: { city: 'Bengaluru', state: 'Karnataka', country: 'IN', address: 'HSR Layout' },
    }),
  };
  assert.equal(filled.city, 'Bengaluru');
  const partial = {
    ...form,
    ...locationFields({ point, address: { state: 'Karnataka', country: 'IN' } }),
  };
  assert.equal(partial.city, '');
  assert.equal(partial.address, '');
  const fallback = { ...form, ...locationFields({ point, address: null }) };
  assert.equal(fallback.city, 'Hyderabad');
});

test('address parser retains only known available fields within form limits', () => {
  assert.deepEqual(
    parseAddress({
      address: '14 Test Road',
      city: 'Pune',
      state: null,
      country: 'IN',
      token: 'discard',
    }),
    { address: '14 Test Road', city: 'Pune', country: 'IN' },
  );
  assert.deepEqual(parseAddress({}), {});
  for (const raw of [
    null,
    [],
    { country: 'India' },
    { country: 'in' },
    { city: '' },
    { state: 22 },
    { address: 'a'.repeat(301) },
  ])
    assert.throws(() => parseAddress(raw));
});

test('address lookup returns exact selected coordinates with address fields and coalesces confirmation taps', async () => {
  const response = deferred<LocationAddress>();
  let calls = 0;
  const lookup = new AddressLookup(async (point) => {
    calls++;
    assert.deepEqual(point, { latitude: '18.520400', longitude: '73.856700' });
    return response.promise;
  });
  const pending = lookup.resolve([73.8567, 18.5204]);
  assert.equal(await lookup.resolve([73.8567, 18.5204]), null);
  response.resolve({ address: 'Road', city: 'Pune', state: 'Maharashtra', country: 'IN' });
  assert.deepEqual(await pending, {
    point: { latitude: '18.520400', longitude: '73.856700' },
    address: { address: 'Road', city: 'Pune', state: 'Maharashtra', country: 'IN' },
  });
  assert.equal(calls, 1);
  assert.equal(lookup.getSnapshot().busy, false);
});

test('moving the pin or closing the picker invalidates old address responses', async () => {
  const old = deferred<LocationAddress>();
  const lookup = new AddressLookup(async (point) =>
    point.latitude === '1.000000' ? old.promise : { city: 'Current place' },
  );
  const pending = lookup.resolve([1, 1]);
  lookup.cancel();
  const current = await lookup.resolve([2, 2]);
  old.resolve({ city: 'Old place' });
  assert.equal(await pending, null);
  assert.equal(current?.address?.city, 'Current place');
  assert.equal(lookup.getSnapshot().error, '');
  const closing = new AddressLookup(() => old.promise);
  const late = closing.resolve([1, 1]);
  closing.cancel();
  assert.equal(await late, null);
  assert.deepEqual(closing.getSnapshot(), { busy: false, error: '' });
});

test('a stale address failure cannot replace the current lookup result', async () => {
  const old = deferred<LocationAddress>();
  const lookup = new AddressLookup(async (point) =>
    point.latitude === '1.000000' ? old.promise : { city: 'New place' },
  );
  const pending = lookup.resolve([1, 1]);
  lookup.cancel();
  assert.equal((await lookup.resolve([2, 2]))?.address?.city, 'New place');
  old.reject(new Error('Old failure'));
  assert.equal(await pending, null);
  assert.equal(lookup.getSnapshot().error, '');
});

test('lookup failure leaves an explicit retry and an empty address is a valid partial result', async () => {
  let calls = 0;
  const lookup = new AddressLookup(async () => {
    if (++calls === 1) throw new Error('Unavailable');
    return {};
  });
  assert.equal(await lookup.resolve([1, 1]), null);
  assert.equal(lookup.getSnapshot().error, 'Unavailable');
  assert.deepEqual((await lookup.resolve([1, 1]))?.address, {});
  assert.equal(lookup.getSnapshot().error, '');
});

test('reverse API validates point, authenticates POST and rejects data after session replacement', async () => {
  let token = 'owner';
  const response = deferred<Response>();
  const session = {
    access: () => ({ token, user: { id: 'owner', role: 'seller' } }),
    checkExpiry: () => {},
    rejectToken: async () => {},
  } as unknown as SessionController;
  let calls = 0;
  const api = new ManagementApi(
    new ApiClient('https://api.example.test', async (url, init) => {
      calls++;
      assert.equal(String(url), 'https://api.example.test/locations/reverse');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer owner');
      assert.deepEqual(JSON.parse(String(init?.body)), { latitude: 18.52, longitude: 73.85 });
      return response.promise;
    }),
    session,
  );
  await assert.rejects(api.reverseLocation({ latitude: '91', longitude: '1' }));
  assert.equal(calls, 0);
  const pending = api.reverseLocation({ latitude: '18.52', longitude: '73.85' });
  token = 'replacement';
  response.resolve(new Response(JSON.stringify({ city: 'Pune', country: 'IN' })));
  await assert.rejects(pending, /session changed/);
});
