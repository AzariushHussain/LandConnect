# LandConnect - Mobile Step 8

Group meetings with the existing LiveKit SFU | 23 November 2026

## 1. Part A - Commit and implementation scope

The one-to-one calling stage was committed as 7777d02: Add foreground mobile LiveKit audio and video calling. This next stage adds meeting screens: hosting, invitations, consent, multi-person media, leaving, withdrawing consent, removing participants and ending for everyone. The new meeting changes remain uncommitted for review.

Open My account > Meetings or Chats > Meetings and invitations. A group conversation also has Host a meeting with this group. That action loads the current group and prefills its name and other members. Review the selection and create the meeting to send invitations. The host can choose audio or video, and invite up to 49 other people.

Incoming meeting invitations appear through an in-app banner while LandConnect is foregrounded. The meeting list has Open and Ended views, refresh and pagination. Invitations require acceptance before media access; accepting alone does not open a microphone or camera. Join meeting media is a separate, explicit action.

This stage reuses the self-hosted LiveKit server and native dependencies installed in Step 7. No Agents framework, cloud account, new native package, database migration or new backend endpoint was added. It continues to use foreground calling. Phone UI checks remain skipped at the user's request.

## 2. Part B - Chat groups and meeting membership

A chat group and a meeting serve different purposes. A conversation retains messages and its own membership/administration. A meeting has an independent host, invitation list, consent state and versioned media room. The existing meeting API does not store a conversation_id.

Launching from a group copies a selection at that moment. Later chat membership changes do not automatically invite or remove meeting members. The host manages meeting access explicitly. Any signed-in Buyer, Seller or Broker can host, subject to the existing privacy rules; chat owner/admin permissions do not make someone the meeting host.

```text
Group chat -> review title, audio/video and invited people
POST /meetings -> meeting + members + transactional outbox
Redis PubSub -> existing /ws/chat -> meeting hint
Invitee opens meeting -> accepts -> explicitly joins media
POST /meetings/{id}/token -> authorized LiveKit SFU room
```

Each phone publishes its local tracks to LiveKit, which forwards subscribed tracks to other participants. The phone does not create a full peer-to-peer mesh or connect directly to Redis/PostgreSQL. FastAPI remains responsible for permissions and room lifecycle.

<!-- pagebreak -->

## 3. Part C - Project structure and reused code

```text
mobile/src/app/meetings/
  index.tsx                  Open/ended meeting list route
  new.tsx                    Hosting route, optional group UUID
  [id].tsx                   Validated meeting detail route
mobile/src/features/meetings/
  api.ts                     DTOs, REST requests and room tokens
  creation.ts                Frozen, idempotent creation retries
  inbox.ts                   Pagination and filter generations
  session.ts                 Consent, media state and lifecycle
  use-meetings.ts             Subscriptions and focused refresh
  MeetingsScreen.tsx          List, filters and pagination
  NewMeetingScreen.tsx        Title, kind and invitation selection
  MeetingScreen.tsx           Roster, consent and host controls
  MeetingBanner.tsx           Foreground invitation/media shortcut
mobile/src/features/media/
  NativeMedia.tsx             Shared native room/tracks/controls
  token.ts                   Shared origin/token/room validation
```

Step 7's NativeCall is now a small adapter: it supplies its call-specific token function and public participant names to NativeMedia. MeetingScreen supplies a meeting-specific token function, current room version and public roster names. Both paths retain the same permission checks, cancellation-aware startup, track teardown and audio-session ownership queue. This avoids implementing camera/microphone cleanup twice.

application/services.ts constructs MeetingsApi and MeetingSession beside the existing call services. CallController and MeetingSession check each other's local media state, so one device does not join meeting media and a one-to-one call at the same time. Explicit class annotations keep these callback references type-safe; neither constructor invokes the other service during module initialization.

_layout.tsx protects all routes by login state, binds the meeting session to the captured login token and handles foreground/background transitions. Route screens validate UUIDs and key their state by account and target. Signing out clears private meeting state; obsolete responses cannot restore it.

## 4. Part D - Request boundaries

MeetingsApi captures the current bearer token for every request and checks it again after the response. A late response from an old login cannot enter a replacement account. HTTP 401 rejects only that captured token. DTO parsing requires an authorized current member, an accepted host, unique members, valid consent statuses and a positive room version. It limits current invitations/accepted memberships to the server's capacity of 50; historical removed/declined records do not count against that capacity.

Only public participant summaries are retained. Unexpected contact fields, internal retiring-room names and unrelated fields are discarded. Title, kind, UUIDs, list pagination and response identity are checked. Production media requires WSS. Private-LAN/loopback WS is allowed only in development, using the existing API-origin policy.

<!-- pagebreak -->

## 5. Part E - Hosting and creation retries

```json
{
  "client_id": "00000000-0000-4000-8000-000000000259",
  "title": "Land discussion",
  "kind": "video",
  "member_ids": [
    "00000000-0000-4000-8000-000000000385"
  ]
}
```

The host is already included and accepted by the server. Everyone in member_ids starts invited. The server checks privacy preferences and blocks before creating the meeting and its outbox event in one transaction. People selection reuses PeoplePicker, which reads existing conversation memberships; it does not expose a public user directory.

MeetingCreation freezes a client-generated UUID, trimmed title, kind and copied invitation list for an uncertain request. Repeated taps coalesce. If the response is lost, Retry same meeting creation sends exactly the original body. The backend can return the same meeting instead of creating a duplicate. A definitive validation/permission failure unlocks the draft; uncertain failures retain the attempt and disable editing.

The attempt is memory-only. Leaving an uncertain creation warns that its retry identifier will be lost and asks the user to check Meetings before creating again. Relaunch can discover a committed meeting through the list, but it cannot reconstruct an unsaved local attempt. There is no automatic recreation after restart.

## 6. Part F - Consent and participant controls

An invited member can Accept meeting invitation or Decline invitation. Acceptance changes meeting consent, not device permission. An accepted participant can explicitly join media, leave media while keeping accepted access, or withdraw consent. Withdrawal removes access until the host invites the person again. A host cannot withdraw their own consent; they can leave media or end the meeting.

```text
POST /meetings/{id}/accept      Invited -> accepted
POST /meetings/{id}/token       Accepted member joins media
POST /meetings/{id}/leave       Disconnect media; retain consent
POST /meetings/{id}/decline     Decline/withdraw and revoke access
POST /meetings/{id}/members     Host invites another person
DELETE /meetings/{id}/members/{user_id}  Host revokes access
POST /meetings/{id}/end         Host ends for everyone
```

The roster labels invitation/consent status separately from connected media presence. Host controls are hidden for other members and independently enforced by FastAPI. Invitations and removals require valid current access; after failed verification, refresh must succeed before further invitation edits. Leaving, withdrawal and ending remain available to resolve communication safely.

<!-- pagebreak -->

## 7. Part G - Why removal can change the room

Removing someone who has received a media token requires more than hiding their tile. That person may retain a still-valid token for the old room. The existing backend revokes membership and, where necessary, retires the old room and increments room_version. Remaining accepted members must obtain access to a new room.

```text
Meeting M, room_version 1 -> meeting-M-1
Host removes a token-holding participant
  -> membership removed
  -> old room retired; room_version becomes 2
  -> old-room cleanup attempted/retried
Remaining accepted member refreshes and taps Join
  -> fresh authorized token for meeting-M-2
```

Meeting room tokens must match the exact ID and version confirmed on the screen. If rotation happens between the detail request and token request, the client refuses a mismatched room response. It refreshes and requires an explicit rejoin. It does not reuse an old token or reopen the camera automatically.

meeting.room_changed, meeting.member_removed and meeting.ended hints remove local media authorization immediately for the affected session. Removal of the current account also clears its private roster snapshot before REST reconciliation. Delayed/out-of-order hints cannot grant access; a fresh authorized REST response is required. The five-second foreground detail poll catches a version or consent change if a hint is missed.

## 8. Part H - Cleanup pending is still a successful revocation

Decline/withdraw and host removal return empty HTTP 204 when cleanup completes, or empty HTTP 202 when consent/access is already revoked but media cleanup is pending. Both are successful access changes. Previously ApiClient parsed JSON for every success except 204; parsing an empty 202 body would incorrectly report network failure after a successful revocation.

RequestOptions now has emptyResponse for endpoints that intentionally return no body. ApiClient still checks HTTP errors first, then skips JSON for these successful responses. MeetingsApi uses it for removal, withdrawal and leave. Other response parsing remains unchanged. Unit tests and the real-route probe cover empty 202 and 204 responses.

After removal, the host refreshes the meeting. media_cleanup_pending explains why joining is paused. The backend retries cleanup; the mobile client does not try to recreate rooms itself. Withdrawal clears the local meeting snapshot and explains that access is revoked while cleanup may still be pending. A saved action followed by a failed refresh is reported as saved with refresh failure, rather than claiming the write failed.

<!-- pagebreak -->

## 9. Part I - Shared native media and foreground lifecycle

NativeMedia requests microphone permission only after Join. Video meetings additionally request camera permission. It then obtains a fresh backend-issued token, configures communication audio, connects the Room and publishes local tracks. Permission denial or startup failure stops media and exposes retry/settings actions. Existing Step 7 camera/microphone explanations and native modules are reused unchanged.

The shared component shows connection state, connected participant names, mute, video camera and audio output controls. Public names come from the validated roster, rather than trusting arbitrary SDK metadata. Video uses a horizontal virtualized list, initially rendering two tiles with a small window; it does not mount every participant video view vertically in the scrolling form. Swipe to view other published camera tracks. Audio continues through the native SDK independently of which video tile is visible.

The existing cancellation boundary remains active between startup steps. Cleanup stops old local tracks, disconnects the room, waits for pending startup operations and stops again. The shared audio queue serializes successive call/meeting mounts. Pending native control work also stops old-room tracks if it finishes after unmount.

Only the focused call/meeting screen renders native media. Return links reuse an existing route, and a hidden screen in navigation history cannot open a second capture session. Navigating elsewhere inside the foreground app releases its native view; returning to the same still-joined session can reconnect it. Backgrounding, revoked access, failed verification and room changes clear joined state and always require an explicit rejoin.

Backgrounding clears joined state and attempts a leave, preserving accepted meeting consent. An inactive permission popup alone does not count as background. Returning to the application refreshes access but never republishes media automatically. Back navigation while joined asks to leave media; an in-flight action must complete first. Opening another meeting while media is active asks the user to return to the current session and leave it first.

Unmounting the selected detail clears its private snapshot and invalidates pending reads; if needed it attempts a leave first. Sign-out clears the entire meeting session. A failed verification stops media without claiming the meeting ended. OS suspension/process termination and network loss can prevent server-side leave confirmation, so local teardown and backend room maintenance remain necessary.

## 10. Part J - Notifications, discovery and list recovery

The existing ChatRealtime now distributes a third typed subscriber stream for meetings, alongside chat and direct calls. It validates event/meeting UUIDs and optional target UUIDs, deduplicates event IDs and forwards minimal metadata. No new WebSocket, Redis connection or media token is added to the notification payload.

Foreground invitation discovery runs every fifteen seconds and on readiness/return. The banner links to one current invitation; the paginated Meetings list is the place to review all invitations. A selected open meeting refreshes every five seconds; an ended meeting continues polling only when cleanup is pending. A focused list refreshes on meeting hints, foreground return and a fifteen-second fallback. Filter generations ignore obsolete Open/Ended page results. Offset advancement uses raw row counts while duplicate IDs are merged.

<!-- pagebreak -->

## 11. Part K - Validation performed

147 mobile tests pass: the previous 122 plus 25 for meeting parsing, empty-body responses, token versions, captured sessions, creation retries, pagination/filter races, consent, room changes, inaccessible snapshots, owner permissions, cleanup, backgrounding, unmounting and local call/meeting exclusion. Shared call-token validation and existing media-lifetime tests continue to run after the refactor.

The new isolated contract probe uses real FastAPI meeting/privacy/socket routes and synthetic accounts in SQLite. It checks creation/idempotency, consent before tokens, unauthorized users, host-only actions, leave retaining consent, withdrawal requiring reinvitation, ended history and privacy/block enforcement. It deliberately makes fake room deletion fail, observes empty 202 responses and denied token access, then runs real cleanup logic against the fake adapter and verifies the incremented room name.

The probe injects a committed, authorized meeting event into the real hub and verifies the authenticated socket frame. It uses real JWT generation but fake room operations, with no live Redis subscriber. This does not establish real media playback, old-token rejection by a live SFU or real Redis cross-instance delivery.

```powershell
# From the repository root
uv run --project backend python scripts/check_mobile_meetings.py
uv run --project backend python scripts/check_mobile_calls.py
uv run --project backend python scripts/check_mobile_chat.py
uv run --project backend python -m pytest `
  backend/tests/unit/test_meetings.py `
  backend/tests/unit/test_calls.py `
  backend/tests/unit/test_chat.py -q

# From mobile/
npm test
npm run typecheck
npm run lint
npm run format:check
npx expo-doctor
npx expo export --platform android --dev
```

All 66 selected backend tests pass. The meeting, direct-call and chat/privacy contract probes pass. TypeScript, lint, formatting, Ruff for the new Python probe, Android development bundle export and all 20 Expo Doctor checks pass. The upstream TestClient HTTPX deprecation warning remains. No Docker service, developer database or upload volume was changed for these checks.

No dependency or app-config change was needed in this stage, so the native APK was not rebuilt again. Step 7's ARM64 development APK already contains the required modules; it needs Metro to load these JavaScript changes. The older phone installation still needs that rebuilt client before native calling can be tested. A development APK requiring Metro is not the standalone submission demo.

<!-- pagebreak -->

## 12. Part L - Remaining device checks

No phone UI, real camera/microphone, speaker routing or multi-device meeting check was performed in this step. The user explicitly skipped phone UI checks. Live Docker, Redis, TURN and real SFU room retirement were not rechecked here. Automated contract/state tests are evidence for those boundaries, not a substitute for a physical-device demonstration.

When device testing resumes, use three distinct accounts. Host a video meeting from a group, review the selected invitees, accept on the other two devices and explicitly join on all three. Check each participant can hear the others and view their cameras. Test mute, camera, audio outputs, scrolling through tracks, leave/rejoin and ending for everyone. Repeat with audio-only media.

Then remove a participant who already joined. Confirm that person loses access, the old room closes and surviving accepted members can explicitly rejoin a new room. Also verify withdrawal/reinvitation, privacy changes, blocks, offline/background transitions, permission denial, session expiry and attempted overlap with a direct call. Confirm device camera/microphone indicators disappear after teardown. These checks remain outstanding.

The existing LAN helper starts the Docker stack with the PC's current private address. Both the API and LiveKit addresses must be reachable from each device; localhost means the current device. Keep LiveKit API secrets and database credentials on the server. Production uses HTTPS/WSS; development cleartext is restricted to the trusted LAN policy.

## 13. Part M - Coverage of the original assignment

Authentication and roles, community listings, seller/broker management, images, maps/location selection, direct/group messaging, privacy controls and direct audio/video call screens were covered in earlier guides. This step adds the basic meeting-room interface and multi-person SFU integration. The role and privacy checks continue to run on the backend for every action.

The assignment gives particular weight to demonstrated audio/video calling and asks for a repository, working application demo, demonstration video, technical documentation and AI tools usage summary. Its deadline is 25 November 2026 at 11:59 PM IST. Screen implementation and passing automated checks do not complete the demonstration deliverables.

The next step should make the existing application ready for the demo: prepare a standalone Android build and clear setup/submission documentation, then perform the real calling demonstration when device testing is resumed. Release signing/distribution, a walkthrough video and accessible repository/demo links remain separate deliverables. Background push, CallKit, locked-screen calling, recording and application-level end-to-end encryption were not added by this stage.

## 14. Official references

Expo SDK 58: https://docs.expo.dev/versions/v58.0.0/

LiveKit React Native setup and tracks: https://docs.livekit.io/transport/sdk-platforms/react-native/

LiveKit Expo integration: https://docs.livekit.io/transport/sdk-platforms/expo/

The implementation also follows the repository's meeting schemas/services, Step 7 media code and installed SDK types. Official setup documentation was read before changing Expo/React Native code; no new package was required.
