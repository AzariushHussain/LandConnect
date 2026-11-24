# LandConnect Mobile Step 17

Listings search, filters, cards and pull-to-refresh

The group information and participant-card changes were committed as 4c9f110 before this work began. This stage updates the Listings tab and public property details. The new listing changes remain uncommitted for review.

## 1. Part A - A compact search experience

The Listings tab now keeps its search controls above the scrollable result cards. The header contains a short title, keyword field, Search action and filter icon. Submit from the keyboard or the arrow button to search by the backend's existing title, description or city query. Typing does not issue a request on every keystroke.

Search applies the current location, budget and area constraints. The clear icon removes the keyword while preserving those constraints. A result count and Map shortcut sit above the cards; Map receives the applied filters. Clear search and filters resets all applied fields. Empty results offer the same reset action and guidance to adjust location, budget or area.

The controller still owns results, totals, pagination and applied filters. Starting another search invalidates an older response through its existing request-generation guard. Pulling the list refreshes the applied search rather than submitting unconfirmed text from the search field. A failed refresh labels retained feed cards as previous results.

## 2. Part B - Filters in a dedicated panel

The filter icon opens a full-screen panel with Location, Budget and Land area sections. Location includes city, state and the two-letter country code. Budget includes a three-letter currency code and minimum/maximum prices. Area uses minimum/maximum square metres. The footer keeps Reset filters and Apply filters available while the form scrolls above it.

The panel edits its own draft. Closing it discards those edits. Reset clears the advanced draft but keeps the search keyword; Apply validates and submits the whole draft, including the current keyword. Invalid fields keep the panel open and display an error.

The existing exact decimal validation remains in use. Money and area stay as strings rather than floating-point numbers. Country/currency codes are normalized to uppercase. Price bounds require a currency, and minimum values cannot exceed maximum values. Numeric fields accept the backend's supported precision.

Applied advanced filters appear as removable chips below the search bar. Their count appears on the filter icon. Removing a currency also clears minimum and maximum price, because those bounds cannot remain meaningful without their currency. Removing an individual bound or location keeps the other applied values intact. Clear all also removes the keyword.

<!-- pagebreak -->

## 3. Part C - Listing cards and property details

Listing cards now place the cover photo above a clearer price/title/location hierarchy. A sale badge and photo count sit over the image. The lower area shows exact land area, a details affordance and the public owner's name/marketplace role. Tapping the photo or main body opens the same property route. A failed-photo retry stops its event from also opening the property.

Cards use the real property images and existing missing-photo/error states. No invented verification status, rating, favorite action or property classification is displayed. Decimal formatting preserves the complete stored price and area.

Details starts with a horizontally snapping gallery. Each image is sized from the actual available width and shows its position in the gallery. The overview card groups sale status, update date, price, title, location, land area and the owner's marketplace role. Separate cards hold the description, address/map action and owner contact controls.

The location card still opens the map at the property's coordinates. The owner card keeps personal contact data private and reuses the existing Message owner and compact audio/video call controls. Those controls retain their existing self-account checks and server privacy enforcement. Block buttons remain absent from this stage.

## 4. Part D - Pull down to refresh

The feed already used FlatList's refresh mechanism. This stage retains it and makes a pull on empty results enter an explicit refreshing state, so the native spinner stays visible until the request settles. The active filters are preserved, the first page is fetched again, and old pagination responses remain unable to overwrite the refresh.

Property details now uses RefreshControl through optional refreshing/onRefresh props on the shared Screen component. Pull from the top to reload. The current property remains visible while a refresh is pending, avoiding a full loading-screen replacement. The spinner stops after either success or failure, and the existing effect cleanup ignores obsolete responses after navigation.

A failed detail request replaces its displayed property with the existing error state. A 404 shows Property unavailable and removes the old contact/location cards. The error screen supports another pull and an accessible Retry property action. There is no normal Refresh property button at the bottom of a successfully loaded page.

These changes use the existing public listing endpoints. They do not add backend routes, migrations, native modules or a new APK requirement. Installed development clients load them through Metro.

<!-- pagebreak -->

## 5. Part E - Code map and validation

CommunityScreen.tsx owns the compact search controls, applied chips and virtualized result list. ListingFiltersSheet.tsx owns the isolated filter draft and panel. filters.ts retains exact validation and adds dependent-filter removal; feed.ts accepts an explicit pull-refresh flag for the empty-feed case.

ListingCard.tsx defines the updated feed card. ListingDetailsScreen.tsx owns the gallery, detail cards and refresh lifecycle. ListingPhoto.tsx adds optional aspect-ratio sizing and keeps the default height for other callers such as property management. ui/components.tsx adds optional RefreshControl support without requiring it on other Screen callers.

All 195 mobile tests pass. Three new checks cover currency-chip removal with dependent bounds, single-bound/location removal without loss of decimal precision or mutation, and pull-refresh state/filter preservation on an empty feed. Existing tests cover query encoding, invalid ranges, money formatting, late search results, pagination/refresh races, public payload validation and unavailable properties.

TypeScript, ESLint, Prettier, git diff whitespace checks and Android development bundle export pass. The export checks Metro compilation; it is not a physical-device gesture demonstration. No backend code changed in this stage. The local schema remains 0006_call_reconnect.

## Manual verification checklist

1. Submit a keyword with the keyboard and search arrow. Clear it and confirm applied location/area constraints remain. Open Map and confirm it receives the applied filters.

2. Open Filters, edit a value and close without applying. Reopen and confirm the applied snapshot is restored. Reset the draft, apply it and confirm only advanced filters are cleared while the keyword stays.

3. Try an invalid country/currency code, an inverted range and a price without currency. Confirm validation keeps the panel open. Apply valid bounds, remove a single chip and then remove currency; confirm the dependent price bounds disappear.

4. Pull down on populated results and on an empty search. Confirm the spinner ends and applied filters remain. Load another page, refresh, and check that older results do not reappear afterward.

5. Tap both a card's image and body. Check missing/failed photos, a long title, a large price and a larger system font. Retry a failed card photo and confirm that the tap does not navigate unexpectedly.

6. Swipe a detail gallery, inspect the summary/location/owner cards and open the map. Pull down on details and confirm the existing content stays while loading. Check retry after a failed request, and verify an unavailable listing removes its old cards. Test messaging/calling with another account and confirm self-contact actions stay hidden on your own listing.

Physical phone layout and gesture checks remain deferred under the earlier testing preference. Native gallery sizing, keyboard placement, screen-reader traversal and pull gestures still need that review. No automatic call, photo capture or account-data mutation was performed for this design stage.

Reference: Expo SDK 58, https://docs.expo.dev/versions/v58.0.0/
