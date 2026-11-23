# LandConnect - Mobile Step 10

Chat rows and direct calling UX | 23 November 2026

## 1. Part A - Commit and visible changes

The bottom navigation stage was committed as 53117e1. This step updates the chat list, conversation controls and direct audio/video calls. These new changes remain uncommitted for review.

Chats now appear as compact, full-width rows with circular avatars, a conversation name, a secondary line and inset separators. Tapping anywhere on a row opens the conversation. There is no Open chat button. Groups use a people icon; direct conversations use initials. The header has compact group-creation and meeting shortcuts instead of large action buttons. The Chats tab hides the navigator header and uses one Chats heading with a top safe-area inset. The list fills the available height and width above bottom navigation, including on wider screens.

The secondary line uses real data already provided by the API: the other person's role or the group's participant count. The conversation response does not include a latest-message summary or unread count, so these rows do not fabricate previews, timestamps, delivery ticks or unread badges. Those would require a separate data/API change.

Inside a direct conversation, the header now has audio/video call icons, an avatar and a truncated name. A menu contains refresh, blocking and group actions. The message composer uses a rounded input with a circular Send button. Existing draft preservation, send-retry identity, older/newer history and membership checks remain unchanged.

## 2. Part B - Relevant files

```text
ui/IconButton.tsx                  Accessible circular icon action
features/chat/ChatAvatar.tsx       Initials/group avatar
features/chat/InboxScreen.tsx      Tappable conversation rows
features/chat/ThreadScreen.tsx     Header, options and composer
features/calls/CallButtons.tsx     Compact chat-header call icons
features/calls/controller.ts      Local call intent and transitions
features/calls/permissions.ts     Permission preflight
features/calls/CallScreen.tsx     Full-screen direct call UI
features/calls/CallBanner.tsx     Inline answer/decline shortcut
features/calls/DirectCallMedia.tsx Direct-call media controls
features/calls/NativeCall.tsx     Call adapter into shared media
features/media/NativeMedia.tsx    Shared startup and cleanup
```

The root stack hides the generic Conversation and Call controls headers because these screens now provide their own headers. Back actions still use Expo Router and the existing leave/discard guards. Group menu actions close the menu before navigating, so a modal is not left above the destination screen.

<!-- pagebreak -->

## 3. Part C - Calling is now dial and answer

```text
Caller taps Audio call or Video call
  -> request required OS permissions if needed
  -> send the idempotent call request
  -> display Calling
Recipient taps Answer
  -> request required OS permissions if needed
  -> accept through FastAPI
  -> recipient connects media automatically
Caller receives acceptance and refreshes REST state
  -> caller connects media automatically
Either person taps End -> disconnect locally and end the call
```

There is no separate Create room or Join call media action in the normal direct-call flow. The backend still performs the required call-state, room-creation and token operations internally. These are implementation steps, not extra user decisions. Formal meeting invitations continue to use their existing consent workflow; direct calls have their own interface.

Permission preflight happens before sending an outgoing request or accepting an incoming call. Audio needs microphone permission; video also needs camera permission. Preflight only obtains permission: it does not start recording or publishing. The shared native media implementation obtains a fresh token and publishes only after the server confirms acceptance.

On Android, the permission activity can briefly background React Native. The preflight helper waits up to five seconds for the foreground state to return after permission succeeds. A real background transition, sign-out or failed preparation prevents an unsent request from proceeding. Permission denial never creates/accepts a call and leaves a clear recovery path.

## 4. Part D - Local intent and safe recovery

CallController records which call this device explicitly dialled or answered. A valid accepted state automatically enables media only for that local call intent. Discovering an accepted record from another device or a prior login does not silently open the microphone. Reconnect call is available for a recovered or failed connection; it is not a required step during a normal call.

Sign-out, terminal hints, failed verification, native failure and backgrounding clear automatic connection intent. Thus a later successful poll cannot reopen capture after an error or after the user left. End attempts stop local media immediately, and a failed server request remains visible rather than being reported as a successful end.

Acceptance hints arriving during an in-flight request/poll are queued for another fresh read. This avoids waiting for the fallback poll after a stale ringing response. Events still carry metadata rather than tokens or authoritative call state. FastAPI independently checks participants, busy status, privacy and room access.

Outgoing retries continue to preserve their original UUID, callee and kind. Losing a response cannot turn a retry into a second call. Permission failures before HTTP clear the unsent attempt. The existing local exclusion between a meeting media session and a direct call remains active.

<!-- pagebreak -->

## 5. Part E - Call screen and media controls

The dark call screen shows the participant, call type and a clear Calling/Incoming/Connected/Ended state. Incoming calls have prominent Answer and Decline controls. Outgoing ringing calls have Cancel; accepted calls have End. The in-app banner also offers Answer and Decline directly, so answering does not require opening another page and then joining.

DirectCallMedia uses actual SDK connection state and remote participant presence. Server acceptance alone is not displayed as proof that both phones are connected. Video shows the remote feed with a smaller local preview. Controls include mute/unmute, camera on/off for video calls and an audio output chooser. Output labels update only after successful native selection.

The shared NativeMedia gained optional child content and a connecting placeholder. Meetings keep their previous participant/control layout; direct calls supply the new compact controls. Both reuse the same cancellation-aware startup, native room disconnect, track stopping and serialized audio-session ownership. No native module or dependency was added for this step.

## 6. Part F - Validation

All 156 mobile tests pass: the previous 147 plus nine cases covering caller auto-connect, passive discovery, denied outgoing/answer permissions, sign-out or account switching during permission preparation, backgrounding before sending, clearing intent after native failure and queued acceptance reconciliation. The existing acceptance test was updated to require automatic connection after a successful answer. The accept/background race still verifies that a room accepted after backgrounding is ended.

TypeScript, lint, formatting, Android development bundle export and all 20 Expo Doctor checks pass. Existing real-route call, meeting and chat/privacy contract probes pass after the shared media changes. These probes use fake room operations and synthetic accounts; they do not exercise real device capture or Redis relay delivery.

```powershell
# From mobile/
npm test
npm run typecheck
npm run lint
npm run format:check
npx expo-doctor
npx expo export --platform android --dev

# From the repository root
uv run --project backend python scripts/check_mobile_calls.py
uv run --project backend python scripts/check_mobile_meetings.py
uv run --project backend python scripts/check_mobile_chat.py
```

No backend service/schema changed and no migration was added. The previous backend test result remains historical; the contract probes above were rerun for this step. No developer data was reset and no new phone APK was installed. Existing development clients load the JavaScript update through Metro. Physical phone UI/media testing remains deferred according to the earlier request.

<!-- pagebreak -->

## 7. Part G - Manual acceptance checks

With two demo accounts on separate phones, open the existing direct chat and tap the phone icon. On first use, allow microphone access. The recipient should see an incoming banner and be able to answer directly. Both devices should connect without a Join screen. Confirm two-way speech, mute/unmute, audio output and ending from either side. Repeat with the video icon and allow camera access; verify both feeds and the camera toggle.

Test decline, cancellation before answer, no-answer expiry, busy participants and privacy restrictions. Deny permissions on each side and confirm no unexpected call acceptance/capture. Try an acceptance arriving while another status request is pending. Test a network failure, refresh and the explicit Reconnect action. Background either app and check that media stops, then confirm the operating-system microphone/camera indicators disappear after teardown.

On Chats, tap the avatar, name and secondary line separately; each should open the same conversation. Check a long name and a group row. Inside the thread, verify the call icons, menu, blocking, group navigation and circular Send action. Confirm that an uncertain send still retries the same message and that leaving an unsaved draft retains its existing confirmation.

## 8. Part H - Scope and limitations

The visual layout and direct-call interaction are inspired by familiar messaging apps. This is still the existing foreground prototype, without locked-screen incoming calls, background push/CallKit integration, a ringtone service, unread/read receipts or application-level end-to-end encryption. Required OS permission prompts cannot be removed. Native media quality, audio routing and the final phone layout remain unverified until device tests are resumed.

These changes supersede Step 7's separate Accept then Join instructions for direct calls. Group meetings still have their own host/invitation/consent model. Buyer, Seller and Broker access rules are unchanged.

## References

Expo SDK 58: https://docs.expo.dev/versions/v58.0.0/

LiveKit React Native: https://docs.livekit.io/transport/sdk-platforms/react-native/
