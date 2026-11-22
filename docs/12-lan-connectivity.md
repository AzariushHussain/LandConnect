# LandConnect LAN Connectivity Guide

Windows-host media, trusted Wi-Fi access and repeatable diagnostics. Implemented checkpoint: 22 November 2026.

## 1. What changed and why

Calling and invite-only meetings were committed as d20a21a before this checkpoint. Those backend features already passed real media tests inside Docker. This step resolves the Windows-host media timeout and prepares API/media addresses for an Android phone on the same Wi-Fi.

## Step 1: Separate listener health from media success

The failing configuration could serve authenticated room requests, answer STUN binding requests and accept a TCP connection on its ICE port. Native clients still timed out while establishing WebRTC. These listener checks therefore did not prove that audio/video could flow.

LiveKit was gathering both the container's loopback and Ethernet candidates while its node address was mapped to the host's LAN IP. Disabling loopback candidate gathering made native Windows media tests pass. The fix is in infra/livekit/livekit.local.yaml:

```yaml
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: false
  enable_loopback_candidate: false
```

The advertised address still needs to be reachable by clients. Disabling the loopback candidate does not make 127.0.0.1 usable from a phone. The LAN profile supplies the computer's private Wi-Fi address for both WebRTC advertisement and client signaling URLs.

This was verified on the current Windows/Docker Desktop setup using the existing server v1.13.11 and native RTC client v1.3.0. It is a tested local configuration, not a guarantee that every Wi-Fi, VPN or public network permits the required media traffic.

## Step 2: Keep the existing base setup

The base compose.yaml remains available for loopback development. PostgreSQL, Redis, migrations, the API and LiveKit retain their existing volumes and credentials. No schema migration or data reset is required for this checkpoint.

An additional compose.lan.yaml replaces only API/LiveKit port bindings and the advertised addresses. It requires Docker Compose 2.24.4 or newer because it uses the !override merge tag. Database and Redis ports remain bound to 127.0.0.1.

Official configuration references:
https://docs.livekit.io/transport/self-hosting/ports-firewall/
https://docs.docker.com/reference/compose-file/merge/

<!-- pagebreak -->

## 2. Start the trusted-LAN profile

## Step 3: Choose the computer's actual Wi-Fi address

For example, if the computer's Wi-Fi IPv4 address is 192.168.29.22:

```powershell
uv run --project backend python scripts/start_lan.py --host 192.168.29.22
```

Replace this example after changing Wi-Fi or DHCP addresses. The helper accepts only RFC1918 IPv4 addresses. It rejects loopback, public, link-local and malformed addresses. It also binds an ephemeral socket to check that the chosen address is assigned to this computer before changing containers.

The helper validates Compose with config --quiet, then builds/starts the stack with --wait and a bounded health timeout. It passes LANDCONNECT_LAN_IP only to the child Compose process. It never rewrites .env or prints the expanded secret configuration. Existing database and upload volumes are preserved.

```text
Phone / Windows client -> LAN-IP:8000 -> FastAPI
Native media client    -> LAN-IP:7880 -> LiveKit signaling
Native media client    -> ICE / TURN -> LiveKit media

PostgreSQL: 127.0.0.1:55432 only
Redis:     127.0.0.1:56379 only
```

The API container still uses http://livekit:7880 for server administration. Its client-facing LIVEKIT_PUBLIC_URL becomes ws://LAN-IP:7880. ICE advertises the same LAN IP. Keep the media port numbers aligned with the published ports.

## Step 4: Check API access from the phone

On the same Wi-Fi, open http://LAN-IP:8000/health/ready in the phone browser. A successful response reports status ready, database ok, current migrations and redis ok. Swagger is available at http://LAN-IP:8000/docs. The phone's localhost points to the phone itself.

This verifies HTTP reachability only. It does not exercise microphone/camera permissions, media playback or TURN from the phone. A native mobile client is still needed for the application demonstration. The LAN profile uses HTTP/WS for trusted local development; public deployment needs appropriate HTTPS/WSS and network configuration.

The helper does not change Windows firewall rules or the network profile. Wi-Fi client isolation, VPNs and firewalls can still affect another device. Use a trusted network and targeted rules if device testing identifies a blocked port; do not disable the firewall to make a test pass.

To return to the original loopback bindings:

```powershell
docker compose up -d
```

Use the LAN helper again for subsequent phone-test starts. A plain Compose start uses the base configuration and does not retain the overlay automatically.

<!-- pagebreak -->

## 3. Run repeatable media diagnostics

## Step 5: Verify control API and listeners

```powershell
uv run --project backend python scripts/check_livekit.py --host 192.168.29.22
```

The optional host argument overrides only this diagnostic's control/signaling addresses. It leaves .env intact. The script creates, lists and deletes its own temporary room, rejects invalid credentials, validates a STUN/UDP binding response on 3478 and checks TCP reachability on 7881. It does not prove media forwarding.

## Step 6: Verify synthetic audio and video

```powershell
uv run --project backend --with "livekit==1.3.0" python `
  scripts/check_media.py --host 192.168.29.22 --participants 2
uv run --project backend --with "livekit==1.3.0" python `
  scripts/check_media.py --host 192.168.29.22 --participants 3
uv run --project backend --with "livekit==1.3.0" python `
  scripts/check_media.py --host 192.168.29.22 --participants 3 --relay
```

The RTC SDK is installed in an ephemeral uv environment for the diagnostic. It is not added to the backend's production dependencies. It is a native media client, not an AI agent framework.

The probe creates a uniquely named temporary room through the authenticated server API and issues short-lived, room-scoped tokens to its test clients. It publishes synthetic microphone audio and camera video without opening physical devices. Each receiver must obtain nonzero audio and a decoded video frame from every other participant. Two clients produce two directed flows; three clients produce six, separately checked for audio and video.

The relay flag forces relay-only ICE. Default ICE can choose among the available paths; a default-ICE pass alone does not identify which path was selected. The relay-only run specifically exercises embedded TURN media transport.

After receiving all expected flows, the probe deletes its room and requires every client to observe disconnection. Cleanup also runs on failure, closes test clients/streams and attempts deletion of only that temporary room. A short empty-room timeout bounds leftover state after process interruption. Application users, call records and meeting records are not created or deleted.

Errors identify the failed phase and exception type without printing SDK responses, tokens or settings. Client connections and frame reception use bounded timeouts. If a network is briefly slow, rerun the diagnostic; one failed probe is still a failed probe and is not silently counted as success.

<!-- pagebreak -->

## 4. Verification and next checkpoint

The full automated suite passes 209 tests, including the existing fifteen PostgreSQL integration cases. Nine new unit cases cover invalid LAN address rejection, rejection of an unassigned host before container mutation, use of the intended overlay, health waiting and preservation of a synthetic .env file in an isolated test directory. Ruff lint/format checks pass. TestClient retains its upstream HTTPX deprecation warning.

## Windows-host media results

Two native clients exchanged synthetic audio and video in both directions using the corrected LAN configuration. Three clients exchanged both media types across all six directions with default ICE and again with relay-only TURN. Room deletion disconnected every participant. The new reusable probe reproduced these results from the Windows host, rather than only from containers.

An initial short-deadline three-client relay probe timed out. A standalone rerun passed; connection deadlines were then increased and made phase-specific for more useful diagnostics. The final default-ICE and relay-only three-client runs both passed. This remains a local connectivity check rather than a load or reliability benchmark.

The LAN startup helper succeeded, the API and SFU listeners were reachable on the selected interface, and PostgreSQL/Redis remained on loopback. Earlier complete backend checks also verified actual call/meeting state transitions, token permissions, member removal and stale-token rejection; this diagnostic focuses on network transport and does not replace those application tests.

## What is still unverified

Physical Android-phone media, camera/microphone permissions, Android development-build networking, audio routing and mobile background behavior are not established by synthetic Windows tests. Phone HTTP reachability is a separate check. Shared Wi-Fi success does not prove internet or restrictive-network connectivity, TURN/TLS or production capacity.

## Next implementation step

Build the React Native Android client foundation and connect it to the LAN API/signaling addresses. Add login, listing browsing and chat using the existing contracts, then the call/meeting interface with consent, connected-state UI, removal reconnect and cleanup handling. A physical-device audio/video demonstration remains required.

This connectivity checkpoint remains uncommitted until the user requests a commit. The earlier calling and meeting implementation is saved in d20a21a.
