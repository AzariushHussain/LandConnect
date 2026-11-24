import assert from 'node:assert/strict';
import test from 'node:test';
import { pickerPeople, toggleParticipant } from '../src/features/chat/participant-selection';
import { actor, other, person, third } from './fixtures/chat';
import { listingId } from './fixtures/listings';

test('participant picker merges retained selections with loaded people and excludes self/current members', () => {
  const alice = { ...person(other), display_name: 'Alice' },
    bob = { ...person(third), display_name: 'Bob' },
    excluded = person(listingId(999)),
    refreshed = { ...alice, display_name: 'Alice updated' };
  assert.deepEqual(
    pickerPeople([person(actor), refreshed, excluded], [bob, alice], actor, [excluded.id], ''),
    [refreshed, bob],
  );
  assert.deepEqual(pickerPeople([refreshed, bob], [], actor, [], '  ALICE '), [refreshed]);
  assert.deepEqual(pickerPeople([refreshed], [], actor, [], 'No match'), []);
  assert.deepEqual(pickerPeople([], [alice], actor, [], ''), [alice]);
});

test('participant selection enforces the limit, supports removal at capacity and never duplicates a person', () => {
  const alice = person(other),
    bob = person(third);
  const chosen = toggleParticipant([], alice, 1);
  assert.deepEqual(chosen, [alice]);
  assert.deepEqual(toggleParticipant(chosen, bob, 1), [alice]);
  assert.deepEqual(toggleParticipant(chosen, alice, 1), []);
  const full = Array.from({ length: 49 }, (_, index) => person(listingId(index + 1)));
  assert.equal(toggleParticipant(full, alice, 49).length, 49);
  const removed = toggleParticipant(full, full[0]!, 49);
  assert.equal(removed.length, 48);
  assert.equal(toggleParticipant(removed, alice, 49).length, 49);
  assert.equal(full.length, 49);
});
