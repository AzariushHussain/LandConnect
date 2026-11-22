import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseListing, parsePage } from '../src/features/listings/types';

const data = JSON.parse(readFileSync(0, 'utf8')) as {
  first: unknown;
  second: unknown;
  filtered: unknown;
  detail: unknown;
  firstId: string;
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
