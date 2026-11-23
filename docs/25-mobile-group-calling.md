# LandConnect - Mobile Step 12

Group audio and video calls | 23 November 2026

## 1. Part A - Visible changes

Group conversation headers now contain phone and video icons, just like direct conversations. The Host a meeting action was removed from the conversation menu. Tap either call icon to start that call type with the group's members. There is no title form, participant picker, meeting-creation screen or separate Join media step in this flow.

The caller grants required OS permissions and connects automatically. Other members receive an in-app group-call banner with the group name, caller and audio/video type. They can answer or decline directly. Answer obtains required permissions, accepts access on the server and connects media in that single action.

The group call screen uses the same dark visual style and circular controls as direct calls. It shows the group name, call type, invited participant count, actual SDK connection state and connected participant count. Audio calls show connected participant names. Video calls show a horizontally scrolling set of named camera tiles. Controls include mute, camera for video, audio output and End/Leave.

```text
Group chat -> phone/video icon -> required OS permissions
  -> create or reuse active group call -> connect caller media
Incoming banner -> Answer -> required OS permissions
  -> accept server access -> connect recipient media
Initiator End -> ends the call for everyone
Other participant Leave -> disconnects that participant
```

## 2. Part B - Reusing the SFU safely

The existing invite-only SFU session implementation already handles room tokens, access checks, media cleanup and room rotation. Group calls reuse that backend engine with a persisted conversation_id. The UI treats these linked sessions as calls. Formal meetings remain separately available under My Account, with their existing workflow.

Migration 0005_group_calls adds the nullable conversation link and a partial unique index allowing one open call per group. Existing meetings retain a null link. The migration preserves their data. Its downgrade refuses to remove group-call context while open group calls or their room cleanup remain.

POST /conversations/{conversation_id}/calls accepts only client_id and audio/video kind. The server verifies current group membership and derives the name and participant roster from the group. Clients cannot supply an arbitrary invitation list through this endpoint. Only group conversations are accepted, with at least one other member and the existing 50-person limit.

<!-- pagebreak -->

## 3. Part C - Backend state and privacy

The conversation write lock serializes competing starts. User rows are locked before the active session row to match the media engine's lock order. The database index supplies a second guarantee against duplicate open calls. Simultaneous dials of the same kind return the same call. A different kind while a call is active returns a conflict.

The initiating UUID identifies a retry. Reusing it with the same group/kind returns its original call, including an ended record; it cannot reopen an ended call. A newly initiated attempt after a call ends can create a new session. A group rename or roster edit does not rewrite an earlier attempt's identity.

Existing call privacy rules apply: disabled incoming calls and blocked participant pairs prevent invitations or media authorization. Declining revokes access. A removed group member immediately loses call detail/token access. If they had an issued room token, the room rotates and durable cleanup closes the old room. Removing the call initiator ends the linked call. Arbitrary extra invitations through the generic meeting API are rejected for group calls.

Unanswered calls expire after CALL_RING_SECONDS, default 45 seconds. Acceptance and token requests enforce expiry, and the existing background worker persists expiry even if clients stop polling. Once another member has accepted, the call is no longer considered unanswered. Terminal events and room changes continue through the transactional outbox, Redis Pub/Sub and authenticated WebSockets; clients reconcile REST state.

```text
backend/app/services/group_calls.py  Start/reuse from group membership
backend/app/services/meetings.py     Shared access, expiry and revocation
backend/app/services/meeting_worker.py
                                    Durable unanswered-call expiry
backend/app/services/chat.py         Revoke calls on group removal
backend/app/models/meeting.py        Persisted conversation link/index
backend/app/schemas/meeting.py       Group-call input and response link
backend/app/api/routes/conversations.py
                                    Authenticated start endpoint
backend/alembic/versions/0005_group_calls.py
                                    Additive schema migration
```

## 4. Part D - Mobile state and media

GroupCallController coordinates permission preparation, the idempotent request, selection, acceptance and the final access check before enabling media. Session-bound API responses and actor/revision checks reject stale results. An uncertain creation retains its UUID for retry. Permission denial prevents an unsent request or acceptance.

Leaving the group while dial preparation is pending cancels an unsent request. A late owned creation is ended without connecting media, and a late join check cannot enable capture after cancellation or sign-out. A direct call or another local media session must finish before a group call can connect. Passive discovery alone never opens the microphone.

<!-- pagebreak -->

## 5. Part E - Screens and recovery

The group header buttons use GroupCallButtons, and the dedicated route renders GroupCallScreen. The incoming/active GroupCallBanner supplies direct Answer/Decline actions. The root navigator registers the route and resets pending group actions on a session change. Existing meeting-list entries and older meeting links for linked calls route to the new call screen.

The shared controls were renamed from DirectCallMedia to CallMedia and extended for multiple participants. NativeCall and the group adapter both render them through NativeMedia. Native startup, publication, cancellation, audio ownership and track teardown stay in that shared implementation. No new native dependency or native configuration was added.

MeetingSession continues to manage verified server access and the current room version. Group call invitations are distinguished from formal meeting invitations during discovery. A failed verification or room rotation stops media. Reconnect call remains an explicit recovery action after an error or access change; it is not part of a normal dial/answer sequence.

```text
features/calls/group-controller.ts  Dial/answer coordination
features/calls/GroupCallButtons.tsx Group conversation icons
features/calls/GroupCallBanner.tsx  Incoming and active call shortcut
features/calls/GroupCallScreen.tsx  Full-screen group call
features/calls/CallMedia.tsx        Shared direct/group controls
features/meetings/api.ts            Linked-call DTO and request
features/meetings/session.ts        Shared access/session state
src/app/group-calls/[id].tsx        Protected Expo Router route
```

## 6. Part F - Validation and runtime

All 174 mobile tests pass. New coverage includes both call kinds, one-action answering, permission denial, session changes, busy media, UUID retries, background acceptance and cancellation during preparation/create/join. The API test verifies the group context and the minimal request payload. TypeScript, lint, formatting and Android JavaScript export pass.

The selected backend unit suite passes 76 tests, including group-call membership, canonical reuse, privacy, token consent, room rotation on removal, initiator removal and unanswered expiry. Seven isolated PostgreSQL tests pass for migrations, model/schema consistency, upgrades/downgrades, concurrency and media-access locking. Simultaneous group dials return one session. Three existing chat/privacy/call/meeting contract probes also pass with fake room operations and injected authorized events.

The local Docker API was rebuilt, migration 0005_group_calls applied and readiness confirmed for database, migrations and Redis. The group-call route appears in the live OpenAPI schema. Existing database/upload volumes were retained. Development clients load the JavaScript update through Metro without a new APK.

<!-- pagebreak -->

## 7. Part G - Manual checks

Sign into three demo accounts on separate devices and place them in a group. Open the group as any member and tap the phone icon. Confirm that the caller connects and each invited member sees the incoming banner. Answer on one or both other devices and confirm two-way/multi-party speech without extra meeting forms or Join buttons. Repeat with video and verify named feeds, mute, camera and audio routing.

Decline as one recipient; other participants should continue. Leave as a non-initiator and confirm local tracks stop. End as the initiator and confirm everyone disconnects. Try repeated taps, simultaneous starts, a different call type during an active call and a new call after the previous one ends. Let an unanswered call expire and confirm the banner disappears after reconciliation.

Deny permissions, switch accounts while a permission prompt is pending, and leave a group while starting a call. No late response should enable capture or navigate back unexpectedly. Background a device and check that tracks stop. Remove a participant during a call and confirm their token access is revoked and the previous room is closed. Remaining participants may need explicit recovery after a security-driven room rotation.

## 8. Part H - Current limits

This remains foreground calling: no push wake-up, locked-screen call service, CallKit integration or ringtone service is included. Actual multi-phone audio/video, keyboard/layout and hardware audio routing remain unverified because phone UI/media checks are deferred. Route tests use fake room operations; they do not establish real SFU/Redis relay delivery.

The initiator's End action ends the call for everyone. Other accepted members can leave and explicitly reconnect while the call remains open. The initial invitation roster is a snapshot of group members at dial time; new group members are not automatically added to an existing call, and a declined invitation is not automatically renewed. Call privacy is strict across invited participants. A privacy or membership change may rotate the room and require recovery.

Formal meeting invitations still exist as a separate feature. This step changes the group-chat calling path and supersedes the older Host a meeting instructions for that path. The earlier empty-chat inversion fix is also included in the current working tree.

## References

Expo SDK 58: https://docs.expo.dev/versions/v58.0.0/

LiveKit React Native: https://docs.livekit.io/transport/sdk-platforms/react-native/
