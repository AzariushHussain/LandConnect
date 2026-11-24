# LandConnect Mobile Step 25

Create-group and participant-selection design

Location search, address prefill and the HSR Layout city correction were committed as 6065bcb before this step. This implementation updates group creation and the shared participant picker. The new interface changes remain uncommitted for review.

## 1. Part A - Creating a group

The New group screen now uses the same colours, avatars, rounded cards and spacing as the chat screens. Its preview shows a group avatar and the entered name. The name field has a clearer placeholder, a character count and a short hint. The screen keeps the navigation header without adding another Create group heading inside the form.

The Participants card shows You with the signed-in profile name and an Owner badge. The count includes the owner, up to 50 people total. Add participants opens the picker; once people are chosen, the row becomes Edit participants and displays the selection count.

Selected participants appear as horizontal avatar/name chips. Tap a chip to remove that person from the draft. The owner is automatically included and has no remove control. The chip list keeps large selections compact rather than placing dozens of text notices in the form.

Create group stays in a footer below the scrolling form. It is enabled only when the trimmed name is non-empty and at least one other person is selected. Footer guidance identifies the missing input. Creation errors appear next to this action so they are not hidden farther down the scrolling form.

## Existing creation behaviour

The form still uses ChatApi.group and the existing authenticated group endpoint. It supports 1 to 49 other participants, keeps the 100-character group-name rule and navigates to the group chat only after a confirmed response. A pending request locks the action and edit controls. No background group creation or automatic write retry is introduced.

Leaving a draft retains the existing discard confirmation. An uncertain network result still directs the user to check Chats before attempting creation again. The group-history notice remains visible: current participants, including people added later, can read the retained chat history.

The new-group route now keys the composer by the signed-in user ID. Switching accounts replaces the screen and its selected people. Existing API token/session checks and the mounted-screen guard remain in place.

<!-- pagebreak -->

## 2. Part B - Selecting participants

PeoplePicker is shared by group creation and Add participants in group information. It now has a compact header/back action, selected count, a name search field and removable chips. Avatar rows show a name, profile role and circular check indicator. Selected rows use the green surface colour, and unavailable rows at the selection limit are visibly disabled.

The search filters names among loaded contacts and retained selections; it does not call global user search. People still come from existing conversations. The helper points users to the Chats search to find someone new. Self and current group members are excluded. Loading more conversations can reveal more eligible contacts, including matches for the current filter.

The list remains virtualized and now supports pull-to-refresh. Separate loading, no-contacts and no-name-match states explain what to do next. Network failures have a retry action, and the existing pagination action remains available. Search, refresh and pagination do not discard selected people. Previously selected people remain visible even if their conversations are on a later unloaded page.

The footer applies the selection. During creation, Use selection can return an empty selection so the user can remove everyone from the draft; Create group then remains disabled. When adding to an existing group, Continue requires one person and retains the parent's explicit invitation confirmation and permission checks. Cancel leaves the parent's selection unchanged.

<!-- pagebreak -->

## 3. Part C - Code and verification

NewGroupScreen.tsx owns the preview, name/owner cards, selected participants and fixed creation footer. PeoplePicker.tsx owns modal layout, filtering, list states and selection confirmation. ParticipantChips.tsx shares the removable avatar chips across both screens. participant-selection.ts merges/deduplicates loaded contacts and retained choices, applies exclusions/name filtering and toggles selection within the allowed count.

All 227 mobile tests pass. Two new checks cover retained selections, refreshed profile names, deduplication, self/member exclusion, case-insensitive name filtering, removal at capacity and the one/49-person limits. Existing chat tests cover group validation, authentication, privacy and uncertain write responses. TypeScript, ESLint, Prettier and Android development export pass. No styling-only assertions were added.

## Manual verification pointers

1. Open Chats > New group. Check the preview/name counter, owner row and disabled Create group state. Enter a name, select/remove people, reopen the picker and verify the selected chips/counts persist. Cancel selection changes and confirm the parent draft is unchanged.

2. Filter by a loaded person's name, clear the filter, pull to refresh and load older conversations. Check empty/error states and selections from older pages. At 49 selections, the owner-inclusive count must be 50 and another participant must remain unavailable until someone is removed.

3. As an existing group's owner/admin, open Add participants. Current members must be excluded. Continue should require one choice and open the existing confirmation. A regular member must not gain invitation controls from the visual change.

4. Check keyboard scrolling, long names, large system fonts, horizontal chip removal, back/discard prompts and switching accounts. Create a real test group only when intentionally checking the final server action.

Physical layout, keyboard and touch checks remain pending. The development app receives this JavaScript update through Metro; no native dependency, backend change or APK rebuild is required. No real group was created or membership changed during this implementation.

Reference: Expo SDK 58, https://docs.expo.dev/versions/v58.0.0/
