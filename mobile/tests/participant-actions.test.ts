import assert from 'node:assert/strict';
import test from 'node:test';
import { participantActions } from '../src/features/chat/participant-actions';
import { actor, conversation, other, person, third } from './fixtures/chat';
import { listingId } from './fixtures/listings';

test('owners can promote ordinary participants, demote admins, transfer ownership and remove either', () => {
  const group = conversation(true);
  assert.deepEqual(participantActions(group, actor, other), [
    'message',
    'audio',
    'video',
    'promote',
    'transfer',
    'remove',
  ]);
  group.members[1]!.role = 'admin';
  assert.deepEqual(participantActions(group, actor, other), [
    'message',
    'audio',
    'video',
    'demote',
    'transfer',
    'remove',
  ]);
});

test('admins can remove ordinary participants but cannot change admins or ownership', () => {
  const group = conversation(true);
  group.members[1]!.role = 'admin';
  group.members.push({ user: person(third), role: 'member', joined_at: group.created_at });
  assert.deepEqual(participantActions(group, other, third), [
    'message',
    'audio',
    'video',
    'remove',
  ]);
  assert.deepEqual(participantActions(group, other, actor), ['message', 'audio', 'video']);
  group.members[2]!.role = 'admin';
  assert.deepEqual(participantActions(group, other, third), ['message', 'audio', 'video']);
});

test('marketplace roles do not grant group administration to ordinary members', () => {
  const group = conversation(true);
  for (const role of ['buyer', 'seller', 'broker'] as const) {
    group.members[1]!.user.role = role;
    assert.deepEqual(participantActions(group, other, actor), ['message', 'audio', 'video']);
  }
});

test('self, removed participants, removed actors and direct conversations have no participant actions', () => {
  const group = conversation(true),
    outsider = listingId(999);
  assert.deepEqual(participantActions(group, actor, actor), []);
  assert.deepEqual(participantActions(group, actor, outsider), []);
  assert.deepEqual(participantActions(group, outsider, other), []);
  assert.deepEqual(participantActions(conversation(), actor, other), []);
});
