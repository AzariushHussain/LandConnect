# LandConnect Mobile Step 27

Blocked-contact cards and list presentation

This step updates the appearance of My Account > Blocked contacts. Direct-chat blocking and the demo-script work remain uncommitted from the previous step; this visual change also remains uncommitted.

## 1. Part A - The cards

Each white rounded card now shows a circular initials avatar, the contact's display name, a capitalized Buyer/Seller/Broker role and a small Blocked badge. It reuses ChatAvatar so the identity treatment matches conversations and group participants. It does not invent a profile photo, blocked date, phone number or other unavailable personal information.

A divider separates the contact identity from its action row. A short restriction label explains that direct messages and calls are blocked. Unblock is a compact green action with a lock-open icon. Its footer can wrap on narrower layouts, while long names can wrap in the identity area.

The existing confirmation still names the chosen contact. The active unblock action displays a spinner; other actions remain disabled during a request, refresh or pagination. A press does not optimistically remove the card. Confirmed deletion updates the existing controller and refreshes the list.

## 2. Part B - The list

The navigation header keeps the Blocked contacts title. A compact privacy note replaces the repeated title inside the page and reminds the user that other preferences/blocks may still prevent communication after unblocking.

The empty list now has a shield icon, a clear No blocked contacts message and an explanation that contacts blocked from individual chats appear here. Pull-to-refresh remains available, including empty content. The normal full-width Refresh button is replaced by an error-only Retry action; loading older pages remains available when needed. Initial loading still has a labelled spinner.

## 3. Part C - Implementation and checks

BlockedAccountsScreen.tsx contains the layout/style changes and reuses the existing avatar and icon system. BlockedAccounts, PrivacyApi, confirmation text, session-keyed mounting, server enforcement and API contracts are unchanged. No package, native configuration or backend change was needed.

All 233 mobile tests pass. Existing privacy tests cover account isolation, authenticated block lists, pagination, confirmed unblocking and late responses. TypeScript, ESLint, Prettier, git whitespace checks and Android development export pass. No tests were added merely to mirror static styling. No real contact was unblocked during verification.

Physical card layout and touch checks remain pending. Reloading the installed development app through Metro is enough; this step does not need an APK rebuild.

## Manual review

Open a populated list and check avatar/name/role alignment, the badge and the compact button. Review a long name, a narrow screen and larger system font. Cancel an Unblock confirmation, then intentionally test a synthetic contact if desired. Check loading, an empty list, pull-to-refresh, retry and older pages. Confirm that an error never claims the contact was successfully unblocked.
