# LandConnect - Mobile Step 9

Bottom navigation for the four main screens | 23 November 2026

## 1. Part A - What changed

Signed-in users now have four bottom tabs, in this order: Listings, Chats, Map and My Account. Each has an icon and a text label. The selected icon has a pale green rounded background and a green label; other tabs use the existing muted color. Listings remains the default entry screen.

The tab bar has its own space in the layout, respects the device's bottom safe area and hides when the keyboard opens. It does not overlap the listing feed or chat list. Standard tab accessibility labels and selected state are provided by the navigator. Android back follows visited tab history.

All three profile roles see these four tabs. Seller/broker management remains under My Account > My properties, using the existing role-protected routes. Authentication, backend permissions, chat, calling and meeting services were not changed.

## 2. Part B - Routing structure

```text
mobile/src/app/
  _layout.tsx                 Authentication and root stack
  (tabs)/
    _layout.tsx               Four-tab navigator and styling
    index.tsx                 Listings
    chats.tsx                 Chats
    map.tsx                   Map, including existing parameters
    account.tsx               My Account
  listings/[id].tsx           Details above the tabs
  chats/[id]/index.tsx        Conversation above the tabs
  manage/, privacy/, meetings/, calls.tsx
```

The four existing route files moved into the parenthesized route group. The group does not change public URLs: /, /chats, /map and /account still work. The root protected stack registers (tabs) with its header hidden; the tab layout provides each main screen's header. Detail screens, editors, privacy, calls and meetings remain in the root stack with normal back navigation and their existing leave/discard guards.

Keeping the tab bar on the four main screens also prevents a tab press from bypassing the conversation draft or property-editor leave flow. Calls/meetings retain their focused-screen media rules. The existing banners remain outside the navigator and can still open their controls.

## 3. Part C - Reusing the existing screens

CommunityScreen, InboxScreen, MapScreen and AccountScreen remain the actual feature implementations. The route group only organizes navigation. Standard tabs retain their mounted screen state when switching, including listing search/filter state and map position. Existing focused chat/account refresh hooks continue to run when those tabs are selected.

The Listings screen no longer repeats My account and Open chats buttons, because the tab bar provides those destinations. Explore properties on map remains: it carries the current listing filters into the Map tab. Property-to-map links still pass coordinates. The map route keeps the same parameter validation and can show a property's pin.

<!-- pagebreak -->

## 4. Part D - Safe areas and icons

The bottom tab navigator owns the bottom safe-area inset for main screens. The listing/chat/map screen wrappers now reserve only left/right insets. The shared Screen component gained bottomInset, which defaults to true for existing detail/form screens; Account uses false while inside the tabs. This avoids applying the bottom inset twice.

Icons use Expo Ionicons. Its expo-font peer is declared directly and registered in app.config.ts. Version 58.0.12 was already used by this project; inspection confirmed the existing ARM64 APK includes the native font loader. Ionicons loads its font through that module at runtime.

```powershell
npx expo install @expo/vector-icons expo-font
```

No generated Android code was edited and no new APK was installed. Existing development clients load the update through Metro; a full reload may be needed after moving route files. Dependency/config changes stay in Git for future native builds.

## 5. Part E - SDK 58 compatibility and verification

Expo SDK 58 and the official tabs guide were checked before implementation. Tabs uses expo-router's bundled navigator, with index providing the default Listings entry. Icon colors use the existing theme strings. No separate React Navigation package was added.

TypeScript, lint, formatting, Android development bundle export and all 20 Expo Doctor checks pass. All 147 existing mobile tests pass. An additional one-off check used Expo Router's own route-tree resolver to confirm exactly four tab screens and the retained detail, conversation, meeting, calling and management routes. No backend change required backend test repetition.

```powershell
# From mobile/
npm run typecheck
npm run lint
npm run format:check
npm test
npx expo-doctor
npx expo export --platform android --dev
```

Physical-phone UI checks remain deferred, following the earlier request. The checks above establish routing structure and compilation, not the final pixel layout, touch behavior or font rendering on a phone. The existing five moderate audit entries along the Expo/minimatch dependency chain remain; no forced downgrade was applied.

## 6. Part F - Manual acceptance checks

Reload, sign in and confirm the four labels and active icons. Switch tabs after searching and check the search remains. Open a property and its map location; verify the selected pin and back navigation. Open a conversation and check unsaved-draft protection.

Check gesture-area spacing, the final list item and keyboard hiding/restoration. Sign out: tabs must disappear and private routes stay locked. Repeat with all three roles; only existing management permissions should differ. Check smaller screens and enlarged system text when device testing resumes.

## References

Expo SDK 58: https://docs.expo.dev/versions/v58.0.0/

JavaScript tabs: https://docs.expo.dev/router/advanced/tabs/
