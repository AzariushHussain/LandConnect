# LandConnect Mobile Step 19

A cleaner My Account tab

The preceding listings, call-history, property-map and direction-icon changes were committed as 9e96425. This step simplifies My Account and gives Blocked contacts its own direct entry. The account changes are left uncommitted for review.

## 1. Part A - Profile and action layout

The tab now starts with one centered profile card. It shows the existing name-initial avatar, display name, email and marketplace-role badge. The large greeting and repeated brand header are removed. Long names and email addresses can wrap within the card; the email remains selectable.

Below the profile, Your account contains compact icon rows with a short description and chevron. Sellers and brokers see My properties for creating/managing their listings. Buyers do not receive that management shortcut. All three roles see Blocked contacts, which opens the existing private blocked-account screen directly.

Sign out is a separate row with a red icon/text treatment. It keeps the existing confirmation: the user can remain signed in or confirm signing out of this device. The action still uses the established session controller and secure-storage cleanup; no new sign-out implementation was added.

## 2. Part B - Privacy and Meetings cleanup

The Your privacy section, displayed message/call preference values and Privacy settings button are removed from My Account. The tab no longer performs a privacy-preference request on focus just to populate that removed section. Backend privacy enforcement and the existing saved preferences still apply to messaging, invitations and calling.

Blocked contacts is now outside that hidden settings section. Its route remains /privacy/blocked, while the navigation title and screen heading are renamed Blocked contacts. The existing list, pagination, refresh and confirmed Unblock action remain in place. Stored blocks are not cleared, and this step does not reintroduce Block buttons elsewhere.

The Meetings CTA is removed. The duplicate Call controls CTA is also removed because Calls already has a dedicated bottom tab and active calls retain their return banners. Existing meeting/call APIs, media cleanup and consent rules were not removed by this account-screen change.

<!-- pagebreak -->

## 3. Part C - Implementation and validation

AccountScreen.tsx now renders the profile and three relevant action rows using the existing theme, avatar, Expo Router and canManage role check. A small local AccountRow component keeps icon, label, description, touch target and pressed state consistent. It adds no package or unused placeholder action.

The root navigation changes only the blocked screen's visible title. BlockedAccountsScreen.tsx changes only its heading. Existing privacy routes remain authenticated, and the underlying block list still belongs to the current signed-in account. The hidden settings screen remains in the codebase; hiding a navigation entry is not an access-control change.

All 203 mobile tests pass, including the existing role, privacy, blocked-account and session tests. TypeScript, ESLint, Prettier, git diff whitespace checks and Android development bundle export pass. A direct check against the installed Ionicons glyph map confirms the account menu's icon names exist.

No new test was added for static layout or text removal. No backend code, database migration, saved preference, block record or native dependency changed. Existing development clients can receive the update through Metro without a new APK.

## 4. Part D - Manual verification

1. Open My Account as each demo role. Verify name, email, avatar initials and role badge. Sellers and brokers should see My properties; buyers should not. Confirm that opening the management row uses the existing protected route.

2. Confirm the tab has no Privacy settings/status section, Meetings button or Call controls button. Calls should remain available through the bottom navigation and existing active-call banners.

3. Tap Blocked contacts directly from My Account. Verify the new title, existing blocked records, refresh/pagination and Unblock confirmation. Cancel an unblock to confirm no change. Only confirm it when testing a disposable block relationship.

4. Cancel Sign out and verify the account remains signed in. Confirm Sign out only when ready to test it, then verify the normal signed-out screen and secure-session cleanup behavior.

5. Check a long name/email, larger system font, menu touch targets and screen-reader labels. Ensure the bottom navigation remains usable and the profile/menu cards scroll on smaller screens.

Physical phone layout and action checks remain deferred under the earlier preference to skip phone UI checks. Automated checks and bundle export do not prove the final native appearance. Reload the development app if it retains an older account layout.

Reference: Expo SDK 58, https://docs.expo.dev/versions/v58.0.0/
