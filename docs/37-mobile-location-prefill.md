# LandConnect Mobile Step 24

Prefill the property address from a selected map point

This step extends the location search from Step 23. The picker now looks up address details for the final point and sends them back to the Add/Edit property form. The current search and prefill changes remain uncommitted; the last commit is 769b2bd.

## 1. Part A - What happens in the app

Search for a place or tap the map to mark a point. Refine the point as needed, then tap Use selected location. The picker looks up the address for those final coordinates and displays a loading message. A successful lookup closes the picker and fills the available address, city, state and country fields together with latitude and longitude.

The lookup uses the marked point, including a manual adjustment after choosing a search result. It does not reuse the address from a previously selected search result. It also works for a point selected through the optional device-location action.

Country is filled as a two-letter code, such as IN, matching the property form. Returned fields remain editable. The form reminds the user to review all location details before saving. The map selection changes the form only; Save or Publish is still required to store the property.

## Missing details and failures

Some places have only partial address data. A successful lookup replaces the location fields for the new point. Unavailable address fields become blank and need manual completion; a city from the previous location is never silently carried forward. If no address is available, the coordinates update and the address fields are cleared for manual entry.

A failed or rate-limited lookup leaves the picker open. The user can retry Use selected location, or tap Use coordinates only and fill the address manually. A failed lookup never silently replaces the form with an unrelated address. Coordinates-only mode preserves existing address fields and explicitly reminds the user to review them.

## The HSR Layout city correction

The first phone test found that selecting HSR Layout, Karnataka retained Hyderabad from the existing form. The provider's neighbourhood record did not contain a city, and the initial partial-field merge kept the old value. The final merge clears unresolved fields. A bounded provider lookup can also resolve a missing city from nearby address data, rather than guessing from a district name.

## Changes while the lookup is running

Moving the point, choosing another result, editing/submitting search, requesting device location or closing the picker invalidates the pending address result. A late response cannot apply the earlier point's address to the new selection or close a cancelled picker. Repeated confirmation taps while a lookup is active share that one operation.

AddressLookup owns this request state and generation counter. ManagementApi also verifies the captured session token before accepting a response. Switching accounts or signing out cannot transfer the former account's pending result into another editor.

<!-- pagebreak -->

## 2. Part B - Backend and form integration

The protected POST /locations/reverse endpoint accepts numeric latitude/longitude and returns available address, city, state and country fields. Missing fields are omitted. Coordinates must be finite and within the geographic bounds. Seller/broker access matches property management; anonymous/buyer requests are rejected.

The existing Photon service now supports reverse lookup through the sibling /reverse endpoint of GEOCODING_URL. It requests the nearest result within a one-kilometre radius, with English labels where available. House number/street and locality details form the address string. City/town/village fields supply the city; the provider's countrycode supplies the uppercase country code.

If the nearby record lacks a city but has an address, state and country, one additional location-biased search checks matching address records. A city is accepted only from records within one kilometre, in the same state/country, with one unambiguous city name. Distant, conflicting or wrong-state records cannot fill the city. The HSR Layout case resolves to Bengaluru. If these checks fail, city remains blank for manual entry.

Forward and reverse lookups share the existing Redis rate slot, network timeout, bounded response read, safe errors and provider cooldown. The internal city search may wait once for the one-second shared slot; it never bypasses that slot. Reverse and fallback results use operation/query-specific cache keys and the existing 24-hour TTL. The cache namespace was advanced so older incomplete cached records cannot suppress the corrected city resolution. No token is sent to Photon. The picker explains that confirmed coordinates are shared for address lookup.

## Code map

Backend schemas/location.py adds LocationPoint and LocationAddress. routes/locations.py adds the reverse route. services/places.py maps provider address fields and reuses the cached, rate-limited request path.

Mobile maps/address-lookup.ts validates partial addresses and manages pending lookups. ManagementApi.reverseLocation validates coordinates, authenticates the request and validates the response. LocationPicker resolves the point on confirmation and supports coordinates-only fallback. PropertyEditorScreen merges the returned coordinates and available address fields, clears the old error and shows a review notice.

<!-- pagebreak -->

## 3. Part C - Verification and manual pointers

All 225 mobile tests and 225 backend unit tests pass. New checks cover partial/invalid addresses, exact selected coordinates, repeated taps, stale successes/failures, cancellation, session replacement, numeric coordinate validation, ISO country mapping, provider parameters, caching, role checks and the HSR Layout regression. They also verify clearing an old city, rejecting incompatible/distant/conflicting city evidence and respecting the shared request slot. TypeScript, ESLint, Prettier, Ruff and Android development bundle export pass.

The local Docker API was rebuilt. Readiness returned 200. A real Pune lookup returned city Pune, state Maharashtra and country IN. After the city correction, a real lookup at the selected HSR Layout point returned address HSR Layout, Karnataka, India, city Bengaluru, state Karnataka and country IN. Repeating the HSR lookup returned the same result through the cache. These checks did not modify a property, image or account preference.

1. In Add/Edit property, mark a point in Pune and confirm. Check address/city/state/country plus coordinates, edit the address if needed, and save only when intentionally modifying a test property.

2. Select a search result and then tap a different point before confirming. Verify the address belongs to the final point. Cancel during a lookup or move the marker and check that an old response never changes the form.

3. Test partial/no address results and an unavailable connection. Successful partial lookups should leave missing fields blank. Explicit Use coordinates only should preserve the entered address for manual review. The lookup may describe a nearby feature; always review it for the actual property.

The user confirmed the country, state and coordinates in the initial phone test and identified the incorrect retained city. The corrected HSR city is verified through the live API; the final phone city retest remains pending. This stage needs no native dependency, schema migration or APK rebuild. The development app receives the update through Metro.

Reference: Photon reverse API, https://github.com/komoot/photon/blob/master/docs/api-v1.md#reverse
