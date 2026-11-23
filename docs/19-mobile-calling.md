# LandConnect - Mobile Step 7

One-to-one audio/video calls | 23 November 2026

## 1. Part A - What was committed and implemented

The privacy stage was committed as 8312303: Add mobile privacy settings and blocked account controls. This next stage adds foreground one-to-one audio/video calling to the Android application. Property owners and the other person in a direct chat have Audio call and Video call buttons. My account has Call controls. The new calling stage remains uncommitted for review.

An incoming call produces an in-app banner while the application is open. The call screen supports accept, decline, outgoing cancellation, joining media and ending a call. Once joined, it shows connection state, camera tracks, microphone/camera toggles and available audio outputs. Accepting and joining are separate actions: acceptance tells the caller you are ready; joining requests native permissions and connects media.

This is ordinary human-to-human calling through the existing self-hosted LiveKit SFU. There is no AI agent, language model, LiveKit Cloud account or new subscription. Group meeting APIs already exist, but group meeting screens belong to the following implementation step.

## 2. Part B - How the application fits together

FastAPI owns identity, privacy rules, busy checks and call status. PostgreSQL stores the call and transactional outbox events. Redis PubSub relays committed events to API instances. The existing authenticated chat WebSocket carries call hints too. LiveKit transports audio/video between authorized participants. The mobile application renders controls and publishes/subscribes to native WebRTC tracks.

```text
Property details / direct chat
  -> POST /calls -> PostgreSQL call + outbox
  -> Redis PubSub -> existing /ws/chat -> REST refresh
Recipient accepts -> backend creates a two-person SFU room
Each person taps Join -> POST /calls/{id}/token
  -> native WebRTC -> self-hosted LiveKit -> other person
End / privacy termination -> backend status + room cleanup
```

The phone never connects to PostgreSQL or Redis directly. It receives a short-lived participant token from FastAPI, never the LiveKit API secret. Application state and media connection state are separate: accepted does not prove both people have connected their microphones.

<!-- pagebreak -->

## 3. Part C - File-by-file structure

```text
mobile/src/app/calls.tsx             Protected Expo Router route
mobile/src/features/calls/
  api.ts                            DTO validation and call requests
  controller.ts                     Call state, retry and reconciliation
  use-calls.ts                      Shared controller subscription
  CallButtons.tsx                   Property/direct-chat entry points
  CallBanner.tsx                    Incoming/current call access
  CallScreen.tsx                    Status and lifecycle actions
  NativeCall.tsx                    Native room, tracks and controls
  media-lifetime.ts                 Asynchronous cleanup boundary
```

application/services.ts constructs one CallsApi and one CallController using the existing API client and session. _layout.tsx registers LiveKit globals, binds calls to the current login token, subscribes to call hints, polls REST and handles application backgrounding. The banner stays outside the navigation stack, so it can appear while the user browses a property or chat.

chat/realtime.ts now validates and distributes call hints separately from chat hints through the same socket. Existing chat consumers keep their original event type. No second socket or second Redis connection is introduced on the phone. ListingDetailsScreen and ThreadScreen reuse CallButtons; AccountScreen links to the call route.

## 4. Part D - Call endpoints and server authority

```text
POST /calls                     Create/retry one outgoing call
GET /calls?status=ringing        Discover ringing calls
GET /calls?status=accepted       Recover accepted calls
GET /calls/{id}                 Verify current call state
POST /calls/{id}/accept          Recipient accepts
POST /calls/{id}/reject          Recipient declines
POST /calls/{id}/cancel          Caller cancels ringing
POST /calls/{id}/end             Either person ends acceptance
POST /calls/{id}/token           Issue authorized media access
```

CallsApi validates UUIDs, kind/status, public participant summaries, timestamps and the signed-in participant. Responses from another call cannot replace the requested call. It discards unexpected private fields. Media responses must name the exact call room and include a bounded token lifetime. WSS is required outside development; WS is allowed only for the same private/loopback development-origin policy used by the API client. Credential-bearing, query-bearing or unexpected-path origins are refused.

Each request captures the current bearer token and checks it again after the response. A late response cannot enter a replacement login session. HTTP 401 rejects only the captured token. The server independently checks participants, allowed actions, callee preferences, blocks and room existence. Mobile validation is an additional boundary; authorization remains on FastAPI.

<!-- pagebreak -->

## 5. Part E - State transitions and retries

```text
ringing -> accepted -> ended
ringing -> rejected / cancelled / missed
```

Only the callee may accept/reject; only the caller may cancel. An accepted call can be ended by either participant. The backend sets ringing expiry and returns authoritative state. The UI displays the expiry time and refreshes rather than inventing a successful acceptance or timeout locally. Busy checks prevent a participant from starting a second active call.

Outgoing creation sends a client-generated UUID. If a response is lost, the controller retains the same identifier, callee and kind in memory. Retry same outgoing call resubmits that exact attempt, allowing the backend to return the original call. Repeated taps are coalesced. Definitive validation/permission/conflict failures clear the local attempt; uncertain failures retain it. This avoids a network retry becoming a second phone call.

```json
{
  "client_id": "00000000-0000-4000-8000-0000000002bd",
  "callee_id": "00000000-0000-4000-8000-000000000385",
  "kind": "video"
}
```

The active call and pending attempt are memory-only. Relaunch discovers accepted/ringing calls through REST. It cannot recover the exact UUID of a request that was never accepted by the server. The server still enforces its busy constraint. There is no automatic new outgoing creation after a restart.

Controller revisions prevent a slow poll from overwriting a newer mutation or a cleared login. A cancel can race with the recipient accepting. When that returns conflict, the controller reads the current call and ends it if it has become accepted. Failed end attempts stop local media and show an error; the screen does not claim the server call ended. Refresh and retry are available.

## 6. Part F - PubSub, missed events and foreground recovery

The socket accepts call.incoming, call.accepted, call.rejected, call.cancelled, call.missed and call.ended with validated event/call UUIDs. Events deduplicate by event_id and expose only minimal metadata to the call subscriber. They never carry a media token or substitute for a call response. Terminal hints stop local media authorization immediately while REST reconciles the actual state.

The foreground root polls every five seconds as a fallback, and refreshes on socket readiness/reconnection and application return. Discovery checks accepted/ringing lists; current calls use their detail endpoint. A failed verification clears joined state and stops media. A later successful poll does not reopen the microphone: Join call media is required again. The server's outbox/Redis pipeline remains unchanged by this mobile step.

<!-- pagebreak -->

## 7. Part G - Native modules and permission configuration

LiveKit React Native 3.2.0 uses livekit-client 2.25.0 and native WebRTC 150.2.0. The two Expo plugins configure native integration and camera/microphone permissions. Expo installed these packages into the existing SDK 58 project. They require rebuilding the development client; Expo Go cannot supply the missing native modules.

```powershell
npx expo install @livekit/react-native `
  @livekit/react-native-expo-plugin `
  @livekit/react-native-webrtc `
  @config-plugins/react-native-webrtc livekit-client
```

app.config.ts registers the plugins and provides call-specific permission explanations. The image-picker plugin previously blocked camera/microphone permissions; those blocks were removed. Photo uploads still use the existing library-selection flow. Merely browsing a property, receiving a call or accepting it does not request device media access.

The generated Android directory retained old tools:node=remove markers when prebuild reused it. This was caught by inspecting the manifest before trusting the build. Gradle was stopped, the generated Android directory was regenerated cleanly, and the new manifest declares CAMERA and RECORD_AUDIO. Native directories stay ignored in Git; app config and plugins remain the reproducible source. Do not hand-edit generated manifests to fix this.

## 8. Part H - Joining and releasing native media

```text
Tap Join -> microphone permission -> video camera permission
  -> fresh authorized room token -> configure/start audio
  -> connect Room -> publish microphone -> publish video
  -> connection state, remote tracks and media controls
```

NativeCall uses communication audio mode. Audio calls prefer a headset/earpiece; video calls prefer a headset/speaker. Permission denial, media-server failure or SDK failure produces a safe message and a retryable Join action. Raw SDK errors and credentials are not shown. SDK logging is silenced; tokens are never persisted in SecureStore or application state outside the current media operation.

MediaLifetime checks cancellation between asynchronous steps. Cleanup stops local tracks and disconnects the room immediately, then waits for any pending native operation and stops again. A permission dialog or publication that resolves late cannot continue to the next startup step. Audio-session ownership is serialized across successive media mounts, so cleanup from the old call finishes before the next call starts its audio session. Pending media-control work also releases old-room tracks if it completes after unmount.

<!-- pagebreak -->

## 9. Part I - Controls and navigation behavior

After media startup, the screen distinguishes connected, waiting for the other person, reconnecting and disconnected states. Video tracks use LiveKit's native VideoTrack renderer. Muting updates the local microphone publication; the camera toggle exists only for video calls. Audio calls receive microphone-only publication grants from the backend, so a client cannot upgrade itself to video by changing a button.

Available audio outputs come from the native SDK. Selecting one confirms that request before updating the label. Refresh audio outputs handles devices attached during a call. iOS also exposes the system route picker. Speaker/headset behavior still needs physical-device verification; enumeration and successful compilation do not prove sound comes from the expected device.

Leaving an active call asks to end/decline it. Navigation proceeds only after a confirmed terminal state. An in-flight request must finish first. An uncertain outgoing attempt remains available through the call banner after leaving; its UUID is retained for a safe retry. A confirmed unavailable call clears local active state. Existing chat draft protection still applies when navigating from a conversation with an unsent message.

When AppState becomes background, the controller clears media authorization immediately and attempts to end an accepted call, cancel an outgoing ringing call or decline an incoming ringing call. A permission popup can cause iOS inactive without background; inactive alone does not end the call. An accept/create response that finishes after backgrounding is also followed by a finish attempt. Foreground return reconciles server state and never automatically republishes tracks.

An OS process kill or network failure can prevent a finish request from reaching FastAPI. Local room teardown is attempted; backend maintenance reconciles empty/missing rooms and durable cleanup. Background execution is not guaranteed. This stage intentionally provides foreground calls, without Android foreground-call services, iOS CallKit, push notifications or locked-screen incoming-call UI.

## 10. Part J - Privacy and multiple devices

Disabling incoming calls and blocking use the existing backend policies. New call creation, acceptance and token issuance are checked independently. Turning off incoming calls still permits outgoing calls to willing recipients. A block ends accepted calls between the accounts; disabling incoming calls ends calls where the changed account is the callee. Notifications and REST reconciliation remove local media authorization, and the server closes the SFU room.

Accepted calls recovered on another device show Join rather than starting capture automatically. Tokens identify the account, so joining the same call from two devices may displace an existing media connection using that identity. Simultaneous-device calling needs a real-device check before release. Calls use encrypted WebRTC transport through the SFU; this implementation does not add application-level end-to-end encryption or recording.

<!-- pagebreak -->

## 11. Part K - Verification performed

122 mobile tests pass: the previous 104 plus 18 covering call DTO/token validation, captured sessions, creation retries, stale polls, acceptance, failed verification/end actions, terminal hints, background races, cancellation/acceptance conflicts, sign-out and native-operation cleanup. Socket tests verify call hints share the existing authenticated transport and discard unexpected payload data.

The isolated call contract probe uses real FastAPI routes, SQLite with synthetic accounts, real token generation and the real socket authorization handler. It verifies creation/idempotency, busy/participant rules, acceptance, token access, cancellation, rejection, end, privacy termination and blocking. It injects an authorized outbox event into the real hub. Media-room operations use FakeRooms, and no Redis relay connection is started. This is a contract check, not an audio/video demonstration.

```powershell
# From the repository root
uv run --project backend python scripts/check_mobile_calls.py
uv run --project backend python -m pytest `
  backend/tests/unit/test_calls.py `
  backend/tests/unit/test_meetings.py `
  backend/tests/unit/test_chat.py -q

# From mobile/
npm test
npm run typecheck
npm run lint
npm run format:check
npx expo-doctor
npx expo export --platform android --dev
```

All 66 selected backend tests pass. TypeScript, lint, formatting, Ruff for the new probe, Android bundle export and all 20 Expo Doctor checks pass. The ARM64 native development APK built successfully in 7m 33s (539 tasks). Packaged-APK inspection confirms CAMERA and RECORD_AUDIO. Its size is 122,454,695 bytes. No developer database/upload volumes were reset or Docker services changed for these checks.

The dependency audit reports five moderate entries along the existing minimatch/Expo fingerprint dependency chain, now also propagated through the WebRTC config plugin. There are no high/critical findings in that audit. A forced audit fix proposes incompatible downgrades, so it was not applied. The installed upstream TestClient still emits its HTTPX deprecation warning.

## 12. Part L - Building and starting the development client

```powershell
# From mobile/; keep the checkout at C:\code\LandConnect
npx expo prebuild --platform android --no-install --clean
$env:JAVA_HOME = 'C:\Users\azari\.jdks\semeru-17.0.9'
$env:NODE_ENV = 'development'
.\android\gradlew.bat -p android :app:assembleDebug `
  -PreactNativeArchitectures=arm64-v8a --max-workers=2 `
  --console=plain
npm start
```

Clean prebuild replaces only generated native code; stop Gradle first and keep configuration changes in app.config.ts/plugins. The ARM64 debug APK is android/app/build/outputs/apk/debug/app-debug.apk. It requires Metro and is not a standalone production APK. Reinstall the rebuilt development client before testing new native modules. iOS compilation requires macOS and is unverified here.

<!-- pagebreak -->

## 13. Part M - Real-device checks and next step

Phone UI checks remain skipped at the user's request. No phone installation, microphone/camera capture, speaker routing or real two-device call was performed for this checkpoint. The JavaScript bundle and native build cannot establish those outcomes. Live Docker/Redis delivery and TURN behavior were not rechecked in this step. Earlier synthetic SFU tests are historical evidence, not this mobile test result.

When device testing resumes, start the existing LAN stack with scripts/start_lan.py using the PC's current private address. Configure mobile/.env with the reachable API origin, rebuild/install the native client and run Metro. Both API and LiveKit signaling/media addresses must be reachable from both devices; localhost on a phone means that phone. The LAN helper configures the self-hosted media address and existing stack; never copy server API secrets into mobile/.env.

First use two different test accounts. Call from a property or direct chat, accept on the recipient, then join on both. Check two-way speech, both camera feeds, mute/camera toggles, output selection and ending from either side. Also check decline, caller cancellation, no-answer expiry, permission denial, a second-call busy response, temporary network loss, backgrounding during permission/acceptance, sign-out and blocking/turning off incoming calls. Confirm no camera/microphone indicator remains after teardown. These are outstanding acceptance checks, not claimed passes.

The next implementation stage is group meeting UI: host from a group, invite members, express consent to join, display multiple participants and support leave/removal/host-end actions using the existing meeting APIs. Background/locked-screen calling, offline push and release signing/deployment are separate later tasks. Nothing in this step installs an Agents framework.

## 14. Official references used

Current SDK setup was checked against official documentation and the installed package source/types. The Expo version is 58; LiveKit examples were adapted to existing backend-issued tokens and application lifecycle rules rather than copying a static demonstration token.

Expo SDK 58: https://docs.expo.dev/versions/v58.0.0/

Expo documentation index: https://docs.expo.dev/llms.txt

LiveKit Expo integration: https://docs.livekit.io/transport/sdk-platforms/expo/

LiveKit React Native integration: https://docs.livekit.io/transport/sdk-platforms/react-native/

Native SDK source: https://github.com/livekit/client-sdk-react-native
