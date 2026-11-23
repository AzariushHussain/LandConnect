# LandConnect - Mobile Step 11

Find someone and start a chat | 23 November 2026

## 1. Part A - What changed

The Chats tab now has a persistent search field below its heading. The video/meeting shortcut was removed from the top right; the group-creation action remains. Formal meetings can still be reached from My Account. Clearing the search returns to the existing conversation list.

Enter at least two characters of a profile name, or a complete email address. After a short pause, matching people appear as tappable rows with an avatar, name and account role. Tap a person to open your existing private conversation or create one if you have never spoken before. A property listing is no longer required to start a conversation.

The current account model has a display_name field, not a separate unique username. Name search therefore uses that profile name. Names match case-insensitive substrings. Email matching is case-insensitive and requires the full address. Search responses contain public identity fields only; they do not expose email addresses or account preferences.

## 2. Part B - Backend implementation

GET /users/search?q=... requires the existing bearer-token authentication. The request schema strips surrounding whitespace, requires 2 to 254 characters and rejects unknown query parameters. The response has items and has_more, with at most 20 people in items. Results use a stable name/ID order. A larger match set asks the user to refine the query.

The service filters out the signed-in account, people who disabled incoming messages, and blocked pairs in either direction. SQL parameters carry the query value; wildcard characters in names are escaped and treated literally. Responses use Cache-Control: no-store and the existing PublicUser schema: id, display_name and role.

```text
backend/app/schemas/user.py       Search filters and public response
backend/app/services/users.py     Matching and privacy filters
backend/app/api/routes/users.py   Authenticated search endpoint
backend/tests/unit/test_user_search.py
                                 Search/create-or-open route tests
```

Selecting a person uses POST /conversations/direct with their ID. That existing endpoint locks the participant rows, checks current privacy rules and reuses the unique conversation for the pair. New conversations emit the existing transactional-outbox event for Redis/WebSocket delivery. Search itself creates no conversations or messages. No model, database migration or dependency was added.

<!-- pagebreak -->

## 3. Part C - Mobile implementation

ChatApi.searchPeople trims and validates input, encodes it as a query parameter and uses the existing session-bound request helper. It validates the result shape, participant IDs, roles, duplicate IDs and self-exclusion before exposing results to the UI. The existing person parser retains only public identity fields. A late response after a session change is rejected.

RecipientSearch owns the query, results, loading/opening states and errors. Each query change invalidates older responses and clears the previous results immediately. Leaving the tab resets the search and invalidates pending reads or navigation. Repeated taps cannot open several chats at once; editing/clearing is disabled while the selected conversation request is pending.

InboxScreen keeps its heading and input outside the scrolling list, so typing does not remount the input or lose keyboard focus. A 300 ms debounce reduces requests while typing. Search results replace the ordinary conversation list while a query is present. Loading, empty, error/retry and refine-search states are explicit. The existing chat list, pagination, refresh and Pub/Sub recovery remain available after clearing the field.

```text
mobile/src/features/chat/api.ts
  searchPeople: validated, session-bound directory request
mobile/src/features/chat/recipient-search.ts
  Query generation and create-or-open state
mobile/src/features/chat/InboxScreen.tsx
  Fixed search field and selectable person rows
mobile/tests/chat.test.ts
mobile/tests/recipient-search.test.ts
  API validation, stale responses and selection races
```

## 4. Part D - Validation

The mobile suite passes 162 tests. Six new cases cover query encoding and public identity parsing; invalid input/pages and session changes; stale search failures/results; leaving during search/open; repeated selection; and recovery from search or privacy errors. TypeScript, lint, formatting and Android JavaScript export pass.

The selected backend suite passes 71 tests across user search, chat, calls and meetings. Five new search tests exercise real FastAPI routes with isolated SQLite data: authentication/input bounds, names and exact email, literal wildcards/contact exclusion, block/privacy filters, create-or-open identity and the result cap. The tests do not connect to the developer database or reset its data.

```powershell
# Repository root
uv run --project backend python -m pytest backend/tests/unit/test_user_search.py backend/tests/unit/test_chat.py backend/tests/unit/test_calls.py backend/tests/unit/test_meetings.py -q

# mobile/
npm test
npm run typecheck
npm run lint
npm run format:check
```

<!-- pagebreak -->

## 5. Part E - How to verify manually

Open Chats and enter seller1@example.com. Select the matching Seller profile. A private thread should open. Return and repeat the search: selecting the same person should reopen that thread. Try a fragment of the displayed profile name with different letter casing. Clear the field and check that the conversation is visible in the ordinary chat list.

Try an unknown name, a one-character query and a rapidly changing query. Old results should not replace the latest query. With the keyboard open, tap a result once; the selection should work on that tap. Repeated taps should not open several screens. Switch tabs while a search is loading and confirm there is no delayed navigation.

Use two accounts to test disabled incoming messages and blocks in each direction. The other profile should disappear from discovery while restricted. If privacy changes after a result was loaded, selecting it must still fail safely at the direct-chat endpoint. Confirm that the video shortcut is gone and the group-creation action still works.

## 6. Part F - Runtime and limits

The local Docker API must include the new endpoint; older API containers will return 404. This step rebuilds/recreates the local API service while retaining its database and uploads. The installed development clients load the JavaScript update through Metro; no native rebuild is required.

The updated LAN API passed a live check using the existing demo Buyer account: readiness, exact email and profile-name matching, public-only response fields, self-exclusion and rejection of unauthenticated search. This check did not create accounts or conversations.

Email lookup requires the full address. Profile names are not unique, so several people can match a name. The maximum result set is 20 people with a refine-search notice. Search only discovers people currently available for a new direct conversation; existing chats remain in the normal list even if privacy later changes. It does not search message text or group names.

Physical phone UI checks remain deferred at the user's request. Automated route tests and a successful bundle do not verify keyboard behavior or the final rendered layout on a phone. This stage does not change direct-call media, group meetings or account roles.

## References

Expo SDK 58: https://docs.expo.dev/versions/v58.0.0/

Expo Router hooks: https://docs.expo.dev/versions/latest/sdk/router/

SQLAlchemy string matching: https://docs.sqlalchemy.org/en/20/core/sqlelement.html
