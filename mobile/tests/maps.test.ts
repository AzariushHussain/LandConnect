import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../src/api/client';
import { DEFAULT_MAP_STYLE, validateMapStyle } from '../src/config/map-style';
import { emptyFilters } from '../src/features/listings/filters';
import {
  MAP_LIMIT,
  MapPage,
  MapsApi,
  MapPoint,
  parseMapPage,
  parseMapPoint,
  routeFilters,
} from '../src/features/maps/api';
import {
  cameraCenter,
  nativeBounds,
  pickedCoordinate,
  readCoordinate,
  sameBounds,
  validateBounds,
} from '../src/features/maps/geo';
import { locateOnce, LocationPort } from '../src/features/maps/locate';
import { MapSearch } from '../src/features/maps/search';
import { deferred, listingId } from './fixtures/listings';

const area = { west: 73, south: 18, east: 74, north: 19 };
const otherArea = { west: 72, south: 18, east: 73, north: 20 };
function point(n = 1): MapPoint {
  return {
    type: 'Feature',
    id: listingId(n),
    geometry: { type: 'Point', coordinates: [73.8567, 18.5204] },
    properties: {
      title: 'Pune plot',
      city: 'Pune',
      price: '999999999999.99',
      currency: 'INR',
      area_sq_m: '500.00',
    },
  };
}
function page(features = [point()], total = features.length): MapPage {
  return { type: 'FeatureCollection', features, total, offset: 0, limit: MAP_LIMIT };
}
const json = (value: unknown) => new Response(JSON.stringify(value));

test('native bounds preserve date-line crossings and normalize wrapped cameras and world views', () => {
  assert.deepEqual(nativeBounds([170, -20, 190, 20]), {
    west: 170,
    south: -20,
    east: -170,
    north: 20,
  });
  assert.deepEqual(nativeBounds([170, -20, -170, 20]), {
    west: 170,
    south: -20,
    east: -170,
    north: 20,
  });
  assert.deepEqual(nativeBounds([-210, -80, 210, 80]), {
    west: -180,
    south: -80,
    east: 180,
    north: 80,
  });
  assert.deepEqual(nativeBounds([433, 18, 434, 19]), area);
  assert.equal(sameBounds(nativeBounds([73.00000001, 18, 74, 19]), area), true);
  assert.equal(sameBounds(null, area), false);
});

test('invalid and partial native/API bounds are refused', () => {
  for (const value of [
    null,
    [1, 2],
    ['73', 18, 74, 19],
    [73, NaN, 74, 19],
    [73, 20, 74, 19],
    [73, -91, 74, 19],
  ])
    assert.throws(() => nativeBounds(value));
  assert.throws(() => validateBounds({ ...area, west: 181 }));
  assert.throws(() => validateBounds({ ...area, north: Infinity }));
});

test('selection uses longitude first, rounds to six places and preserves manual zero/negative coordinates', () => {
  assert.deepEqual(pickedCoordinate([73.856700123, 18.520400876]), {
    longitude: '73.856700',
    latitude: '18.520401',
  });
  assert.deepEqual(pickedCoordinate([190, -20]), {
    longitude: '-170.000000',
    latitude: '-20.000000',
  });
  assert.deepEqual(readCoordinate('0', '0'), [0, 0]);
  assert.deepEqual(readCoordinate('-33.500000', '151.200000'), [151.2, -33.5]);
  for (const [lat, lng] of [
    ['', ''],
    ['91', '180'],
    ['10', '181'],
    ['1e1', '20'],
    ['1.1234567', '20'],
  ])
    assert.equal(readCoordinate(lat!, lng!), null);
  for (const value of [[0, 91], [Infinity, 0], [0, NaN], [0], null])
    assert.throws(() => pickedCoordinate(value));
  const polar = readCoordinate('90', '0')!;
  assert.equal(cameraCenter(polar)[1], 85.051129);
  assert.equal(polar[1], 90);
});

test('map styles are public HTTPS configuration without embedded credentials', () => {
  assert.equal(validateMapStyle(), DEFAULT_MAP_STYLE);
  assert.equal(
    validateMapStyle(' https://maps.example/style.json '),
    'https://maps.example/style.json',
  );
  for (const value of [
    'http://maps.example/style',
    'file:///private',
    'https://user:pass@maps.example/style',
    'https://maps.example/style#private',
    'bad',
  ])
    assert.throws(() => validateMapStyle(value));
});

test('route filters whitelist fields, normalize codes and validate exact decimal comparisons', () => {
  assert.deepEqual(routeFilters(), emptyFilters);
  assert.equal(
    routeFilters(JSON.stringify({ city: ' Pune ', currency: 'inr', min_price: '999999999999.98' }))
      .min_price,
    '999999999999.98',
  );
  assert.equal(routeFilters('{"country":"in"}').country, 'IN');
  for (const raw of [
    '{',
    'null',
    '[]',
    '"text"',
    '{"token":"secret"}',
    '{"toString":"bad"}',
    '{"q":42}',
    '{"__proto__":"bad"}',
    ' '.repeat(3001),
  ])
    assert.throws(() => routeFilters(raw));
  assert.throws(() => routeFilters('{"min_price":"100"}'), /currency/);
});

test('map GeoJSON preserves money strings and strips unexpected owner/contact data', () => {
  const parsed = parseMapPoint({
    ...point(),
    owner: { email: 'private@example.com' },
    properties: { ...point().properties, email: 'private@example.com' },
  });
  assert.equal(parsed.properties.price, '999999999999.99');
  assert.deepEqual(parsed.geometry.coordinates, [73.8567, 18.5204]);
  assert.equal('email' in parsed.properties, false);
  assert.equal('owner' in parsed, false);
});

test('map GeoJSON rejects malformed IDs, geometry, amounts, codes and coordinates', () => {
  for (const change of [
    { id: 'invalid' },
    { type: 'Point' },
    { geometry: { type: 'LineString', coordinates: [1, 2] } },
    { geometry: { type: 'Point', coordinates: [181, 0] } },
    { geometry: { type: 'Point', coordinates: [0, 91] } },
    { geometry: { type: 'Point', coordinates: ['73', 18] } },
    { properties: { ...point().properties, price: 100 } },
    { properties: { ...point().properties, price: '0' } },
    { properties: { ...point().properties, currency: 'inr' } },
  ])
    assert.throws(() => parseMapPoint({ ...point(), ...change }));
  assert.throws(() => parseMapPoint(null));
});

test('map pages enforce a bounded first page, truthful totals and unique property IDs', () => {
  assert.equal(parseMapPage(page()).features.length, 1);
  assert.equal(parseMapPage(page([], 0)).total, 0);
  for (const change of [
    { type: 'Collection' },
    { offset: 20 },
    { limit: 20 },
    { total: -1 },
    { total: 0 },
    { features: [point(), point()] },
    { features: Array.from({ length: 101 }, (_, n) => point(n)), total: 101 },
  ])
    assert.throws(() => parseMapPage({ ...page(), ...change }));
});

test('map requests send applied filters and four bounds without bearer tokens', async () => {
  let requestUrl = '';
  let options: RequestInit | undefined;
  const api = new MapsApi(
    new ApiClient('https://api.example.com', async (url, init) => {
      requestUrl = String(url);
      options = init;
      return json(page());
    }),
  );
  await api.search(
    { ...emptyFilters, q: 'land & road', currency: 'INR', min_price: '999999999999.98' },
    { west: 170, east: -170, south: -20, north: 20 },
  );
  const url = new URL(requestUrl);
  assert.equal(url.pathname, '/listings/map');
  assert.equal(url.searchParams.get('q'), 'land & road');
  assert.equal(url.searchParams.get('min_price'), '999999999999.98');
  assert.equal(url.searchParams.get('limit'), '100');
  assert.equal(url.searchParams.get('west'), '170');
  assert.equal(url.searchParams.get('east'), '-170');
  assert.equal(new Headers(options?.headers).get('Authorization'), null);
});

test('invalid map area/filter combinations never reach the service', async () => {
  let calls = 0;
  const api = new MapsApi(
    new ApiClient('https://api.example.com', async () => {
      calls++;
      return json(page());
    }),
  );
  await assert.rejects(api.search(emptyFilters, { ...area, south: 30 }));
  await assert.rejects(api.search({ ...emptyFilters, min_price: '100' }, area));
  assert.equal(calls, 0);
});

test('panning does not auto-request and duplicate searches for the same pending area are ignored', async () => {
  const pending = deferred<MapPage>();
  let calls = 0;
  const search = new MapSearch(
    {
      search: async () => {
        calls++;
        return pending.promise;
      },
    },
    emptyFilters,
  );
  await search.search();
  assert.equal(calls, 0);
  search.viewport(area);
  assert.equal(calls, 0);
  const first = search.search();
  await search.search();
  assert.equal(calls, 1);
  search.viewport(otherArea);
  pending.resolve(page());
  await first;
  assert.deepEqual(search.getSnapshot().searched, area);
  assert.deepEqual(search.getSnapshot().viewport, otherArea);
  assert.equal(search.getSnapshot().features.length, 1);
});

test('a new area search wins over a late response and unmounted searches ignore pending results', async () => {
  const first = deferred<MapPage>(),
    second = deferred<MapPage>();
  let calls = 0;
  const search = new MapSearch(
    { search: async () => (++calls === 1 ? first.promise : second.promise) },
    emptyFilters,
  );
  search.viewport(area);
  const old = search.search();
  search.viewport(otherArea);
  const latest = search.search();
  second.resolve(page([point(2)]));
  await latest;
  first.resolve(page([point(1)]));
  await old;
  assert.equal(search.getSnapshot().features[0]!.id, listingId(2));
  const stale = deferred<MapPage>();
  const closed = new MapSearch({ search: () => stale.promise }, emptyFilters);
  closed.viewport(area);
  const request = closed.search();
  closed.invalidate();
  stale.resolve(page());
  await request;
  assert.equal(closed.getSnapshot().features.length, 0);
  assert.equal(closed.getSnapshot().status, 'idle');
  await closed.search();
  assert.equal(closed.getSnapshot().status, 'ready');
});

test('map errors are visible and explicit retries recover an empty result', async () => {
  let fail = true;
  const search = new MapSearch(
    {
      search: async () => {
        if (fail) throw new Error('offline');
        return page([], 0);
      },
    },
    emptyFilters,
  );
  search.viewport(area);
  await search.search();
  assert.equal(search.getSnapshot().status, 'error');
  fail = false;
  await search.search();
  assert.equal(search.getSnapshot().status, 'ready');
  assert.equal(search.getSnapshot().total, 0);
});

function locationPort(): LocationPort {
  return {
    requestPermission: async () => ({ granted: true, canAskAgain: true }),
    servicesEnabled: async () => true,
    position: async () => ({
      coords: { longitude: 73.85670012, latitude: 18.52040099, accuracy: 103.1 },
    }),
  };
}
test('location asks foreground permission first and never reads GPS when declined or disabled', async () => {
  let calls = 0;
  const port = locationPort();
  port.position = async () => {
    calls++;
    throw new Error('must not read');
  };
  for (const canAskAgain of [true, false]) {
    port.requestPermission = async () => ({ granted: false, canAskAgain });
    await assert.rejects(locateOnce(port), /permission/);
  }
  port.requestPermission = locationPort().requestPermission;
  port.servicesEnabled = async () => false;
  await assert.rejects(locateOnce(port), /Device location is off/);
  assert.equal(calls, 0);
});

test('approximate device location preserves coordinate order and reports accuracy without raw native errors', async () => {
  const port = locationPort();
  assert.deepEqual(await locateOnce(port), {
    longitude: '73.856700',
    latitude: '18.520401',
    accuracy: 104,
  });
  port.position = async () => {
    throw new Error('native error containing precise position');
  };
  await assert.rejects(
    locateOnce(port),
    (e: Error) => !e.message.includes('precise') && /Could not read/.test(e.message),
  );
});

test('device location lookup has a bounded wait and ignores late completion', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const result = deferred<Awaited<ReturnType<LocationPort['position']>>>();
  const port = locationPort();
  port.position = () => result.promise;
  const request = locateOnce(port);
  const rejected = assert.rejects(request, /took too long/);
  await Promise.resolve();
  await Promise.resolve();
  context.mock.timers.tick(15000);
  await rejected;
  result.resolve({ coords: { longitude: 0, latitude: 0, accuracy: null } });
});
