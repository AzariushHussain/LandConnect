# LandConnect SFU Architecture Guide

We will use a self-hosted LiveKit Selective Forwarding Unit for both one-to-one audio/video calls and invite-only group meetings. This decision extends the planned demonstration to group calling while keeping the brief's one-to-one call lifecycle as a priority. This is the agreed architecture; the media service and calling features are still pending implementation.

## 1 Separate application control from media

```text
Application control
Mobile clients <-- HTTPS / WebSocket --> FastAPI
                                           |
                                       PostgreSQL

Audio and video
Mobile A <-- WebRTC --> LiveKit SFU <-- WebRTC --> Mobile B
                            ^
                            | WebRTC
                         Mobile C
```

FastAPI controls identity, permissions, invitations, call acceptance and room access. PostgreSQL stores call and meeting records. The mobile clients use LiveKit's client SDK to connect to the media server after the backend authorizes them.

LiveKit is an SFU: clients publish encoded audio/video tracks, and the server forwards tracks to subscribers. A group participant publishes to the SFU instead of sending a separate copy to every other participant. The same transport can serve a two-person call or a multi-person meeting.

FastAPI WebSocket events will carry application notifications such as incoming calls, accepted invitations and ended meetings. The LiveKit SDK handles media negotiation with LiveKit. We do not need to relay raw SDP offers, answers and ICE candidates through FastAPI for this architecture.

The existing livekit-api Python package is therefore retained. It is the backend server SDK for tokens and room administration; installing it alone does not run an SFU or make calling functional.

Official SFU reference
https://docs.livekit.io/reference/internals/livekit-sfu/

<!-- pagebreak -->

## 2 Implement both call flows

For a one-to-one call, the caller chooses audio or video and FastAPI creates a ringing call record. The callee receives an application event and accepts or rejects it. After acceptance, both users can request room access. Their clients connect to the same SFU room. Either participant can end the call; the backend marks it ended and closes the media room.

For a group meeting, the owner creates a room and invites account IDs. Invited members can request access after membership and privacy checks. A participant leaving disconnects that participant. The owner ending the meeting closes the room for everyone. Group joining and leaving will be handled explicitly, rather than attempting to store several callees in the two-person Call record.

The existing Call model remains the one-to-one invitation record. Meeting and MeetingMember represent the group meeting and its allowed participants. Live attendance comes from media connection state. If the implementation needs extra persistent fields, those will be added through reviewed Alembic migrations during the calling stage.

## Room authorization

Application login tokens and LiveKit room tokens have different jobs. FastAPI will validate the application token, enforce membership, blocks and call state, then issue a short-lived media token scoped to one user and one room. Clients never receive the LiveKit server API secret. Audio calls will permit microphone publishing; video calls and video meetings can permit both microphone and camera publishing.

Call acceptance is application state. The UI must separately report connecting, connected or disconnected based on SDK events. Room tokens, member removal and room closure must be enforced against LiveKit as well as PostgreSQL; changing a database flag alone does not stop media already flowing.

## Deployment and verification

The calling stage will add a LiveKit service to Docker Compose and configure reachable signaling and media addresses. It will include STUN/TURN connectivity for networks where direct client-to-SFU paths are unavailable. Local container startup by itself will not count as a successful calling demonstration.

Verification will cover a two-person audio call, a two-person video call, accept/reject/end actions and an invite-only meeting with at least three clients. It will also check rejected unauthorized joins, participant departure, owner room closure and reconnect behavior. Group capacity will be measured on the demo environment rather than described as unlimited.

## Next implementation checkpoint

This decision does not change the database schema or deploy new services now. The next code checkpoint remains registration, login and role permissions, after you say next. Calling will follow authentication, listings and messaging so it can use the same user identities and privacy controls.

Official token and room references
https://docs.livekit.io/frontends/reference/tokens-grants/
https://docs.livekit.io/intro/basics/rooms-participants-tracks/rooms/
