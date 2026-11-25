import assert from 'node:assert/strict';
import test from 'node:test';
import { ContactBlock } from '../src/features/privacy/contact-block';
import { deferred } from './fixtures/listings';
import { other } from './fixtures/chat';

test('contact blocking waits for confirmation and serializes repeated block/unblock requests', async () => {
  const response = deferred<void>();
  let saved = false,
    blocks = 0,
    unblocks = 0;
  const contact = new ContactBlock(other, {
    blocked: async () => saved,
    block: async (id) => {
      assert.equal(id, other);
      blocks++;
      await response.promise;
      saved = true;
    },
    unblock: async () => {
      unblocks++;
      saved = false;
    },
  });
  await contact.refresh();
  const blocking = contact.change(true);
  await contact.change(true);
  await contact.change(false);
  await contact.refresh();
  assert.equal(blocks, 1);
  assert.equal(contact.getSnapshot().blocked, false);
  assert.equal(contact.getSnapshot().busy, true);
  response.resolve();
  await blocking;
  assert.equal(contact.getSnapshot().blocked, true);
  await contact.change(false);
  assert.equal(unblocks, 1);
  assert.equal(contact.getSnapshot().blocked, false);
});

test('uncertain block mutations require reconciliation and do not auto-retry', async () => {
  let calls = 0,
    saved = false;
  const contact = new ContactBlock(other, {
    blocked: async () => saved,
    block: async () => {
      calls++;
      saved = true;
      throw new Error('Response lost');
    },
    unblock: async () => {},
  });
  await contact.refresh();
  await contact.change(true);
  assert.equal(contact.getSnapshot().uncertain, true);
  assert.equal(contact.getSnapshot().blocked, false);
  await contact.change(true);
  assert.equal(calls, 1);
  await contact.refresh();
  assert.equal(contact.getSnapshot().blocked, true);
  assert.equal(contact.getSnapshot().uncertain, false);
});

test('refresh failure keeps a confirmed block and stale responses cannot update a stopped contact', async () => {
  let fail = false;
  const response = deferred<boolean>();
  const contact = new ContactBlock(other, {
    blocked: async () => {
      if (fail) throw new Error('Unavailable');
      return true;
    },
    block: async () => {},
    unblock: async () => {},
  });
  await contact.refresh();
  fail = true;
  await contact.refresh();
  assert.equal(contact.getSnapshot().blocked, true);
  const stopped = new ContactBlock(other, {
    blocked: () => response.promise,
    block: async () => {},
    unblock: async () => {},
  });
  const reading = stopped.refresh();
  stopped.stop();
  response.resolve(true);
  await reading;
  assert.equal(stopped.getSnapshot().blocked, null);
  await stopped.change(true);
  assert.equal(stopped.getSnapshot().blocked, null);
});

test('stopping during a mutation ignores its late confirmation and prevents future writes', async () => {
  const response = deferred<void>();
  let calls = 0;
  const contact = new ContactBlock(other, {
    blocked: async () => false,
    block: async () => {
      calls++;
      return response.promise;
    },
    unblock: async () => {},
  });
  await contact.refresh();
  const pending = contact.change(true);
  contact.stop();
  response.resolve();
  await pending;
  await contact.change(true);
  assert.equal(contact.getSnapshot().blocked, false);
  assert.equal(calls, 1);
});

test('a stopped initial read can restart after React effect replay without accepting the old response', async () => {
  const old = deferred<boolean>();
  let reads = 0;
  const contact = new ContactBlock(other, {
    blocked: async () => (++reads === 1 ? old.promise : false),
    block: async () => {},
    unblock: async () => {},
  });
  const initial = contact.refresh();
  contact.stop();
  await contact.refresh();
  old.resolve(true);
  await initial;
  assert.equal(contact.getSnapshot().blocked, false);
  assert.equal(contact.getSnapshot().loading, false);
});
