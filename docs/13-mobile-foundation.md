# LandConnect Mobile - Step 1

Android foundation, authentication and secure sessions. Implementation walkthrough, 22 November 2026.

## 1. What this implementation delivers

This is the first mobile application checkpoint. The previous backend and LAN work is saved in Git as f9f03f1. A physical Android phone on the same Wi-Fi has already opened the readiness endpoint successfully. That establishes phone-to-API HTTP reachability; this step builds the actual application that uses that API.

The app now has a registration form with Buyer, Seller and Broker roles; a sign-in form; a verified account screen; encrypted session persistence; session restoration; expiry handling; and sign-out from this device. The forms use the existing FastAPI contracts. There is no duplicate account database inside the app.

The user interface uses a restrained green palette, readable account cards, labelled inputs, password visibility controls, loading indicators and actionable error messages. It is deliberately a working account foundation. Listing, map, chat and calling screens will be added in later checkpoints, each with its own explanation.

## Part A: How the whole project fits together

```text
React Native Android application
  | JSON over HTTP (LAN debug) / HTTPS (hosted)
  v
FastAPI -> SQLAlchemy -> PostgreSQL
  |                      |
  | chat/call events     | durable records + outbox
  v                      |
Redis Pub/Sub <----------+
  |
Authenticated WebSocket -> mobile event handling (later)

FastAPI -> short-lived room token -> mobile (later)
Mobile <-> self-hosted LiveKit SFU <-> other participants
```

FastAPI authenticates accounts and decides permissions. PostgreSQL stores durable users, listings, messages, invitations and call state. Redis distributes event notifications. LiveKit forwards audio/video. The mobile app presents these capabilities and requests only the access the backend permits. It never holds the backend's signing or media administration secrets.

The backend remains Dockerized. The Android application is compiled with the Android toolchain and installed on a phone; it is not a service inside Compose. The phone reaches the API through the LAN profile configured in the previous checkpoint.

<!-- pagebreak -->

## 2. Project setup and dependencies

## Part B: Why React Native, TypeScript and Expo

React Native renders Android interface components from React code. TypeScript checks data shapes and navigation parameters before runtime. Expo supplies compatible native modules, local build tooling and reproducible native-project generation. We use its blank TypeScript template so the project contains only the foundation needed for this checkpoint.

The installed stack is Expo 58.0.26, React Native 0.88.1 and React 19.3.0. Compatible Expo modules are selected through expo install and exact resolved dependencies are recorded in mobile/package-lock.json. Run npm ci on another machine to reproduce that dependency tree. Backend Python packages continue to use uv independently.

Expo Router provides file-based routes and native stack screens using React Navigation underneath. The generated mobile/AGENTS.md requires this routing convention. SecureStore stores the session using the platform's protected storage. On Android, its SharedPreferences values are encrypted using the Android Keystore. expo-dev-client supplies a custom development application that can include native modules. expo-system-ui applies the light appearance setting.

This choice also prepares the workflow for calling. The LiveKit React Native WebRTC modules require a custom native development build and cannot run in Expo Go. They are not installed in this account-only checkpoint; they will be added with the calling interface. No AI Agents framework or paid cloud service is required for the local workflow.

## Part C: Reproducible native configuration

mobile/app.config.ts names the app LandConnect, sets its package identifier to com.landconnect.app and registers the router, development-client and secure-storage plugins. It also configures the Android main manifest to reject cleartext traffic.

The generated debug manifest overrides that setting to allow the local HTTP API and Metro development server. The production API URL validator separately rejects HTTP when development mode is off. A public release therefore requires an HTTPS backend URL. Do not ship a LAN development build as a public production release.

Expo generates the android directory from this configuration. Generated native projects, build outputs, node_modules, Metro state and local environment files are ignored by Git. Maintain native changes in app configuration or config plugins. Regeneration can clear native files; do not edit generated files as the source of truth or regenerate them while Gradle is running.

Official references used for these decisions:

https://docs.expo.dev/versions/latest/
https://docs.expo.dev/more/create-expo/
https://docs.expo.dev/versions/v58.0.0/sdk/securestore/
https://docs.livekit.io/transport/sdk-platforms/expo/

<!-- pagebreak -->

## 3. Folder structure and responsibilities

## Part D: Where each piece of code belongs

```text
mobile/
  app.config.ts            Native configuration and plugins
  .env.example             Public API address example
  package.json             Dependencies and repeatable commands
  package-lock.json        Exact dependency resolution
  plugins/
    with-cmake-paths.js    Keep generated Windows native paths short
  src/
    app/
      _layout.tsx          Lifecycle, session gates and route stack
      index.tsx            Private account route
      sign-in.tsx          Sign-in route and typed query parameters
      register.tsx         Registration route
    application/
      services.ts          Compose API, storage and session objects
      use-session.ts       Subscribe React to session changes
    api/client.ts          JSON HTTP, timeout and safe errors
    config/api-url.ts      Validate the configured server origin
    features/
      auth/
        types.ts           Backend payloads and stored-session format
        api.ts             Register, login and current-account calls
        validation.ts      User-friendly form checks
        session.ts         Session lifecycle and async coordination
        storage.ts         Expo SecureStore adapter
        AuthScreen.tsx     Sign-in and registration interfaces
      account/
        AccountScreen.tsx  Verified profile and device sign-out
    ui/
      theme.ts             Shared colors
      components.tsx       Screen, field, button, brand and notices
  tests/
    auth.test.ts           URL, HTTP and auth contract checks
    session.test.ts        Session lifecycle and race checks
```

The application folder wires the concrete services together. Feature folders contain code owned by a specific capability. Shared UI contains reusable visual pieces, while the API folder handles transport concerns. The backend keeps its own existing layers and models. This prevents a large screen component from owning network requests, persistence, permissions and visual styles at once.

For example, pressing Sign in begins in AuthScreen. That screen delegates to SessionController. The controller calls AuthApi, which uses ApiClient. Successful credentials are persisted through the SecureStore adapter. React observes the changed session state and switches the available screens. Each file has a specific place in that chain.

New capabilities should follow the same pattern: features/listings for listing behavior, features/chat for conversations, and features/calls for media UI. Those directories are not created until they contain actual implementation.

<!-- pagebreak -->

## 4. API configuration and account requests

## Part E: How the phone finds the backend

mobile/.env contains EXPO_PUBLIC_API_URL, initially http://192.168.29.22:8000 for the tested Wi-Fi setup. A physical phone's localhost refers to the phone, so it cannot use the computer's loopback API address. Replace the LAN address after DHCP or Wi-Fi changes. Android emulators can use 10.0.2.2 to reach a host loopback service instead.

Expo inlines EXPO_PUBLIC values into the JavaScript bundle. This URL is public configuration, not a secret. Never put a database password, JWT signing key, LiveKit API secret or administrator token in a mobile environment variable. The application only receives the signed user tokens returned by the backend.

validateApiUrl requires an origin without credentials, paths, queries or fragments. HTTPS is accepted for hosted use. Private IPv4/localhost HTTP is allowed only during development. Missing or invalid configuration stops initialization with an explicit configuration error instead of sending credentials to an arbitrary fallback address.

ApiClient builds JSON GET/POST requests, adds an Authorization header only when a token is explicitly supplied, and aborts requests after twelve seconds. It does not retry writes automatically. Safe status messages replace raw server error bodies, preventing submitted values or internal details from being displayed. TypeScript types describe contracts; auth response checks also validate essential fields at runtime.

## Part F: Registration and sign-in are different operations

```text
Register form
  -> validate name/email/password/confirmation/role
  -> POST /auth/register
  -> account created on backend
  -> return to Sign in, with email and success message

Sign-in form
  -> POST /auth/login
  -> access_token + expires_in
  -> GET /users/me with Bearer token
  -> persist token + expiry securely
  -> show verified account screen
```

Registration does not silently log the user in. That matches the backend's separate account-creation and token endpoints and avoids claiming an account failed to be created merely because a subsequent automatic login failed. If a registration response is lost, the account may already exist; try signing in before creating another account.

The client checks a trimmed name of 1-80 characters, an email address, a password of 12-128 characters for registration, and matching confirmation. It preserves password whitespace. FastAPI remains the final authority for validation and role permissions. Login accepts existing passwords without reapplying registration's twelve-character minimum.

A submission guard prevents rapid duplicate form submissions. Busy forms disable editing/navigation actions. Password fields are cleared after requests and never placed in navigation parameters, persistent storage or logs.

<!-- pagebreak -->

## 5. Session lifecycle and storage

## Part G: What is saved, and what is verified

```typescript
type SavedSession = {
  token: string;
  expiresAt: number;
};
```

Only the access token and its expiry timestamp are stored under landconnect.session.v1. The password and full profile are not persisted. Profile data comes from GET /users/me and is held in memory. SecureStore's Android backup configuration excludes its encrypted entries because restored entries would no longer have the original Keystore key.

At startup, the controller reads and parses the saved session. Missing, corrupt, incomplete or expired data is erased. A plausible unexpired session must still pass GET /users/me before private screens become available. A rejected token is removed. A connectivity or storage-read failure leaves the app locked and offers retry or sign-out; it does not treat an outage as proof that the credentials are invalid.

SessionState explicitly represents loading, signedOut, signedIn, restoreError and storageError. React subscribes with useSyncExternalStore, so there is one session owner. UI screens do not maintain independent copies of the logged-in account.

## Part H: Expiry, sign-out and asynchronous races

The login request's start time plus expires_in gives a conservative local expiry. The app sets a timer while signed in and checks expiry again when Android returns it to the foreground. This handles the case where background execution pauses JavaScript timers. The backend still validates JWT expiry on every protected request.

Sign-out immediately locks the application, clears its in-memory session and removes the secure entry. It then makes only authentication screens available. If native storage deletion fails, a blocking retry screen appears. The app does not claim credentials were erased when the device reports otherwise.

A generation counter identifies the current session operation. If an old account request completes after sign-out, its response cannot unlock the app. Native storage writes and deletes are serialized through a promise chain so a slow login write cannot complete after deletion and restore credentials. Tests exercise both races.

The current backend has access tokens but no refresh-token or server-side logout/revocation endpoint. Expiry therefore returns the user to sign-in. Device sign-out deletes this application's local credentials; it cannot revoke a separately copied token before that token expires. The app does not invent a refresh workflow the server does not provide.

<!-- pagebreak -->

## 6. Navigation and interface implementation

## Part I: Screen access follows session state

package.json uses expo-router/entry as the application entry point. src/app/_layout.tsx owns the root stack, lifecycle subscriptions and session gates. Stack.Protected guards make the account route available while signed in and the sign-in/registration routes available while signed out. Loading and recovery states are rendered before the stack. A successful login changes session state; Expo Router then selects an available route. We do not manually navigate into a private screen after login.

This matters for Android's back button. After signing in, the old password form is no longer an available screen. After signing out, the account route is no longer available. A navigation change is a usability boundary; actual authorization still happens in FastAPI.

Both authentication routes use AuthScreen because their email/password input behavior is shared. Registration additionally renders a name field, confirmation field and labelled role choices. On successful registration, router.dismissTo returns to sign-in with the email and a success flag. The route remounts its form when these parameters change, so the email is prefilled and stale password/form state is discarded. Passwords never become route parameters.

AccountScreen renders the verified display name, email, role and current allow_messages/allow_calls values. These privacy values are read-only in this checkpoint. A confirmation dialog triggers sign-out. The screen does not include inactive listing, chat or calling buttons pretending those flows are already implemented.

## Part J: Shared components and accessibility

Screen supplies a safe-area container, keyboard avoidance and a scrolling content region. The maximum content width keeps forms readable on wider displays. Fields have visible labels and accessibility labels, suitable keyboard/autofill hints and bounded input lengths. Buttons expose disabled/busy state and remain large enough for touch interaction.

Notice renders errors with an alert role and polite live announcements. Role selections expose radio state. Password visibility exposes checked state and a clear Show/Hide label. Colors, surfaces, borders and typography are reused across the forms and account screen through theme.ts and shared components.

These choices make the foundation consistent, but they do not replace physical-device accessibility testing. Large-font layout, keyboard behavior, TalkBack announcements and hardware back navigation need verification on Android. No camera or microphone permission is requested during this account-only checkpoint.

Official navigation and configuration references:

https://docs.expo.dev/router/advanced/authentication/
https://docs.expo.dev/router/installation/
https://docs.expo.dev/guides/environment-variables/
https://docs.expo.dev/versions/latest/sdk/build-properties/

<!-- pagebreak -->

## 7. Running the application yourself

## Part K: Start the backend and install a development build

Run the existing LAN helper from the repository root, using this computer's current private Wi-Fi address:

```powershell
uv run --project backend python scripts/start_lan.py --host 192.168.29.22
```

Keep the phone on the same Wi-Fi. Its browser readiness check has already passed for this address. Install dependencies and configure the mobile project in another terminal:

```powershell
cd mobile
npm ci
Copy-Item .env.example .env
npm run android -- --device
```

Copy the example only on first setup; preserve an existing mobile/.env. npm ci requires the committed lock file. Android builds need Node, JDK 17, the Android SDK, required platform/build tools and accepted licenses. The build may download Gradle, Maven artifacts and SDK components on first use. An ADB-authorized device must be connected using USB debugging or paired Android wireless debugging.

Once the build is installed, npm start runs Metro for the development client over LAN. Open the installed LandConnect client and use the QR code or Metro server URL. Port 8081 must be reachable from the phone in addition to API port 8000. Changing native packages or app configuration requires a new native build; TypeScript screen changes usually require only reloading Metro.

To compile without a connected phone:

```powershell
npm run prebuild:android
$env:NODE_ENV = 'development'
.\android\gradlew.bat -p android :app:assembleDebug `
  -PreactNativeArchitectures=arm64-v8a --console=plain
```

The expected output is android/app/build/outputs/apk/debug/app-debug.apk. This is an ARM64 development APK that loads JavaScript from Metro, not a standalone release/demo APK. Choose the appropriate architecture for an emulator or another device. Generated output is excluded from Git.

Create a test account through Register, sign in, verify the name/role, close and reopen the app, then sign out. An unavailable backend should produce a useful error rather than an unlocked profile. Real-account data belongs to the backend; reinstalling the app does not delete it.

<!-- pagebreak -->

## 8. Verification, limits and the next implementation

## Part L: What the checks actually establish

Twenty automated mobile tests cover public/private URL policy, JSON authorization headers, safe error handling, request timeouts, invalid auth payloads, registration constraints, clean installation, verified restoration, corrupt/expired/rejected tokens, outage recovery, secure-storage errors, minimal persistence, expiry and concurrent sign-out behavior. They use fake transport/storage dependencies and do not alter real backend accounts.

TypeScript strict checks and ESLint pass. Expo Doctor passes all twenty checks. Android development JavaScript/Hermes bundle compilation and native project generation are checked separately from tests. A bundle export proves compilation; it does not establish that Android storage, native navigation or a physical phone's keyboard behaves correctly.

The existing backend's last full validation remains 209 passing tests. This checkpoint does not change the backend API or schema. Previous native synthetic media checks passed on Windows with default ICE and forced TURN. Neither those checks nor the phone's browser readiness response establish actual phone microphone/camera or app media success.

Native APK build results and remaining environment limits are recorded in section 10. A physical Android phone became available over wireless ADB during implementation, and the development APK was installed. Further phone UI checks were skipped at the user's request. A successful account walkthrough and camera/microphone demonstration remain separate checks.

The dependency audit currently reports three moderate findings through Expo's fingerprinting dependency on minimatch. The suggested forced fix downgrades Expo to an older major version, so it is not applied blindly. Keep this tooling issue visible and review a compatible upstream update rather than claiming a clean audit.

## Part M: How the remaining app will be built

The next checkpoint is community listings: fetch active listings, show loading/error/empty states, render image/price/location cards and open listing details. Seller/broker management and map selection follow the listing contracts. Role-specific UI improves usability; backend authorization remains mandatory.

Chat then adds direct/group conversations, REST history and message writes, plus the authenticated Pub/Sub WebSocket notifications. Redis events are hints, not durable history: reconnect and foreground recovery must fetch authoritative REST state. Message retries reuse client IDs to avoid duplicate sends.

Calling and meetings use backend lifecycle APIs for invitations, accept/reject/end and scoped room tokens. LiveKit provides native audio/video transport and controls. Member removal can retire a room, so surviving clients must fetch fresh state and reconnect with a new token. Physical two-device calls and a three-participant meeting are required demonstration checkpoints.

Privacy editing, blocked users, listing management, deployment configuration and a standalone demo APK will then complete the user flows and submission preparation. Each checkpoint will include its implementation parts, files, data flow, verification and explanation. Stop after each checkpoint for review and continue when the user requests the next step.

An interview explanation of this first step should connect five ideas: screens collect intent; typed API functions call FastAPI; the server authenticates and authorizes; secure storage persists only the access session; and session state determines which routes exist. The next features build on that same boundary rather than replacing it.

<!-- pagebreak -->

## 9. Native build troubleshooting

## Part N: Windows paths and large native downloads

The original checkout was under the user's OneDrive Desktop. Native compilation exposed Ninja's 260-character filename limit in generated C++ paths. The checkout is now C:\code\LandConnect. Keeping a short path helps every native module and avoids storing build intermediates under a deeply nested synchronized directory.

Even the shorter location produced a long generated gesture-handler object filename. mobile/plugins/with-cmake-paths.js uses Expo's withAppBuildGradle mod to append a small Android configuration block:

```groovy
android {
    defaultConfig {
        externalNativeBuild {
            cmake {
                arguments "-DCMAKE_OBJECT_PATH_MAX=250"
            }
        }
    }
}
```

CMake shortens object paths using hashes when their full paths exceed its configured limit. The value 250 leaves room below Ninja's Windows limit while remaining large enough for the generated target directories; 128 was too small for those directories and did not fix the build. The plugin keeps the setting in maintained source, survives native regeneration, rejects an unexpected Gradle language and avoids inserting the same block twice. It does not modify application behavior or require changing Windows registry settings. Native compilation, rather than a text-only unit test, checks whether the resulting paths work with Ninja.

The first build also needed approximately 405 MB of React Native and Hermes AAR artifacts. Slow downloads were diagnosed separately from code compilation. A temporary build-machine helper downloaded validated byte ranges, checked the published artifact checksums and populated the local Maven cache. Gradle then confirmed that it reused the matching artifact. No alternate SDK version or extra application dependency was introduced for this download workaround.

Official references for the build fixes:

https://cmake.org/cmake/help/latest/variable/CMAKE_OBJECT_PATH_MAX.html
https://docs.expo.dev/config-plugins/plugins/
https://docs.gradle.org/current/userguide/dependency_caching.html

<!-- pagebreak -->

## 10. Checkpoint verification record

The final Android ARM64 development build completed successfully using Gradle 9.4.1, JDK 17, Android SDK/build tools 37 and the maintained CMake-path plugin. The final Gradle run reported 445 actionable tasks and BUILD SUCCESSFUL. The APK was installed on the connected Android 16 phone using wireless ADB, and Metro served the application bundle.

The app reached its sign-in interface, including the email/password fields and registration action. A floating window prevented a clean screen review, and the user requested that further phone UI checks be skipped. No completed phone registration, successful phone login, session restoration on the phone or call/media demonstration is claimed. An incidental screen capture was deleted and is not included in the deliverables.

The generated CMake cache contains CMAKE_OBJECT_PATH_MAX=250. The previously failing gesture-handler object path shortened from 344 to 238 characters, below the observed Windows/Ninja limit. The generated Gradle file contains one owned configuration block after prebuild. This confirms the native fix reaches the actual compiler configuration, rather than only changing source text.

Twenty mobile unit tests pass. TypeScript, ESLint, formatting and Expo Doctor checks pass, and the development Android JavaScript bundle exports successfully. The backend API and schema are unchanged by this checkpoint. Its last full suite result remains 209 passing tests; that suite was not rerun for these mobile-only changes.

## Current environment limitation

After the workspace moved to C:\code\LandConnect, the backend containers were stopped. Docker Desktop could list/inspect them but container-start requests hung. A user-performed Docker Desktop restart did not restore service startup during this checkpoint. Pending project startup/probe clients were stopped; database/upload volumes were not deleted or reset. The API readiness endpoint therefore remained unavailable at the end of this verification run.

The earlier phone browser readiness success belongs to the previous running LAN stack. It does not prove that the currently stopped stack is reachable. Restore Docker container startup and rerun the LAN helper before testing real registration/login from the app. Do not replace this missing check with mocked success or claim a completed account demonstration.

## Continue from this point

The account foundation is implemented and remains uncommitted for review. The next verification task is restoring the Docker/LAN API and completing the phone account walkthrough when the user is ready. The next feature checkpoint is community listing browsing and details. Phone audio/video, public deployment, release signing and a standalone demo APK remain later work.
