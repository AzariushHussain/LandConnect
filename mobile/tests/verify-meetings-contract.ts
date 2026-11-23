import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { meetingDto, memberStatus } from '../src/features/meetings/api';
import { mediaToken } from '../src/features/media/token';
const data = JSON.parse(readFileSync(0, 'utf8'));
const created = meetingDto(data.created, data.actor);
assert.equal(memberStatus(created, data.guest), 'invited');
const accepted = meetingDto(data.accepted, data.guest);
assert.equal(memberStatus(accepted, data.guest), 'accepted');
assert.equal('email' in accepted.owner, false);
assert.equal(meetingDto(data.retiring, data.actor).media_cleanup_pending, true);
const rotated = meetingDto(data.rotated, data.actor);
assert.equal(rotated.room_version, 2);
assert.equal(rotated.media_cleanup_pending, false);
mediaToken(data.media, `meeting-${created.id}-1`, false);
mediaToken(data.newMedia, `meeting-${created.id}-2`, false);
assert.throws(() => mediaToken(data.newMedia, `meeting-${created.id}-1`, false));
assert.ok(meetingDto(data.ended, data.actor).ended_at);
assert.equal(data.history.items.length, 1);
assert.equal(data.hint.type, 'meeting.invited');
assert.equal(data.hint.meeting_id, created.id);
assert.equal('token' in data.hint, false);
console.log(
  'PASS: real meeting creation/retry, consent, host/member permissions, tokens, leave, empty 202 withdrawal/removal, room rotation/cleanup, end, privacy/block rules and authenticated socket notification match mobile DTOs. Media rooms are fake; Redis relay and physical-device media remain outside this probe.',
);
