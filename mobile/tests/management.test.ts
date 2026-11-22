import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient, ApiError } from '../src/api/client';
import { ManagementApi, parseOwnedListing } from '../src/features/management/api';
import {
  emptyProperty,
  propertyForm,
  validateProperty,
  canManage,
} from '../src/features/management/form';
import {
  MAX_PHOTO_BYTES,
  resizePhoto,
  validatePreparedPhoto,
} from '../src/features/management/photo-policy';
import { parseListing, ListingStatus } from '../src/features/listings/types';
import { deferred, listing, listingId } from './fixtures/listings';

function fixture(fetcher: typeof fetch) {
  let access: { token: string; user: { id: string; role: string } } | null = {
    token: 'owner-token',
    user: { id: listing().owner.id, role: 'seller' },
  };
  const rejected: string[] = [];
  const session = {
    access: () =>
      access as ReturnType<import('../src/features/auth/session').SessionController['access']>,
    checkExpiry: () => {},
    rejectToken: async (token: string) => {
      rejected.push(token);
      if (access?.token === token) access = null;
    },
  };
  return {
    api: new ManagementApi(new ApiClient('https://api.example.com', fetcher), session),
    set: (next: typeof access) => {
      access = next;
    },
    rejected,
  };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const form = () => propertyForm(listing());

test('owner parser accepts private statuses while community parser rejects them', () => {
  for (const status of ['draft', 'sold', 'archived'] as const) {
    const row = { ...listing(), status };
    assert.equal(parseOwnedListing(row, row.owner.id).status, status);
    assert.throws(() => parseListing(row));
  }
  assert.throws(() => parseOwnedListing(listing(), listingId(123)), /own properties/);
  assert.throws(() => parseOwnedListing({ ...listing(), status: 'unknown' }, listing().owner.id));
});

test('form trims, normalizes codes, preserves decimals and excludes server-owned fields', () => {
  const data = validateProperty({
    ...form(),
    title: ' Plot ',
    currency: 'inr',
    country: 'in',
    price: '999999999999.99',
    latitude: '-90.000000',
    longitude: '180.000000',
    owner_id: 'injected',
    status: 'active',
  } as ReturnType<typeof form>);
  assert.equal(data.title, 'Plot');
  assert.equal(data.price, '999999999999.99');
  assert.equal(data.currency, 'INR');
  assert.equal(data.country, 'IN');
  assert.equal('owner_id' in data, false);
  assert.equal('status' in data, false);
  assert.throws(() => validateProperty(emptyProperty), /required/);
  for (const price of ['0', '-1', '1e3', '1,000', '0.001', '1000000000000', 'NaN'])
    assert.throws(() => validateProperty({ ...form(), price }));
  for (const latitude of ['90.000001', '-90.1', '1.1234567', 'Infinity'])
    assert.throws(() => validateProperty({ ...form(), latitude }));
  assert.throws(() => validateProperty({ ...form(), longitude: '180.000001' }));
  assert.throws(() => validateProperty({ ...form(), description: 'a'.repeat(10001) }));
  assert.equal(canManage('broker'), true);
  assert.equal(canManage('buyer'), false);
});

test('management never sends a request for an absent session or buyer role', async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return json(listing());
  });
  f.set(null);
  await assert.rejects(f.api.mine('all', 0), (e) => e instanceof ApiError && e.status === 401);
  f.set({ token: 'buyer', user: { id: listing().owner.id, role: 'buyer' } });
  await assert.rejects(f.api.create(form()), (e) => e instanceof ApiError && e.status === 403);
  assert.equal(calls, 0);
});

test('create forces a private draft and authenticated PATCH preserves status unless explicitly publishing', async () => {
  const calls: { path: string; init: RequestInit }[] = [];
  const f = fixture(async (url, init) => {
    calls.push({ path: String(url), init: init! });
    return json({ ...listing(), status: 'draft' });
  });
  await f.api.create(form());
  await f.api.save(listing().id, form());
  await f.api.save(listing().id, form(), 'active');
  assert.equal(calls[0]!.init.method, 'POST');
  assert.equal(JSON.parse(String(calls[0]!.init.body)).status, 'draft');
  assert.equal(new Headers(calls[0]!.init.headers).get('Authorization'), 'Bearer owner-token');
  assert.equal(calls[1]!.init.method, 'PATCH');
  assert.equal('status' in JSON.parse(String(calls[1]!.init.body)), false);
  assert.equal(JSON.parse(String(calls[2]!.init.body)).status, 'active');
});

test('owner list validates pagination, status and every returned owner', async () => {
  let response: unknown = {
    items: [{ ...listing(), status: 'draft' }],
    total: 1,
    offset: 0,
    limit: 20,
  };
  let url = '';
  const f = fixture(async (path) => {
    url = String(path);
    return json(response);
  });
  assert.equal((await f.api.mine('draft', 0)).items[0]!.status, 'draft');
  assert.match(url, /status=draft/);
  await assert.rejects(f.api.mine('all', 10001));
  response = { items: [listing()], total: 1, offset: 20, limit: 20 };
  await assert.rejects(f.api.mine('all', 0), /Invalid property list/);
  response = {
    items: [{ ...listing(), owner: { ...listing().owner, id: listingId(222) } }],
    total: 1,
    offset: 0,
    limit: 20,
  };
  await assert.rejects(f.api.mine('all', 0), /own properties/);
});

test('property identifiers and runtime statuses are checked before writes', async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return json(listing());
  });
  await assert.rejects(f.api.archive('../users'));
  await assert.rejects(f.api.removePhoto(listing().id, 'invalid'));
  await assert.rejects(f.api.changeStatus(listing().id, 'unknown' as ListingStatus));
  await assert.rejects(f.api.save(listing().id, form(), 'unknown' as ListingStatus));
  assert.equal(calls, 0);
  await assert.rejects(f.api.detail(listingId(2)), /wrong property/);
});

test('network failures and malformed successful writes report uncertainty without retrying', async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    throw new Error('raw native error with token');
  });
  await assert.rejects(f.api.create(form()), /may have succeeded.*Refresh/);
  assert.equal(calls, 1);
  const malformed = fixture(async () => json({}));
  await assert.rejects(malformed.api.save(listing().id, form()), /may have succeeded/);
});

test('401 rejects the captured token, while late results cannot cross accounts', async () => {
  const response = deferred<Response>();
  const f = fixture(async () => response.promise);
  const read = f.api.detail(listing().id);
  f.set({ token: 'new-token', user: { id: listingId(333), role: 'broker' } });
  response.resolve(json(listing()));
  await assert.rejects(read, (e) => e instanceof ApiError && e.status === 401);
  assert.deepEqual(f.rejected, ['owner-token']);
  const invalid = fixture(async () => json({}, 401));
  await assert.rejects(invalid.api.mine('all', 0));
  assert.deepEqual(invalid.rejected, ['owner-token']);
  const missing = fixture(async () => json({}, 404));
  await assert.rejects(missing.api.detail(listing().id), /no longer available to your account/);
});

test('multipart uses a native-generated boundary; archive and photo removal accept empty 204', async () => {
  const calls: RequestInit[] = [];
  const image = listing().images[0]!;
  const f = fixture(async (_path, init) => {
    calls.push(init!);
    return init!.method === 'DELETE' ? new Response(null, { status: 204 }) : json(image, 201);
  });
  const body = new FormData();
  body.append('file', new Blob(['synthetic']), 'property.jpg');
  assert.deepEqual(await f.api.upload(listing().id, body), image);
  await f.api.archive(listing().id);
  await f.api.removePhoto(listing().id, image.id);
  assert.equal(calls[0]!.body, body);
  assert.equal(new Headers(calls[0]!.headers).get('Content-Type'), null);
  assert.equal(calls[1]!.method, 'DELETE');
  assert.equal(calls[2]!.method, 'DELETE');
  const mismatch = fixture(async () => json({ ...image, url: 'https://untrusted.example/photo' }));
  await assert.rejects(mismatch.api.upload(listing().id, body), /may have succeeded/);
});

test('photo policy bounds decoded dimensions, resize and prepared bytes', () => {
  assert.equal(resizePhoto(2048, 1024), null);
  assert.deepEqual(resizePhoto(4000, 3000), { width: 2048 });
  assert.deepEqual(resizePhoto(3000, 4000), { height: 2048 });
  for (const [width, height] of [
    [0, 10],
    [-1, 10],
    [1.5, 10],
    [10000, 10000],
    [NaN, 20],
  ])
    assert.throws(() => resizePhoto(width!, height!));
  validatePreparedPhoto(MAX_PHOTO_BYTES, 2048, 1024);
  for (const size of [0, -1, NaN, Infinity, MAX_PHOTO_BYTES + 1])
    assert.throws(() => validatePreparedPhoto(size, 2048, 1024));
  assert.throws(() => validatePreparedPhoto(100, 2049, 1024));
});

test('multipart gets a bounded 45-second timeout', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let aborted = false;
  const client = new ApiClient(
    'https://api.example.com',
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      }),
  );
  const pending = assert.rejects(
    client.request('/listings/x/images', { form: new FormData() }),
    /Check your connection/,
  );
  context.mock.timers.tick(12_000);
  assert.equal(aborted, false);
  context.mock.timers.tick(33_000);
  await pending;
  assert.equal(aborted, true);
});
