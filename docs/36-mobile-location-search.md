# LandConnect Mobile Step 23

Search, centre and mark a property location

The property editor and upload fixes were committed as 769b2bd before this step. This implementation adds place search to the existing Choose property location modal, used by both Add property and Edit property. The new search changes remain uncommitted for review.

## 1. Part A - Using the picker

Enter a city, locality, landmark or address in the search field. Tap Search places or the keyboard Search key. Search runs only on submission, not for every typed character. A clear action resets the text and results. Queries must contain 3 to 200 characters after whitespace normalization.

Up to five matching places appear above the map. Each result has a name and a location label to distinguish similar names. Tap a result to dismiss the keyboard/results, centre the map at that place and show the existing red selected-point marker. The coordinate summary shows the selected latitude and longitude.

You can pan/zoom and tap another point to refine the location. Selecting the same search result again recentres the camera even if you have manually panned away. Use selected location returns six-decimal coordinate strings to the property form. Save or Publish is still required to store the property. Cancel closes the picker without changing the form.

Searching and selecting a place do not automatically fill or replace the street, city, state or country fields. Search returns an approximate point, which must be checked for the actual property. Device location remains an explicit optional action and search does not request GPS permission.

## UI states and existing selections

A spinner marks an active lookup. No matches has its own message suggesting a more specific query or manual map selection. A failed request shows an error while preserving the selected point and manual map controls. A failed search does not move the marker to a default location or erase the previous coordinates.

Results are overlaid on the map so a long list does not push the confirmation controls off the page. Editing/clearing the query, choosing a result, tapping the map, requesting device location or closing the picker invalidates obsolete search results. Starting a search cancels any pending device-location result so it cannot unexpectedly replace the user's choice.

<!-- pagebreak -->

## 2. Part B - FastAPI place-search service

The mobile app uses the authenticated POST /locations/search endpoint. It accepts a JSON object containing q and returns items with id, name, label, longitude and latitude. Seller/broker authorization matches property management; anonymous callers receive 401 and buyer accounts receive 403. The query is sent in a JSON body instead of the LandConnect request URL.

```text
Search button
  -> ManagementApi.searchPlaces(q)
  -> POST /locations/search
  -> Validated shared Redis cache, if present
  -> Configured Photon /api endpoint, on a cache miss
  -> Validate and return up to five places
  -> Select result and mark its coordinates locally
```

Photon is an OpenStreetMap-based geocoder. The default upstream endpoint is https://photon.komoot.io/api/. The backend requests q, limit=5 and lang=en, with an application-specific User-Agent. Results use GeoJSON longitude/latitude order. The service rejects invalid points, bounds coordinates, removes duplicate OSM IDs and returns only the small set of fields the picker needs. Invalid feature rows are skipped; malformed responses and network failures become safe service errors.

## Cache, limits and configuration

Results, including empty results, are cached for 24 hours. Cache keys hash the provider URL and normalized case-insensitive query; cached values contain the public place results. Search does not store query text in the property database. HTTP responses use Cache-Control: no-store, separate from the application-managed shared provider cache.

Redis enforces a shared upstream slot across API workers: at most one cache-miss request can start each second. Another uncached search during that interval returns 429 with Retry-After: 1. A provider 429 applies a 30-second shared cooldown. There are no automatic retries, background geocoding or searches for each keystroke. Redis failure prevents upstream access instead of bypassing the gate.

Upstream requests have a five-second network timeout and a 256 KiB response-read limit. The API strips raw provider errors. GEOCODING_URL in settings/.env.example can point to another Photon-compatible instance without rebuilding the phone app. The existing Redis client is reused; no package, database migration or native dependency is added.

Photon permits reasonable use of its public demo service, may throttle extensive traffic and does not guarantee availability. A larger deployment should configure a hosted/private Photon instance. The picker credits Photon and OpenStreetMap contributors, links the data attribution and explains that submitted search text goes to the provider. Account tokens are used only with LandConnect and are not forwarded to Photon.

## Official references

Photon API: https://github.com/komoot/photon/blob/master/docs/api-v1.md

Photon public-service usage: https://github.com/komoot/photon#demo-server

OpenStreetMap attribution: https://www.openstreetmap.org/copyright

Expo SDK 58: https://docs.expo.dev/versions/v58.0.0/

<!-- pagebreak -->

## 3. Part C - Code walkthrough and verification

LocationPicker.tsx owns the search input, results, camera target and selected point. It reuses LandMap and the existing pickedCoordinate validator. A recenter counter handles repeated selection of the same coordinates after panning. Existing GPS cancellation and polar-coordinate handling remain available.

maps/place-search.ts validates query/results and owns observable search state. Each text edit or dismissal increments a generation counter; responses from older generations cannot replace the current results. Repeated Search taps while a lookup is active do not duplicate that lookup. ManagementApi.searchPlaces reuses the existing token capture, role checks and replaced-session rejection.

Backend api/routes/locations.py exposes the protected endpoint. schemas/location.py defines its query/result contracts. services/places.py handles Photon parsing, bounded requests, shared caching and the rate gate. core/config.py adds GEOCODING_URL; api/router.py registers the route.

## Automated and live checks

All 218 mobile tests pass, including four new checks for query/result validation, duplicate-tap handling, obsolete responses, empty/error/retry states and authenticated requests across replaced sessions. TypeScript, ESLint, Prettier and Android development bundle export pass.

All 219 backend unit tests pass, including nine new place-search checks for role enforcement, normalized queries, coordinates/duplicates, encoded provider parameters, caching, the shared slot, Redis failure, timeouts, oversized responses, provider cooldown and safe errors. Ruff lint/format checks pass. The broader unit run initially found two unrelated readiness failures: its fixture still seeded migration 0004_meetings. The fixture now seeds the current migration heads without altering production readiness behavior.

The Docker API image was rebuilt and restarted locally. Readiness returned 200. A real authenticated Pune search returned five results through the backend and Photon; repeating the normalized query returned the same cached response in about 15 ms in that local check. Anonymous and buyer requests returned 401 and 403. No property, image or account preference was changed by these checks.

## Manual verification pointers

1. As a seller and broker, open Add/Edit property > Choose location on map. Search Pune or an address. Check the result labels, tap a match and verify the map/marker move there. Pan away, search/select the same result again and verify recentering.

2. Tap a more precise point on the map. Confirm it and check the form coordinates. Reopen the picker and cancel a different selection; the form should retain its prior coordinates. Save only when intentionally modifying a disposable test property.

3. Check empty results, unavailable internet, rapid edits after Search, clearing text and closing while a lookup is pending. The previous selected point must remain usable. If rate-limited, wait and explicitly retry. Check GPS permission denial separately from ordinary place search.

The user tested the updated picker on the phone and confirmed that search and the marker work. Other layout, accessibility and failure scenarios above have not been independently demonstrated on the device. The Android development client receives these JavaScript changes through Metro; an APK rebuild is not needed.

