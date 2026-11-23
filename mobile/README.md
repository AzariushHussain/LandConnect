# LandConnect mobile

React Native/TypeScript Android application using Expo development builds and Expo Router. It implements secure accounts, listings/photos/maps/location selection, direct/group messaging, group administration, privacy/block controls, foreground one-to-one calling and invite-only group meetings with LiveKit. FastAPI remains the source of permissions and application data.

## Run on your Android phone

Start the backend from the repository root:

```powershell
uv run --project backend python scripts/start_lan.py --host 192.168.29.22
```

Then, in a separate terminal:

```powershell
cd mobile
npm ci
Copy-Item .env.example .env # First setup only; preserve an existing .env.
npm run android -- --device
```

Requirements: Node 24.3+ (24.7 tested), JDK 17, Android SDK/accepted licenses, Android build tools/platform required by Expo SDK 58, and an authorized ADB device. Use a USB connection with USB debugging or pair Android wireless debugging. The first native build downloads Gradle/Maven/SDK dependencies and may take several minutes. Check `adb devices -l` if the phone is not listed. Do not regenerate native directories while Gradle is building them.

On Windows, keep the checkout in a short directory such as `C:\code\LandConnect`. The native build hit Ninja's 260-character filename limit in the original OneDrive location. `plugins/with-cmake-paths.js` configures CMake object-path hashing through Expo prebuild; keep this plugin registered rather than editing generated Gradle files.

The phone and PC must share Wi-Fi. Set `EXPO_PUBLIC_API_URL` in `mobile/.env` to the PC's actual private IPv4 address; the example is the address previously confirmed reachable from this phone. Changing Wi-Fi/DHCP may change it. This file contains a public API origin, **never** database passwords, JWT signing secrets or LiveKit API secrets.

Once the development build is installed, use `npm start`. Open the installed LandConnect development client and scan the Metro QR code or use its server URL. Metro uses port 8081 and must also be reachable from the phone. Rebuild after changing native dependencies/app configuration; ordinary TypeScript edits use Metro reloads.

This project uses a **development build**, not Expo Go. LiveKit includes native WebRTC modules; rebuild/reinstall the development client after this calling update. No Expo account, EAS Cloud build, LiveKit Cloud account or AI agent is needed for local Android development. iOS builds require macOS and are not verified at this checkpoint.

## Build without a connected device

```powershell
npx expo prebuild --platform android --no-install --clean
$env:NODE_ENV = 'development'
.\android\gradlew.bat -p android :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --max-workers=2 --console=plain
```

The ARM64 development APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. It needs Metro to serve the JavaScript application. This is not a standalone release/demo APK. Omit the architecture property, or choose a matching architecture, for other devices/emulators.

Expo generates `android/` from `app.config.ts`; it is ignored in Git. Keep native settings in app config/plugins so another checkout can reproduce them. Expo SDK 58 prebuild clears/regenerates native code: never put hand-maintained changes there. PostgreSQL/Redis/uploads remain in the existing Docker volumes; the app uses HTTP, never a direct database connection.

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npm run format:check
npx expo-doctor
npx expo export --platform android --dev
```

`npm test` runs Node's test runner with `tsx`. Tests use fake API/storage dependencies and never create real backend users. The development bundle export checks Metro/Hermes compilation, not device execution. For a release export/build, set a real HTTPS `EXPO_PUBLIC_API_URL`; the runtime refuses HTTP outside development, and Android's main manifest disables cleartext traffic. The generated debug manifest permits HTTP for Metro/trusted-LAN testing.

Read [the detailed walkthrough](../docs/13-mobile-foundation.md) for the file-by-file explanation, request flows, test boundaries and remaining work.

Read [mobile step 2](../docs/14-mobile-listings.md) for community browsing, filters, exact decimal values, pagination races, photos and property details. After sign-in the community is the home route; My account opens the existing profile screen.

Read [mobile step 3](../docs/15-mobile-property-management.md) for owner management, forms, photos, session/ownership checks and uncertain-write recovery. Sellers and brokers open My account > My properties. Only active listings are public. Photo changes save immediately; unsaved field edits are separate. Native photo dependencies require rebuilding the development client. The calling stage now configures camera/microphone access; property photo selection still uses the library picker.

Read [mobile step 4](../docs/16-mobile-maps.md) for MapLibre/OpenFreeMap, map filters/bounds, coordinate selection and optional foreground device location. The default style requires no API key; `EXPO_PUBLIC_MAP_STYLE_URL` optionally selects another public HTTPS style. The external tile provider receives the viewed area. Opening maps does not request GPS permission; nearby/location buttons do. The map shows up to 100 active properties per searched area, with the matching total. Picker confirmation updates the form; save or publish to persist. Manual coordinates remain available. New native map/location modules require rebuilding the client.

The listing contract probe uses real FastAPI routes and an isolated SQLite database without Docker or changes to developer data. From the repository root:

```powershell
uv run --project backend python scripts/check_mobile_listings.py
```

## Current verification

The foundation development APK was installed and reached sign-in. Step 7 added native calling modules; this meeting step reuses them without another native/config change. Phone UI checks remain skipped at the user's request. The suite has 147 passing tests; backend chat/call/meeting test files pass 66 tests. TypeScript/lint/format, Android bundle export and all 20 Expo Doctor checks pass. The real-route meeting/call probes use fake room operations and injected authorized socket events; they do not test live Redis/media. Real phone and live Docker/LAN checks remain outstanding. No developer database/upload volumes were reset. Concurrent property/privacy edits follow last-write-wins behavior. The last audit recorded five moderate entries along the minimatch/Expo fingerprint chain, propagated through the WebRTC config plugin too; no high/critical entries or forced downgrade. Dependencies did not change in this meeting stage.

The calling-stage ARM64 native APK built successfully in 7m 33s (539 tasks), at `android/app/build/outputs/apk/debug/app-debug.apk`, 122,454,695 bytes. Packaged permission inspection confirms `CAMERA` and `RECORD_AUDIO`. It was not installed on the phone in this step and still requires Metro.

Read [mobile step 5](../docs/17-mobile-chat.md) for chat screens, group permissions, WebSocket authentication, missed-hint recovery and retry semantics. Open chats from the community or Message owner from a property. Group people are selected from existing conversation memberships. Drafts and pending retries are memory-only. Retry same message preserves its UUID/body; group creation, listing creation and uploads have no automatic retry. Refresh before repeating an uncertain creation. No background push, unread counts or delivery/read receipts are implemented.

The chat contract probe exercises real REST/socket handlers with synthetic data and an injected authorized outbox event, without a Redis connection or relay. Run from the repository root:

```powershell
uv run --project backend python scripts/check_mobile_chat.py
uv run --project backend python -m pytest backend/tests/unit/test_chat.py -q
```

The backend now accepts its exact HTTP(S) API origin in the socket handler, which React Native Android sends by default. Other origins still need the configured allowlist, and every socket still requires JWT authentication. Rebuild/restart the API through the existing LAN helper before real chat testing.

Read [mobile step 6](../docs/18-mobile-privacy.md) for incoming-message/call preferences, confirmed saves, session safety and blocked-account controls. Open My account > Privacy settings. Blocking is also available from listings and chats; review/unblock through Blocked accounts. Existing groups/history remain shared. Switches edit a local draft until Save; an uncertain save requires refresh before further edits. The chat contract probe now verifies real privacy/block routes and enforcement too.

Read [mobile step 7](../docs/19-mobile-calling.md) for the call state machine, native configuration, session safety and cleanup. Start Audio call/Video call from a property owner or direct-chat participant. Use the incoming banner or My account > Call controls to return. Accept and Join call media are separate actions; only Join requests native permissions. Keep the app foregrounded: backgrounding stops media and attempts to finish the call. Failed verification stops media until an explicit rejoin. No locked-screen calling, background call service, offline push or recording is included yet.

For existing native checkouts, use clean prebuild with Gradle stopped to remove old generated camera/microphone permission blocks. Keep native changes in app config/plugins. Production requires HTTPS API/WSS media origins; development permits private-LAN/loopback HTTP/WS. Rebuild/install before testing; the existing phone installation lacks these native modules.

Run the new contract probe from the repository root:

```powershell
uv run --project backend python scripts/check_mobile_calls.py
```

Read [mobile step 8](../docs/20-mobile-meetings.md) for hosting, invitations/consent, room rotation and shared native media. Open My account > Meetings or Chats > Meetings and invitations; group conversations prefill a hosting form. Chat and meeting membership remain separate. The host can invite/remove/end; participants accept, join, leave media or withdraw consent. Removing a token-holding member can rotate the room, requiring surviving members to refresh and explicitly rejoin. Empty 202 removal/withdrawal responses mean access was revoked while cleanup is pending.

Call and meeting screens share one native media implementation and serialize audio ownership. Only the focused controls screen renders media; hidden routes cannot duplicate capture. Returning to the same still-joined session within the foreground app can reconnect media. Backgrounding, failed verification or room/access changes clear joined state. This device cannot join meeting media and a direct call simultaneously. Meeting pages use the Step 7 native development APK with Metro; a standalone submission APK remains the next packaging task.

```powershell
# From the repository root
uv run --project backend python scripts/check_mobile_meetings.py
```
