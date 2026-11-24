# LandConnect

A land marketplace mobile application, built in stages. The backend includes **authentication, listings/images/maps, direct/group chat, privacy controls, direct/group calls and invite-only meeting APIs with a self-hosted SFU**, on FastAPI, PostgreSQL, Alembic, Redis and Docker. The **React Native Android app** includes secure accounts, listings/photos/maps/location selection, direct/group messaging with Pub/Sub notifications and history recovery, group administration, privacy/block controls, foreground direct/group calling and separate invite-only meeting screens using LiveKit.

## Android application

Group creation now has a name/preview card, owner row, participant counts, removable avatar chips and a fixed Create group footer. The shared participant picker adds name filtering, avatar/checkmark rows, selected chips, pull-to-refresh and clearer empty/error states, while retaining conversation-based contacts and invitation limits. See [the group-composer walkthrough](docs/38-mobile-group-composer.md) and [step 25 PDF](docs/LandConnect%20Mobile%20Step%2025%20Guide.pdf). **227 mobile tests**, typecheck/lint/format and Android development export pass. Phone layout/keyboard checks remain pending.

Confirming a map point now prefills available address, city, state and country fields along with coordinates. Missing fields become blank instead of retaining the previous location's city; a bounded nearby-address lookup resolves missing city data when it agrees on state/country. The picker ignores obsolete lookups and offers coordinates-only fallback. See [the prefill walkthrough](docs/37-mobile-location-prefill.md) and [step 24 PDF](docs/LandConnect%20Mobile%20Step%2024%20Guide.pdf). **225 mobile tests** and **225 backend unit tests**, typecheck/lint/format and Android export pass. The live API resolves HSR Layout to Bengaluru, Karnataka, IN; final phone city retesting remains pending.

The property location picker now searches cities, areas and addresses. Select a result to centre the map and mark a point, then tap to refine it before confirming. A protected FastAPI Photon proxy adds validated results, shared Redis caching and rate limiting. See [the location-search walkthrough](docs/36-mobile-location-search.md) and [step 23 PDF](docs/LandConnect%20Mobile%20Step%2023%20Guide.pdf). **218 mobile tests** and **219 backend unit tests**, typecheck/lint/format and Android development export pass. The rebuilt local API returned live/cached results, and the user confirmed phone search/marker behavior.

Add/edit property forms now group photos, details, pricing and location into cards. Photos can be selected and previewed before draft creation, then upload sequentially on Save; requested publication waits for uploads to finish. Photo uploads now use Expo `File` multipart data, fixing an SDK 58 incompatibility with the previous URI descriptor. Partial failures retain the confirmed draft and require gallery reconciliation before retrying a photo. See [the editor walkthrough](docs/35-mobile-property-editor.md) and [step 22 PDF](docs/LandConnect%20Mobile%20Step%2022%20Guide.pdf). **214 mobile tests**, typecheck/lint/format and Android development export pass. The user confirmed successful phone upload; physical form layout checks remain pending.

My properties now has authenticated cover-photo cards, distinct Draft/Active/Sold/Archived badges, exact price/area, update dates and clearer edit/public-preview actions. Compact status chips replace the large filter buttons. Owner-keyed screen state, pull-to-refresh and existing role/ownership checks remain in place. See [the owner-listings walkthrough](docs/34-mobile-owned-property-design.md) and [step 21 PDF](docs/LandConnect%20Mobile%20Step%2021%20Guide.pdf). **207 mobile tests**, typecheck/lint/format and Android development export pass. A private-photo HTTP check permits its owner and rejects other/anonymous viewers; phone layout checks remain pending.

Login/signup now use a consistent form card, inline field errors, independent password visibility controls, keyboard focus actions and explanatory Buyer/Seller/Broker choices. Email is carried between forms; signup returns to login only after confirmed creation. Validation counts Unicode name/password characters consistently with the backend. See [the auth walkthrough](docs/33-mobile-auth-design.md) and [step 20 PDF](docs/LandConnect%20Mobile%20Step%2020%20Guide.pdf). **207 mobile tests**, typecheck/lint/format and Android development export pass. Physical keyboard/autofill and form-navigation checks remain pending.

My Account now has a compact profile card, direct Blocked contacts access, role-appropriate My properties and a separate sign-out row. Privacy settings/status, Meetings and duplicate Call controls shortcuts are hidden from this tab. See [the account walkthrough](docs/32-mobile-account-design.md) and [step 19 PDF](docs/LandConnect%20Mobile%20Step%2019%20Guide.pdf). **203 mobile tests**, typecheck/lint/format and Android development export pass; physical layout checks remain deferred.

The bottom tabs are now **Listings, Chats, Calls and My Account**. Calls shows authenticated direct/group history with All/Missed filters, callbacks, pull-to-refresh and older pages. Public maps open only from a property's details; the Map tab and Listings map shortcut are removed. Property maps use a dedicated native map screen, Android surface rendering and explicit camera moves. See [the calls/property-map walkthrough](docs/31-mobile-history-property-maps.md) and [step 18 PDF](docs/LandConnect%20Mobile%20Step%2018%20Guide.pdf). Validation: **203 mobile tests**, **46 selected backend unit tests**, **6 PostgreSQL checks**, typecheck/lint/format and Android development export. Phone gesture smoothness remains unmeasured.

Listings now has a compact search bar, a dedicated filter panel, removable applied-filter chips and redesigned photo/price/area cards. Property details uses a responsive gallery and clearer summary, location and owner cards. Pull down to refresh either the results or details; the normal property refresh button is removed. See [the listings design walkthrough](docs/30-mobile-listing-design.md) and [step 17 PDF](docs/LandConnect%20Mobile%20Step%2017%20Guide.pdf). **195 mobile tests**, typecheck/lint/format and Android development bundle export pass. Phone visual/gesture checks remain deferred.

Group information now has a centered group header, Chat/Audio/Video shortcuts, participant search, role badges and participant action cards. Owners manage admin roles/ownership; admins can remove ordinary members. Block actions have been removed from listings, chats and groups; existing blocks can still be undone in Privacy settings. See [the group information walkthrough](docs/29-mobile-group-info.md) and [step 16 PDF](docs/LandConnect%20Mobile%20Step%2016%20Guide.pdf). **192 mobile tests**, typecheck/lint/format and Android development bundle export pass. Phone visual/action checks remain deferred.

Camera switching now replaces only the video source at the 480p target, restores the previous camera on failure, and leaves microphone/End controls available. Established direct calls get a 60-second continuous-absence recovery window; new rooms get a 90-second empty-room departure timeout. The local API runs **0006_call_reconnect**. See the [camera and reconnect walkthrough](docs/28-mobile-camera-recovery.md) and [step 15 PDF](docs/LandConnect%20Mobile%20Step%2015%20Guide.pdf). Validation: **188 mobile tests**, **78 selected backend unit tests**, **6 isolated PostgreSQL checks**, typecheck/lint/format and Android development export. Physical camera-switch and reconnection checks remain outstanding.

Video now targets **480p/30 fps**, with a **550 kbit/s main stream** and one **180p/15 fps fallback**. It preserves these constraints when switching cameras and avoids off-screen group video rendering. Development builds log numeric WebRTC diagnostics. See the [performance investigation](docs/27-mobile-video-performance.md) and [step 14 PDF](docs/LandConnect%20Mobile%20Step%2014%20Guide.pdf). **182 mobile tests** pass. A fresh call is needed to assess the final profile on the current network.

Direct video calls now use a full-screen remote feed, floating self-preview and bottom controls. Group video calls use named, paged grids with camera-off states and speaker highlights. See the [video UI walkthrough](docs/26-mobile-video-call-design.md) and [step 13 PDF](docs/LandConnect%20Mobile%20Step%2013%20Guide.pdf). **176 mobile tests**, typecheck/lint/format and Android bundle export pass; native phone rendering/media checks remain deferred.

Group chats now have Audio/Video call icons with direct dial/answer and automatic media connection. See the [group calling walkthrough](docs/25-mobile-group-calling.md) and [step 12 PDF](docs/LandConnect%20Mobile%20Step%2012%20Guide.pdf). Current validation passes **174 mobile tests**, **76 selected backend unit tests** and **7 isolated PostgreSQL checks**. The local API runs migration **0005_group_calls**; phone media/UI checks remain deferred.

Start a new private chat directly from the Chats search field using a profile name or full email address. Selecting a person creates or opens the existing direct conversation. The video shortcut was removed; meetings remain under My Account. See the [new-chat search walkthrough](docs/24-mobile-new-chat-search.md) and [step 11 PDF](docs/LandConnect%20Mobile%20Step%2011%20Guide.pdf). Current checks pass **162 mobile tests** and **71 selected backend tests**; physical phone UI checks remain deferred.

The four main screens use a bottom navigation bar: **Listings, Chats, Calls and My Account**. See the [current navigation and history walkthrough](docs/31-mobile-history-property-maps.md); the [step 9 guide](docs/22-mobile-navigation.md) records the earlier tab setup.

Chats now use tappable conversation rows, compact call icons and a rounded composer. Direct calls connect automatically after the recipient answers, with a full-screen call view, mute/camera/audio-output controls and inline answer/decline actions. See the [chat and calling walkthrough](docs/23-mobile-chat-call-polish.md) and [step 10 PDF](docs/LandConnect%20Mobile%20Step%2010%20Guide.pdf). That stage passed **156 mobile tests**, TypeScript/lint/format, Android JS export, real-route chat/call/meeting probes and **20/20 Expo Doctor checks**. Physical phone UI/media checks remain deferred.

Local demo data is available with **two Buyer, two Seller and two Broker accounts**. See [demo accounts and seed instructions](docs/21-demo-data.md) for login details, sample properties/chats/meeting invitations and the reusable `scripts/seed_demo.py` helper. Existing data is preserved.

The application lives in [mobile/](mobile/README.md) and uses TypeScript, Expo Router and Expo development builds. Start the backend with the LAN helper, configure `mobile/.env` from its example, then use `npm ci` and `npm run android -- --device` from `mobile/` with an ADB-authorized Android phone. Subsequent development uses `npm start`. LiveKit uses native WebRTC modules and requires rebuilding the development client; Expo Go is not supported.

Read the [first mobile walkthrough](docs/13-mobile-foundation.md) or [PDF guide](docs/LandConnect%20Mobile%20Step%201%20Guide.pdf) for authentication/session flows, and the [mobile listings walkthrough](docs/14-mobile-listings.md) or [step 2 PDF](docs/LandConnect%20Mobile%20Step%202%20Guide.pdf) for browsing, filters and details. The [property management walkthrough](docs/15-mobile-property-management.md) and [step 3 PDF](docs/LandConnect%20Mobile%20Step%203%20Guide.pdf) explain editing, publishing and photos. The [map walkthrough](docs/16-mobile-maps.md) and [step 4 PDF](docs/LandConnect%20Mobile%20Step%204%20Guide.pdf) explain MapLibre/OpenFreeMap, viewport search, location selection, permissions and verification limits.

The [mobile chat walkthrough](docs/17-mobile-chat.md) and [step 5 PDF](docs/LandConnect%20Mobile%20Step%205%20Guide.pdf) explain direct/group chat, send retry identity, cursor recovery, foreground WebSocket lifecycle, group permissions and native-origin compatibility. Device/live Redis messaging checks remain outstanding; automated checks use isolated routes and protocol fixtures.

The [mobile privacy walkthrough](docs/18-mobile-privacy.md) and [step 6 PDF](docs/LandConnect%20Mobile%20Step%206%20Guide.pdf) explain confirmed preference saves, session updates and block/unblock controls. Open My account > Privacy settings; block actions also appear on property owners and chat participants. Existing groups/history remain shared after a block.

The earlier [mobile calling walkthrough](docs/19-mobile-calling.md) and [step 7 PDF](docs/LandConnect%20Mobile%20Step%207%20Guide.pdf) explain shared PubSub hints, native configuration, media cleanup and recovery. Step 10 supersedes their separate Accept/Join interaction: dial or answer directly, grant required OS permissions, and media connects after server acceptance. Backgrounding stops media and attempts to finish the call. Run `uv run --project backend python scripts/check_mobile_calls.py` for the isolated contract check.

The calling-stage ARM64 development APK builds successfully; packaged-APK inspection confirms camera/microphone permissions. It requires Metro and has not been installed/tested on the phone in this stage.

The [mobile meeting walkthrough](docs/20-mobile-meetings.md) and [step 8 PDF](docs/LandConnect%20Mobile%20Step%208%20Guide.pdf) explain hosting, consent, shared native media, member removal, versioned rooms and cleanup. Open My account > Meetings for formal meetings; group conversation icons start group calls. Meeting invitations are managed separately from chat membership. That stage passed **147 mobile tests** and **66 selected backend tests**. Meeting probes use fake room operations and an injected authorized socket event; real device/SFU/Redis delivery remains unverified. Run `uv run --project backend python scripts/check_mobile_meetings.py` for the isolated probe.

## Calling architecture

The agreed media architecture is **WebRTC through a self-hosted LiveKit SFU**, for both one-to-one calls and invite-only group meeting rooms. Mobile clients publish audio/video tracks to the SFU, which forwards them to the other participants. FastAPI owns authentication, invitations, membership checks, call state and short-lived room access tokens. LiveKit owns media transport and its WebRTC signaling.

The `livekit-api` dependency supplies server-side room management and token generation. **LiveKit Server v1.13.11 runs in Compose**, with the same credentials as the backend and local TURN/UDP support. No Agents framework, AI models or LiveKit Cloud subscription are involved. One-to-one calling now includes lifecycle APIs, scoped room tokens, Redis notifications, timeout handling and durable media cleanup. See the [calling guide](docs/10-calling.md), [setup walkthrough](docs/09-livekit-setup.md) and earlier [SFU architecture decision](docs/04-sfu-architecture.md). Physical-device media testing remains part of client integration.

## Chat architecture

Direct and group chat use **PostgreSQL message history and a transactional outbox, Redis Pub/Sub fan-out, and authenticated WebSockets**. Redis carries small change notifications; it is not the message store. Each API instance forwards broker events to its own connected clients after authorization checks. Reconnects recover messages from paginated PostgreSQL history. See the [chat architecture decision](docs/07-chat-architecture.md) and [implementation guide](docs/08-messaging.md).

## Start the backend

Requirements: Git, uv and Docker Desktop running Linux containers. Run these commands from the LandConnect directory:

```powershell
uv sync --project backend --locked
uv run --project backend python scripts/init_env.py
docker compose up --build -d
```

`uv sync` creates or reuses `backend/.venv`. You can use `uv run` without activating it. The setup script generates a local `.env` with random secrets and preserves an existing `.env`. Both `.env` and `.venv` are excluded from Git.

Open [Swagger API documentation](http://localhost:8000/docs). The first image build downloads dependencies; the API starts after PostgreSQL, Redis and LiveKit are healthy and the migration service succeeds.

```powershell
Invoke-RestMethod http://localhost:8000/health/live
Invoke-RestMethod http://localhost:8000/health/ready
docker compose ps -a
docker compose logs --tail=50 api migrate
```

Readiness returns `503` when PostgreSQL is unavailable, its Alembic revision differs from the migration files, or the local Redis subscriber is disconnected. It does not check LiveKit continuously, verify media transport or guarantee notification delivery. LiveKit has its own Compose HTTP health check and a separate authenticated smoke check below.

Default local ports are API `8000`, PostgreSQL `55432` and Redis `56379`. They bind to the local computer only. To use different ports, update `API_PORT`, `POSTGRES_PORT` or `REDIS_PORT` in `.env`; keep host URLs in `DATABASE_URL` and `REDIS_URL` consistent. Compose uses `DOCKER_DATABASE_URL` for PostgreSQL and `redis://redis:6379/0` for Redis internally. Existing `.env` files can use the default Redis settings without being regenerated.

Use a unique `CHAT_CHANNEL_PREFIX` per deployment sharing Redis. Pub/Sub channels are independent of Redis database numbers. Local Redis has no password and is intended for this loopback development stack; configure authentication, TLS and network access for hosted infrastructure.

If you customize database credentials, keep `POSTGRES_*` and both connection URLs consistent. URL-encode special characters in connection URLs. PostgreSQL initialization settings apply when its data volume is first created; changing `.env` does not change an existing database password.

## LiveKit infrastructure

```powershell
docker compose up -d livekit
uv run --project backend python scripts/check_livekit.py
docker compose ps livekit
```

The check creates a uniquely named temporary room, lists it, deletes it and verifies deletion. It also rejects a request signed with an incorrect secret, checks the STUN/UDP binding response on `3478`, and connects to ICE/TCP `7881`. It never displays credentials or existing room names. Passing this check does **not** prove audio/video playback or TURN media relay; those require clients in the next calling checkpoint.

| Port | Purpose |
| --- | --- |
| `7880/TCP` | LiveKit HTTP control API and WebSocket signaling |
| `7881/TCP` | ICE/TCP media fallback |
| `7882/UDP` | Multiplexed WebRTC media |
| `3478/UDP` | Embedded TURN/UDP, also serving STUN |
| `30000â€“30049/UDP` | Bounded TURN relay allocation range for local testing |

All LiveKit mappings bind to `LIVEKIT_BIND_IP`, default `127.0.0.1`. Keep RTC and TURN port numbers unchanged in this local configuration: clients receive those advertised port numbers. `infra/livekit/livekit.local.yaml` contains the non-secret server settings; Compose injects `LIVEKIT_KEYS` from the existing key/secret and supplies the advertised `NODE_IP`. There is no hardcoded development secret or `--dev` mode. Preserve the generated URL-safe credentials, and do not publish expanded Compose configuration because it contains secrets.

For a host process, `LIVEKIT_INTERNAL_URL` defaults to `http://localhost:7880`; Compose overrides it to `http://livekit:7880` for the API container. `LIVEKIT_PUBLIC_URL` defaults to `ws://localhost:7880`, and `LIVEKIT_NODE_IP` defaults to `127.0.0.1`. Public URL and advertised media IP are different settings and both must be reachable by clients. An existing `.env` remains valid with the default bind IP.

For an Android phone on the same trusted Wi-Fi, start the explicit LAN profile (Docker Compose 2.24.4+):

```powershell
uv run --project backend python scripts/start_lan.py --host 192.168.29.22
uv run --project backend python scripts/check_livekit.py --host 192.168.29.22
uv run --project backend --with "livekit==1.3.0" python scripts/check_media.py --host 192.168.29.22 --participants 3 --relay
```

Replace the example with this computer's actual private Wi-Fi IPv4 address. The helper checks that it belongs to this computer, validates Compose without printing secrets, starts the stack and waits for health. API/Swagger is then `http://<LAN-IP>:8000/docs` and LiveKit signaling is `ws://<LAN-IP>:7880`. Open `http://<LAN-IP>:8000/health/ready` from the phone as a first check. A phone's localhost means the phone, not the computer.

`compose.lan.yaml` replaces API/LiveKit bindings with the selected interface and advertises that same IP in room-token URLs and ICE. PostgreSQL/Redis remain on loopback. The existing `.env` is preserved. Keep the same profile on subsequent starts by using the helper; plain `docker compose up -d` returns to the base loopback configuration. The profile is local HTTP/WS development, not public hosting.

Loopback ICE candidate gathering is now disabled in `infra/livekit/livekit.local.yaml`. This resolved the reproducible Windows-host media timeout when advertising a LAN IP through Docker NAT. Native two-way and three-way synthetic audio/video, including relay-only TURN, now pass on the Windows host. See the [connectivity walkthrough](docs/12-lan-connectivity.md) and [PDF guide](docs/LandConnect%20LAN%20Connectivity%20Guide.pdf).

This is a single-node local setup. TURN permits local/private peers and has 50 relay ports; it has not been load-tested. Public deployment needs reachable media addresses, appropriate network policy, HTTPS/WSS certificates and TURN/TLS for restrictive networks. The server may warn about Docker's UDP buffer size; tune that on the deployment host when testing production load. Rooms must be created explicitly by an authenticated server API because `room.auto_create` is disabled. This is infrastructure preparation, not the application's invitation/permission enforcement.

## Run the API locally with uv

Keep PostgreSQL and Redis in Docker and run a second development API on port `8001`:

```powershell
docker compose up -d db redis
uv run --directory backend python -m alembic upgrade head
uv run --directory backend uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

Local API documentation: <http://localhost:8001/docs>. Root `.env` settings load independently of the working directory. Containers receive settings through Compose environment variables.

## Authentication

| Endpoint | Request | Result |
| --- | --- | --- |
| `POST /auth/register` | JSON email, password, display_name and optional role | `201` user profile; role defaults to buyer |
| `POST /auth/login` | JSON email and password | `200` bearer access token and expires_in seconds |
| `GET /users/me` | `Authorization: Bearer <access_token>` | `200` authenticated user's profile |

Use `/docs` to register and log in. Copy `access_token` from the login response, click **Authorize**, paste the token alone and try `/users/me`. Swagger supplies the Bearer prefix. Other API clients must send the full Authorization header. Login accepts JSON, rather than an OAuth2 password form.

Registration supports `buyer`, `seller` and `broker`. Emails are normalized to lowercase; duplicate accounts return `409`. Passwords must be 12 through 128 characters and are stored as Argon2id hashes. Password whitespace is preserved. User responses omit password hashes, and validation errors omit submitted values.

Access tokens use HS256 and expire after `ACCESS_TOKEN_MINUTES` (default 60). Signature, issuer, audience, expiry, issue time, subject and token purpose are checked. Protected requests load the current user and role from PostgreSQL. `require_roles(Role.seller, Role.broker)` protects listing creation, editing, archiving and image management. Ownership checks additionally prevent one seller from managing another seller's properties.

This is the prototype's access-token flow. Refresh tokens, logout revocation, password recovery and email verification are not implemented. Shared login throttling and HTTPS must be provided before public deployment. Local Compose ports remain bound to the computer's loopback interface.

## Listings and maps

| Endpoint | Behavior |
| --- | --- |
| `GET /listings` | Public active listings with filters and pagination |
| `GET /listings/map` | Active listings as GeoJSON points, with the same filters |
| `GET /listings/mine` | Seller/broker's own listings, optionally filtered by status |
| `POST /listings` | Seller/broker creates a listing; default status is draft |
| `GET /listings/{id}` | Active listing publicly; other statuses only for its authenticated owner |
| `PATCH /listings/{id}` | Owner edits supplied fields or changes status |
| `DELETE /listings/{id}` | Owner archives the listing; preserves its record and images |
| `POST /listings/{id}/images` | Owner uploads one multipart `file` |
| `GET /listings/{id}/images/{image_id}` | JPEG bytes with the same visibility rules as the listing |
| `DELETE /listings/{id}/images/{image_id}` | Owner removes the image record and file |

Create a draft in Swagger, upload its images, then PATCH `{"status":"active"}` to publish. The active community feed excludes drafts, sold properties and archived properties. Owners can inspect those through `/listings/mine` or an authenticated detail request and can restore them with PATCH. There is no permanent listing-deletion endpoint in this stage.

Filters: `q`, `city`, `state`, `country`, `currency`, `min_price`, `max_price`, `min_area`, `max_area`, and a complete bounding box (`south`, `north`, `west`, `east`). Search treats `%` and `_` literally. West greater than east selects a box across the date line. `limit` defaults to 20 and is capped at 100; `offset` ranges from 0 to 10000. Responses include the filtered total. Only `/listings/mine` accepts a `status` filter.

Prices and areas are positive decimals with up to two fractional digits; area is in square metres. Country and currency fields use uppercase two-letter and three-letter formats. Coordinates allow six fractional digits and valid latitude/longitude ranges. JSON decimal values are returned as strings; map geometry contains numeric `[longitude, latitude]` pairs. Prices are not converted between currencies: specify `currency` when comparing amounts.

Uploads accept JPEG, PNG and WebP, at most 5 MiB and 12 million pixels each, with up to 10 images per listing. Images are normalized to JPEG, resized within 2048 by 2048, oriented from EXIF, and stripped of original metadata. Animated images are rejected. Every HTTP request is capped at 6 MiB, including streamed bodies. Client filenames are ignored. Image URLs are relative to the API base URL; send the owner's bearer token to preview an unpublished image.

Files live in the configured `UPLOAD_DIR`, anchored to `backend/` when relative, and in the persistent uploads volume in Docker. They are served through visibility-checked endpoints rather than a public static directory. Local files and PostgreSQL are separate storage systems; crash recovery and multi-instance storage need reconciliation/shared storage beyond this prototype.

## Messaging and privacy

All REST endpoints below require a bearer token. Conversation responses contain public member summaries (ID, display name and marketplace role), without email addresses or phone numbers.

| Endpoint | Behavior |
| --- | --- |
| `POST /conversations/direct` | `{recipient_id}`; creates or returns the pair's unique direct conversation |
| `POST /conversations/groups` | `{name, member_ids}`; owner plus 1â€“49 other members |
| `GET /conversations` | Current memberships, with limit/offset pagination |
| `GET /conversations/{id}` | Current member reads conversation details |
| `PATCH /conversations/{id}` | Owner/admin renames a group with `{name}` |
| `POST /conversations/{id}/members` | Owner/admin adds `{user_id}` |
| `PATCH /conversations/{id}/members/{user_id}` | Owner sets `{role: "admin"}` or `"member"` |
| `POST /conversations/{id}/ownership` | Owner transfers ownership to current `{user_id}` |
| `DELETE /conversations/{id}/members/me` | Leaves group; owner must first transfer ownership |
| `DELETE /conversations/{id}/members/{user_id}` | Owner/admin removes member; only owner removes admins |
| `POST /conversations/{id}/messages` | `{client_id: "UUID", body: "text"}`; durable send |
| `GET /conversations/{id}/messages` | History with `limit`, exclusive `after_id` or `before_id` |
| `PATCH /users/me/privacy` | Updates `allow_messages` and/or `allow_calls` booleans |
| `GET /users/me/blocks` | Paginated accounts blocked by the current user |
| `PUT /users/me/blocks/{user_id}` | Blocks an account, idempotently |
| `DELETE /users/me/blocks/{user_id}` | Unblocks an account, idempotently |

Messages are nonblank text of at most 4000 characters. Generate one `client_id` UUID per logical send and reuse it on retry. An identical retry returns the existing message (`200`, versus `201` for new); reusing that UUID with different text returns `409`. There are no message edits, deletion or attachments in this stage.

History defaults to the latest 50 messages, returned in ascending ID order. Use `before_id=next_before_id` for older pages. For recovery use `after_id=<last_received_id>` (or `0` for all history), then advance through `next_after_id` while `has_more` is true. Do not advance a cursor from a notification alone: fetch history through that point first. Cursor gaps across conversations are expected. Current members can read all retained group history, including messages before joining. Removed members immediately lose read/send access; rejoining restores that history.

Group owner/admin roles are separate from buyer/seller/broker roles. Owners cannot leave until transferring ownership. Direct participants are fixed. Membership checks also guard realtime hints. Missing conversations and conversations unavailable to the caller return `404`.

Blocks in either direction and a recipient's `allow_messages=false` prevent direct sends and new invitations. A new group or member addition cannot introduce a blocked pair. An existing shared group remains shared if someone later blocks another member or disables incoming messages: leave the group to stop sharing it. Changing these settings does not erase existing direct history. Call privacy is enforced as described below.

Connect a WebSocket to `ws://localhost:8000/ws/chat`. Within five seconds, send `{"type":"auth","token":"<access_token>"}` as the first frame. The server replies `{"type":"ready","user_id":"..."}`. Tokens never appear in the URL. Origins must be in `CORS_ORIGINS` or match the target API's own HTTP(S) origin; native clients may omit Origin. The exact API origin also supports React Native Android's automatic Origin header. Send `{"type":"pong"}` when the server sends `{"type":"ping"}`. Message writes stay on REST.

Notifications include `event_id`, `type`, `conversation_id`, `actor_id` and optional `message_id`/`target_user_id`; they omit text. Types are `message.created`, `conversation.updated` and `membership.removed`. Deduplicate by `event_id`, fetch authorized REST state, and periodically reconcile history even while connected. Pub/Sub is at-most-once; outbox retry can produce duplicates and events can arrive out of order. A notification is not a delivery/read receipt. On disconnect, reconnect and recover REST history. Close `1013` asks for retry/recovery; `1008` requires checking authentication/protocol, including expired tokens. Each user has at most five sockets per API process; slow consumers are disconnected when their bounded queue fills.

The outbox commits with the message, then API background relays claim pending rows with `FOR UPDATE SKIP LOCKED`, publish to server-derived per-user Redis channels, and record publication. A failed broker publish leaves the row pending. Successful publication does not mean a client received it. Published outbox rows currently remain stored; add monitored retention/cleanup before sustained production use. Push notifications, typing/presence, delivery/read receipts and end-to-end encryption are later work.

## One-to-one audio/video calls

All routes require an application bearer token. Only the two participants can read the call or act on it; outsiders receive `404`. Responses contain public profiles without private contact details, and use `Cache-Control: no-store`.

| Endpoint | Behavior |
| --- | --- |
| `POST /calls` | `{client_id: "UUID", callee_id: "UUID", kind: "audio"}` or `"video"`; initiates ringing |
| `GET /calls` | Paginated call history; optional `status` and `direction=incoming/outgoing` |
| `GET /calls/{id}` | Current state; also persists an overdue ringing timeout |
| `POST /calls/{id}/accept` | Callee accepts; creates a two-participant SFU room |
| `POST /calls/{id}/reject` | Callee rejects a ringing call |
| `POST /calls/{id}/cancel` | Caller cancels a ringing call |
| `POST /calls/{id}/end` | Either participant ends an accepted call and requests room closure |
| `POST /calls/{id}/token` | Either participant obtains room access after acceptance and fresh privacy checks |

Reuse the initiating `client_id` for a retry: matching data returns the existing call with `200`; a new call returns `201`. Different data with the same UUID returns `409`. Each account may have one ringing or accepted call at a time. Repeating the same successful lifecycle action is idempotent; incompatible transitions return `409` and wrong participant roles return `403`.

Call states are `ringing -> accepted -> ended`, or `ringing -> rejected/cancelled/missed`. `CALL_RING_SECONDS` defaults to 45 (10â€“120 allowed). A per-process maintenance worker persists missed calls independently of clients; request-time checks enforce the exact deadline before acceptance. Acceptance is application consent, not proof that audio/video is connected. Clients must show SDK connection state separately.

Blocks in either direction and the callee's `allow_calls=false` prevent initiation, acceptance and room-token access. Disabling incoming calls still permits that user to place outgoing calls. Creating a block cancels an existing ringing call between the accounts or ends an accepted call. Disabling incoming calls does the same for the user's incoming calls. These state changes and their notifications commit with the privacy update; the worker closes media rooms and retries failures.

Token responses contain `url`, `room`, `token` and `expires_in`. Default TTL is 120 seconds, configurable with `CALL_TOKEN_SECONDS` (30â€“300). Tokens identify one participant, allow only the specific room, deny room administration/creation, data publishing and agent-session management, and permit microphone publishing for audio or microphone/camera for video. They grant no screen-sharing or recording capability. Tokens and private profiles never appear in broker events. Expiry controls joining; ending existing media requires server room closure. Clients should request a fresh token when reconnecting, subject to the current call state.

The existing `/ws/chat` authenticated socket now also carries `call.incoming`, `call.accepted`, `call.rejected`, `call.cancelled`, `call.missed` and `call.ended`. Payloads contain `event_id`, `call_id` and optional `actor_id`. Deduplicate hints and fetch REST state; never infer current state from notification order. Recover incoming calls with `GET /calls?direction=incoming&status=ringing` after reconnect, and poll the current call if a hint is missed. Offline mobile push notifications remain later work.

Ending commits the terminal state and durable cleanup intent before contacting LiveKit. A successful close records `room_closed_at`; otherwise `media_cleanup_pending=true` remains visible and a worker retries. Media may continue until LiveKit acknowledges closure during an outage. Token requests cannot recreate rooms. Keep `room.auto_create=false` in the server configuration so old tokens cannot recreate deleted rooms.

The worker gives accepted calls 45 seconds to join. After that, it checks room identity and participant count in bounded batches. A missing/replaced room or fewer than two participants ends the call and closes remaining media; SFU outages leave state unchanged until a check can succeed. This polling reconciliation also handles stale state after an SFU restart, without requiring webhooks. Clients should call `/end` for immediate hangup rather than waiting for reconciliation.

## Invite-only group meetings

Meetings have one owner and up to 49 current invited/accepted guests, independent of text conversations. All marketplace roles may host. Guests must accept before requesting tokens. The roster records consent and access; use SDK participant state for live attendance.

| Endpoint | Behavior |
| --- | --- |
| `POST /meetings` | `{client_id: "UUID", title, kind: "video", member_ids: ["UUID"]}`; audio also supported |
| `GET /meetings` | Private list with limit/offset, `status=open/ended`, `invitation=invited/accepted` |
| `GET /meetings/{id}` | Owner/current invitees read public roster and state |
| `POST /meetings/{id}/members` | Owner invites or reinvites `{user_id}` |
| `POST /meetings/{id}/accept` | Guest accepts, idempotently |
| `POST /meetings/{id}/decline` | Guest withdraws consent and loses access |
| `POST /meetings/{id}/token` | Accepted member obtains scoped room access |
| `POST /meetings/{id}/leave` | Disconnects this session, preserving access for rejoin |
| `DELETE /meetings/{id}/members/{user_id}` | Owner revokes access; cannot remove themselves |
| `POST /meetings/{id}/end` | Owner ends the meeting and closes everyone's media |

Titles are trimmed, 1â€“150 characters. Creation requires 1â€“49 unique guests excluding the owner. The same `client_id` and original payload return the existing meeting (`200` versus `201`); changed data returns `409`, even after roster changes. Private responses use `no-store`; outsiders and removed/declined members get `404` for reads and token access. Repeated decline returns no roster data.

Rooms are created on the first accepted member's token request, with capacity 50, empty timeout 300 seconds and departure timeout 20 seconds. Owners need not stay online. If a materialized room disappears, the meeting ends. A meeting awaiting its first/replacement room can remain open until owner end.

**Removal deliberately requires reconnection.** Self-hosted LiveKit cannot revoke an already issued JWT by kicking its holder. When removing a token-bearing member, the backend retires the current room and advances its version. Remaining members obtain new room tokens after old-room deletion succeeds. Token issuance pauses with `503` during cleanup. Keep `room.auto_create=false` so old tokens cannot recreate retired rooms.

Decline/removal returns `204` after cleanup or `202` when authorization is revoked but media cleanup must retry. Owner end returns `media_cleanup_pending`. During an outage, old media may continue until deletion succeeds; clients should disconnect locally. Removing someone who never received tokens does not require rotation. Leaving retains consent and intentionally permits rejoin while the meeting stays open.

Blocks prevent new invitations. For a shared open meeting, a guest who blocks someone is withdrawn; if the owner blocks someone, that target is removed. Disabling incoming calls revokes guest memberships while preserving meetings owned by the user. Token-bearing revocations retire the media room; other members retain invitations. These rules differ from shared text-chat history.

The existing `/ws/chat` socket adds `meeting.invited`, `meeting.updated`, `meeting.member_removed`, `meeting.room_changed` and `meeting.ended`, carrying IDs but no tokens. Fetch REST state after hints. On `room_changed`, wait for cleanup to finish, request fresh tokens and reconnect. Recover invitations with `GET /meetings?status=open&invitation=invited`. The worker retries retired-room closure and reconciles missing/replaced rooms. See the [meeting walkthrough](docs/11-meetings.md) and [PDF guide](docs/LandConnect%20Meetings%20Guide.pdf).

## Database migrations

```powershell
uv run --directory backend python -m alembic current
uv run --directory backend python -m alembic check
```

After a model change, generate a new migration, review its `upgrade` and `downgrade`, then apply it:

```powershell
uv run --directory backend python -m alembic revision --autogenerate -m "describe the schema change"
uv run --directory backend python -m alembic upgrade head
```

Commit reviewed migrations with their model changes. Rebuild the image when code or migrations change. `docker compose up --build -d` applies pending migrations through the one-off `migrate` service before starting the API. The application never creates tables with `create_all`.

The current revision is `0004_meetings`. It preserves legacy members, backfills owner access, and adds invitation states, creation retry keys and durable room rotation. Downgrade refuses open meetings or pending cleanup. The earlier `0003_calls` migration supports one-to-one calls. It preserves existing call records and adds the caller retry key, media room SID, closure time and reconciliation time, with worker indexes. Legacy accepted timestamps are backfilled and terminal calls are marked as requiring no new media cleanup. Downgrade refuses while active calls or known media cleanup remain. The earlier `0002_chat` migration preserves direct history and blocks downgrade when groups exist.

## Checks

Run unit tests and code checks from the project root:

```powershell
uv run --directory backend python -m pytest -q
uv run --project backend ruff check backend scripts
uv run --project backend ruff format --check backend scripts
```

Without `TEST_POSTGRES_URL`, fifteen PostgreSQL integration tests are skipped. Four also require `TEST_REDIS_URL`. To run the complete suite against the development services configured in `.env`:

```powershell
uv run --directory backend python -c "import os,pytest; from app.core.config import get_settings; s=get_settings(); os.environ['TEST_POSTGRES_URL']=s.database_url; os.environ['TEST_REDIS_URL']=s.redis_url; raise SystemExit(pytest.main(['-q']))"
```

Integration tests create unique temporary schemas and remove them after use. They check authentication, listings, migration preservation/rollback, concurrent messages and opposite-direction calls, Redis cross-instance fan-out, and background call timeout notifications. Redis tests use unique prefixes and kill only their own subscriber connection. The database user needs permission to create schemas. Current validation: **209 tests passed**. Calling tests also check state permissions, token grants, privacy termination, transaction rollback, cleanup retry and room reconciliation. The installed TestClient emits one upstream HTTPX deprecation warning. Real media/control checks and their current limitations are described in the calling guide.

Native RTC probes passed inside Docker and now on the Windows host through the LAN profile. Two-client and three-client synthetic audio/video passed, including relay-only TURN; room deletion disconnected every client. Earlier Windows timeouts were resolved by disabling loopback candidate gathering with a LAN advertisement. Physical-phone media and camera/microphone checks remain pending. The connectivity guide distinguishes listener checks, synthetic transport checks and real-device validation.

Meeting verification adds a waiting-join/removal PostgreSQL race, cross-instance Redis invitations/removal, legacy membership preservation, consent/owner permissions, cleanup retry and privacy tests. Separate Docker-native probes passed three-client audio/video in all six directions, both with default ICE and relay-only TURN. Retained tokens could not rejoin the retired room after removal; surviving members rejoined a new room, and owner end disconnected everyone. These are separate media scenarios, not additional pytest cases or a physical-device demonstration.

## Files and explanations

- `backend/app/main.py`: application assembly, CORS and lifecycle management.
- `backend/app/api/router.py`: central API route registration.
- `backend/app/api/routes/health.py`: liveness and readiness endpoints.
- `backend/app/api/routes/auth.py` and `users.py`: registration, login and private profile endpoints.
- `backend/app/api/routes/listings.py`: community, ownership, upload and geographic endpoints.
- `backend/app/api/routes/conversations.py` and `websocket.py`: messaging REST and authenticated realtime endpoints.
- `backend/app/api/routes/calls.py`: private one-to-one call lifecycle and media-token endpoints.
- `backend/app/api/routes/meetings.py`: invite-only meeting, consent, member and token endpoints.
- `backend/app/api/deps.py`: authenticated-user and role dependencies.
- `backend/app/api/errors.py`: validation responses that omit submitted values.
- `backend/app/api/middleware.py`: total request-body size limit.
- `backend/app/core/config.py`: environment validation and cached settings.
- `backend/app/core/security.py`: password hashing and access-token creation/validation.
- `backend/app/schemas/`: validated request and response contracts.
- `backend/app/services/auth.py`: account creation and credential verification.
- `backend/app/services/listings.py` and `media.py`: property queries, transactions and safe image storage.
- `backend/app/services/chat.py`, `chat_outbox.py` and `realtime.py`: membership/privacy rules, transactional broker relay and local WebSocket fan-out.
- `backend/app/services/calls.py`, `livekit.py` and `call_worker.py`: call state, media grants, room lifecycle and durable maintenance.
- `backend/app/services/meetings.py` and `meeting_worker.py`: roster access, room retirement, cleanup retry and reconciliation.
- `backend/app/services/privacy.py`: shared user-lock ordering and block checks for chat/calls.
- `backend/app/db/base.py`: declarative base and constraint naming conventions.
- `backend/app/db/session.py`: connection engine and request session dependency.
- `backend/app/models/`: one file per entity, shared enums, helpers and explicit model exports.
- `backend/tests/unit/` and `backend/tests/integration/`: isolated unit and PostgreSQL checks.
- `backend/alembic/`: versioned schema changes, starting at `0001_initial`.
- `backend/Dockerfile` and `compose.yaml`: API image, PostgreSQL, Redis and migration startup.
- `infra/livekit/livekit.local.yaml`: local SFU, ICE and TURN configuration; credentials come from Compose.
- `scripts/check_livekit.py`: authenticated room lifecycle and local connectivity smoke check.
- `scripts/start_lan.py` and `compose.lan.yaml`: explicit private-interface API/media access without modifying `.env`.
- `scripts/check_media.py`: native synthetic audio/video probe for two or three clients, optionally forcing TURN.
- [Step 1 guide](docs/LandConnect%20Backend%20Step%201%20Guide.pdf): initial scaffold explanation and full assignment roadmap.
- [Step 2 explanation](docs/02-backend-foundation.md) and [PDF guide](docs/LandConnect%20Backend%20Step%202%20Guide.pdf): foundation checkpoint before the directory refactor.
- [Backend structure explanation](docs/03-backend-structure.md): current directory tree, imports and the rules for adding models and future features.
- [Backend structure PDF guide](docs/LandConnect%20Backend%20Structure%20Guide.pdf): printable explanation of the refactor.
- [Authentication explanation](docs/05-authentication.md) and [PDF guide](docs/LandConnect%20Authentication%20Guide.pdf): the authentication checkpoint.
- [Listings explanation](docs/06-listings.md) and [PDF guide](docs/LandConnect%20Listings%20Guide.pdf): uploads, maps and property management.
- [Messaging explanation](docs/08-messaging.md) and [PDF guide](docs/LandConnect%20Messaging%20Guide.pdf): direct/group chat, Pub/Sub, privacy, code walkthrough and client protocol.
- [LiveKit setup explanation](docs/09-livekit-setup.md) and [PDF guide](docs/LandConnect%20LiveKit%20Setup%20Guide.pdf): this infrastructure checkpoint and the boundaries of its verification.
- [Calling explanation](docs/10-calling.md) and [PDF guide](docs/LandConnect%20Calling%20Guide.pdf): lifecycle, privacy, token grants, Pub/Sub, media cleanup and client integration.

The structure separates HTTP handlers, configuration, persistence and models. Import `get_settings` from `app.core.config` and `get_db` from `app.db.session`. Import individual models from their modules or use the public exports in `app.models`. The models package imports every entity so Alembic receives the complete metadata registry. Importing it does not initialize a database engine.

Git is initialized at the project root on `main`. Keep `uv.lock` in Git; `.env` and virtual environments are excluded.

## Stop the containers

```powershell
docker compose down
```

PostgreSQL data and uploads are stored in named volumes, which this command preserves. Redis notifications are transient; PostgreSQL retains history, pending notifications and media cleanup intent. LiveKit rooms are runtime state; restarting the SFU disconnects participants and maintenance reconciles missing rooms. The next checkpoint is **a standalone demo APK and submission documentation**, followed by real calling demonstrations when device testing resumes. Restore Docker/LAN API startup before live app testing. Physical-device audio/video demonstrations are still required.
