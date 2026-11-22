# LandConnect - Mobile Step 3

Seller and broker property management | 22 November 2026

## 1. Part A - What this step delivers

The application now lets sellers and brokers manage their own property listings from My account > My properties. They can create a private draft, edit the property, add or remove photos, publish it, return it to a draft, mark it as sold, archive it and restore it by publishing again. Buyers continue to browse public properties and do not receive management routes or controls.

The previous community browsing stage was committed as df508ea. This new implementation is the next reviewable stage and remains uncommitted until the next requested commit. The backend listing and media APIs already existed; this step connects the mobile application to them without changing database models, Alembic migrations or Docker infrastructure.

Start with a complete private draft. A draft needs valid property information even though it is not public. After the server assigns its ID, the editor opens the saved property so that photos can be attached. Publishing is a separate, confirmed action. Only active listings appear in the community; draft, sold and archived records remain visible to their owner.

## 2. Part B - Where the code lives

Routes stay in src/app. Feature code stays outside the router directory, following the existing production project structure. The management feature reuses the shared form controls, photo view, API transport and pagination controller rather than creating a parallel application stack.

```text
mobile/src/app/manage/
  index.tsx                My properties route
  new.tsx                  New private draft route
  [id].tsx                 Saved property editor route
mobile/src/features/management/
  MyPropertiesScreen.tsx   Status filters and owner pagination
  PropertyEditorScreen.tsx Form, confirmations and write state
  form.ts                  Editable fields and validation
  api.ts                   Authenticated owner API and DTO checks
  photo-policy.ts          Pure image limits and resize policy
  photos.ts                Native picker, JPEG preparation, cleanup
```

The root layout protects all three management routes with both sign-in state and seller/broker role. AccountScreen shows the entry point only for those roles. services.ts constructs ManagementApi with the shared ApiClient and SessionController. The server remains responsible for enforcing the current account's role and ownership on every protected request.

<!-- pagebreak -->

## 3. Part C - Form data and exact numeric values

form.ts defines the editable fields once: title, description, price, currency, area_sq_m, address, city, state, country, latitude and longitude. propertyForm copies just those fields from a server record. validateProperty builds a fresh whitelisted payload, so owner IDs, image data and status cannot enter the JSON through an accidental form spread.

```typescript
const body = { ...validateProperty(form), status: 'draft' };
// POST /listings: the server assigns the ID and authenticated owner.
```

Text is trimmed and checked against the backend's field limits: title 150 characters, description 10,000, address 300, city/state 100. Currency and country become uppercase three-letter and two-letter codes. The default codes are INR and IN; the application does not convert currencies or verify a property's address.

Price and area stay as strings through form editing and JSON transport. They must be positive, with at most 12 whole digits and two decimal places. This avoids rounding money through JavaScript floating point. Coordinates accept signed decimal degrees, at most six decimal places, latitude from -90 to 90 and longitude from -180 to 180. The keyboard for coordinates permits a minus sign; maps and pin selection are a later step.

## 4. Part D - Listing lifecycle and persistence

Save private draft sends POST /listings with status=draft. On success, the new route is replaced with /manage/{id}, preventing a second create when the user returns to editing. Save changes sends PATCH /listings/{id} with the validated editable fields and omits status. It therefore does not accidentally restore an old status while saving ordinary edits.

Publish property sends the form and status=active together in one PATCH, after a visibility confirmation. Saving edits to an already active listing also updates its public details immediately. Unpublish to draft and Mark as sold send only the new status. Archive property sends DELETE /listings/{id}, which is a soft archive: the record and photos are retained. Sold and archived properties can be moved to draft or published again.

Status-only actions preserve unsaved text edits in the form. They do not silently save those edits. Photo operations also persist separately from field edits, and their section explains this behavior. This is useful when a seller needs to hide a property immediately while continuing to prepare new wording.

My properties offers All, Draft, Active, Sold and Archived filters. The generic ListingFeed reuses the existing deduplication, request-generation checks, refresh and load-more behavior. Pages contain 20 rows. The list refreshes when it regains focus after editing. Pagination remains offset-based with the backend's 10,000-offset cap; refreshing reconciles concurrent insertions and deletions.

<!-- pagebreak -->

## 5. Part E - Authentication, ownership and private records

Public listing parsing still accepts active records only. The shared ListingRecord parser recognizes the four backend statuses, while parseOwnedListing also checks that the returned owner ID matches the account captured for the request. This allows private properties in the editor without weakening the public community parser. DTOs retain only the supported listing fields and public owner summary; unexpected contact fields are discarded.

ManagementApi checks the session and marketplace role before HTTP is attempted. It sends the bearer token explicitly in the Authorization header. Public community requests continue without it. UUIDs are validated before property and photo IDs become paths. Page metadata, returned property IDs, owner IDs and image paths are checked before state is updated.

SessionController.access refuses expired credentials even before the scheduled expiry callback runs. An HTTP 401 rejects the token captured for that request. rejectToken erases a session only when that token is still current, so a late response cannot sign out a different, newly signed-in account. Results arriving after an account change are rejected rather than entering that account's UI state.

The backend independently loads the account and applies seller/broker and ownership checks. Hiding a button is therefore only a navigation decision. A buyer cannot create listings by constructing a request, and another seller cannot edit a private listing by guessing its ID. Missing or inaccessible property/photo errors use a safe message without raw server responses.

## 6. Part F - Transport changes

ApiClient now supports explicit PATCH and DELETE, native multipart FormData and empty HTTP 204 responses. JSON requests keep their 12-second timeout; photo uploads have a bounded 45-second timeout. The upload does not set Content-Type itself: native networking must create the multipart boundary. DELETE success returns without attempting to parse an empty JSON body.

```text
GET    /listings/mine?status=draft&limit=20&offset=0
GET    /listings/{id}                 authenticated owner detail
POST   /listings                      create private draft
PATCH  /listings/{id}                 edit or change status
DELETE /listings/{id}                 soft archive
POST   /listings/{id}/images          multipart field: file
DELETE /listings/{id}/images/{image_id}
```

ApiClient sanitizes errors centrally. Registration retains its specific duplicate-email message when it receives 409. Management uses a general conflict message, including when a concurrent upload reaches the server's ten-photo limit. No raw token, submitted property body or native error is logged by this feature.

<!-- pagebreak -->

## 7. Part G - Photo preparation and visibility

Choose and upload a photo opens the system image library only after a button press. Cancellation exits without a request. The adapter accepts a local still image, rejects GIF selection, validates positive dimensions and caps original dimensions at 50 megapixels before manipulation. Picker EXIF and base64 output are not requested.

ImageManipulator preserves the aspect ratio and reduces the longest side to 2048 pixels when necessary. The result is saved as JPEG at 0.85 quality into app cache. Its dimensions and actual byte size must be valid, with at most 2048 pixels per side and 5 MiB. The prepared file is appended to React Native's native FormData using a URI descriptor; the original photo is not uploaded directly.

The original selection may exceed the backend's 12-million-pixel decoded-image limit because the file sent to the backend is the smaller prepared JPEG. FastAPI still independently validates bytes and decoded pixels, normalizes the image, strips original metadata and enforces the ten-image limit. Client preprocessing improves compatibility; server validation remains necessary.

The temporary prepared file is deleted after upload success or failure, and image manipulation resources are released. Cleanup only targets the generated cache file, never the user's selected original. Cleanup failure does not turn a confirmed successful upload into an apparent failure. A picker or image-processing error is shown as a safe instruction to choose another image.

Private previews use the same API-origin image path and an Authorization header. Tokens never appear in image URLs. The backend checks listing visibility when serving each image and returns Cache-Control: no-store. Publishing makes existing photos public; unpublishing, selling or archiving removes anonymous access. Removing a photo deletes it immediately and requires confirmation. Photos on an active listing become public as soon as upload succeeds.

## 8. Part H - Native permissions and dependencies

This step adds SDK-compatible expo-image-picker, expo-image-manipulator and expo-file-system using expo install. app.config.ts registers the image picker plugin and explains the iOS photo-library purpose. This photo-library flow does not request camera or microphone permission. Those permissions are explicitly blocked for this stage; legacy external-storage declarations from dependencies may still appear in the merged Android manifest.

When the calling step adds LiveKit, remove these camera/microphone blocks and add the appropriate calling permission configuration before rebuilding. The current picker configuration must not accidentally disable future audio/video calling. Native configuration belongs in app.config.ts/plugins; generated android files remain ignored by Git.

<!-- pagebreak -->

## 9. Part I - Async actions, edits and uncertain writes

The editor distinguishes loading a saved record, editing fields and executing a write. A synchronous ref lock prevents rapid repeated button presses from starting duplicate actions before React renders the busy state. Controls and inputs are disabled during writes, including while the picker is open. Navigation asks before discarding unsaved field edits and blocks leaving during an action.

Expo Router SDK 58 supplies usePreventRemove with a repeat callback. Confirmed discard clears the prevention flag before repeating the requested navigation. Successful draft creation disables prevention before replacing the new route with the saved editor. This uses the installed SDK's API rather than an older React Navigation dispatch example.

Async detail loads use request generations and mounted checks so late results cannot overwrite a newer refresh or update an unmounted screen. Confirmed field writes replace the form with the canonical server response. Confirmed photo upload/removal updates local metadata directly rather than treating a failed follow-up GET as a failed upload. Errors retain field edits. Refresh saved property asks before replacing dirty fields.

There is no backend idempotency key for draft creation or image upload. If a connection drops after the server commits, the client cannot know whether the operation succeeded. ManagementApi does not automatically retry writes: network errors, server errors and invalid success payloads ask the user to refresh My properties or the saved property before trying again. Repeating creation blindly could otherwise produce duplicate drafts or photos.

There is also no version or ETag precondition on edits. Concurrent edits from two devices follow last-write-wins behavior. Status-only actions avoid unnecessarily resending old fields, but a later full form save can overwrite another device's edits. Refresh before editing on a second device; versioned optimistic concurrency is a separate backend enhancement.

## 10. Part J - Verification completed

The mobile test suite passes 51 tests, including the prior authentication, browsing and pagination coverage. New tests exercise the public/private parser boundary; form limits and exact decimals; buyer/session rejection before HTTP; owner checks; forced draft creation; PATCH status behavior; invalid IDs/statuses; stale-token rejection; uncertain writes without retry; multipart boundaries; HTTP 204; photo dimensions/bytes; and the bounded upload timeout.

The contract probe uses the real FastAPI listing routes, an isolated in-memory SQLite database, synthetic accounts, a synthetic JPEG and a temporary upload directory. It checks create, owner-only detail/listing, edit/publish, photo upload/download, unpublish, sold, archive and image deletion. Buyer and cross-owner operations are denied. Actual responses are passed to the TypeScript parsers. No developer database or Docker volume is reset, and no real account is created.

<!-- pagebreak -->

## 11. Part K - Build results and how to run

TypeScript, ESLint, Prettier and the contract script's Ruff checks pass. Expo Doctor passes all 20 checks. Android development JavaScript export succeeds. Android ARM64 assembleDebug succeeds with the new native modules; the APK is about 93 MiB at mobile/android/app/build/outputs/apk/debug/app-debug.apk. It is a development client requiring Metro, not a standalone release APK.

```powershell
# Repository root: isolated API-to-mobile contract check
uv run --project backend python scripts/check_mobile_listings.py

# mobile/ directory: reproducible checks
npm ci
npm test
npm run typecheck
npm run lint
npm run format:check
npx expo-doctor
npx expo export --platform android --dev
```

Native modules require a rebuilt client. The build here used expo prebuild --platform android --no-install --no-clean followed by the ARM64 Gradle command below. Do not run prebuild while Gradle is building. Keep the Windows checkout short, such as C:\code\LandConnect, and retain the existing CMake path plugin.

```powershell
# Run from mobile/ after prebuild
$env:NODE_ENV = 'development'
.\android\gradlew.bat -p android :app:assembleDebug `
  -PreactNativeArchitectures=arm64-v8a --max-workers=2 --console=plain
```

The rebuilt APK was not installed or operated on the phone in this stage, as requested. Once Docker/LAN service is available, use the existing root start_lan.py helper, confirm phone readiness, and use npm run android -- --device to rebuild/install, followed by npm start for Metro. Keep EXPO_PUBLIC_API_URL pointed at the reachable PC LAN address for development. Release builds require HTTPS. Never put signing secrets or database credentials in the mobile environment.

<!-- pagebreak -->

## 12. Part L - Remaining checks and the next step

Device UI, keyboard behavior, picker cancellation/permissions, real camera-roll formats and authenticated native Image rendering remain unverified on the phone. No phone UI checks were performed. The Docker/LAN backend was not exercised live during this checkpoint; the route contract check bypasses application lifespan, middleware and Redis and does not replace full PostgreSQL/Docker integration tests. iOS was not built or tested.

When device testing resumes, sign in as a seller or broker, create a draft, upload a photo, refresh, edit, publish, then verify the public details from a buyer account. Return it to draft and confirm public details/photos disappear. Mark another property sold, archive it, filter by status and publish it again. Check image removal, cancelling a picker, cancelling discard, refresh with unsaved edits, and expiry during a private request. A simulated network drop after submission should lead to refresh-and-reconcile, without automatic retries.

Other known boundaries remain unchanged: unsaved fields are in memory and do not survive process death; a background OS termination can interrupt an upload; two-device edits have no conflict detection; listing/media writes lack idempotency keys; local upload files need shared storage and reconciliation before multi-instance deployment. Camera capture, image reordering, cover selection, automatic address lookup and location permissions are not part of this step. Existing npm audit findings in the Expo toolchain remain; no forced dependency downgrade was applied.

The next implementation step is map browsing and property location selection, using the existing GeoJSON endpoint and validated coordinates. After that come direct/group chat interfaces with the agreed Redis Pub/Sub architecture, privacy settings, then LiveKit one-to-one calls and group meetings. Each step will be implemented and documented separately after the next instruction.

## Official references used for this implementation

Expo SDK 58 ImagePicker: https://docs.expo.dev/versions/v58.0.0/sdk/imagepicker/

Expo SDK 58 ImageManipulator: https://docs.expo.dev/versions/v58.0.0/sdk/imagemanipulator/

Expo SDK 58 FileSystem: https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/

Expo Router removal prevention: https://docs.expo.dev/router/advanced/prevent-screen-removal/

Expo SDK 58 navigation changes: https://docs.expo.dev/router/migrate/sdk-57-to-58/
