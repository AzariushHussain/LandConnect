# LandConnect LiveKit Setup Guide

Self-hosted WebRTC SFU infrastructure. Implemented checkpoint: 22 November 2026.

## 1. What is implemented

LiveKit Server v1.13.11 runs as a separate Docker Compose service. The backend can reach its authenticated room-management API. The host can reach the signaling endpoint, ICE/TCP listener and embedded TURN/STUN UDP listener. Existing messaging, database and image storage continue to work.

This uses LiveKit's open-source media server and the existing livekit-api Python SDK. There is no Agents framework, AI worker, AI model or LiveKit Cloud subscription. Human clients will exchange audio/video through the SFU when the calling features are implemented.

The current step is infrastructure preparation. It does not add application call endpoints, incoming-call events, room-token endpoints or a calling UI. A successful infrastructure check is distinct from two users actually hearing and seeing each other.

## Step 1: Add a separate media service

compose.yaml pins the server image to livekit/livekit-server:v1.13.11 and mounts infra/livekit/livekit.local.yaml read-only. The configuration file contains no credentials. Compose takes the same LIVEKIT_API_KEY and LIVEKIT_API_SECRET already used by FastAPI and supplies them through LiveKit's LIVEKIT_KEYS environment variable.

```yaml
command: ["--config", "/etc/livekit.yaml"]
environment:
  LIVEKIT_KEYS: "${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}"
  NODE_IP: ${LIVEKIT_NODE_IP:-127.0.0.1}
```

This abbreviated excerpt explains the connection; the actual Compose configuration also rejects missing credentials. The existing setup script generates a random secret, preserves an existing .env, and keeps secrets outside Git. Keep the generated URL-safe credential format. Avoid displaying expanded Compose configuration, which includes credentials.

Inside Docker, FastAPI uses http://livekit:7880. A host process uses the configured LIVEKIT_INTERNAL_URL, which defaults to http://localhost:7880. These are control-plane HTTP URLs, used by the server SDK.

LIVEKIT_PUBLIC_URL defaults to ws://localhost:7880. It is the signaling address that a client will receive from a future authorized token endpoint. Media then uses the separate ICE ports and advertised media IP; a working WebSocket URL alone cannot prove media connectivity.

<!-- pagebreak -->

## 2. Local network configuration

## Step 2: Configure ICE and TURN

```yaml
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: false
  enable_loopback_candidate: true
turn:
  enabled: true
  udp_port: 3478
  relay_range_start: 30000
  relay_range_end: 30049
```

ICE selects a usable network path for WebRTC. UDP 7882 multiplexes direct client-to-SFU media on one port, avoiding a large media port range. TCP 7881 provides a fallback. STUN helps discover addressing; TURN relays traffic when a direct path cannot be used. LiveKit's embedded TURN/UDP listener also answers STUN binding requests.

The bounded relay range contains 50 UDP ports for this local prototype. It is not a measured participant-capacity promise. The local configuration permits loopback/private peer addresses so local and LAN tests are possible; the embedded TURN server also restricts relay destinations to the SFU's media ports. Public deployment should use its own reviewed network policy and TURN/TLS configuration.

Compose publishes 7880/TCP, 7881/TCP, 7882/UDP, 3478/UDP and 30000-30049/UDP. All default to loopback through LIVEKIT_BIND_IP=127.0.0.1. The container listens on its own interfaces, while the host binding controls which machines can reach it.

NODE_IP supplies the address advertised in WebRTC candidates. Local tests use 127.0.0.1. External-IP discovery is disabled because a local Docker Desktop setup needs an explicit host address instead of an automatically chosen container/public address. Keep the configured media port numbers aligned with the published ports.

## Step 3: Choose room and startup behavior

The server uses single-node routing; no extra Redis dependency is needed for this local SFU. Existing chat still uses its Redis Pub/Sub service. A future distributed media deployment requires separate deployment planning.

room.auto_create is false: joining with a token does not implicitly create a new room. The application backend will explicitly create authorized rooms in the next step. Empty rooms expire after 60 seconds by default, and rooms remain briefly after everyone leaves. Those timers are resource cleanup, not application call acceptance or unanswered-call timeouts.

The Compose health check performs an HTTP GET on LiveKit's root endpoint. FastAPI waits for LiveKit to be healthy during Compose startup. The existing /health/ready endpoint still checks PostgreSQL, migration state and Redis; it does not continuously test the media server or client media paths.

<!-- pagebreak -->

## 3. Run and verify the setup

## Step 4: Start the service

From the repository root:

```powershell
uv sync --project backend --locked
uv run --project backend python scripts/init_env.py
docker compose up --build -d
uv run --project backend python scripts/check_livekit.py
docker compose ps -a
```

An existing .env is preserved. LIVEKIT_BIND_IP defaults to loopback if absent, so the previous setup still works. No Alembic migration or application data reset is needed for this checkpoint. The current database revision remains 0002_chat.

## Step 5: Understand the smoke-check code

scripts/check_livekit.py loads the backend's settings and uses an authenticated LiveKitAPI client with a five-second request timeout. It first lists rooms to check connectivity and credentials, without printing room names.

It creates a unique landconnect-check-UUID room, lists that specific room, and removes it in a finally block. It then confirms the room is gone. Only its own temporary room is deleted. A short empty timeout also limits leftover state if the checking process is interrupted.

```python
try:
    room = await client.room.create_room(request)
    created = True
    # Validate the created room and look it up by its unique name.
finally:
    if created:
        await client.room.delete_room(delete_request)
```

The abbreviated sequence above is the cleanup pattern. Next, a second client signs a request with a random incorrect secret. The server must return HTTP 401; a reachable endpoint that accepts invalid credentials would fail the check.

The network probe sends a standard STUN binding request to UDP 3478. It validates response type, magic cookie, declared length and the random transaction ID, so an unrelated UDP response cannot count as success. It then connects to TCP 7881. Errors produce a nonzero exit without printing credentials or server response bodies.

Successful output reports authenticated room creation/listing/deletion, incorrect-secret rejection, STUN response and TCP reachability. This does not send microphone/camera tracks, exercise media decoding, force TURN relay traffic or test a restrictive external network.

<!-- pagebreak -->

## 4. Verification, device access and next work

The full existing suite plus three new unit cases passes 157 tests. New cases verify temporary-room cleanup when the control API fails and validate correct versus mismatched STUN transaction IDs. Ruff lint and formatting checks pass. The installed TestClient still emits its upstream HTTPX deprecation warning.

The real LiveKit smoke check passes against Docker. A separate authenticated request from inside the API container also succeeds using http://livekit:7880, confirming container networking and credential alignment. The application readiness endpoint remains healthy. The complete suite continues to exercise PostgreSQL migrations, authentication, listings, messaging and real Redis fan-out.

## Testing a physical phone later

For a phone on the same trusted Wi-Fi, use the computer's LAN IPv4 address in all four host settings:

```dotenv
LIVEKIT_BIND_IP=192.168.1.50
LIVEKIT_NODE_IP=192.168.1.50
LIVEKIT_PUBLIC_URL=ws://192.168.1.50:7880
LIVEKIT_INTERNAL_URL=http://192.168.1.50:7880
```

Replace the example with the actual address. Recreate LiveKit after changing the environment, permit the listed ports in the host firewall, and rerun the smoke check. Compose still overrides the API container's internal URL to its service DNS address. A phone's localhost means the phone itself. API access for the phone is separate: the API currently remains bound to the computer's loopback interface until client integration configures it.

This local configuration has no HTTPS/WSS or TURN/TLS certificates. Public deployment requires reachable advertised media addresses, TLS, appropriate firewall rules and connectivity tests from different networks. Docker may log a small UDP receive-buffer warning; production load testing must include host buffer tuning. Restarting the SFU disconnects active media participants and does not preserve room runtime state.

## Next implementation step

Add one-to-one audio/video call lifecycle APIs with initiation, acceptance, rejection, cancellation, ending and unanswered-call timeout. Enforce blocks and allow_calls. Publish incoming and state-change notifications through the existing Redis architecture, then issue short-lived room access tokens only to authorized participants.

After that, implement invite-only meetings and synchronize media room closure/removal with application state. Native-client audio/video and a three-participant meeting demonstration remain necessary to satisfy the assignment's calling requirement. This checkpoint remains uncommitted until the user requests the next commit.

## Official references

Deployment and configuration:
https://docs.livekit.io/transport/self-hosting/deployment/

Port roles:
https://docs.livekit.io/transport/self-hosting/ports-firewall/

Pinned server configuration reference:
https://github.com/livekit/livekit/blob/v1.13.11/config-sample.yaml
