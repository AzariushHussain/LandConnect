# LandConnect Mobile Step 16

Group information, participant actions and removal of Block buttons

The preceding 480p, camera-switch and reconnect changes were committed as 58677f0. This stage improves the group information experience and removes Block actions from the mobile interface. The new group changes are left uncommitted for review.

## 1. Part A - Group information layout

Open a group chat and tap its name/avatar, or choose Group information in the conversation options. The header now has a large group avatar, group name, participant count and Chat, Audio and Video shortcuts. The call shortcuts use the existing group-call controller, including its return-to-active-call behavior. They do not open a meeting creation form.

Participants appear as compact rows with avatars, display names, marketplace roles and Owner/Admin badges. Your row is labelled You and still shows your name. Search participants filters this group's loaded roster by display name, ignoring case and surrounding spaces. It does not search private email addresses or other accounts.

Group actions sit in a separate rounded card. Admins and owners can edit the group name. Everyone can refresh the snapshot. Members can leave after confirmation. The owner's Leave row explains that ownership must first be transferred from another participant's card. The 50-person group limit is shown next to the participant count.

Adding people stays within the existing permissions and API. Admins see Add participants above the roster. The picker offers eligible people from existing conversations, excludes current members, and selects one addition per confirmation. The group-capacity limit disables further additions when full. The confirmation explains that a new participant can read retained history.

## Implementation parts

GroupInfoScreen.tsx manages the group snapshot, participant selection, search, rename editor and existing mutation flows. GroupActions.tsx supplies the common icon rows and bottom action-card layout. ThreadScreen.tsx makes the group header an entry point. GroupCallButtons.tsx gains an expanded presentation for the hero shortcuts while retaining compact conversation-header controls.

The layout uses the existing theme, ChatAvatar, IconButton and Expo Router. No design or navigation dependency was added. There are no new API routes, database fields or generated native changes in this step.

<!-- pagebreak -->

## 2. Part B - Participant action cards

Tap a participant row to open a bottom card. It shows the person's avatar, name, group role, marketplace role and join date. The card scrolls on smaller screens and has a close button, backdrop dismissal and Android Back handling. Mutations disable dismissal while their request is being confirmed.

For another participant, Message opens or creates the existing private conversation through ChatApi.direct. Audio and video controls use the existing direct-call controller. The card closes before navigating into call controls, so its native modal does not remain over the call screen. If another direct call is active, the shared controls return to that call.

Owners additionally see Make group admin or Remove admin role, Transfer ownership, and Remove from group. Admins see Remove from group only for ordinary members. Ordinary members receive communication actions. Your own card contains your profile and a pointer to Group actions; it offers no self-call, self-promotion or self-removal action.

```typescript
const actions = participantActions(chat, actor, targetId);
// Ordinary member: message, audio, video
// Owner viewing a member: also promote, transfer, remove
// Admin viewing a member: also remove
```

participant-actions.ts derives the menu from the current membership and existing permissions helper. A missing participant, removed actor, self target or direct conversation produces no participant actions. Marketplace buyer/seller/broker roles do not grant group administration. The backend independently enforces every mutation and privacy restriction.

## Confirmed group changes

Role changes, ownership transfer, removal, additions and leaving require confirmation with an explanation of their effect. Editing the name uses a dedicated sheet with Save. Requests are serialized, stale snapshot responses are ignored, and unavailable membership clears the private snapshot. Incoming removal of the signed-in member closes the roster and its cards immediately; normal Pub/Sub reconciliation still follows.

Uncertain writes show an error asking the user to refresh before repeating. Starting a private conversation also uses the request lock and only navigates when the current mounted screen still owns the result. The reusable CallButtons accepts a disabled state and an onOpen callback so group requests cannot race a card's call controls.

## 3. Part C - Block buttons removed

The Block buttons were removed from listing owner sections, direct-chat options and group participant rows. The unused BlockButton component was deleted, and there is no Block action in the new participant card. Existing backend privacy enforcement, incoming-message/call preferences and stored blocks remain intact. Privacy settings still provides Blocked accounts with Unblock, allowing users to undo earlier blocks. No existing block record is deleted by this UI change.

<!-- pagebreak -->

## 4. Part D - Validation and role checklist

All 192 mobile tests pass, including four new participant-action tests. They cover owner promotion/demotion/transfer/removal, admin restrictions against owners and fellow admins, marketplace-role independence, and absence of actions for self or invalid membership. Existing chat, call, privacy and camera tests continue to pass.

TypeScript, ESLint, Prettier and git diff whitespace checks pass. Android development export wrote the bundle successfully with exit code 0; Expo then emitted a warning that it needed to force its own CLI process to exit. This does not demonstrate native device execution. No backend code changed, so the earlier migration remains 0006_call_reconnect.

## Owner checklist

1. Open Group information from the chat header and conversation options. Confirm the group name, count, owner badge, participant search and Chat shortcut.

2. Edit the group name. Confirm that Save rejects empty or unchanged names and that the saved name returns in the group snapshot.

3. Open an ordinary member's card. Confirm Message, audio/video, promotion, transfer and removal actions. Cancel a destructive action and confirm no membership changes. Promote the member and reopen their card to verify Remove admin role replaces promotion.

4. Transfer ownership only in a disposable test group. Confirm the new owner receives ownership controls and the previous owner remains an admin. Verify the previous owner can now leave.

## Admin checklist

1. Verify edit-name and add-participant controls. Open an ordinary member's card and confirm removal is available.

2. Open an owner or another admin's card. Confirm no role-change, transfer or removal control is offered. Messaging/calling still follows the account's existing privacy rules.

## Ordinary member checklist

1. Confirm no edit-name, add, role-change, transfer or remove-other-member actions. Open another participant's card and try opening an existing private conversation. Check your own card contains profile details without self-actions.

2. Leave a disposable test group and confirm access is removed. When removed by an admin while the screen is open, confirm the roster/card closes and the app reports lost access.

## Checks shared by all roles

Search a partial display name and clear it. Check a long display name and a larger system font. Open/close action cards using their close button, backdrop and Android Back. Check rename with the keyboard open. Verify calls open after their participant card closes. Confirm Block buttons are absent in listing details, direct-chat options and group cards. Previously blocked accounts should still support Unblock in Privacy settings.

Physical phone visual/action checks remain deferred under the earlier testing preference. The automated permission tests and bundle export do not verify native card dimensions, keyboard placement or a real media call. Reload the installed development app through Metro to review this stage; a native rebuild is not needed.

Reference: Expo SDK 58, https://docs.expo.dev/versions/v58.0.0/
