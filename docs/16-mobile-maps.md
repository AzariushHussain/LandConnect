# LandConnect - Mobile Step 4

Maps and property location selection | 22 November 2026

## 1. Part A - What was implemented

Property management was committed as 1e7ef50. This next stage adds geographic browsing and location selection to the Android application. Buyers, sellers and brokers can open Explore properties on map from the community, pan and zoom, search the visible area, select a property marker and open its details. Property details also open a map centered on their coordinates with a red reference pin.

Sellers and brokers can open Choose location on map in the property editor, tap to place a pin, optionally use device location and confirm the selection. Confirmation fills latitude and longitude in the form. It does not save or publish the property. Cancel leaves the form unchanged, and manual coordinate fields remain available when maps or device location are unavailable.

The backend already implements /listings/map and geographic filters. This stage adds the client and extends the isolated contract probe. It needs no new database tables, migrations or backend endpoints. The new map stage remains uncommitted until the next requested commit.

## 2. Part B - Technical choice and file structure

MapLibre React Native 11.5.1 renders the native map. OpenFreeMap supplies the default Liberty style, tiles, fonts and sprites. Its public service does not require an API key, account or paid Google Maps setup. MapLibre's attribution control stays enabled. This is an external map service; Docker continues to host the existing application API, database, Redis and LiveKit infrastructure.

```text
mobile/src/app/map.tsx                  Protected map route
mobile/src/config/map-style.ts         HTTPS style configuration
mobile/src/features/maps/
  MapScreen.tsx                        Browsing, markers and results
  LandMap.tsx                          Native map, camera and layers
  LocationPicker.tsx                   Confirm/cancel picker modal
  api.ts                               GeoJSON parsing and requests
  geo.ts                               Coordinates and viewport bounds
  search.ts                            Async map search state
  locate.ts                            Testable one-shot location policy
  use-device-location.ts               Expo Location and React lifecycle
```

The application service container constructs MapsApi with the shared ApiClient. Existing community, property details and editor screens provide the entry points. Native rendering stays separate from pure parsing and state logic so important boundary conditions can be tested without a phone or native-module mocks.

<!-- pagebreak -->

## 3. Part C - Map browsing flow

The community passes its applied filters to the map. Text still being edited in the search form is not applied automatically. The route validates the JSON filter shape, accepts only supported string fields, normalizes country/currency codes and reuses the existing exact price/area validation. Invalid links show an error instead of silently running a different search.

The initial camera shows India, or a property's coordinates when opened from details. The first valid native viewport starts an initial search. Later pans and zooms update the viewport without automatically querying FastAPI. Search this area submits the current bounds with the community filters. This avoids an API request for every camera movement and gives the user control over when results change.

If the camera has moved since the last search, the screen labels the results as belonging to the previous area. New searches clear the old result set while loading. Errors remain visible and the same button explicitly retries. A later request generation wins over an older response, and unmounted searches ignore pending results.

Green circles represent returned active properties. Tapping one selects it and offers Open selected property. The scrollable result list also opens each property, allowing access when markers overlap or native maps are unavailable. A red pin identifies the reference coordinates passed from property details, independently of whether that property is among the latest 100 returned results.

## 4. Part D - API contract and bounded rendering

```text
GET /listings/map
  ?limit=100&offset=0
  &west=73&south=18&east=74&north=19
  &city=Pune&currency=INR&min_price=1500

FeatureCollection:
  features[]: Feature { id, geometry, properties }
  geometry: Point { coordinates: [longitude, latitude] }
  properties: title, price, currency, area_sq_m, city
  total, limit, offset
```

Map requests use the public endpoint without a bearer token. The backend excludes draft, sold and archived listings. MapsApi validates the collection type, page metadata, total, UUIDs, unique IDs, geometry, numeric coordinate ranges and supported property fields. Price and area remain Decimal strings; extra owner/contact fields are discarded.

The map displays at most 100 results per searched area. It says Showing X of Y and asks the user to zoom in or narrow filters when Y is larger. It does not claim that all properties are shown. Bounded GeoJSON layers avoid creating an unbounded number of React marker views. Clustering and exhaustive map pagination are not required for this prototype checkpoint.

<!-- pagebreak -->

## 5. Part E - Coordinates, wrapping and map projection

GeoJSON and MapLibre use [longitude, latitude]. The editor and API fields are named latitude and longitude. geo.ts handles this conversion explicitly. Selected coordinates are rounded and written as strings with six decimal places, matching the backend. Zero and negative values remain valid; blank or invalid fields do not silently become the origin.

```typescript
const selected = pickedCoordinate([73.856700123, 18.520400876]);
// { longitude: '73.856700', latitude: '18.520401' }
// Confirm: copy into form. Save: ordinary owner PATCH.
```

Native cameras can wrap longitude beyond -180 or 180 while panning. nativeBounds converts a native [west, south, east, north] tuple into the API's bounding box. A view from longitude 170 through 190 becomes west=170, east=-170. The backend interprets west greater than east as crossing the date line. Views covering at least 360 degrees become the full longitude range.

Bounds must be finite, complete and valid. South cannot exceed north. Rounding native bounds to six decimal places also prevents tiny floating-point camera differences from continuously changing the search-area indicator. Values outside supported geographic ranges are rejected before HTTP.

The native base map uses a Mercator projection, whose usable latitude stops around 85.051129 degrees. Camera centering clamps to this range without changing stored property coordinates. Manual fields still support the backend's full -90 to 90 latitude range. The picker explains when an existing polar point cannot be shown accurately by the map projection.

## 6. Part F - Choosing a property's location

The picker is a modal with local selection state. If the editor has valid coordinates, it opens at that location with the existing red pin. Otherwise it opens over India without a selected point. Tapping the map validates and rounds the point, moves the pin and shows the coordinate values. The original editor form stays unchanged while exploring.

Use selected location copies only latitude and longitude into the form and closes the modal. The usual unsaved-edit protection then covers the new coordinates. Save changes or Publish property performs the existing validated write. Cancel or Android back closes the picker without changing the form. A manual map selection invalidates a pending device-location result so it cannot replace the user's chosen point later.

The lower controls scroll on smaller displays instead of requiring every button and message to fit below the map. Browsing uses a scrollable map header and result list. Android's TextureView rendering option is selected for composition inside these React Native layouts. Actual gesture and font-scaling behavior still requires device verification.

<!-- pagebreak -->

## 7. Part G - Optional device location

Find properties near me in the browser and Use my device location in the picker are explicit user actions. The app does not request location on launch or merely on opening a map. locateOnce first requests foreground permission, then checks that location services are enabled. Declined permission or disabled services produce a helpful message and leave manual map selection available.

Expo Location requests a single Balanced-accuracy position. Approximate location is accepted. The picker displays the provider's estimated accuracy, rounded up to metres, and asks the user to check the property location before confirming. Six decimal places express the selected coordinate; they do not mean the device measured it that precisely.

The position lookup waits at most 15 seconds after permission/service checks. The UI can then retry or continue manually. Expo's one-shot native request is not cancellable through this API and may finish later; the timed-out result is ignored. Pending request guards prevent concurrent lookups from repeated taps, while generation checks discard results after dismissal, unmount or manual selection.

No location watcher, background task or continuous tracking is configured. The hook only applies a successful result while the app is active. A nearby search recenters the map; the user searches that area explicitly. A picker result still needs confirmation, followed by saving the form, before property coordinates are persisted.

## 8. Part H - Privacy and external resources

The map style and tiles are downloaded directly from OpenFreeMap over HTTPS. The tile provider can infer the area being viewed from requested tiles. The app explains this in both map flows, which matters when selecting a private property's location. Nearby searches also send the searched bounding box to the LandConnect API through the normal map query.

No LandConnect bearer token, email address or original property object is sent to the tile provider. MapsApi requests the public GeoJSON endpoint without Authorization. Draft/sold/archived visibility is enforced by FastAPI, and saving a selected property location still uses the authenticated owner-management API from the previous stage.

EXPO_PUBLIC_MAP_STYLE_URL is optional public configuration. It defaults to https://tiles.openfreemap.org/styles/liberty and must be an HTTPS URL without embedded username/password or fragment. It is not a place for backend signing secrets. A different style may use different external hosts and attribution; review the provider configuration before deployment. The default style supplies attribution metadata and the native attribution control remains enabled.

<!-- pagebreak -->

## 9. Part I - Native configuration and failure handling

The stage installs @maplibre/maplibre-react-native and expo-location through expo install. app.config.ts registers their config plugins, including a foreground-location purpose string for iOS. Background location, Android location foreground services and iOS background location mode are disabled. Android's merged manifest was checked: coarse/fine location are declared; background location and location foreground-service permissions are absent.

The existing image-picker camera/microphone blocks remain in effect. The future LiveKit calling step must remove those blocks and configure calling permissions. There is no camera or microphone use in this map stage. Generated Android code remains ignored by Git; native configuration lives in app config and the existing CMake path plugin.

LandMap shows loading state, handles native style-load failure and offers Retry map. A 20-second style-loading wait also exposes recovery instead of an indefinite spinner. Invalid style configuration explains the failure. Manual coordinates and the main community list remain available when external map resources are unavailable. A successfully fetched style does not guarantee every individual tile or device GPU render will succeed.

Camera input objects are memoized so marker/selection updates do not unnecessarily reapply the initial camera props. Native region callbacks validate their bounds before reaching the search controller. Rendering uses bounded circle layers, and selection IDs must correspond to a returned property. Native error strings and raw device location errors are not shown to the user by this feature.

## 10. Part J - Checks completed

The mobile suite passes 67 tests. The 16 new map/location tests cover wrapped cameras, world bounds and date-line crossing; invalid coordinates/bounds; coordinate order, rounding and polar camera clamping; HTTPS style configuration; route filter whitelisting; GeoJSON fields and exact decimals; page limits and duplicate IDs; public request headers; invalid input before HTTP; request deduplication and stale responses; errors/retries; permission denial; disabled services; accuracy reporting; and the bounded device lookup wait.

The real FastAPI contract probe now includes map bounds, combined filters, date-line crossings and empty areas. It verifies that draft creation does not add a public marker, publishing does, and selected coordinates persist through the normal owner PATCH. Actual GeoJSON and property responses are checked by TypeScript parsers. Previous browsing, ownership, photo and property-lifecycle checks still pass.

The probe uses in-memory SQLite, synthetic accounts and a temporary image directory. It never writes to the developer database, touches Docker volumes or uses real GPS data. It bypasses application lifespan, middleware and Redis, so it is not a full production-stack integration test.

<!-- pagebreak -->

## 11. Part K - Build and verification results

TypeScript, ESLint, formatting and Ruff checks pass. Expo Doctor passes all 20 checks. Android development bundle export compiles the MapLibre and location imports. ARM64 assembleDebug succeeds with the new native modules, producing a development APK of about 113 MiB. A network probe retrieved the default style JSON successfully; native rendering and tile loading were not tested on the phone.

```powershell
# Repository root: isolated contract probe
uv run --project backend python scripts/check_mobile_listings.py

# mobile/ directory
npm ci
npm test
npm run typecheck
npm run lint
npm run format:check
npx expo-doctor
npx expo export --platform android --dev
```

Native dependencies require a rebuilt development client. Keep the checkout at a short Windows path, such as C:\code\LandConnect. Do not run prebuild while Gradle is building. Native generation and the build used:

```powershell
# Run from mobile/
npx expo prebuild --platform android --no-install --no-clean
$env:NODE_ENV = 'development'
.\android\gradlew.bat -p android :app:assembleDebug `
  -PreactNativeArchitectures=arm64-v8a --max-workers=2 --console=plain
```

The APK is at mobile/android/app/build/outputs/apk/debug/app-debug.apk. It needs Metro and a reachable development API; it is not a standalone release APK. Phone installation and UI checks remain skipped at the user's request. When testing resumes, start Docker/LAN through the existing helper, confirm API readiness, rebuild/install with npm run android -- --device and start Metro with npm start. Mobile API release configuration still requires HTTPS.

The npm audit reports four moderate findings, propagated through the Expo fingerprint/minimatch dependency chain and MapLibre's Expo peer relationship. No high or critical findings were reported. The suggested forced downgrade would change the SDK/library versions, so it was not applied. This checkpoint does not claim a dependency-security clean bill of health.

<!-- pagebreak -->

## 12. Part L - Remaining checks and next implementation

Phone UI, map pan/zoom and marker taps, Android permission prompts, approximate GPS, native tile loading, attribution presentation and modal scrolling remain unverified on the device. iOS was not built or tested. The live Docker/LAN backend was not exercised this stage. These limits remain separate from passing parser/controller tests, native compilation and the isolated real-route contract probe.

When device testing resumes, open the community map with city/price filters, pan and Search this area, open a marker, and verify a property's red reference pin. As a seller, select a location, cancel and confirm that the form is unchanged; then select again, confirm, save, refresh and verify the coordinates. Try declined location permission, device location switched off, approximate permission, a slow lookup followed by manual selection, style failure/retry and rapid searches of different areas.

Known scope boundaries: the map shows up to 100 matches in each area; results are snapshots until searched again; there is no clustering, offline download, address geocoding, reverse geocoding or boundary drawing. Manual coordinates remain available. The default external tile service has no availability guarantee. For production hosting, choose an appropriate tile service or self-hosting arrangement and verify native performance and device permissions.

Next is the application's messaging interface: start direct conversations from property owners, show conversation history and support group conversations through the existing authorized REST and Redis Pub/Sub WebSocket architecture. Privacy controls and LiveKit audio/video calling and group meetings follow as separate checkpoints. The agreed calling requirement remains a priority; this stage does not implement calling or AI agents.

## Official implementation references

MapLibre Expo setup: https://maplibre.org/maplibre-react-native/docs/setup/expo/

MapLibre v11 migration: https://maplibre.org/maplibre-react-native/docs/setup/migrations/v11/

MapLibre map and camera: https://maplibre.org/maplibre-react-native/docs/components/map/

GeoJSON source: https://maplibre.org/maplibre-react-native/docs/components/sources/geo-json-source/

OpenFreeMap setup and attribution: https://openfreemap.org/quick_start/

Expo SDK 58 Location: https://docs.expo.dev/versions/v58.0.0/sdk/location/
