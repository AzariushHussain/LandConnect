# LandConnect Mobile Step 21

My properties page and owner listing cards

The call-history header/safe-area fix was committed as e91c860 before this work began. This step updates the owner-facing My properties page. These new owner-listing changes remain uncommitted for review.

## 1. Part A - The management page

My properties keeps its existing navigation title and back action. The page now has a compact count/header area, Add property action and horizontally scrollable All, Drafts, Active, Sold and Archived filter chips. Selected filters use a clear selected state instead of placing the word selected inside a large button label.

The count belongs to the selected status category, as returned by the server. While loading or refreshing, the heading reports Updating listings rather than showing an unconfirmed zero. Add property still opens the existing draft-creation screen; no new creation endpoint or automatic write is introduced.

The list remains virtualized. Pull down to refresh the selected category, including an empty category. Loading a later page uses the existing cursor-by-offset state and deduplication. A failed refresh identifies retained cards as previously loaded; a failed later-page request has a retry action. Empty All results offer draft creation, while an empty status category offers Show all properties.

## 2. Part B - Cards designed for owners

OwnedPropertyCard.tsx replaces the earlier text-only card. Each card has a real cover photo or the existing missing/failed-photo state, a colour-coded status badge and photo count. Its body groups the exact stored currency/price, title, city/state, land area and update date.

The image and main body open the owner editor for every status. The status/visibility line explains whether the listing is public. Drafts are marked as owner-only; active listings are visible in Listings; sold and archived records are hidden from public listings. A failed photo retains the existing accessible Retry control, and its press does not also open the editor.

Active cards additionally offer View public listing, using the existing public detail route. Private-status records do not offer that preview. Publish, sold, archive and photo-removal operations remain inside the existing editor with their established confirmation/validation rules. No destructive or publication action was moved onto a card.

Prices and areas retain Decimal strings and the existing formatter. The UI does not invent transaction prices, engagement counts, verification badges or a property's completion score.

<!-- pagebreak -->

## 3. Part C - Private photos and account boundaries

Owner cards use the existing ListingPhoto renderer with the validated API photo URL and the current token in an Authorization header. The token is not placed in a URL, React key or user-visible text. This lets a seller/broker see a draft's cover without making the image public. Missing/failed-image handling and retry remain available.

The /manage route now explicitly checks the signed-in role and keys MyPropertiesScreen by the current user ID. Changing accounts creates a new screen/feed. The page checks that its current session matches that actor before rendering, and returned cards also require the matching owner ID. ManagementApi continues to validate every returned owner's identity and reject a late response from another login session.

Status switching creates a separate feed for the selected status and invalidates the older one. Focus refresh and the existing generation checks prevent obsolete page responses from overwriting the current list. Backend seller/broker and ownership enforcement remains the final authority.

## Implementation map

MyPropertiesScreen.tsx owns the count/header, status chips, list and loading/error/empty states. OwnedPropertyCard.tsx owns authenticated previews, status presentation and editor/public navigation. src/app/manage/index.tsx adds explicit role/owner-keyed mounting. The existing ListingFeed, ManagementApi, ListingPhoto and editor are reused.

## 4. Part D - Verification and checklist

All 207 mobile tests pass. Existing tests cover seller/broker management permissions, rejection of buyer/absent sessions, private-status parsing, owner validation, replaced-session responses, exact decimals and feed refresh/pagination races. No tests were added solely for static styling. TypeScript, ESLint, Prettier, git diff whitespace checks and Android development bundle export pass. Card icon names were checked against the installed Ionicons glyph map.

A read-only check against an existing demo private photo returned image/jpeg with HTTP 200 for its owner. The same URL returned 404 for a second owner and for an anonymous request. No property, image or preference was changed by the check. Native image rendering was not visually tested by that HTTP check.

1. Sign in as a seller and broker. Open My Account > My properties. Verify that buyers do not receive the management shortcut/access. Check that switching accounts shows only that account's records.

2. Switch all five status chips, including rapid switches. Check category totals, selected states, empty categories, pull-to-refresh and older pages. Verify there is no duplicate My properties heading inside the page.

3. Inspect a property in each status. Check its cover, status/visibility text, price, area, location and update date. Tap the photo/body to edit. Verify only an active property offers a public preview. Check missing photos and retry after a failed download.

4. Review a long title, large price and larger system font. Return after editing and verify focus refresh shows the latest saved record. Make real changes only in a disposable test listing when intentionally testing the editor.

No backend, database schema or native dependency changed. The installed development client receives this stage through Metro without rebuilding its APK. Physical phone card layout and gesture checks remain pending under the earlier preference to skip phone UI checks.

Reference: Expo SDK 58, https://docs.expo.dev/versions/v58.0.0/
