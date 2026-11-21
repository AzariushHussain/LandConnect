# LandConnect Messaging Guide

Direct chat, group conversations, Redis Pub/Sub and privacy controls. Implemented checkpoint: 21 November 2026.

## 1. What this checkpoint adds

Buyers, sellers and brokers can create direct conversations, create groups, send text, browse history, manage group membership and block accounts. All marketplace roles can chat. Group ownership and administration are separate permissions. This covers text messaging and basic communication privacy; LiveKit calls and meeting rooms are the next checkpoint.

The previous architecture decision was committed as 7c7dfa8. This document explains its implementation. The code follows the existing production-oriented layers: routes for HTTP, schemas for validation, services for policy and transactions, models for persistence, and reviewed Alembic migrations.

## Step 1: Store durable state in PostgreSQL

Conversation now has a direct/group kind. A direct conversation retains its unique ordered pair of user IDs. A group instead has a name and owner. Database checks enforce these two shapes. ConversationMember stores the conversation/user pair, admin/member role and join time. The composite primary key prevents duplicate memberships.

Message retains its integer ID, sender, text and timestamp, and adds client_id. A uniqueness constraint on conversation_id, sender_id and client_id makes retries safe. Legacy messages can have a null client_id; every new API send requires a UUID.

ChatOutbox stores event ID, event metadata, recipient IDs, creation time and optional publication time. It contains no message text. The new models live in their own files and are explicitly exported through app/models/__init__.py so Alembic sees the full registry.

## Step 2: Connect the components through Pub/Sub

```text
REST send + JWT
  -> membership/privacy checks
  -> PostgreSQL: message + outbox in ONE transaction
  -> background relay: Redis PUBLISH per recipient
  -> subscribers in every API process
  -> live authorization check -> local WebSocket hint
  -> client fetches PostgreSQL history
```

Each process owns only its local socket queues. Communication between processes uses Redis. Clients never connect to Redis or choose a subscription channel. Channels are derived from the configured deployment prefix plus the authenticated user's ID.

PostgreSQL is the source of truth. Redis Pub/Sub is transient and provides at-most-once delivery. A hint can be missed, duplicated by relay retries or received out of order. The client must recover and periodically reconcile history. No hint proves delivery or reading.

<!-- pagebreak -->

## 2. Sending safely, step by step

The implementation is in app/services/chat.py. HTTP handlers obtain the current user and database session, validate input through app/schemas/chat.py, call a service and serialize a public response. Business rules are shared by REST and realtime authorization rather than duplicated in handlers.

## Step 3: Validate and serialize a send

MessageCreate requires a UUID client_id and nonblank body of 1 through 4000 characters. Text whitespace is preserved. Unknown fields are rejected. The following is the central transaction sequence, abbreviated from send_message:

```python
conversation = get_conversation(db, conversation_id, actor, write=True)
# Look up this sender's existing client_id; return it on an exact retry.
# For direct messages, check current recipient preference and blocks.
db.add(message)
db.flush()
emit(db, conversation, actor,
     event_type="message.created", message_id=message.id)
db.commit()
```

The write lock is SELECT FOR UPDATE on the conversation. It serializes messages and membership changes for that conversation. Membership is checked again in a fresh statement after acquiring the lock: a member may have been removed while the request was waiting. The PostgreSQL regression test reproduces exactly that race.

Serializing sends also makes a per-conversation integer cursor safe. Without it, one transaction could allocate a lower message ID and commit after a later ID had already been fetched. The client could then skip the earlier message forever. IDs can still have gaps because other conversations and rolled-back transactions use the same sequence.

An exact retry with the same sender/client UUID returns the original message with HTTP 200. A new send returns 201. The same UUID with different text returns 409. The conversation lock and database uniqueness constraint protect simultaneous retries. Keep the UUID when retrying a timed-out request.

## Step 4: Publish after commit

app/services/chat_outbox.py claims up to 20 pending events per pass using FOR UPDATE SKIP LOCKED. Each API process can run the relay without publishing the same claimed batch concurrently. It publishes to recipient channels through a Redis pipeline, then marks publication time and commits.

If publication fails, the transaction leaves the event pending for retry. If the process crashes after Redis publication but before the database commit, it can publish again with the same event_id. This is why clients deduplicate IDs. Publication can succeed with no subscriber, so the outbox does not replace REST recovery.

A message and its outbox event commit together. A database failure before commit leaves neither record. No network operation with Redis runs inside the user's send transaction. Broker downtime therefore does not erase a successfully committed REST message.

<!-- pagebreak -->

## 3. Conversations, permissions and privacy

## Step 5: Create direct and group conversations

POST /conversations/direct accepts recipient_id. User IDs are sorted into a canonical pair, and relevant user rows are locked in stable order. The pair's existing conversation returns 200; a new one returns 201. A user cannot create a conversation with themselves. Direct participants cannot be changed.

POST /conversations/groups accepts a name and 1 through 49 distinct member_ids, excluding the caller. The caller becomes owner and admin. Groups allow at most 50 current participants including the owner; names are trimmed and limited to 100 characters.

GET /conversations lists the caller's memberships with limit/offset pagination. GET /conversations/{id} returns public details only to a current member. An unavailable conversation returns 404. Member summaries expose ID, display name and marketplace role, without private email or phone details.

## Group management endpoints

```text
PATCH  /conversations/{id}                    {name}
POST   /conversations/{id}/members            {user_id}
PATCH  /conversations/{id}/members/{user_id}  {role}
POST   /conversations/{id}/ownership          {user_id}
DELETE /conversations/{id}/members/me
DELETE /conversations/{id}/members/{user_id}
```

Owner and admins can rename the group and add ordinary members. Only the owner can promote/demote admins or transfer ownership. Admins can remove ordinary members; only the owner can remove admins. Members can leave. An owner must transfer ownership before leaving; the new owner must already be a member and becomes an admin. The former owner remains an admin until the new owner changes their role or they leave.

Current members can read all retained group history, including messages sent before they joined. Removal immediately prevents new history reads and sends; realtime hints also check current authorization. Rejoining restores access to shared history. Previously downloaded copies cannot be recalled.

## Privacy rules

PATCH /users/me/privacy accepts allow_messages and/or allow_calls as actual JSON booleans. Empty changes and null values are rejected. Call preferences are saved for the next calling checkpoint.

PUT /users/me/blocks/{user_id} blocks; DELETE on the same path unblocks. Both are idempotent. GET /users/me/blocks lists outgoing blocks. Blocking yourself is rejected. A block in either direction, or a recipient disabling incoming messages, prevents direct sends and new invitations. New groups and additions cannot introduce a blocked pair.

An already shared group remains shared after a later block or incoming-message preference change. Leave that group to stop participating. Direct history is retained and readable by its participants after blocking. This policy is deliberate and must be represented accurately in the mobile interface.

<!-- pagebreak -->

## 4. Client protocol and history recovery

## Step 6: Send text through REST

POST /conversations/{id}/messages with a bearer token:

```json
{
  "client_id": "5428ab0a-79c4-4f3b-a76b-fb91775974af",
  "body": "Can we discuss this land listing?"
}
```

Generate a fresh UUID for each logical message; the example must not be reused for unrelated sends. Responses include the server ID, public sender summary, client UUID, body and timestamp.

GET /conversations/{id}/messages defaults to the latest 50 messages and returns items in ascending ID order. limit is 1 through 100. before_id fetches older messages; after_id fetches newer messages, both exclusively. The filters cannot be combined.

For older pages, use next_before_id while has_more is true. For recovery, start with after_id equal to the last fully stored server ID, or 0 for all history, then repeatedly use next_after_id until has_more is false. Store the cursor separately for each conversation. Advance it only after successfully processing the returned history, never from a notification alone.

## Authenticate a WebSocket

Connect to ws://localhost:8000/ws/chat. Within five seconds send:

```json
{"type":"auth","token":"YOUR_ACCESS_TOKEN"}
```

The server replies with type ready and the authenticated user_id. The token stays out of the URL. Browser Origin must match CORS_ORIGINS; native clients may omit Origin. JWT signature, issuer, audience, purpose, subject and expiry are validated, and the account must exist. Connected tokens close at expiry.

The server sends type ping periodically; reply with {"type":"pong"}. Send messages through REST. Other client commands are rejected. Frames are capped at 8192 bytes; each user may have five sockets per process, each with a queue capped at 100 events. A slow consumer reconnects instead of building unbounded memory.

## React to metadata hints

```json
{
  "event_id": "057c7f69-d8db-4d7c-8e81-52dc2c114977",
  "type": "message.created",
  "conversation_id": "13ff8f94-52ca-4bf8-b679-9aee1e5dfdbd",
  "actor_id": "b5998cbd-c0da-41c4-9c78-239a9f89f5f0",
  "message_id": 42
}
```

Deduplicate event_id and fetch authorized REST state. Other event types are conversation.updated and membership.removed; removal includes target_user_id. Message text never travels through Redis. Close 1013 requests retry and history recovery; 1008 indicates authentication/protocol issues, including token expiry; 1009 indicates an oversized frame. Reconcile on every reconnect and periodically while connected because silent event loss is possible.

<!-- pagebreak -->

## 5. Infrastructure and migration

## Step 7: Run the complete implemented backend

From the repository root:

```powershell
uv sync --project backend --locked
uv run --project backend python scripts/init_env.py
docker compose up --build -d
Invoke-RestMethod http://localhost:8000/health/ready
```

The setup script preserves an existing .env. Defaults allow existing local setups to use Redis without regenerating secrets. Local ports are API 8000, PostgreSQL 55432 and Redis 56379; all bind to loopback. Compose connects internally to db:5432 and redis:6379. For a host development API, start both db and redis and set host URLs consistently if changing ports.

The Redis Python dependency is locked through uv. Docker runs the API as the existing non-root account. Compose waits for PostgreSQL and Redis health and a successful migrate job. The readiness endpoint checks database connectivity, the Alembic revision and this process's subscriber readiness. Liveness remains independent.

Set CHAT_CHANNEL_PREFIX uniquely for each deployment sharing Redis. Pub/Sub channels are not isolated by selecting different Redis database numbers. Redis data durability is not needed for these transient hints: messages and pending outbox records are in PostgreSQL. Configure appropriate credentials, transport security and network restrictions when moving beyond local Compose.

## Migration 0002_chat

The reviewed migration extends Conversation, adds ConversationMember and ChatOutbox, and adds the Message retry key. Existing direct conversations retain their IDs, pair uniqueness and message history. Both old participants are backfilled as members with the original conversation timestamp. No application data reset is required.

Downgrade refuses if group conversations exist because the old two-participant schema cannot represent them. Integration tests exercise legacy preservation, schema/model consistency and rollback/reapply in isolated schemas. Do not delete real groups simply to force a downgrade.

## Where to read the code

app/api/routes/conversations.py handles conversation, member and message REST requests. app/api/routes/users.py handles privacy and block requests. app/api/routes/websocket.py implements authentication and the socket protocol.

app/schemas/chat.py defines request/response contracts. app/services/chat.py owns membership, privacy, idempotency and history. app/services/chat_outbox.py owns publication transactions. app/services/realtime.py owns subscriptions, local queues, reconnect behavior and relay tasks.

app/main.py creates and closes the per-process hub through application lifespan. Its injectable session factory lets integration tests run two independent app instances against an isolated database schema. Existing HTTP authentication keeps its token helper; a shared claims decoder also supports socket expiry handling.

<!-- pagebreak -->

## 6. Verification and the next checkpoint

The complete suite passes 154 tests, including nine PostgreSQL integration tests; two of those also use real Redis. Ruff lint and formatting checks pass. The installed TestClient emits one upstream HTTPX deprecation warning.

Tests cover direct-pair uniqueness, group roles and ownership transfer, the 50-member cap, block/preference rules, private summaries, history pagination, idempotent retries, failed transaction rollback, outbox retry, socket authentication and expiry, queue bounds and Redis readiness.

PostgreSQL concurrency tests verify that simultaneous retries create one message and that a send waiting behind member removal is rejected after the removal commits. Migration tests preserve a legacy direct conversation and its message, then verify the group downgrade guard.

Real Redis integration tests run separate app hubs, receive a message on another instance, verify removal authorization, disconnect only the test's own subscriber and recover history after reconnect. They use unique channel prefixes and temporary database schemas; application tables are never downgraded.

An additional Docker smoke check ran two separate API containers against the same PostgreSQL and Redis services. Group hints reached sockets in both processes. REST history, duplicate-send retry and member-removal enforcement passed. The temporary second container, accounts and conversations were removed afterward; the main stack remains running.

## Run verification

```powershell
uv run --project backend ruff check backend scripts
uv run --project backend ruff format --check backend scripts
uv run --directory backend python -m pytest -q
```

The last command skips infrastructure tests unless TEST_POSTGRES_URL and TEST_REDIS_URL are set. README contains a command that safely loads both URLs from the existing local settings without printing credentials. Use a PostgreSQL account that can create temporary schemas. The Redis reconnect test requires permission to inspect clients and kill its own subscriber connection.

## Remaining scope

This is a working text-chat checkpoint in a functional prototype. It does not include mobile UI, push notifications, typing/presence, message attachments or edits, message deletion, delivery/read receipts or end-to-end encryption. There is no claim of exactly-once realtime delivery. Access-token refresh/revocation and shared abuse throttling remain earlier documented deployment work.

Published outbox rows are currently retained. Add retention, operational metrics and monitored retry handling for sustained production use. Every process subscribes to the deployment's recipient-channel pattern and discards nonlocal recipients; measure load before choosing more granular subscriptions or a dedicated relay deployment.

The next authorized checkpoint, after the user says next, is LiveKit SFU audio/video calls and invite-only meeting rooms: initiation, incoming-call events, accept/reject/end state, current membership/privacy checks and short-lived media tokens. LiveKit media deployment and a mobile call demonstration are still required to complete the assignment's key calling requirement.

## Primary references

Redis Pub/Sub delivery and channel semantics:
https://redis.io/docs/latest/develop/pubsub/

Redis Python Pub/Sub guidance:
https://redis.io/docs/latest/develop/use-cases/pub-sub/redis-py/
