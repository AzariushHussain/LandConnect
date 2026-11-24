# LandConnect Mobile Step 18

Calls tab, private call history and property maps

This stage replaces the public Map tab with Calls, removes the map shortcut from Listings and changes the public map experience to one property at a time. It builds on the uncommitted listing-design stage. These changes are also uncommitted; the latest existing commit remains 4c9f110.

## 1. Part A - Navigation and call history

The bottom navigation is now Listings, Chats, Calls and My Account. The Calls tab is a history screen; the existing foreground call-control route remains separate. Opening history does not obtain a media token, join a room or activate the microphone/camera.

The Calls tab hides the navigator's default title bar and uses its own Call history heading. The screen applies the top safe-area inset itself, preventing a duplicate Calls label while keeping content below the status bar. The bottom-tab label remains Calls.

History shows direct and group-conversation calls together, newest first. Each row contains the other person's name or the group's call title, direction, status, audio/video type and date/time. All calls and Missed are separate filters. Missed means an incoming direct call that the server explicitly marked missed; outgoing unanswered calls and group invitations are not guessed to be incoming missed calls.

Audio/video controls reuse the existing direct/group call components. They start a callback only after a tap and retain the normal permission/privacy checks. If the relevant media controller already has a call joined, its existing return-to-call behavior applies. An ended group entry starts or finds a current conversation call; it does not revive an ended room.

Pull down to refresh. Load older calls requests the next page. The screen reconciles when focused, after relevant Pub/Sub hints, on foreground return and every 15 seconds while focused. Request generations prevent an older filter/page response from replacing a newer one. Membership-removal hints immediately drop that group's displayed entries and invalidate an older pending read.

## Client implementation

The new tab route is src/app/(tabs)/call-history.tsx and is keyed by the signed-in user. CallHistoryScreen.tsx renders rows, filters and event subscriptions. history.ts contains the typed history records and request controller. CallsApi adds authenticated history retrieval and validates the response, including public identity fields, source/status combinations, dates, ordering and pagination.

Authentication failures clear displayed history instead of keeping private rows indefinitely. Replacing the login session invalidates its pending API response. Results remain memory-only. The app does not add recording, call-history deletion or estimated duration in this stage.

<!-- pagebreak -->

## 2. Part B - Backend history endpoint

```text
GET /calls/history?limit=20&offset=0&missed_only=false
Authorization: Bearer <access token>
```

The endpoint is registered before /calls/{call_id}, so history is not interpreted as a UUID. HistoryFilters validates a bounded limit and offset. HistoryPage returns items, limit, offset and has_more. The response uses Cache-Control: no-store.

The query combines direct calls and group calls with SQL UNION ALL, orders the combined result by creation time with source/ID tie breakers, and applies pagination after that ordering. It requests one extra row to compute has_more. This produces global chronological pages rather than independently paging two sources and merging incomplete lists in the app.

Direct entries require the authenticated user to be caller or callee. The query selects only the other person's public ID, display name and marketplace role. Group entries require both current conversation membership and invited/accepted membership in that group's call. Declined/removed meeting memberships are excluded, as are groups the viewer left or was removed from. Formal meetings without a group-conversation ID stay in the separate meeting feature.

Group entries contain the call title and conversation ID, not a full historical member roster or media grant. The group title is the call's stored title. There is no media token, private email address or phone number in this response. Group status is open or ended; an open record is not proof that media is currently connected.

The new code lives in backend/app/schemas/call_history.py, services/call_history.py and the existing calls route module. It reads existing tables and needs no migration. Existing call creation, consent, ending and token endpoints retain their behavior.

## Paging limits and history visibility

The mobile client requests 20 rows at a time and respects the backend's 10,000-offset bound. It deduplicates overlapping IDs. Since paging uses offsets, new calls can shift later pages; refresh reconciles the history. A future cursor endpoint would be appropriate if activity makes that limitation significant.

This is currently accessible history, rather than a permanent archive of every group invitation. Leaving a group or losing call access removes the corresponding group entries. Group invitations that were declined are not included by the existing access policy. The Missed filter deliberately uses the reliable direct-call status only.

<!-- pagebreak -->

## 3. Part C - Property maps and smoother gestures

The public map entry point is now View on map inside a property's details. It navigates to /property-map/[id]. That route validates the property ID and fetches its current public details, so callers cannot supply unrelated arbitrary coordinates or open a general property-search map.

The property map shows one pin, the property's name, address and coordinates, plus a Center map on property action. It does not automatically request device location. The editor's existing location picker remains available for choosing that property's coordinates while creating/editing it.

The old public map was a 320-pixel view inside a scrolling FlatList. That arrangement could make the parent list compete with map pan gestures. It also rendered nearby-property search/results around the map. The replacement gives the native map its own flexible screen region without a scrolling parent or live nearby-property queries.

The Android renderer changes from the explicit TextureView override to MapLibre v11's default surface renderer. The map requests a maximum of 60 frames per second; actual rendering still depends on hardware and tile loading. This is a rendering configuration change, not a measured frame-rate result.

The camera now has a stable initial view and a ref for explicit easeTo requests. A camera move occurs after the style is ready, when a requested center/zoom changes, or when the user taps recenter. The map no longer receives controlled center/zoom props on every render. Stable numeric target dependencies prevent a newly allocated coordinate array from causing an unnecessary camera move.

```typescript
camera.current?.easeTo({ center: target, zoom, duration: 350 });
// Pan/pinch gestures otherwise remain under native map control.
```

The same shared LandMap improvements apply to the editor's picker. Pin changes do not themselves request a camera recenter. Projection clamping, tile-error feedback, retry and coordinate validation remain. Polar locations outside Mercator's display range retain their coordinates with an explanatory note.

## Scope of the smoothness fix

The code removes parent-scroll competition and unnecessary camera control and uses the library's native rendering defaults. These are plausible contributors found during inspection; no phone frame-time trace was collected to attribute every stutter. Slow external tile delivery, device load or a debug build can still affect the experience. The OpenFreeMap provider still receives the viewed area, as before.

Official MapLibre v11 migration reference:
https://maplibre.org/maplibre-react-native/docs/setup/migrations/v11/

Camera reference:
https://maplibre.org/maplibre-react-native/docs/components/camera/

<!-- pagebreak -->

## 4. Part D - Validation and manual checks

All 203 mobile tests pass. Eight new history tests cover public-field parsing, invalid source/access/order/page data, authenticated requests, missed-only enforcement, replaced sessions, stale filters, refresh/pagination races, coalesced page requests, immediate group revocation and late reads after leaving the screen.

The selected history/call/meeting backend unit suite passes 46 tests. New endpoint checks cover private row visibility, combined ordering, global pagination, direction, missed-only results, removal/decline visibility, authentication, invalid offsets and no-store/public-field contracts. Six isolated PostgreSQL checks pass: the real union query/pagination scenario plus existing migration preservation/round-trip checks. Temporary test schemas are cleaned up afterward.

TypeScript, ESLint, Prettier, Ruff checks/format, git diff whitespace checks and Android development bundle export pass. TestClient still emits its existing upstream HTTPX deprecation warning. These checks do not measure physical map gestures.

The local API image was rebuilt and its container updated. Readiness reports healthy database/Redis and current migrations. An authenticated demo-account request to the deployed history endpoint returned 20 entries containing both direct and group calls; missed-only returned an empty page for that account. Tokens and private account fields were not printed. The existing schema remains 0006_call_reconnect, and developer data/upload volumes were preserved.

## Manual verification checklist

1. Reload the development app after the route changes. Confirm four tabs in order: Listings, Chats, Calls, My Account. Confirm Listings no longer has a Map shortcut and that the old Map tab is absent.

2. Open Calls with both test accounts. Check direction, status, type and date against each account's direct calls. Check group entries where that account still has access. Switch All/Missed and confirm Missed contains only incoming server-marked missed direct calls.

3. Pull to refresh and load an older page. Leave the screen while a request is pending, change accounts and ensure an old account's history cannot reappear. Remove a member from a disposable group while their history is open and verify that group's entries disappear.

4. Tap a direct callback and a group callback only when ready to test media. Confirm the normal permissions/privacy rules and active-call return controls. Merely opening history must not turn on camera/microphone indicators.

5. Open a property, then View on map. Pan vertically/horizontally and pinch/double-tap to zoom. Verify gestures move the map rather than a parent list. Tap recenter and confirm a smooth return to the property's pin.

6. Open another property's map and verify its coordinates. Repeat picker gestures while editing a disposable property, then cancel without saving. Check tile-error retry and the provider attribution. Compare behavior on the actual phone rather than assuming the configured frame-rate ceiling proves smooth rendering.

Physical gesture/frame-rate and phone history UI checks remain pending under the earlier preference to skip phone UI checks. No native dependency changed, so the installed development client can load this stage through Metro without rebuilding its APK.

Expo SDK 58 reference: https://docs.expo.dev/versions/v58.0.0/
