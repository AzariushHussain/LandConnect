# LandConnect mobile

React Native/TypeScript Android application using Expo development builds and Expo Router. It implements secure accounts, listings/photos/maps/location selection, direct/group messaging with history recovery, and group administration. FastAPI remains the source of permissions and application data.

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

This project uses a **development build**, not Expo Go. LiveKit will require native WebRTC modules when calling is implemented. No Expo account, EAS Cloud build, LiveKit Cloud account or AI agent is needed for local Android development. iOS builds require macOS and are not verified at this checkpoint.

## Build without a connected device

```powershell
npm run prebuild:android
$env:NODE_ENV = 'development'
.\android\gradlew.bat -p android :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain
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

Read [mobile step 3](../docs/15-mobile-property-management.md) for owner management, forms, photos, session/ownership checks and uncertain-write recovery. Sellers and brokers open My account > My properties. Only active listings are public. Photo changes save immediately; unsaved field edits are separate. Native photo dependencies require rebuilding the development client. The image picker blocks camera/microphone permissions at this stage; remove those blocks and configure calling permissions when integrating LiveKit.

Read [mobile step 4](../docs/16-mobile-maps.md) for MapLibre/OpenFreeMap, map filters/bounds, coordinate selection and optional foreground device location. The default style requires no API key; `EXPO_PUBLIC_MAP_STYLE_URL` optionally selects another public HTTPS style. The external tile provider receives the viewed area. Opening maps does not request GPS permission; nearby/location buttons do. The map shows up to 100 active properties per searched area, with the matching total. Picker confirmation updates the form; save or publish to persist. Manual coordinates remain available. New native map/location modules require rebuilding the client.

The listing contract probe uses real FastAPI routes and an isolated SQLite database without Docker or changes to developer data. From the repository root:

```powershell
uv run --project backend python scripts/check_mobile_listings.py
```

## Current verification

The foundation development APK was installed and reached sign-in. The current chat stage rebuilt the ARM64 development APK, but did not install or operate it on the phone. Phone UI checks remain skipped at the user's request. The suite has 88 passing tests; the backend chat test file has 29 passing tests. TypeScript/lint/format, Android bundle export, native assembleDebug and all 20 Expo Doctor checks pass. Real phone messaging/maps/GPS and live Docker/LAN Redis delivery checks remain outstanding. No developer database/upload volumes were reset. Concurrent property edits follow last-write-wins behavior. Four moderate npm audit findings remain in the Expo dependency chain; no forced downgrade was applied.

Read [mobile step 5](../docs/17-mobile-chat.md) for chat screens, group permissions, WebSocket authentication, missed-hint recovery and retry semantics. Open chats from the community or Message owner from a property. Group people are selected from existing conversation memberships. Drafts and pending retries are memory-only. Retry same message preserves its UUID/body; group creation, listing creation and uploads have no automatic retry. Refresh before repeating an uncertain creation. No background push, unread counts or delivery/read receipts are implemented.

The chat contract probe exercises real REST/socket handlers with synthetic data and an injected authorized outbox event, without a Redis connection or relay. Run from the repository root:

```powershell
uv run --project backend python scripts/check_mobile_chat.py
uv run --project backend python -m pytest backend/tests/unit/test_chat.py -q
```

The backend now accepts its exact HTTP(S) API origin in the socket handler, which React Native Android sends by default. Other origins still need the configured allowlist, and every socket still requires JWT authentication. Rebuild/restart the API through the existing LAN helper before real chat testing.
