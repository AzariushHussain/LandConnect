import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseListing, parsePage } from '../src/features/listings/types';
import { parseOwnedListing } from '../src/features/management/api';
import { parseMapPage } from '../src/features/maps/api';
import { readCoordinate } from '../src/features/maps/geo';

const data = JSON.parse(readFileSync(0, 'utf8')) as {
  first: unknown;
  second: unknown;
  filtered: unknown;
  detail: unknown;
  firstId: string;
  ownerId: string;
  managedDraft: unknown;
  managedWithPhoto: unknown;
  managedActive: unknown;
  managedArchived: unknown;
  managedSold: unknown;
  map: unknown;
  mapFiltered: unknown;
  mapCrossing: unknown;
  mapEmpty: unknown;
  movedProperty: unknown;
};
const first = parsePage(data.first, 0, 2);
const second = parsePage(data.second, 2, 2);
const filtered = parsePage(data.filtered, 0, 20);
const detail = parseListing(data.detail);
assert.equal(first.total, 3);
assert.equal(first.items.length, 2);
assert.equal(second.items.length, 1);
assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 3);
assert.equal(filtered.total, 1);
assert.equal(filtered.items[0]!.price, '2000.00');
assert.equal(detail.id, data.firstId);
assert.equal(detail.images.length, 1);
assert.equal('email' in detail.owner, false);
console.log(
  'PASS: actual FastAPI listing/detail/filter/page responses satisfy the mobile contract.',
);
assert.equal(parseOwnedListing(data.managedDraft, data.ownerId).status, 'draft');
assert.throws(() => parseListing(data.managedDraft));
assert.equal(parseOwnedListing(data.managedWithPhoto, data.ownerId).images.length, 1);
assert.equal(parseListing(data.managedActive).title, 'Published mobile plot');
const archived = parseOwnedListing(data.managedArchived, data.ownerId);
assert.equal(archived.status, 'archived');
assert.equal(archived.images.length, 0);
assert.throws(() => parseListing(data.managedArchived));
assert.equal(parseOwnedListing(data.managedSold, data.ownerId).status, 'sold');
assert.throws(() => parseListing(data.managedSold));
console.log(
  'PASS: authenticated draft/edit/publish/unpublish/archive/photo routes and owner DTOs satisfy the mobile contract; buyer and cross-owner access are denied.',
);
const map = parseMapPage(data.map),
  mapFiltered = parseMapPage(data.mapFiltered);
assert.equal(map.total, 3);
assert.equal(map.features.length, 3);
assert.deepEqual(
  map.features.find((feature) => feature.id === data.firstId)!.geometry.coordinates,
  [73.8567, 18.5204],
);
assert.equal(mapFiltered.total, 1);
assert.equal(mapFiltered.features[0]!.properties.price, '2000.00');
assert.equal('owner' in map.features[0]!, false);
const crossing = parseMapPage(data.mapCrossing);
assert.deepEqual(
  crossing.features.map((feature) => feature.geometry.coordinates[0]).sort(),
  [-179.5, 179.5],
);
assert.equal(parseMapPage(data.mapEmpty).total, 0);
const moved = parseOwnedListing(data.movedProperty, data.ownerId);
assert.deepEqual(readCoordinate(moved.latitude, moved.longitude), [151.2093, -33.8688]);
console.log(
  'PASS: real GeoJSON bounds/filter/date-line/empty responses satisfy mobile map parsers; selected location coordinates persist through owner PATCH.',
);
