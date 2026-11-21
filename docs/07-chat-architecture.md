# LandConnect Chat Architecture

Direct and group text conversations will follow the same publish/subscribe architecture. This decision is recorded before implementing the messaging checkpoint. Audio/video will continue to use the separate LiveKit SFU architecture.

## Message flow

```text
Authenticated sender
    POST message with a reusable client UUID
          |
    FastAPI validates current membership and privacy
          |
    PostgreSQL transaction saves message and outbox event
          |
    Outbox relay publishes through Redis Pub/Sub
          |
    Every FastAPI instance receives recipient notifications
          |
    Authorized local WebSockets receive change events
          |
    Clients fetch ordered message history from PostgreSQL
```

Clients connect to FastAPI, not directly to Redis. Per-user channels are derived by the server, with an environment-specific prefix. Each process keeps only its own socket connections locally; message delivery between processes uses Redis. Pub/Sub channel names are not isolated by Redis database number, so separate environments and tests need distinct prefixes.

## Durability and reconnects

Message bodies stay in PostgreSQL. An outbox event is inserted in the same transaction as the message so a process crash cannot leave a committed message with no pending publication. A background relay retries unpublished events. A relay crash after publishing but before marking its event published can produce a duplicate notification; event IDs allow clients to deduplicate.

Redis Pub/Sub itself provides at-most-once delivery. Offline or disconnected subscribers can miss events, even with an outbox. WebSocket events are therefore hints, not proof that a message was delivered or read. On reconnect, clients fetch history after their last stored message ID, and should periodically reconcile while connected. Message writes for a conversation are serialized to make its history cursor safe with concurrent commits. Reusing a client UUID makes send retries idempotent; a different body with that UUID is rejected.

Broker events contain identifiers and event type, not message text. Slow WebSocket clients get bounded queues and reconnect rather than consuming unbounded server memory. Tokens expire, memberships are rechecked before message notifications, and clients cannot subscribe to arbitrary Redis channels.

## Direct and group membership

An Alembic migration will extend Conversation with direct/group type, a group name and owner, and add ConversationMember. Existing two-user conversations and their message history must be preserved, with both participants backfilled as members. Group membership will have admin/member roles; ownership is separate from marketplace buyer/seller/broker roles.

Current members may read shared history. Removed members lose access to new reads, sends and message notifications. Owners can name groups, manage admins and transfer ownership; an owner must transfer before leaving. Admins can add ordinary members and remove ordinary members. Direct participants cannot be changed. Groups will have a bounded participant count for the prototype.

Blocking and incoming-message preferences govern direct sends and new invitations. New groups or invitations must not introduce a blocked pair. If users block each other after already sharing a group, the existing group remains shared history and communication for its current members; they can leave it. This policy is explicit so a block is not mistaken for deletion of an existing shared group. Private account emails and phone details are not exposed in conversation member summaries.

## Implementation and validation

The messaging checkpoint will add Redis to Docker Compose, the Python Redis dependency, REST conversation/member/history endpoints, authenticated WebSockets, privacy updates, block controls, the outbox relay and migrations. It must demonstrate cross-instance fan-out using real Redis, plus unauthorized access rejection, group member removal, idempotent sends, broker outage/retry and migration preservation. This architecture decision alone does not deploy those features.

Official Redis delivery semantics and channel scoping
https://redis.io/docs/latest/develop/pubsub/

Official Python Pub/Sub guidance
https://redis.io/docs/latest/develop/use-cases/pub-sub/redis-py/
