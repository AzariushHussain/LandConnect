import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import type { ListingRecord } from '../src/features/listings/types';
import { propertyForm } from '../src/features/management/form';
import { PhotoQueue, PendingPhoto } from '../src/features/management/photo-queue';
import { saveProperty } from '../src/features/management/save-property';
import { deferred, listing, listingId } from './fixtures/listings';

const draft = (): ListingRecord => ({ ...listing(), status: 'draft', images: [] });
function photo(number: number) {
  let cleanups = 0;
  const value: PendingPhoto = {
    uri: `file:///cache/photo-${number}.jpg`,
    body: new FormData(),
    cleanup: () => {
      cleanups++;
    },
  };
  return { value, cleanups: () => cleanups };
}
const image = (number: number) => ({ ...listing().images[0]!, id: listingId(number) });
function fixture() {
  const events: string[] = [];
  const photos = new PhotoQueue();
  let record: ListingRecord | null = null;
  let active = true;
  const api = {
    create: async () => {
      events.push('create');
      return draft();
    },
    save: async () => {
      events.push('update');
      return record!;
    },
    upload: async () => {
      events.push('upload');
      return image(200 + events.length);
    },
    changeStatus: async () => {
      events.push('publish');
      return { ...record!, status: 'active' as const };
    },
  };
  return {
    photos,
    events,
    api,
    record: () => record,
    deactivate: () => {
      active = false;
    },
    save: (publish = false) =>
      saveProperty({
        form: propertyForm(listing()),
        record,
        publish,
        photos,
        api,
        active: () => active,
        saved: (value) => {
          record = value;
          events.push(`saved:${value.images.length}`);
        },
        progress: () => {},
      }),
  };
}

test('Expo SDK 58 rejects legacy URI descriptors and serializes File bytes as multipart JPEG', async () => {
  // Use the installed SDK converter to catch changes to the actual fetch contract.
  const { convertFormDataAsync } = createRequire(__filename)(
    '../node_modules/expo/src/winter/fetch/convertFormData.ts',
  ) as {
    convertFormDataAsync: (form: FormData, boundary: string) => Promise<{ body: Uint8Array }>;
  };
  const multipart = (part: unknown) => ({ entries: () => [['file', part]] }) as unknown as FormData;
  await assert.rejects(
    convertFormDataAsync(
      multipart({ uri: 'file:///photo.jpg', name: 'photo.jpg', type: 'image/jpeg' }),
      'test-boundary',
    ),
    /Unsupported FormDataPart/,
  );
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0xd9]);
  const result = await convertFormDataAsync(
    multipart({
      uri: 'file:///photo.jpg',
      name: 'photo.jpg',
      type: 'image/jpeg',
      bytes: async () => bytes,
    }),
    'test-boundary',
  );
  const body = Buffer.from(result.body);
  assert.match(body.toString(), /name="file"; filename="photo.jpg"/);
  assert.match(body.toString(), /content-type: image\/jpeg/);
  assert.ok(body.includes(bytes));
  assert.ok(body.toString().endsWith('--test-boundary--\r\n'));
});

test('photo limit includes saved and pending photos; removal and disposal release only queued files', () => {
  const queue = new PhotoQueue(),
    first = photo(1),
    extra = photo(2);
  queue.add(first.value, 9);
  assert.throws(() => queue.add(extra.value, 9), /10 photos/);
  assert.equal(extra.cleanups(), 1);
  assert.equal(queue.getSnapshot().items.length, 1);
  queue.remove(first.value.uri);
  queue.dispose();
  assert.equal(first.cleanups(), 1);
  const pending = photo(3);
  queue.add(pending.value, 0);
  queue.dispose();
  assert.equal(pending.cleanups(), 1);
});

test('new property is remembered before sequential photo uploads and published only after all succeed', async () => {
  const f = fixture(),
    first = photo(1),
    second = photo(2);
  f.photos.add(first.value, 0);
  f.photos.add(second.value, 0);
  const result = await f.save(true);
  assert.deepEqual(f.events, [
    'create',
    'saved:0',
    'upload',
    'saved:1',
    'upload',
    'saved:2',
    'publish',
    'saved:2',
  ]);
  assert.equal(result?.status, 'active');
  assert.equal(f.photos.getSnapshot().items.length, 0);
  assert.equal(first.cleanups(), 1);
  assert.equal(second.cleanups(), 1);
});

test('failed photo is not retried; remaining selections wait for refresh and reuse the confirmed draft', async () => {
  const f = fixture(),
    first = photo(1),
    second = photo(2),
    third = photo(3);
  for (const p of [first, second, third]) f.photos.add(p.value, 0);
  let attempts = 0;
  f.api.upload = async () => {
    f.events.push('upload');
    attempts++;
    if (attempts === 2) throw new Error('Response lost; the upload may have succeeded.');
    return image(200 + attempts);
  };
  await assert.rejects(f.save(true), /Refresh saved photos/);
  assert.equal(f.record()?.id, listing().id);
  assert.equal(f.record()?.images.length, 1);
  assert.equal(f.record()?.status, 'draft');
  assert.equal(f.photos.getSnapshot().blocked, true);
  assert.deepEqual(f.photos.getSnapshot().items, [third.value]);
  assert.equal(first.cleanups(), 1);
  assert.equal(second.cleanups(), 1);
  assert.equal(third.cleanups(), 0);
  const eventCount = f.events.length;
  await assert.rejects(f.save(true), /Refresh saved photos/);
  assert.equal(f.events.length, eventCount);
  const extra = photo(4);
  assert.throws(() => f.photos.add(extra.value, 1), /Refresh/);
  assert.equal(extra.cleanups(), 1);
  f.photos.reconciled();
  await f.save(true);
  assert.equal(f.events.filter((event) => event === 'create').length, 1);
  assert.equal(f.events.filter((event) => event === 'update').length, 1);
  assert.equal(attempts, 3);
  assert.equal(third.cleanups(), 1);
});

test('late create response after session loss does not upload or publish', async () => {
  const f = fixture(),
    response = deferred<ListingRecord>();
  f.photos.add(photo(1).value, 0);
  f.api.create = () => {
    f.events.push('create');
    return response.promise;
  };
  const saving = f.save(true);
  f.deactivate();
  response.resolve(draft());
  assert.equal(await saving, null);
  assert.deepEqual(f.events, ['create']);
  assert.equal(f.record(), null);
  f.photos.dispose();
});

test('late upload response stops remaining uploads and publish after session loss', async () => {
  const f = fixture(),
    response = deferred<ReturnType<typeof image>>();
  const first = photo(1),
    second = photo(2);
  f.photos.add(first.value, 0);
  f.photos.add(second.value, 0);
  f.api.upload = () => {
    f.events.push('upload');
    return response.promise;
  };
  const saving = f.save(true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.deactivate();
  response.resolve(image(222));
  assert.equal(await saving, null);
  assert.deepEqual(f.events, ['create', 'saved:0', 'upload']);
  assert.equal(first.cleanups(), 1);
  assert.deepEqual(f.photos.getSnapshot().items, [second.value]);
  f.photos.dispose();
});

test('validation and refreshed photo capacity stop requests before upload or publish', async () => {
  const f = fixture();
  await assert.rejects(
    saveProperty({
      form: { ...propertyForm(listing()), price: '0' },
      record: null,
      publish: true,
      photos: f.photos,
      api: f.api,
      active: () => true,
      saved: () => {},
      progress: () => {},
    }),
    /positive/,
  );
  assert.deepEqual(f.events, []);
  const pending = photo(1);
  f.photos.add(pending.value, 0);
  const full = { ...draft(), images: Array.from({ length: 10 }, (_, index) => image(index + 200)) };
  let calls = 0;
  await assert.rejects(
    f.photos.upload(
      full,
      async () => {
        calls++;
        return image(299);
      },
      () => true,
      () => {},
    ),
    /already has 10 photos/,
  );
  assert.equal(calls, 0);
  assert.equal(f.photos.getSnapshot().items.length, 1);
  f.photos.dispose();
});
