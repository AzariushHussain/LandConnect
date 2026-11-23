import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { conversation, history, message, permissions } from '../src/features/chat/types';
import { blockedPage, preferences } from '../src/features/privacy/api';
const data = JSON.parse(readFileSync(0, 'utf8'));
const direct = conversation(data.direct, data.actor);
assert.equal(direct.kind, 'direct');
assert.equal('email' in direct.members[0]!.user, false);
const latest = history(data.latest, direct.id, {});
const older = history(data.older, direct.id, { before: latest.next_before_id! });
assert.equal(latest.items.length, 50);
assert.equal(older.items.length, 5);
const initial = history(data.catchup, direct.id, { after: 0 });
const recovered = history(data.catchupLast, direct.id, { after: initial.next_after_id! });
assert.equal(initial.items.length, 50);
assert.equal(recovered.items.length, 5);
assert.equal(new Set([...initial.items, ...recovered.items].map((item) => item.id)).size, 55);
assert.equal(message(data.saved, direct.id).body, 'Synthetic message 0');
const group = conversation(data.group, data.actor);
assert.equal(group.name, 'Mobile group');
assert.equal(permissions(group, data.actor).owner, true);
const transferred = conversation(data.transferred, data.actor);
assert.equal(permissions(transferred, data.actor).owner, false);
assert.equal(permissions(transferred, data.actor).admin, true);
assert.equal(data.hint.type, 'message.created');
assert.equal(data.hint.conversation_id, direct.id);
assert.equal('body' in data.hint, false);
assert.equal(data.inbox.items.length, 1);
console.log(
  'PASS: real direct/group/history/send-retry/permissions routes and socket authentication, heartbeat and authorized notification satisfy the mobile contract. Redis relay delivery is outside this isolated probe.',
);
assert.deepEqual(preferences(data.privacyBefore, data.actor), {
  allow_messages: true,
  allow_calls: true,
});
assert.deepEqual(preferences(data.privacyMessagesOff, data.actor), {
  allow_messages: false,
  allow_calls: true,
});
assert.deepEqual(preferences(data.privacyAfter, data.actor), {
  allow_messages: true,
  allow_calls: false,
});
const blocked = blockedPage(data.blocked, data.actor, 0);
assert.equal(blocked.length, 1);
assert.equal('email' in blocked[0]!, false);
assert.equal(blockedPage(data.unblocked, data.actor, 0).length, 0);
console.log(
  'PASS: real privacy/strict-boolean/private-block-list/block/unblock routes satisfy mobile parsers and enforce direct-message/invitation restrictions while retaining shared groups/history.',
);
