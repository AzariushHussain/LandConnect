# LandConnect Mobile Step 22

Add/edit property forms and photo uploads

The My properties page and owner cards were committed as d875da5 before this implementation. This step redesigns the editor, adds photo selection before draft creation and fixes the multipart upload failure. These new changes remain uncommitted for review.

## 1. Part A - The form and its controls

Add property and Edit property share PropertyEditorScreen.tsx. The screen groups inputs into white cards: Property photos, Property details, Price and area, Location and, for a saved record, Listing status. A compact badge shows the current status; a second label indicates unsaved changes. An active listing explains that saving updates its public details and photos.

The description has a taller multiline input. Related fields sit together and wrap on narrow screens: price/area, city/state and latitude/longitude. Examples clarify expected values. Price and area use decimal input; coordinate inputs allow a minus sign for southern/western locations. Country and currency retain their existing code validation. Location can be selected on the map, while the address is entered separately.

Save private draft creates a new private record. Save changes and photos updates an existing record. Publish property asks for confirmation and saves/uploads before requesting publication. Existing unpublish, sold and archive actions remain available. These status actions preserve unsaved field edits and pending photos rather than silently discarding them.

## Photo selection is now part of creation

Tap Add photo to open the system image picker. Each prepared photo appears immediately with a Pending save label and a local remove action. You can select photos before any property exists on the server. Selections remain local until Save or Publish; cancelling the picker does not change the queue.

Existing photos appear with saved/cover labels and authenticated previews. The first saved photo is the cover. The count includes both saved and pending photos, up to ten total. Removing a pending item only discards its generated cache copy. Removing an already saved photo asks for confirmation and calls the server immediately; the form states this explicitly.

<!-- pagebreak -->

## 2. Part B - Why selected photos failed to upload

The reported symptom was that selecting a photo worked but uploading failed. The installed Expo SDK 58 runtime uses Expo fetch by default. Its multipart converter rejects the old React Native file descriptor containing only uri, name and type. The failure can occur before an HTTP request reaches FastAPI.

The former upload appended an object cast to Blob. A TypeScript cast does not create file bytes or make an unsupported runtime object into a Blob. The upload now appends the existing Expo File implementation, matching the SDK 58 filesystem documentation:

```ts
const body = new FormData();
body.append('file', new File(photo.uri));
return { uri: photo.uri, body, cleanup };
```

Expo File provides a name, MIME type and bytes() implementation. Expo fetch can serialize those bytes into a multipart body. The field remains named file, as required by FastAPI. ApiClient continues to let fetch set the multipart Content-Type and boundary; the app does not invent its own boundary header.

## Preparation and storage limits

The existing preparation pipeline remains: select a local still image, validate source dimensions up to 50 megapixels, resize the longest edge to at most 2048 pixels, and save JPEG at 0.85 compression. The prepared file must fit the 5 MiB client limit. GIFs and non-image selections are rejected. The backend independently enforces image format, size, dimensions, ownership and the ten-photo limit, and re-encodes stored images.

The app keeps only the generated JPEG needed for preview/upload. Cleanup deletes a generated file only when it differs from the original selection and lies under the application's cache directory. Successful upload, explicit pending removal and editor disposal release queued cache files. A cleanup failure does not turn a confirmed upload into a failed upload. The original gallery image is never deleted by this code.

## Evidence and its limits

A regression test runs the actual multipart converter from the installed Expo package. It reproduces rejection of the former URI descriptor and confirms that a File-shaped bytes() part produces a JPEG multipart field with its filename and original binary bytes. The user also retested the updated development app on the phone and confirmed that the selected photo uploads successfully. The automated check covers the serialization contract; the reported phone result covers the original upload symptom.

<!-- pagebreak -->

## 3. Part C - The save sequence and failure handling

PhotoQueue owns the pending selections and cleanup callbacks. Its observable snapshot lets the screen update previews/counts without storing duplicate queue state. save-property.ts coordinates the write sequence, while ManagementApi continues to perform authenticated requests and validate returned records.

```text
Validate fields and session
  -> Create private draft OR update existing details
  -> Remember confirmed record ID and details
  -> Upload queued photos one at a time
  -> Remember each confirmed saved image
  -> Publish only if requested and all uploads finished
```

A newly created draft is remembered before its first photo upload. If an upload fails, another save updates that known draft instead of issuing another create request. Confirmed photos are removed from the local queue as each response arrives. Unattempted selections stay in the editor.

## When an upload cannot be confirmed

The failed item is removed from the queue and its generated file is released. Further Save, Publish and Add photo actions are blocked until Refresh saved photos succeeds. The user must inspect the saved gallery before reselecting that image: a lost response can mean the server saved a photo even though the client could not confirm it. There is no automatic retry of an uncertain upload.

Refresh loads the latest owner record, reconciles the gallery and clears the upload block. Pending unattempted selections are retained. If field edits are unsaved, refreshing first asks whether to replace them with saved details. A refreshed gallery with ten photos prevents another upload; pending selections can be removed or saved photos intentionally deleted.

An upload failure prevents a new Publish action, but already confirmed field changes and photos remain saved. For an existing active property those confirmed changes are already public. This is a sequence of API operations, not an atomic transaction across property creation, files and publication. If creation itself returns an uncertain response, the existing API warning directs the user to check My properties before trying creation again.

## Account and navigation boundaries

Seller/broker routes mount the editor with a key containing the account ID and property ID. The editor verifies that its actor still matches the session. In-flight actions capture the token; late completions after session loss cannot start later uploads, publish or update the new account's screen. ManagementApi and FastAPI retain their independent owner/role checks.

Navigation warns before discarding unsaved fields or pending selections and prevents leaving while an editor operation is running. Closing the editor does not delete anything already saved on the server. Unsaved selections are temporary and do not survive closing/restarting the editor.

<!-- pagebreak -->

## 4. Part D - Code map and verification

PropertyEditorScreen.tsx owns grouped controls, previews, progress/error text, confirmation prompts and navigation protection. The new/edit route files enforce role/account mounting. The shared Field component adds multiline sizing without changing single-line inputs.

photos.ts prepares the JPEG and appends an Expo File to FormData. photo-queue.ts manages pending selections, capacity, cleanup, sequential uploads and the refresh-required state. save-property.ts validates fields, remembers the saved record before uploads, and defers requested publication. property-save.test.ts checks the serialization and save failure paths. No backend schema, API contract or native dependency changed.

## Automated checks

All 214 mobile tests pass, including seven new checks covering the actual Expo multipart converter, saved-plus-pending capacity and cache cleanup, upload ordering and delayed publication, partial failure without duplicate draft creation or automatic resend, late create/upload responses after session loss, validation and refreshed capacity. Existing tests retain API authorization, owner parsing and uncertain-write coverage.

TypeScript, ESLint, Prettier and Android development bundle export pass. The bundle export validates module resolution and packaging, not native picker behavior or visual layout. The installed development client receives these JavaScript changes through Metro; no APK rebuild is required for this stage.

## Manual verification pointers

1. As a seller and broker, open Add property. Select a photo, cancel another selection, remove a pending photo and select again. Check previews/counts and that selection alone does not create a property. Fill valid fields, save privately and reopen the draft to confirm its saved photos.

2. Edit a disposable property. Add a photo, tap Save changes and photos, and confirm the saved image is visible after a refresh. Test removal of a pending photo separately from confirmed removal of a saved photo. Check that a draft's images are only accessible to its owner.

3. Publish a new disposable property with multiple photos. Confirm it becomes public only after the requested uploads finish. Simulate a lost/failed upload; inspect Refresh saved photos before reselecting the failed image. Confirm the original draft is reused and unattempted photos remain queued.

4. Check multiline typing, decimal/signed coordinate entry, map selection, keyboard scrolling, long text, larger font settings and discard confirmation. Switch accounts and confirm the previous account's fields/photos never appear. Buyers must not receive owner management access.

The user confirmed successful photo upload on the phone after the fix. Physical form layout, multi-photo partial failures and the remaining manual scenarios above have not been independently demonstrated. The Android bundle export validates packaging and is separate from the reported successful device upload.

## Official references

Expo SDK 58: https://docs.expo.dev/versions/v58.0.0/

File uploads with FormData: https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/

Image picker: https://docs.expo.dev/versions/v58.0.0/sdk/imagepicker/
