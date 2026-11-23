import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callDto, roomToken } from '../src/features/calls/api';
const data = JSON.parse(readFileSync(0, 'utf8'));
const calls = data.calls.map((item: unknown) => callDto(item, data.actor));
assert.deepEqual(
  calls.map((call: { status: string }) => call.status),
  ['ringing', 'accepted', 'ended', 'rejected', 'cancelled'],
);
const media = roomToken(data.media, calls[0].id, false);
assert.equal(media.room, `call-${calls[0].id}`);
assert.equal(data.hint.type, 'call.incoming');
assert.equal(data.hint.call_id, calls[0].id);
assert.equal('token' in data.hint, false);
assert.equal('email' in calls[0].caller, false);
console.log(
  'PASS: real call creation/retry, acceptance, tokens, rejection/cancellation/end, privacy/block enforcement and authenticated socket notification match mobile parsers. Media rooms are faked; Redis relay and device media are outside this probe.',
);
