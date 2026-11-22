# LandConnect Mobile - Step 2

Community listings, search, filters and property details. Implementation walkthrough, 22 November 2026.

## 1. What changed in this checkpoint

The Android foundation and authentication checkpoint is committed as bddf781. This step implements the next application feature: browsing active land listings and opening a property to see its details. The backend schema and API behavior are unchanged.

## Part A: The user flow

After signing in, the default route now opens the community feed instead of the account card. My account remains available from the feed header. The community, account and property-detail routes are all inside the existing signed-in route guard. Signing out still removes those private app routes.

```text
Sign in -> Community -> Property details
               |
               +-> My account -> Sign out

Community -> Search/filter -> First results
                         -> Load more / Pull to refresh
```

Cards show a property photo, title, exact price/currency, city/state and area in square metres. Details show the photo gallery, full description, price, area, address, geographic coordinates and the seller/broker's public display name and role.

## Part B: What is included

The feed supports keyword search, exact city/state filters, country/currency codes and minimum/maximum price and area. It requests twenty properties at a time. Search changes reset pagination; Load more appends a page; pull-to-refresh reloads the first page. Loading, empty results, unavailable photos, request failures and removed properties have dedicated states and recovery actions.

Listing creation/editing, image uploads, map selection, messaging and calls are later app checkpoints. There are no inactive buttons pretending those flows are implemented. Coordinates are displayed as property information; this checkpoint does not request phone location permission or add a map dependency.

The application uses real API requests. Test properties exist only inside automated test fixtures and the isolated contract probe, not in the production feed or the developer's database. A stopped backend produces an error state rather than fabricated listing results.

<!-- pagebreak -->

## 2. Files and API contract

## Part C: Where this implementation lives

```text
mobile/src/app/
  index.tsx                  Community route
  account.tsx                Existing account screen, new route
  listings/[id].tsx          Validate the property route parameter
  _layout.tsx                Register signed-in routes
mobile/src/features/listings/
  types.ts                   Public payload types + runtime checks
  api.ts                     List/detail requests + photo origins
  filters.ts                 Query validation and exact formatting
  feed.ts                    Pagination, refresh and race handling
  CommunityScreen.tsx        Search form, filters and virtualized list
  ListingCard.tsx            Summary card + detail navigation
  ListingPhoto.tsx           Remote image, loading, fallback and retry
  ListingDetailsScreen.tsx   Fresh property data and horizontal gallery
```

application/services.ts creates ListingsApi using the existing shared ApiClient. No additional application dependency was installed. React Native supplies FlatList and Image; Expo Router supplies routes and navigation. The existing theme, form fields, buttons, notices and scrolling Screen are reused.

## Part D: Public data, authenticated app navigation

GET /listings and GET /listings/{id} are public backend endpoints. The app's browsing routes currently require sign-in, but their listing requests do not attach a bearer token. This keeps browsing limited to the public active-listing view even when the logged-in account owns a draft.

types.ts checks essential response fields at runtime. It requires an active status, UUID-shaped IDs, valid decimal strings, bounded coordinates, public owner fields and at most ten photo records. It selects the public fields explicitly so unexpected owner email/phone fields do not enter component state.

Each photo must belong to its listing and match the exact relative path /listings/{id}/images/{imageId}. ListingsApi resolves that path against the configured API origin. It rejects full external URLs, protocol-relative URLs and malformed paths. These checks prevent a response from sending image requests to an arbitrary host.

Page parsing verifies that limit and offset match the request, that total is a non-negative safe integer and that items do not exceed the requested page size. Invalid data produces a useful retry error. TypeScript interfaces alone do not validate remote JSON.

<!-- pagebreak -->

## 3. Search, filters and decimal values

## Part E: Draft form state versus applied filters

Typing changes the local draft form. Requests run only when the user submits Search properties or clears the filters. normalizeFilters trims text, uppercases country/currency codes and validates lengths, numeric syntax and bounds. A bad filter does not replace the currently applied feed or issue a request.

Keyword search follows the backend contract: it searches title, description and city. City and state fields are exact case-insensitive filters. Country uses a two-letter code, such as IN; currency uses a three-letter code, such as INR. These optional fields are placed in an expandable filter area so the initial feed stays readable.

```text
q=road & field?
city=Pune
currency=INR
min_price=100000.00
max_price=250000.00
min_area=100
limit=20
offset=0
```

listingQuery uses URLSearchParams instead of concatenating raw input. Characters such as ampersands and question marks therefore remain part of the search term. Blank filters are omitted. Price bounds require a currency in this UI so values from different currencies are not compared as though they were equivalent. Area bounds always use square metres.

## Part F: Why prices remain strings

FastAPI serializes Decimal fields as strings. The app keeps price, area and coordinate values in that form. It does not convert property prices into floating-point numbers for comparison or display.

For filter range comparisons, the code converts the two-decimal input into integer hundredths using BigInt. This distinguishes nearby values at the upper end of the backend's supported range. Maximums cannot be lower than minimums; negatives, scientific notation, grouping commas and more than two fractional digits are refused.

formatDecimal adds Indian digit grouping directly to the string and preserves meaningful fractional digits. For example, 1234567.89 becomes 12,34,567.89, while 500.00 becomes 500. The currency code remains visible beside every price. This is presentation only: the app does not perform currency conversion, valuation or area-unit conversion.

<!-- pagebreak -->

## 4. Feed state and pagination

## Part G: One owner for request state

ListingFeed owns the applied filters, visible items, server total, next offset, pagination flags and request status. CommunityScreen subscribes through useSyncExternalStore, following the same testable external-store pattern used for authentication. The controller is created per screen; it is not a global cross-account property cache.

```text
loading      -> first page / changed search
ready        -> cards or a legitimate empty result
refreshing   -> keep cards while replacing the first page
loadingMore  -> keep cards while fetching another page
error        -> first-page/refresh failure with a retry action
```

A failed additional page returns to ready with the old cards and a Retry loading more action. It does not erase the feed or advance the offset. A failed refresh also retains existing cards, while clearly showing the failure. A successful refresh replaces the previous pages with the current first page.

FlatList owns vertical scrolling and virtualizes the property cards. The search/filter form is its header, and loading/retry/pagination controls are its footer. It is not nested inside the shared vertical ScrollView. The detail page's gallery is horizontal, which avoids that same-direction nesting problem.

## Part H: Races, duplicates and boundaries

Every load increments a generation counter. A response updates state only if its generation is still current. An old search cannot overwrite a newer search, a late Load more result cannot append after refresh, and an unmounted feed invalidates pending responses. The shared API timeout still bounds network requests.

Load more changes status synchronously before awaiting the request, so repeated presses cannot launch the same page twice. Returned items are merged by listing ID. If an overlapping record appears again, its latest data replaces the old version without adding a duplicate card.

The next offset advances by the number of raw server rows, not by the number of unique visible cards. Otherwise duplicate suppression could repeatedly request the same range. The backend uses offset pagination and caps offset at 10000. The app stops at that boundary and asks the user to refine the search.

Offset pagination can skip or repeat records while listings are inserted or removed. The code carries a shortcut comment documenting that limit. Refresh reconciles the feed; stable cursor pagination requires a future backend change. A valid empty page also stops pagination, preventing endless empty requests after concurrent changes.

<!-- pagebreak -->

## 5. Property details and photos

## Part I: Open a fresh property record

Tapping View property navigates to listings/[id].tsx with only the listing ID. It does not pass the full card record through navigation parameters. The route validates the ID before issuing a request, then ListingDetailsScreen fetches fresh detail data from FastAPI.

An invalid link renders Property unavailable without making a request. A public 404, including a property archived since it appeared in the feed, receives the same useful unavailable message. The details API also verifies that the returned ID matches the requested one. Other failures offer a retry action.

The route keys its detail component by ID, so changing properties cannot preserve the previous property's loaded state. Each effect also ignores a request that completes after cleanup. Refresh property clears the previous detail and reloads it; if access has been withdrawn, old detail is not kept under a success state.

Details include the full description/address, coordinates and public listing owner information. Personal contact information is not rendered. Messaging and call actions will be added with their actual consent/access workflows in later steps.

## Part J: Photo loading is separate from property loading

ListingPhoto shows a bounded remote image with an accessible label. A loading indicator is displayed while the image is being fetched. If the property has no image records, it shows No photos added yet. A failed request shows Photo unavailable and a separate retry action.

Retry remounts the native Image component. Photo components are keyed by their path so a failed old image does not permanently mark a different image as failed. Cards use the first photo. Details use a horizontal gallery, with numbered labels and at most the backend's ten permitted photos.

Image requests carry no user bearer header. Their initial URL remains on the API origin, and backend image access remains responsible for current visibility. A metadata record alone does not prove the actual JPEG is present or reachable. Native image loading, offline retries, keyboard layout, large fonts and screen-reader behavior still need device verification.

Official component/routing references:

https://reactnative.dev/docs/0.88/flatlist
https://reactnative.dev/docs/0.88/image
https://docs.expo.dev/router/basics/notation/
https://docs.expo.dev/versions/v58.0.0/

<!-- pagebreak -->

## 6. Validation and running this checkpoint

## Part K: What was verified

The mobile suite now passes 38 tests: the previous twenty authentication/session cases and eighteen listing/filter/feed cases. New coverage includes encoded filters, exact decimal bounds, malformed or non-public payload rejection, contact-field stripping, same-origin image paths, page metadata, unavailable/mismatched details, duplicate suppression, request races, pagination retry and unmount cleanup.

scripts/check_mobile_listings.py adds a separate reproducible contract check. It creates an isolated SQLite in-memory database, seeds synthetic public/draft listings, calls the real FastAPI listing routes with TestClient and pipes their serialized JSON into the actual TypeScript parsers. It verifies filters, two pages, details/image metadata and denial of a draft listing. It never connects to the developer database, starts Redis workers or inserts sample properties in the real app.

```powershell
# From the repository root:
uv run --project backend python scripts/check_mobile_listings.py

# From mobile/:
npm test
npm run typecheck
npm run lint
npm run format:check
npx expo export --platform android --dev
```

TypeScript, lint, formatting and the Android development bundle export pass. Generated .expo files are excluded from lint. Expo's development server regenerates typed route declarations when new route files are added; the declarations are generated artifacts, not maintained source. The contract probe retains the upstream Starlette/TestClient HTTPX deprecation warning.

The contract check is not a PostgreSQL/Docker integration test, a real photo download or a phone demonstration. The backend's previous full suite result remains 209 tests; no backend behavior or schema changed in this step. The existing development APK can load these TypeScript screens from Metro because no native dependency/configuration changed.

## Part L: Current limits and the next step

Docker was still reporting no running containers when this step began. The previous checkpoint's container-start issue was not treated as fixed merely because application code compiled. Restore Docker startup, run the LAN helper and require /health/ready to return ready before attempting real app authentication and listing requests.

After the API is available, run npm start in mobile/, sign in and browse the community. Exercise search, filters, Load more, refresh and unavailable-detail states with real listings. Phone UI checks remain skipped at the user's request; this checkpoint did not operate or capture the phone.

This listing implementation remains uncommitted after the requested foundation commit bddf781. The next app feature is seller/broker listing creation, editing and image management, followed by maps/location selection. Direct/group chat and LiveKit calls/meetings build on the already implemented backend contracts. Each next step will receive its own implementation explanation.
