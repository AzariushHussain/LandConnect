# LandConnect mobile - checkpoint 1

React Native/TypeScript Android application using Expo development builds and Expo Router. This checkpoint implements registration, sign-in, secure session restoration, expiry, account details and device sign-out. The existing FastAPI backend remains the source of account permissions.

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

## Current verification

The ARM64 development APK builds and was installed on the Android phone. The app reached sign-in; further phone UI checks were skipped at the user's request. Twenty mobile tests and the TypeScript/lint/format/Expo Doctor checks pass. Docker container-start requests were hanging after the workspace move, so real phone registration/login remains pending until the backend can be started. No database/upload volumes were reset.
