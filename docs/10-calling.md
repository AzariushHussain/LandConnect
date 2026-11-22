# LandConnect Calling Guide

One-to-one audio/video call APIs, scoped media access and reliable room cleanup. Implemented checkpoint: 22 November 2026.

## 1. Application call lifecycle

This checkpoint adds calling among buyers, sellers and brokers through the existing self-hosted LiveKit SFU. FastAPI controls invitations, permissions and persistent call state. LiveKit transports media. No AI agents, model services or LiveKit Cloud subscription are involved. Group meeting APIs and the React Native interface remain later checkpoints.

## Step 1: Initiate and respond to a call

Every route requires the application's bearer token. POST /calls accepts:

```json
{
  "client_id": "f637ee26-c8c8-4cb7-8c60-e120e3a7611d",
  "callee_id": "713e8850-d645-47a3-8983-493339889541",
  "kind": "audio"
}
```

Use video for camera calls. Generate one client_id per logical invitation and keep it on retry. A new invitation returns 201. A matching retry returns the same call with 200; different data with the same UUID returns 409. Self-calls are rejected. An account may have only one ringing or accepted call at a time.

```text
ringing -- callee accepts --> accepted -- either ends --> ended
ringing -- callee rejects -----------------------------> rejected
ringing -- caller cancels -----------------------------> cancelled
ringing -- ringing deadline passes --------------------> missed
```

POST /calls/{id}/accept and /reject are callee-only. POST /calls/{id}/cancel is caller-only. POST /calls/{id}/end is available to either participant after acceptance. Repeating the same completed action is idempotent; incompatible transitions return 409. Wrong participant roles return 403; outsiders receive 404 for reads and actions.

GET /calls/{id} returns the latest persistent state. GET /calls lists private history with limit/offset pagination and optional status and direction=incoming/outgoing. Profiles contain IDs, display names and marketplace roles without private email or phone details. Responses are marked no-store.

Acceptance means consent to enter the call. It does not mean media has connected. The mobile interface must distinguish accepted/connecting from the SDK's connected state, then show disconnected or ended when appropriate.

<!-- pagebreak -->

## 2. State, transactions and privacy

## Step 2: Extend the existing Call model

Migration 0003_calls preserves the original call records and adds a nullable legacy-compatible client UUID, the LiveKit room SID, the room closure timestamp and the last media-check timestamp. A caller/client UUID uniqueness constraint protects retries. Indexes support ringing timeout and media reconciliation scans.

Legacy accepted_at values are backfilled from created_at where necessary. Existing terminal calls are marked as needing no new media cleanup. The migration does not reset users, messages or call history. Downgrade refuses while active calls or known media cleanup remain.

## Step 3: Serialize conflicting actions

app/services/calls.py owns transitions. It locks participant user rows in sorted UUID order before locking the call row. This same order is shared with privacy changes. Creating opposite-direction calls simultaneously therefore produces one active call and one busy response, rather than two ringing calls.

After obtaining the call lock, the service refreshes state before acting. Only one concurrent transition can change it. New state and its notification are committed together using the existing transactional outbox. A failed database commit cannot leave a saved invitation without its publication intent.

```python
call = locked(db, call_id, actor)
# Check participant role, ringing deadline and current state.
# Acceptance creates the media room and remembers its SID.
call.status = CallStatus.accepted
call.accepted_at = now()
emit(db, call, actor)
db.commit()
```

This abbreviated sequence shows the service boundary; the actual implementation includes deadline rechecks after the media request. Media and PostgreSQL cannot share one atomic transaction. A failed acceptance commit may leave an empty media room, which expires automatically after its configured timeout. No client receives a room token before a committed accepted state.

## Step 4: Enforce privacy throughout the flow

A block in either direction or the callee's allow_calls=false prevents initiation, acceptance and token issuance. This preference controls incoming calls; the user can still place outgoing calls. Incoming message preferences are independent of call preferences.

Adding a block cancels a ringing call between those accounts or ends an accepted call. Disabling incoming calls does the same for the user's incoming calls. Those changes and their call events commit with the privacy update. Shared helpers in app/services/privacy.py enforce consistent user locking and block checks across chat and calls. General service exceptions now have neutral names and retain the existing HTTP status behavior.

<!-- pagebreak -->

## 3. Authorized media access

## Step 5: Create the room only after consent

Acceptance calls the official LiveKit server SDK through app/services/livekit.py. The room name is derived from the call UUID and its maximum participant count is two. The returned room SID is stored so reconciliation and token checks can distinguish the expected room instance from a replacement.

The media gateway wraps the asynchronous SDK for synchronous request/worker threads, with bounded three-second requests and sanitized service errors. A failed room creation returns 503 and leaves the call ringing so acceptance can retry before the deadline. If the deadline passes during creation, acceptance is refused and room cleanup is requested.

## Step 6: Issue a scoped room token

POST /calls/{id}/token requires the caller or callee, an accepted state, current privacy permission and the expected live media room. It returns url, room, token and expires_in. It never recreates a missing room: the call ends instead. Keep room.auto_create=false in the LiveKit configuration so stale tokens cannot recreate deleted rooms.

```python
api.VideoGrants(
    room_join=True, room=room_name(call.id),
    room_create=False, room_admin=False, room_list=False,
    can_publish=True, can_subscribe=True,
    can_publish_data=False,
    can_publish_sources=["microphone"],
)
```

The abbreviated grant above is for audio. Video adds camera. Full grants also deny recording, ingress administration, metadata changes, agent-session management and metrics subscription. They permit no screen-sharing source. Identity is the authenticated user's UUID; private contact data is unnecessary.

CALL_TOKEN_SECONDS defaults to 120 and permits 30 through 300. The application login JWT and LiveKit JWT serve different purposes and use different signing credentials. Never expose the LiveKit API secret to clients. Tokens are returned only in private no-store responses, never in Redis events.

Token expiration governs joining; it does not automatically stop already connected media. Ending a call must close its room on the server. If reconnecting, request a fresh token through the application so state and privacy are checked again.

## Step 7: Notify through Redis Pub/Sub

The existing /ws/chat first-frame authentication protocol now carries call.incoming, call.accepted, call.rejected, call.cancelled, call.missed and call.ended. The discriminated event schema accepts both existing chat hints and new call hints. Existing message payloads remain compatible.

Call hints contain event_id, call_id and optional actor_id, without media tokens. Current participant authorization is checked before forwarding; stale ringing/accepted hints are suppressed. Deduplicate IDs and fetch REST state. On reconnect, recover incoming calls with GET /calls?direction=incoming&status=ringing. Pub/Sub can miss or reorder hints, so clients should also poll current state. Offline push notifications are not implemented.

<!-- pagebreak -->

## 4. Timeouts, disconnection and cleanup

## Step 8: Persist termination before closing media

An accepted call ending sets status and ended_at and saves its call.ended outbox event. A null room_closed_at on a terminal call is durable cleanup intent. The service then attempts LiveKit DeleteRoom, which disconnects participants. Success records closure time. Failure leaves media_cleanup_pending=true for retry; the terminal application state is not rolled back.

This makes end requests safe during a temporary media outage, but media can continue until the server acknowledges room closure. Clients should disconnect locally immediately on hangup and observe the cleanup field if server closure is delayed. Repeating /end retries closure idempotently.

## Step 9: Run maintenance independently of clients

app/services/call_worker.py starts alongside the realtime hub during application lifespan. Every API process can run maintenance. Row locks and SKIP LOCKED divide claims for timeout/reconciliation work; cleanup re-locks individual records and handles already-missing rooms safely.

CALL_RING_SECONDS defaults to 45 and permits 10 through 120. The worker marks overdue ringing calls missed, even when both clients are offline. Transition requests additionally check the actual deadline, so worker scheduling delay cannot allow late acceptance.

Accepted calls receive a 45-second join grace. Thereafter, bounded batches inspect media room SID and participant count. Fewer than two participants, a missing room or a replaced room ends the application call and requests cleanup. If the control API is unavailable, reconciliation retries without declaring healthy calls ended merely because the API failed. Successful checks rotate through calls using media_checked_at.

This polling approach handles peer departure and stale state following an SFU restart without adding a webhook deployment requirement. Clients should explicitly call /end for immediate hangup. A client still negotiating after the grace period can have its call ended; reconnect and connection-state UI must account for that behavior.

## Code map

app/api/routes/calls.py validates HTTP requests and sets private response headers. app/schemas/call.py defines invitations, history, tokens and call events. app/services/calls.py contains state, idempotency, busy checks and authorization. app/services/livekit.py contains room operations and media grants. app/services/call_worker.py contains periodic timeout, reconciliation and cleanup work.

app/schemas/events.py combines chat and call hints. app/services/realtime.py validates that union and forwards only authorized hints. The existing ChatOutbox table is reused as the communication event outbox; its table name remains unchanged to preserve the deployed schema. Published-event retention remains earlier documented production work.

## Official references

Token grants: https://docs.livekit.io/frontends/reference/tokens-grants/

Room management: https://docs.livekit.io/intro/basics/rooms-participants-tracks/rooms/

Python server SDK: https://docs.livekit.io/reference/python/livekit/api/

<!-- pagebreak -->

## 5. Run, verify and continue

From the repository root:

```powershell
uv sync --project backend --locked
docker compose up --build -d
Invoke-RestMethod http://localhost:8000/health/ready
```

Compose applies 0003_calls before starting the updated API. Existing .env files use defaults for the two new call settings. Register or log in two accounts through Swagger at http://localhost:8000/docs. With caller authorization, create the call using the other account's ID. Switch authorization to the callee to accept, then request each account's room token. Either account can end the accepted call. Never share login or media tokens in screenshots or logs.

The complete suite passes 177 tests, including twelve PostgreSQL integration cases. It covers opposite-call concurrency, state permissions, retry keys, timeout persistence, scoped token grants, block/preference termination, failed-commit rollback, cleanup retry, room reconciliation, legacy migration preservation and downgrade safeguards. Real Redis tests verify call hints across independent API instances and background missed-call publication. Ruff lint and formatting pass; TestClient retains its upstream HTTPX deprecation warning.

README includes the full-suite command that loads TEST_POSTGRES_URL and TEST_REDIS_URL without printing credentials. Without infrastructure variables, twelve cases skip. Unit tests use fake media operations and do not contact the developer's LiveKit instance.

## Media verification and limits

Additional native Python RTC clients inside the Docker network passed three real media scenarios: two-way synthetic audio with default ICE, two-way synthetic audio/video with default ICE, and two-way synthetic audio/video with relay-only ICE to force TURN. Ending each call through FastAPI disconnected both clients, and subsequent token requests were rejected. These checks used real API-created rooms and scoped tokens. Temporary accounts, call records, rooms and the checking container were removed afterward.

These scenarios are separate from the 177 automated tests. RTC and HTTP test-client packages were installed only in an ephemeral checking container, without adding media-client packages to the production backend. A temporary internal-network Compose override advertised the container's media address and service DNS; normal loopback configuration was restored after verification.

Native probes from the Windows host timed out with both loopback and temporary LAN advertisements in this environment, although signaling and authenticated control requests succeeded. Host firewall/NAT/media routing remains unresolved. Docker media results do not establish Windows-host or phone connectivity and must not be presented as a successful physical-device demonstration.

Mobile calling UI, camera/microphone permissions, physical-device network behavior and external-network connectivity still require client integration. Public deployment needs HTTPS/WSS, reachable ICE addresses and an appropriately tested TURN deployment. Local infrastructure success alone is not the assignment's full working mobile-call demonstration.

## Next checkpoint

Implement invite-only group meetings: owner/member permissions, invitation access, join/leave tokens, removal and owner-ended room closure. Then integrate the React Native calling interface, incoming-call UX and a real-device audio/video demonstration. This checkpoint remains uncommitted until the user requests its commit.
