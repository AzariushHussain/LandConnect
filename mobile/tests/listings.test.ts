import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient, ApiError } from '../src/api/client';
import { ListingsApi } from '../src/features/listings/api';
import {
  emptyFilters,
  formatDecimal,
  listingQuery,
  normalizeFilters,
  withoutFilter,
} from '../src/features/listings/filters';
import { isListingId, parseListing, parsePage } from '../src/features/listings/types';
import { listing, listingId, page } from './fixtures/listings';

test('filters encode special characters, preserve decimals and omit blank values', () => {
  const query = new URLSearchParams(
    listingQuery(
      {
        ...emptyFilters,
        q: ' road & field? ',
        currency: 'inr',
        min_price: '123456789012.01',
        country: 'in',
      },
      20,
    ),
  );
  assert.equal(query.get('q'), 'road & field?');
  assert.equal(query.get('currency'), 'INR');
  assert.equal(query.get('country'), 'IN');
  assert.equal(query.get('min_price'), '123456789012.01');
  assert.equal(query.get('offset'), '20');
  assert.equal(query.has('city'), false);
});

test('filter bounds are validated exactly rather than using rounded numeric conversions', () => {
  assert.throws(
    () =>
      normalizeFilters({
        ...emptyFilters,
        currency: 'INR',
        min_price: '999999999999.99',
        max_price: '999999999999.98',
      }),
    /Minimum price/,
  );
  assert.throws(
    () => normalizeFilters({ ...emptyFilters, min_area: '10', max_area: '9.99' }),
    /Minimum area/,
  );
  assert.equal(
    normalizeFilters({ ...emptyFilters, currency: 'INR', min_price: '0', max_price: '0.01' })
      .min_price,
    '0',
  );
});

test('removing a currency chip clears its dependent budget without mutating applied filters', () => {
  const applied = {
    ...emptyFilters,
    q: 'farm',
    city: 'Pune',
    currency: 'INR',
    min_price: '1000.01',
    max_price: '999999999999.99',
  };
  assert.deepEqual(withoutFilter(applied, 'currency'), {
    ...emptyFilters,
    q: 'farm',
    city: 'Pune',
  });
  assert.equal(applied.max_price, '999999999999.99');
});

test('removing a single bound retains the exact remaining budget, location and search', () => {
  const applied = {
    ...emptyFilters,
    q: 'field',
    city: 'Pune',
    currency: 'INR',
    min_price: '999999999999.98',
    max_price: '999999999999.99',
  };
  assert.deepEqual(withoutFilter(applied, 'min_price'), { ...applied, min_price: '' });
  assert.deepEqual(withoutFilter(applied, 'city'), { ...applied, city: '' });
});

test('invalid numeric, country, currency and oversized filters are refused', () => {
  for (const value of ['-1', '1e4', 'Infinity', '1.234', '1000000000000', '1,000']) {
    assert.throws(() => normalizeFilters({ ...emptyFilters, min_area: value }));
  }
  assert.throws(() => normalizeFilters({ ...emptyFilters, min_price: '1' }), /currency/);
  assert.throws(() => normalizeFilters({ ...emptyFilters, country: 'IND' }), /country/);
  assert.throws(() => normalizeFilters({ ...emptyFilters, currency: 'RUPEE' }), /currency/);
  assert.throws(() => normalizeFilters({ ...emptyFilters, q: 'x'.repeat(101) }), /100/);
  for (const offset of [-1, 1.5, 10001]) assert.throws(() => listingQuery(emptyFilters, offset));
  for (const limit of [0, 101, 1.5]) assert.throws(() => listingQuery(emptyFilters, 0, limit));
});

test('money/area formatting preserves exact digits in the full supported range', () => {
  assert.equal(formatDecimal('999999999999.99'), '9,99,99,99,99,999.99');
  assert.equal(formatDecimal('1234567.89'), '12,34,567.89');
  assert.equal(formatDecimal('500.00'), '500');
  assert.equal(formatDecimal('0.01'), '0.01');
  assert.equal(formatDecimal('12.5'), '12.50');
});

test('listing parsing preserves Decimal strings and strips unexpected contact fields', () => {
  const original = listing();
  const value = parseListing({
    ...original,
    owner: { ...original.owner, email: 'private@example.com', phone: 'private' },
  });
  assert.equal(value.price, original.price);
  assert.equal(value.latitude, original.latitude);
  assert.equal('email' in value.owner, false);
  assert.equal('phone' in value.owner, false);
});

test('non-public, malformed and out-of-range property payloads are refused', () => {
  for (const changes of [
    { status: 'draft' },
    { status: 'archived' },
    { price: 5 },
    { area_sq_m: '0' },
    { latitude: '91' },
    { longitude: '-181' },
    { id: '../mine' },
    { owner: null },
    { created_at: 'invalid' },
  ]) {
    assert.throws(() => parseListing({ ...listing(), ...changes }));
  }
  assert.equal(isListingId(listingId(1)), true);
  assert.equal(isListingId('..%2Fmine'), false);
});

test('photo payloads must reference that property and its exact relative image path', () => {
  const value = listing();
  const photo = value.images[0]!;
  for (const changes of [
    { url: 'https://attacker.example/image' },
    { url: '//attacker.example/image' },
    { listing_id: listingId(2) },
    { url: photo.url + '?token=private' },
  ]) {
    assert.throws(() => parseListing({ ...value, images: [{ ...photo, ...changes }] }));
  }
  assert.throws(() => parseListing({ ...value, images: Array.from({ length: 11 }, () => photo) }));
});

test('page metadata and item limits must match the request', () => {
  assert.deepEqual(parsePage(page([listing()], 1), 0, 20).items, [listing()]);
  for (const changes of [
    { total: -1 },
    { total: 1.5 },
    { offset: 20 },
    { limit: 100 },
    { items: Array.from({ length: 21 }, () => listing()) },
  ]) {
    assert.throws(() => parsePage({ ...page([listing()], 1), ...changes }, 0, 20));
  }
});

test('public list/detail requests send no bearer token and use the configured image origin', async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const api = new ListingsApi(
    new ApiClient('https://api.example.com', async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(
        JSON.stringify(String(url).includes('?') ? page([listing()], 1) : listing()),
      );
    }),
  );
  await api.page(emptyFilters, 0);
  await api.detail(listingId(1));
  assert.equal(calls.length, 2);
  assert.ok(calls[0]!.url.endsWith('/listings?limit=20&offset=0'));
  for (const call of calls)
    assert.equal(new Headers(call.options?.headers).get('Authorization'), null);
  assert.equal(
    api.photoUrl(listing().images[0]!.url),
    'https://api.example.com' + listing().images[0]!.url,
  );
  for (const path of [
    'https://attacker.example/image',
    '//attacker.example/image',
    '/listings/../images/file',
    `/listings/${'-'.repeat(36)}/images/${'-'.repeat(36)}`,
  ])
    assert.throws(() => api.photoUrl(path));
});

test('invalid detail links never issue requests; missing and mismatched records are handled', async () => {
  let calls = 0;
  const api = new ListingsApi(
    new ApiClient('https://api.example.com', async () => {
      calls++;
      return new Response('{}', { status: 404 });
    }),
  );
  await assert.rejects(
    api.detail('../mine'),
    (error: unknown) => error instanceof ApiError && error.status === 404,
  );
  assert.equal(calls, 0);
  await assert.rejects(api.detail(listingId(1)), /no longer available/);
  const wrong = new ListingsApi(
    new ApiClient('https://api.example.com', async () => new Response(JSON.stringify(listing(2)))),
  );
  await assert.rejects(wrong.detail(listingId(1)), /wrong property/);
});
