# LandConnect Mobile Step 26

Block and unblock from an individual chat

The group composer was committed as 82d3e7c before this step. This implementation adds direct-chat Block/Unblock actions and a targeted privacy-state read. These changes and the demo-script documents remain uncommitted for review.

## 1. Part A - Where the control appears

Open an individual conversation and tap the three-dot Conversation options menu. Once its saved privacy state is verified, the menu shows Block user or Unblock user for that contact. The name appears below the action. Block is presented as a destructive action and requires confirmation; Unblock also confirms the intended contact.

The confirmation explains what changes: blocking prevents new direct messages, calls and invitations between the accounts and ends any direct call between them. Existing history and shared group conversations remain visible. The action applies only to individual chats; group participant menus and listing screens are not changed by this step.

The menu also links to My Account's existing Blocked contacts screen. An already blocked contact can be unblocked either from that list or directly inside the conversation.

## Confirmed, pending and uncertain states

After a confirmed block, the message composer is replaced by a blocked-contact notice and Unblock action. Direct-call buttons are disabled. Messages already in history remain visible, and an unsent draft stays in memory rather than being silently deleted. Confirmed unblocking restores the composer/call controls; another account's privacy preferences or a block in the reverse direction may still prevent communication.

During a block/unblock request, messaging/calling controls pause and navigation asks the user to wait. Another write cannot start until that request finishes. The action is also disabled while a message is actively sending, avoiding competing local actions.

If the server response is lost or the change otherwise cannot be confirmed, the UI does not claim success. Further privacy writes, messaging and calling pause until Refresh contact privacy succeeds. No write is automatically retried. A failed background refresh preserves a previously confirmed blocked state, so a network error cannot silently re-enable that chat's controls.

Contact state is refreshed with the focused conversation's existing updates. Returning from Blocked contacts therefore reconciles a change made there. Old requests are invalidated on screen disposal, and the account-keyed chat route prevents results crossing accounts. The confirmation callback also checks the current actor before starting a write.

<!-- pagebreak -->

## 2. Part B - Backend and implementation map

PUT and DELETE /users/me/blocks/{user_id} already implemented blocking and unblocking. This step reuses them and adds GET on the same resource. The new GET returns only user_id and blocked, describing the signed-in user's own block of that target. It does not reveal whether the target has blocked the caller or expose another user's block list.

The read is authenticated, validates the UUID, rejects self queries and returns 404 for a nonexistent target. Responses use Cache-Control: no-store. Backend message, invitation and call enforcement remains authoritative even when a client has an outdated state. No database migration or native dependency is required.

PrivacyApi.blocked validates the returned target ID and actual boolean. ContactBlock owns the read/write state, duplicate-tap guard, uncertain-response reconciliation and disposal generation. ThreadScreen uses that state to render the direct-chat menu, confirmation, blocked notice and communication controls. It reuses GroupActionRow for the menu's icon/text treatment without adding group blocking actions.

## 3. Part C - Verification

All 233 mobile tests and 226 backend unit tests pass. New checks cover block/unblock confirmation ordering, repeated writes, uncertain responses, refresh failure, stopped/late requests, React effect replay and the targeted API response. Backend checks demonstrate authentication, directionality, account isolation, self/invalid/missing targets and updated state after PUT/DELETE. Existing tests continue to verify message/invitation/call restrictions and shared-group behaviour.

TypeScript, ESLint, Prettier, Ruff and Android development export pass. The local Docker API was rebuilt and readiness returned 200. A read-only check of the new endpoint against a synthetic demo contact returned 200 and a validated boolean. No real contact was blocked/unblocked and no live call was started by the implementation checks.

The user reloaded the app and confirmed that the Block/Unblock option is visible on the phone. The actual two-phone block/unblock enforcement flow has not been demonstrated in this step; the backend and controller behaviour is covered by the automated tests.

## Manual checks and recording

1. Open a direct chat, inspect the three-dot action and cancel the confirmation. Repeat and intentionally block a disposable demo contact. Confirm the composer/call controls pause and the blocked notice appears while history remains visible.

2. From the other demo account, attempt a new direct message or call and verify the backend refuses it. Check that shared group history/messages remain accessible. Do not expect the other account's private block list to be revealed.

3. Unblock from the direct chat and repeat a permitted message/call. Also unblock from My Account > Blocked contacts and return to the conversation to verify reconciliation. Other preferences and reverse-direction blocks still apply.

4. Try a lost response, refresh failure, repeated taps, signing out and leaving during a request. There must be no false success, automatic resend or private state appearing in a different account.

The demo video script's privacy scene now uses this direct-chat Block/Unblock flow. Advanced Privacy settings remain an optional separate route. These JavaScript changes are delivered through Metro; the installed development client does not need an APK rebuild.
