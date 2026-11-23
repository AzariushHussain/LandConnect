# LandConnect - Mobile Step 5

Direct and group messaging | 23 November 2026

## 1. Part A - What this step delivers

The map stage was committed as c1b02ee. The application now has a Chats inbox, direct messaging from a property's Message owner button, message history, explicit send retries and group conversation management. Buyer, Seller and Broker accounts can all chat. Group owner/admin permissions are independent of marketplace roles.

This stage completes the mobile interface to the existing chat architecture: PostgreSQL stores messages, a transactional outbox records notifications, Redis Pub/Sub carries change hints across API instances and authenticated WebSockets deliver authorized hints to the mobile application. Message writes and history reads use REST. The new mobile stage remains uncommitted until the next requested commit.

The user can create a group, rename it, add eligible people, change admin roles, remove members, transfer ownership and leave. The backend remains authoritative for each action. Phone UI and live Docker/Redis delivery checks remain outstanding; this guide distinguishes implemented behavior from what was verified automatically.

## 2. Part B - Code structure and responsibilities

```text
mobile/src/app/chats/
  index.tsx                  Inbox route
  new-group.tsx              Group creation route
  [id]/index.tsx             Conversation route
  [id]/info.tsx              Group information route
mobile/src/features/chat/
  types.ts                   Validated public DTOs and permissions
  api.ts                     Authenticated REST operations
  realtime.ts                Socket protocol, retries and event hints
  inbox.ts                   Conversation pagination and known people
  thread.ts                  History, recovery cursor and send state
  use-chat-updates.tsx       Focus/app activity and reconciliation
  InboxScreen.tsx            Conversation list
  ThreadScreen.tsx           Message bubbles and composer
  MessageOwner.tsx           Property-owner conversation entry
  PeoplePicker.tsx           Existing conversation participant picker
  NewGroupScreen.tsx         Group creation
  GroupInfoScreen.tsx        Membership and administration controls
```

application/services.ts creates ChatApi and one ChatRealtime instance. The root layout protects chat routes behind the verified session and starts/stops the socket with app activity. Controllers and protocol parsing are separate from native screens, allowing meaningful tests without a device.

<!-- pagebreak -->

## 3. Part C - Using the messaging interface

Open chats on the community opens the user's conversations. A property detail offers Message owner unless the listing belongs to the current user. That button calls POST /conversations/direct; the backend returns the pair's existing conversation or creates one. No phone number, email lookup or phone contact permission is needed.

The inbox loads 20 conversations at a time with explicit Load more. Its order follows the backend's conversation creation order, not most recent message activity. Refresh returns to the first page. Duplicate IDs across offset pages are merged, while the next offset advances by raw rows. A full last page may require one extra empty fetch to establish the end. The API's 10,000-offset cap remains in effect.

Conversation screens show sender names, message text and timestamps. History starts with the latest 50 messages. Load older messages reads the next exclusive before cursor; the inverted list keeps the composer below the newest end. Refresh chat reads authoritative state. Text remains in the composer after a failed send, and a pending attempt is visually distinct from confirmed message bubbles.

Create a group opens a name form and a people picker. People come from current memberships in the user's existing conversations. Load more people reads more conversation pages, and duplicates/self are removed. This does not introduce a public account directory or expose account emails. If no eligible person appears, start a direct conversation from a listing first.

The picker allows 1 to 49 other people; the creator becomes owner/admin and the server caps the group at 50 current members. Privacy and block restrictions can still prevent creation or invitation after a person is selected. Group information provides only the controls appropriate for the caller's current group role.

Leaving a screen with a draft or unconfirmed send asks for confirmation because that local state is held in memory. Group creation similarly protects unsaved selections and blocks departure while creation is being attempted. Group administration blocks navigation during a write; successful leave explicitly releases that guard before returning to Chats.

<!-- pagebreak -->

## 4. Part D - REST authentication and DTO validation

ChatApi captures the current verified session for each request and sends its bearer token explicitly. After a response, it verifies that the same token is still current before returning private data. A late result from an old session cannot populate another account's screen. HTTP 401 rejects only the captured token; 403 explains privacy/group permissions, and 404 means the conversation or person is unavailable to this caller.

DTO parsing accepts only supported public person fields: ID, display name and marketplace role. Conversations must contain the current member, distinct member IDs and a valid direct/group shape. A group owner must be a current admin. Messages must belong to the requested conversation, contain valid sender/text/timestamp fields and use supported integer IDs. Extra contact fields are discarded.

The backend's message IDs and history cursors are positive signed 32-bit integers. History responses must be ascending, cursor-exclusive and internally consistent. A next cursor is checked against the returned rows before it enters recovery state. Bodies preserve whitespace and allow up to 4000 Unicode characters; blank text is rejected. Group names are trimmed and limited to 100 characters.

```text
POST /conversations/direct                { recipient_id }
POST /conversations/groups                { name, member_ids }
GET  /conversations                       limit/offset
GET  /conversations/{id}                   current member only
POST /conversations/{id}/messages          { client_id, body }
GET  /conversations/{id}/messages          limit, after_id OR before_id
```

## 5. Part E - WebSocket protocol and lifecycle

ChatRealtime derives /ws/chat from the validated API origin: HTTPS becomes WSS and trusted-LAN development HTTP becomes WS. The URL contains no token. After the socket opens, authentication is the first JSON frame:

```json
{"type":"auth","token":"the current access token"}
```

The server's ready frame must identify the expected user. Only then are hints accepted. Server ping frames receive pong frames. Connection/authentication waits and missing heartbeats have bounded watchdogs. Transient failure retries at 1, 2, 4, 8, 16 and up to 30 seconds; policy/protocol rejection pauses automatic retries and exposes Reconnect live updates.

The root layout closes sockets and retry timers on background/sign-out and reconnects on foreground. Only one socket is owned by this manager. Event IDs are deduplicated in a bounded 500-ID set. Hint parsing forwards supported metadata and omits unexpected message bodies/contact data. Call/meeting notification types are reserved for the subsequent calling integration.

<!-- pagebreak -->

## 6. Part F - Recovery is part of the Pub/Sub design

Redis Pub/Sub hints can be lost, duplicated or arrive out of order. The client therefore treats a hint as a reason to fetch authorized REST state. Every successful socket readiness/reconnect emits a local reconcile hint. Focused chat screens also reconcile on focus, foreground and a 15-second interval while active, even when the socket appears healthy. Hints are debounced for 200 milliseconds to combine bursts.

Thread.sync first rechecks conversation access and current membership. It then reads after the last history cursor, draining up to five 50-message pages per pass. If more remain, it exposes Load more new messages and the next explicit/periodic pass continues. Older-history reads have a separate before cursor and never move the live after cursor backwards.

The critical rule is that a notification or a successful POST response does not advance the history cursor. Only a validated history page does. For example, suppose the last fetched ID is 10, an incoming message 11 commits, and the user's outgoing message 12 returns first. Moving the cursor straight to 12 would permanently skip 11. This implementation still fetches after_id=10 and merges both 11 and 12.

```text
Stored history cursor: 10
REST send confirms:    12  -> merge bubble, keep cursor at 10
REST history after 10: 11,12 -> merge by ID, cursor becomes 12
```

Messages merge by server ID and display in order. Repeated sync requests coalesce while one is running, with another pass requested when needed. Request generations prevent unmounted or removed-membership results from restoring private state. A matching removal hint immediately hides the focused conversation's data; HTTP access rejection also clears its messages, draft and pending send.

## 7. Part G - Sending and retry identity

Each logical send gets one UUID from expo-crypto randomUUID. Thread retains the UUID and the exact text as an immutable attempt. Repeated taps while sending do not create another request. On failure, Retry same message reuses that UUID and text, matching the backend's unique conversation/sender/client_id constraint.

An exact retry returns the original server message; a different body with the same UUID is a conflict. History recovery can also confirm an uncertain send by matching sender, client UUID and text. Until confirmation or explicit local discard, the composer cannot edit that attempt into a different message.

Discard local attempt warns that the message may already be saved. The user should refresh before retyping it. Pending attempts and drafts are not persisted to disk, so leaving the screen or process death loses the local retry identity. This is a documented prototype boundary; a durable encrypted local outbox would be a separate enhancement.

<!-- pagebreak -->

## 8. Part H - Group permissions and membership operations

Group information uses the conversation's owner_id and membership roles. The owner can rename, invite, remove other members/admins, promote/demote admins and transfer ownership. An admin can rename, invite and remove ordinary members. Ordinary members can leave. Direct conversation participants are fixed and receive none of those group controls.

```text
PATCH  /conversations/{id}                     { name }
POST   /conversations/{id}/members             { user_id }
PATCH  /conversations/{id}/members/{user_id}   { role }
POST   /conversations/{id}/ownership           { user_id }
DELETE /conversations/{id}/members/{user_id}
DELETE /conversations/{id}/members/me
```

The owner must transfer ownership before leaving. Transfer requires an existing member and makes that person an admin; the previous owner remains an admin until leaving or being changed by the new owner. Each privilege or membership change requires a confirmation dialog and the backend rechecks authorization, so stale UI controls cannot bypass server policy.

Group creation lacks a server idempotency key. A network failure or malformed successful response may mean creation already committed. The app does not automatically retry it; the error directs the user to refresh Chats or group information first. Membership/rename failures also direct users to refresh before repeating a change. Reads that started before an administration write cannot overwrite its newer result.

## 9. Part I - Privacy and cached state

All marketplace roles have the same messaging capability. Group roles do not grant seller/broker property permissions. Group membership grants access to retained history, including messages sent before joining. A removed member loses new reads/sends; a user can still possess copies already downloaded. The application cannot recall screenshots or previous downloads.

Incoming-message preferences and blocks are enforced by the existing backend. Privacy restrictions can reject a direct send, a new conversation or a group invitation. Existing shared-group behavior follows the documented backend policy. Account settings and block/unblock controls are the next mobile checkpoint; this stage honors current server settings but does not add those settings screens.

The mobile client does not persist message text, conversation history or people lists to local storage. Screens own transient snapshots; auth/session transitions remove protected routes. Group-removal notifications and HTTP access failures discard focused private snapshots. JWTs stay in SecureStore through the existing session flow, and neither transport adds JWTs to URLs.

Server authorization plus HTTPS/WSS is the transport/security model. Messages are readable by the server and stored in PostgreSQL; this is not end-to-end encrypted messaging. Development HTTP/WS is restricted to the existing trusted-LAN workflow, and release configuration requires HTTPS.

<!-- pagebreak -->

## 10. Part J - Android origin compatibility and backend change

Inspection of the installed React Native Android WebSocket implementation found that it automatically sends an Origin matching the target API's HTTP(S) origin. The original backend accepted only configured origins or an absent Origin. That could reject the native Android client before JWT authentication, even though its REST requests worked.

The socket route now also accepts the exact target API origin. Other origins still need to be in CORS_ORIGINS; unrelated origins remain rejected. This adds no wildcard and does not change REST CORS settings. The JWT-first-frame requirement, expiry checks and live event authorization remain in force. Native HTTP and HTTPS origin regression tests verify acceptance and also verify that an invalid token is still rejected.

```text
ws://api-host:8000/ws/chat  -> allowed self origin http://api-host:8000
wss://api.example/ws/chat  -> allowed self origin https://api.example
https://untrusted.example  -> rejected unless explicitly configured
```

For public deployment, reverse proxies must preserve the correct host/scheme or explicitly configure the expected origin. Rebuild the API container through the existing LAN helper to pick up this route change. Existing data and Docker volumes are preserved.

The only new mobile dependency is the SDK-compatible expo-crypto package for UUID generation. It is not being used to claim message encryption. Native generation and ARM64 assembleDebug succeeded, as did the Android development JavaScript export. The rebuilt development APK remains about 113 MiB and still requires Metro.

## Verification evidence

The mobile suite has 88 passing tests: the prior 67 plus 21 chat/protocol tests. Coverage includes participant privacy, group roles, history/cursor validation, authenticated requests, stable send retries, missed-message recovery, removal races, WebSocket first-frame authentication, ping/pong, event deduplication, backoff, policy pause, heartbeat failure and stale sockets. The backend chat test file passes 29 tests, including the new native-origin cases.

The new chat contract probe exercises real FastAPI routes and socket handlers over an isolated SQLite database. It verifies direct reuse, send deduplication/conflict, 55-message history in both directions, group roles/invitations/removal/transfer/leave, origin checks, JWT readiness and heartbeat. An actual transactional-outbox event is injected into the hub queue and goes through the socket's event authorization. No Redis connection or relay delivery is tested by that injection.

<!-- pagebreak -->

## 11. Part K - Reproducing the checks and running the app

TypeScript, ESLint, formatting, Ruff, Android bundle export and ARM64 native build pass. Expo Doctor passes all 20 checks. The existing four moderate npm audit findings in the Expo dependency chain remain; no forced SDK downgrade was applied. The upstream TestClient deprecation warning remains unrelated to these passing route checks.

```powershell
# Repository root: synthetic data, no Docker required
uv run --project backend python scripts/check_mobile_chat.py
uv run --project backend python scripts/check_mobile_listings.py
uv run --project backend python -m pytest backend/tests/unit/test_chat.py -q

# mobile/ directory
npm ci
npm test
npm run typecheck
npm run lint
npm run format:check
npx expo-doctor
npx expo export --platform android --dev
```

The probes never create real users or write to the developer database. The chat probe creates an in-memory database, synthetic accounts/messages and a local TestClient socket. It does not start LiveKit, Redis or the full application background workers. PostgreSQL concurrency and live Redis behavior remain covered by separate backend integration work, not this isolated probe.

```powershell
# mobile/; do not prebuild while Gradle is running
npx expo prebuild --platform android --no-install --no-clean
$env:NODE_ENV = 'development'
.\android\gradlew.bat -p android :app:assembleDebug `
  -PreactNativeArchitectures=arm64-v8a --max-workers=2 --console=plain
```

The APK is mobile/android/app/build/outputs/apk/debug/app-debug.apk. The build was verified without installing or operating it on the phone. Keep the short Windows checkout path and existing CMake path plugin. When phone testing resumes, start the backend with the existing start_lan.py helper, confirm readiness, install the rebuilt development client and use npm start for Metro. Native dependencies require a new client build; ordinary TypeScript changes use Metro reload.

<!-- pagebreak -->

## 12. Part L - Remaining checks and next step

Phone UI, keyboard/inverted-list behavior, native crypto execution, two-device messaging, real LAN WebSocket handshake and live Redis notification delivery were not tested on devices. iOS was not built or tested. No phone UI checks or Docker-volume resets were performed. Passing native compilation, fake-socket tests and isolated real-route probes does not substitute for a live end-to-end demonstration.

When device testing resumes, use two accounts. Start from a listing, exchange direct messages and confirm history after reconnect. Interrupt a send after submission, then retry the same attempt and verify one saved message. Create a group, invite/remove a person, change an admin, transfer ownership and leave. Test a removed member's active screen and denied reads/sends, background/foreground recovery and an event missed while offline. Check that text entered after a history-confirmed send cannot be cleared by an older network response.

Known boundaries: drafts/retry attempts are memory-only; no unread counts, presence, typing indicators, delivery/read receipts, attachments or background push notifications are implemented. Reconciliation is a periodic foreground fallback, not a delivery guarantee. Inbox refresh resets pagination; people selection uses known current conversation members. History loads in user-controlled pages and remains in screen memory while open. Group creation lacks idempotency, so refresh before repeating an uncertain creation.

Next is mobile privacy settings and block/unblock controls, followed by LiveKit audio/video calls and invite-only meetings using the agreed SFU architecture. Calling remains the key project requirement. These later steps will add camera/microphone permission configuration, incoming-call UI, accept/reject/end actions and real two-device media checks; they are not part of this chat checkpoint.

## Official implementation references

Expo SDK 58 Crypto: https://docs.expo.dev/versions/v58.0.0/sdk/crypto/

React Native networking/WebSockets: https://reactnative.dev/docs/network

React Native Android socket source: https://github.com/facebook/react-native/blob/v0.88.1/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/websocket/WebSocketModule.kt

Expo Router navigation: https://docs.expo.dev/router/reference/stack/

The repository's messaging and Pub/Sub architecture is explained in docs/07-chat-architecture.md and docs/08-messaging.md; those remain the backend contract for this client.
