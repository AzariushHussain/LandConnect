# LandConnect Meetings Guide

Invite-only group audio/video, consent, member removal and media cleanup. Implemented checkpoint: 22 November 2026.

## 1. Meeting workflow and endpoints

This checkpoint extends the existing one-to-one calling backend with group meetings. All marketplace roles can host. Each meeting has one owner and at most 49 current invited/accepted guests. Meetings are independent of text conversations. The backend continues to use self-hosted LiveKit without agents or AI services.

## Step 1: Create an invitation roster

POST /meetings requires an application bearer token and accepts:

```json
{
  "client_id": "ec56e840-235c-498c-a486-9097ccdd2954",
  "title": "Land discussion",
  "kind": "video",
  "member_ids": ["a9eebd6d-f930-4bd8-8ecb-7281b0af1227"]
}
```

Audio is also supported; video is the default. Titles are trimmed, 1 through 150 characters. Supply 1 through 49 distinct guest IDs, excluding the owner. The owner is accepted automatically; guests start invited. Creation returns 201. The same client UUID and original data return the existing meeting with 200; conflicting data returns 409, even if the roster has since changed.

## Step 2: Accept, join and manage the session

```text
GET    /meetings                      private list and filters
GET    /meetings/{id}                 current roster and state
POST   /meetings/{id}/members         owner invites {user_id}
POST   /meetings/{id}/accept          guest accepts consent
POST   /meetings/{id}/decline         guest withdraws consent
POST   /meetings/{id}/token           accepted member joins media
POST   /meetings/{id}/leave           disconnect this session
DELETE /meetings/{id}/members/{user}  owner revokes access
POST   /meetings/{id}/end             owner closes the meeting
```

The list supports limit/offset, status=open/ended and invitation=invited/accepted. Public member summaries exclude private email and phone details. Reads and tokens require current invited/accepted access; outsiders and removed/declined members receive 404. Accepted membership permits tokens; an unanswered invitation does not. Private responses use no-store.

Only the owner can invite, remove others or end the meeting. The owner cannot decline or remove themselves; they can end it. Leaving a media session preserves accepted access for rejoin while the meeting remains open. Declining withdraws access until the owner reinvites. Acceptance is consent, not live attendance; the client must use SDK participant events for the connected roster.

<!-- pagebreak -->

## 2. Persistence, concurrency and privacy

## Step 3: Extend the existing models

Meeting and MeetingMember remain separate model files. Meeting gains a client retry key, audio/video kind, original invitation IDs, room version/SID, retired-room cleanup name, closure timestamp and reconciliation timestamp. A unique owner/client UUID constraint prevents duplicate creation. Original guest IDs are retained privately so a creation retry can be compared after roster edits.

MeetingMember gains invited, accepted, declined or removed status, a response timestamp and the last token-issue timestamp. Removed rows are retained for access history and safe reinvitation. The response omits internal token-issue and retired-room fields; media_cleanup_pending communicates delayed room cleanup.

The reviewed Alembic revision is 0004_meetings. Legacy member access is preserved as accepted; owner membership is backfilled if absent. Existing titles, IDs and meeting records remain intact. The migration adds enum checks, a positive room-version check and indexes. Downgrade refuses open meetings or pending cleanup, avoiding loss of active permissions or cleanup intent.

## Step 4: Serialize changes before issuing capabilities

The service first locks relevant user rows in sorted UUID order, then the parent meeting. Membership and state are refreshed after the lock is acquired. A request that waited behind removal cannot rely on an earlier membership snapshot. The PostgreSQL concurrency test reproduces a blocked join and proves it is denied after removal commits.

Creation and invitations use the same user-lock order as privacy changes. New records and their event outbox entries commit together. Worker room checks also lock the parent before changing state. This coordinates token issuance, removal, ending and background reconciliation across API instances.

## Step 5: Apply explicit privacy rules

New invitations check incoming-call preferences and blocks among resulting current members. Acceptance and token requests recheck permission. A block cannot be bypassed by introducing a blocked pair through a new invitation.

If a guest blocks someone in an open shared meeting, the blocker is withdrawn from that meeting. If the owner blocks someone, the blocked target is removed instead. Disabling incoming calls revokes the user's guest memberships, while meetings owned by the user remain available. These changes commit with the privacy update and queue any necessary media retirement.

Other participants retain their invitations; the meeting is not ended for everyone. If token-bearing access was revoked, however, everyone connected to that room must reconnect after rotation. These media rules differ from existing shared text-chat history. No reason revealing another user's private block list is included in notifications.

<!-- pagebreak -->

## 3. Scoped tokens and secure removal

## Step 6: Create media lazily

The first accepted member requesting a token creates the LiveKit room. The room holds at most 50 participants, with an empty timeout of 300 seconds and a departure timeout of 20 seconds. The owner need not stay connected for guests to participate. A roster awaiting its first join can remain open until the owner ends it.

Tokens use the existing bounded TTL, default 120 seconds, and bind the authenticated user to a single versioned meeting room. Audio grants microphone publishing; video grants microphone and camera. Room administration/creation, server recording, data publishing, screen sharing and agent-session management are not granted. Tokens are returned only through private REST responses, never broker events.

## Step 7: Retire the old room on access revocation

In self-hosted LiveKit, RemoveParticipant does not invalidate an existing token. A simple kick would let its holder rejoin with that token. LandConnect therefore rotates rooms when revoking access from a member who has received media tokens.

```text
Owner removes a token-bearing member
  -> lock meeting; revoke member status
  -> retain old room name as durable cleanup intent
  -> advance room version; clear current media SID
  -> commit removal and realtime hints
  -> delete retired room, retrying failures
  -> remaining members request fresh room tokens
```

For example, meeting-UUID-1 is retired and remaining members join meeting-UUID-2. A retained token is signed for version 1 and cannot authorize version 2. Keep room.auto_create=false: the retired room must never be recreated by an old token. A token request also ends a meeting if an already-materialized room is missing or unexpectedly replaced, rather than recreating that same room name.

Removal or decline returns 204 after cleanup, or 202 when authorization has been revoked but media cleanup must retry. New tokens return 503 while the retired room remains pending. GET meeting state exposes media_cleanup_pending. During a control-plane outage, old media can continue until deletion succeeds; clients should disconnect locally immediately.

Removing an invitee who has never received a token avoids this rotation. Leaving is different: it disconnects the current participant while preserving authorized rejoin. A member who permanently wants to withdraw consent should decline. Once the last participant leaves and LiveKit deletes the room after its timeout, reconciliation ends the logical meeting; rejoin then requires a new meeting.

<!-- pagebreak -->

## 4. Events, maintenance and code walkthrough

## Step 8: Reuse the communication Pub/Sub path

Meeting events share the existing PostgreSQL outbox, Redis per-user channels and authenticated /ws/chat socket. The event union now accepts meeting.invited, meeting.updated, meeting.member_removed, meeting.room_changed and meeting.ended alongside existing chat and one-to-one call events.

Hints contain event_id, meeting_id and optional actor_id/target_user_id. They omit media tokens and message content. Before forwarding, the API rechecks current access. A revoked member may receive their own member_removed hint so the client can clear its meeting UI, but cannot fetch the current roster or tokens.

Deduplicate hints and fetch REST state. After room_changed, disconnect the old SDK room, wait until cleanup is no longer pending, request a new token and reconnect. Cleanup completion emits another room_changed hint. Notifications can be missed, duplicated or reordered, so periodically reconcile state and recover invitations using GET /meetings?status=open&invitation=invited.

## Step 9: Retry cleanup and reconcile media state

The existing communication maintenance loop now also runs meeting maintenance. It retries retired-room deletion in bounded batches, rotating retry order after failures. Pending cleanup is stored in PostgreSQL and survives API restarts. Ended meetings cannot receive new tokens; successful cleanup records room_closed_at without changing that timestamp on repeated end requests.

For materialized open meetings, the worker checks room identity in bounded batches. Missing or replaced rooms end the logical meeting and trigger cleanup where needed. A media API outage does not falsely end a meeting. Unlike one-to-one calls, a group meeting is allowed to have only one connected participant, and owner departure does not end everyone else's session.

## Source map

app/api/routes/meetings.py exposes private endpoints. app/schemas/meeting.py defines validated requests, public state and hints. app/services/meetings.py owns consent, permissions, token admission, retirement and privacy revocation. app/services/meeting_worker.py retries cleanup and reconciles room state. app/services/livekit.py shares restricted media grants and room operations with one-to-one calls.

app/api/media.py provides the shared media dependency. app/schemas/events.py and app/services/realtime.py validate and authorize meeting hints. Model registry exports include MeetingMemberStatus. Existing chat privacy updates invoke call and meeting revocation in the same database transaction.

## Official reference

Self-hosted token revocation limits:
https://docs.livekit.io/frontends/reference/tokens-grants/

<!-- pagebreak -->

## 5. Verification and next work

Start or update the implemented backend from the repository root:

```powershell
uv sync --project backend --locked
docker compose up --build -d
Invoke-RestMethod http://localhost:8000/health/ready
```

Compose applies 0004_meetings before starting the updated API. Use Swagger to register/login an owner and at least two guests. Create a meeting with the guest IDs, accept from each guest account, request separate tokens, and connect clients to the returned room. End with the owner account or remove one guest to exercise rotation.

The complete automated suite passes 200 tests, including fifteen PostgreSQL integration cases. New checks cover invite consent, owner permissions, idempotent creation, token grants, the 50-member authorization cap, decline/reinvite, leave/rejoin, privacy revocation, failed cleanup, room reconciliation, failed-commit rollback and invalid inputs.

Real Redis tests verify meeting invitations and removal notifications across independent API instances. A PostgreSQL race test verifies a waiting join cannot bypass removal. Migration checks preserve old meeting/member records, backfill owner access, verify schema/model agreement and enforce downgrade safeguards. Ruff lint and formatting pass. TestClient retains one upstream HTTPX deprecation warning.

## Native three-client media proof

Additional native RTC clients inside Docker exchanged synthetic audio and video across all six participant directions. This passed with default ICE and again with relay-only ICE to force TURN. Removing one participant disconnected all clients from the retired room. The removed member's retained token was rejected by LiveKit; remaining members requested new tokens, rejoined a new room and exchanged media again. Owner end disconnected the remaining participants.

These two media scenarios are separate from the 200 automated tests. They used real API-created rooms and scoped tokens; media-client dependencies ran only in an ephemeral checking container. Temporary accounts, meeting records, rooms and the checking container were removed afterward. Normal loopback configuration was restored after a temporary internal-network override used for the test.

## Limits and next checkpoint

The 50-member limit is an authorization cap, not a measured media-capacity guarantee. Room rotation prioritizes access revocation and temporarily disconnects surviving participants. The mobile UI must implement fresh-token reconnect, show pending cleanup, and distinguish consent from actual media connectivity.

Windows-host native media probes timed out in the preceding checkpoint despite successful signaling/control requests. Host/device media routing remains unresolved. Docker group-media success does not establish phone connectivity, camera/microphone permissions or physical-device quality. Public hosting still needs reachable ICE addresses, HTTPS/WSS and tested TURN connectivity.

The next checkpoint is client integration and host/device connectivity, followed by a real-device calling demonstration. Offline push notifications and deployment hardening remain documented later work. One-to-one calling and this meeting checkpoint remain uncommitted until the user requests a commit.
