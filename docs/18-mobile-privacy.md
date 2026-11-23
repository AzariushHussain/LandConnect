# LandConnect - Mobile Step 6

Privacy preferences and blocked accounts | 23 November 2026

## 1. Part A - What this step adds

The chat stage was committed as fed2eee. My account now opens Privacy settings, where the user can edit incoming-message/group-invitation and incoming-call/meeting-invitation preferences, explicitly save them and review confirmed values. Blocked accounts provides paginated listing and confirmed unblocking.

Block actions appear for property owners, the other participant in a direct chat and other group members. Self-blocking is refused. Buyer, Seller and Broker accounts use the same controls. No phone number, private email address or another person's block list is exposed.

The existing backend already implements these policies. This step adds no new database models, migrations, endpoints, dependencies or native permissions. The new privacy stage remains uncommitted until the next requested commit.

## 2. Part B - Code structure

```text
mobile/src/app/privacy/
  index.tsx                    Privacy settings route
  blocked.tsx                  Blocked accounts route
mobile/src/features/privacy/
  api.ts                       Authenticated requests and DTO checks
  preferences.ts               Draft/save/uncertainty controller
  blocks.ts                    Pagination and unblock controller
  PrivacyScreen.tsx            Switches and explicit save
  BlockedAccountsScreen.tsx    Private list and unblock confirmation
  BlockButton.tsx              Reusable confirmed block action
```

application/services.ts constructs PrivacyApi with the shared ApiClient and SessionController. AccountScreen refreshes preferences on focus. ListingDetailsScreen, ThreadScreen and GroupInfoScreen reuse BlockButton. Both routes are protected by sign-in state and keyed by account ID, preventing another account's controller snapshot from being reused after a session change.

<!-- pagebreak -->

## 3. Part C - Editing and saving preferences

GET /users/me loads the saved settings. The response must identify the current account and contain actual boolean allow_messages and allow_calls values. The controller keeps saved and draft objects separately. Controlled native switches edit the draft; toggling alone does not issue a request or claim a server change.

Save privacy settings computes a whitelist of changed flags. Changing incoming messages does not resend an old call preference from another device. After a valid response, the saved values and form become the canonical server values. Unsaved changes are labeled, leaving asks before discarding them, and navigation during a save attempt is blocked.

```json
{"allow_messages": false}
```

This is a PATCH /users/me/privacy body when only the message preference changed. Empty, null, string-valued and unexpected-field changes are rejected before HTTP. The backend independently requires strict booleans. No role, identity, password or token is put in the JSON body.

## 4. Part D - What each setting means

Turning off allow_messages prevents new incoming direct messages and group invitations. The user can still send to recipients who allow messages. It does not erase history or remove the user from existing shared groups.

Turning off allow_calls prevents incoming calls and meeting invitations, ends active direct calls where this user is the recipient and revokes access to meetings hosted by other people. Meetings owned by this account can continue. Saving this change requires confirmation explaining its effect on existing communication.

These effects use the existing backend services. The server updates call/meeting state and schedules required media cleanup. Tests use room adapters; this checkpoint does not prove live device audio stops under every network condition. The mobile calling interface is the next stage.

These account preferences are separate from operating-system microphone/camera permission. They request no native permission and do not turn on native calling or end-to-end message encryption.

<!-- pagebreak -->

## 5. Part E - Updating the session safely

PrivacyApi captures the verified token, sends it through Authorization and checks that it remains current after the response. HTTP 401 rejects only that captured token. Profile parsing accepts the authenticated account ID and two boolean flags, discarding unrelated fields.

SessionController.updatePrivacy checks the token, account ID, expiry and flag types again. It updates only in-memory privacy preferences. It cannot replace the role, email, name, expiry or token, and does not write profile data into SecureStore. Identical values preserve the existing snapshot rather than notifying subscribers again.

A profile-request revision prevents an earlier GET from overwriting a newer confirmed PATCH. Controller request generations ignore obsolete reads and unmounted writes. My account labels values as last confirmed, refreshes them on focus and explains when that refresh fails.

The root WebSocket effect now follows the session token rather than every profile-object update. Saving preferences therefore does not intentionally disconnect chat realtime. Sign-out, token changes and backgrounding still stop it. This also avoids losing a privacy/call notification simply because confirmed flags changed.

## 6. Part F - Failed and uncertain saves

A rejected save keeps the form. A connection error, server error or invalid success response might occur after the server committed. The app marks that result as uncertain, freezes additional edits/saves and asks the user to refresh saved settings instead of assuming the old settings still apply.

Refresh replaces the form only after a successful validated read. A failed read retains the draft and uncertainty warning. Rapid Save taps produce one write. Returning to the screen does not silently replace an unsaved draft.

The backend has no ETag/version precondition for these updates. Concurrent writes to the same flag follow last-write-wins behavior. Sending only changed fields reduces unrelated overwrites but does not provide conflict detection. Refresh to reconcile changes from another device.

<!-- pagebreak -->

## 7. Part G - Blocking from listings and chats

BlockButton shows the person's public display name and sends only their UUID. Confirmation explains that blocking stops direct messaging and new invitations between the accounts, restricts affected calls/meetings and leaves existing shared groups/history available. Success is shown only after HTTP 204.

```text
PUT    /users/me/blocks/{user_id}    block; empty 204
DELETE /users/me/blocks/{user_id}    unblock; empty 204
GET    /users/me/blocks             private limit/offset page
```

ApiClient now accepts explicit PUT. Block/unblock requests have no JSON body, and empty 204 responses are not parsed as JSON. Blocking is idempotent: choosing Block again reaffirms it without creating duplicate records. The button does not claim someone is unblocked simply because their record is outside a partially loaded list. Review current blocks and undo them in Blocked accounts.

Blocking prevents direct messages in both directions, including in an existing direct conversation. New group creation cannot introduce a blocked pair. Existing shared groups/history remain shared, and active property listings remain publicly discoverable. Blocking does not hide listings or delete content. Server checks still apply when an older screen offers Send or Invite.

## 8. Part H - Listing and unblocking accounts

The private list loads 20 public summaries per page: ID, display name and marketplace role. It validates metadata, rejects duplicate/self records and discards unexpected contact fields. Another account reading its own endpoint cannot discover who blocked it.

Unblock requires confirmation. Other preferences or a reverse-direction block can still prevent communication afterwards. A row is removed only after confirmed deletion. Deletion shifts server offsets, so pagination is invalidated and the first page is refreshed independently.

A failed follow-up read cannot turn confirmed unblocking into a failed write. The success notice and locally removed row remain with a separate refresh error. An unconfirmed DELETE preserves its row and asks for refresh before retrying. Generations ignore results from superseded reads or an unmounted screen.

<!-- pagebreak -->

## 9. Part I - Verification evidence

The mobile suite passes 104 tests, including 16 new privacy/session tests. They cover actor/boolean validation, whitelisted payloads, authenticated methods, empty 204, stale reads/sessions, wrong-account flags, unchanged credentials/storage, save deduplication, retained drafts, uncertain-write recovery, private block DTOs, pagination races and confirmed deletion followed by failed refresh.

The isolated chat probe now includes real user/privacy routes. It checks strict-boolean rejection, a message-only PATCH preserving the call flag, incoming/outgoing message differences, private block-list access, self-block rejection, idempotent block/unblock, direct-message/invitation restrictions, retained history and continued existing-group messaging. Actual responses are checked by the mobile privacy/block-page parsers.

The backend chat, call and meeting test files pass 66 tests, including existing privacy-triggered call/meeting cleanup behavior. They use isolated database/test room infrastructure, not live device media. The probe uses synthetic accounts in SQLite, never the developer database or Docker volumes.

## 10. Part J - Reproducing checks

```powershell
# Repository root
uv run --project backend python scripts/check_mobile_chat.py
uv run --project backend python -m pytest `
  backend/tests/unit/test_chat.py backend/tests/unit/test_calls.py `
  backend/tests/unit/test_meetings.py -q

# mobile/
npm test
npm run typecheck
npm run lint
npm run format:check
npx expo-doctor
npx expo export --platform android --dev
```

TypeScript, ESLint, formatting, Ruff and Android development bundle export pass. Expo Doctor passes all 20 checks. No native dependency/config changes were introduced, so the existing development client loads this step through Metro. Native assembleDebug was not rerun; no APK was installed or operated on the phone.

The development app still needs the Docker/LAN backend and Metro. When device testing resumes, use start_lan.py and npm start. Release configuration requires HTTPS. Existing Expo audit findings and the upstream TestClient deprecation warning remain unchanged.

<!-- pagebreak -->

## 11. Part K - Remaining checks and limits

Phone switches, discard prompts, block confirmations and two-account live communication remain unverified. No phone UI checks were performed, following the user's earlier instruction. iOS and live Docker/Redis/media effects were not tested. The last native build remains the chat checkpoint's development client.

When testing resumes, toggle one flag, cancel leaving and verify the draft remains. Save, return to My account and check the confirmed value without signing in again. Interrupt a save and refresh to reconcile. With two accounts, verify incoming messages can be disabled while permitted outgoing messages still work.

Block a property owner/direct participant, verify direct sends fail both ways and confirm a shared group remains available. Unblock and check that other preferences/reverse blocks still apply. Test pagination, a failed refresh after confirmed unblock, switching accounts during a read and a profile GET arriving after a save.

Settings and block-list views are snapshots; other devices may change them. Refresh for current state. Local drafts and list snapshots stay in memory. The feature provides communication controls, not content deletion, end-to-end encryption or a public account directory. Every action still requires server authorization.

## 12. Part L - Next implementation

Next is LiveKit audio/video calling with the agreed self-hosted SFU: native SDK/permissions, call initiation, incoming-call UI, accept/reject/end controls and authorized room tokens. Invite-only meetings follow the existing backend model. The photo-stage camera/microphone blocks must be removed and replaced with calling configuration before rebuilding.

Calling is the assignment's key demonstration requirement. It needs a rebuilt client and actual media checks. This privacy checkpoint does not claim that mobile calling is implemented; backend call/meeting APIs, infrastructure and privacy enforcement are ready for the next stage.

## References

React Native Switch: https://reactnative.dev/docs/switch

Expo SDK 58: https://docs.expo.dev/versions/v58.0.0/

Expo Router: https://docs.expo.dev/router/reference/stack/

Backend policy: docs/08-messaging.md, docs/10-calling.md and docs/11-meetings.md. The route/service implementation remains authoritative for visibility, membership and media cleanup.
