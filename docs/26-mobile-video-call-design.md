# LandConnect - Mobile Step 13

Direct and group video call design | 23 November 2026

## 1. Part A - Direct video calls

An active direct video call now fills the screen instead of appearing inside a fixed-height card in a scrolling call page. The other person's camera uses cover sizing, which fills the stage and may crop the outer edges of the camera image. The caller's own camera appears in a smaller floating You preview near the top right. A camera-off participant keeps an initials placeholder instead of disappearing.

The compact translucent header shows the person's name and real connection status. The bottom dock has Camera, Mute/Unmute, Audio and a red End action. The camera-switch button is in the header. There are no decorative controls that imply unsupported recording, sharing or encryption features. The layout is inspired by familiar messaging-app video calls while retaining LandConnect's identity.

Video startup also uses this frame. It shows a connecting state with unavailable media controls disabled, while End remains available. It does not start a preview before consent: native media still mounts only for a foreground, focused, verified, explicitly connected call. Incoming/ringing, ended and recovery actions retain their existing consent and navigation behavior.

## 2. Part B - Group video calls

The horizontal strip of fixed-size videos was replaced by a paged grid. Each page shows up to four connected participants. One participant fills the stage; two share a row; three use two tiles plus a full-width lower tile; four use a two-by-two grid. Additional participants are available by swiping, with a page indicator.

Grid membership comes from connected SDK participants, rather than only published camera tracks. Turning a camera off therefore preserves the person's tile and name. Muted microphones have an indicator, and SDK speaking state adds a green border. The connection count reflects media participants, not the number of invited people.

The group grid fits between the measured header and bottom dock. Names, rounded tiles and the same controls provide a consistent direct/group experience. The initiator still has End for everyone; other participants have Leave. This design change does not alter those server-side permissions.

```text
Direct call: remote video fills stage + floating local preview
Group call: up to four named tiles + swipe for further pages
Header: back / name / connection status / switch camera
Dock: camera / microphone / audio output / end or leave
```

<!-- pagebreak -->

## 3. Part C - Implementation parts

VideoCallFrame owns the full-screen background, compact header, safe-area overlays and bottom dock. It measures header/footer height so the group grid stays clear of them, including when text or system insets change. VideoCallControls is the common control row, and VideoCallConnecting supplies the startup presentation.

CallVideoStage maps camera references to connected participant IDs. Direct calls render the remote participant as the background and the local camera above it. Android rendering uses the SDK's documented zOrder hints: zero for background videos and one for the floating local preview. Front-facing local video is mirrored; remote video is not.

For groups, a horizontal FlatList pages through sets of four participants and renders nearby pages. The videoGrid helper computes tile rectangles from the measured stage dimensions. Page offsets adjust when width changes, and the current page is clamped when the participant count shrinks. Native hardware layering and rotation still require device verification.

CallMedia keeps SDK hooks and media operations together. The new camera-switch control restarts the local camera track with the requested user/environment facing mode; the displayed facing state changes only after success. A synchronous operation lock prevents overlapping camera/mute mutations. Existing unmount handling stops late publications and disconnects the old room after an asynchronous operation finishes.

The audio-output chooser now uses a dark bottom sheet with the operating system's available routes. It marks only a successfully selected route. NativeCall and the group media adapter pass the same presentation options to the shared components. Their token loaders and NativeMedia startup/teardown pipeline remain in place.

```text
features/calls/VideoCallFrame.tsx  Frame, dock and startup screen
features/calls/CallVideoStage.tsx Direct preview and group pages
features/calls/video-layout.ts   Measured grid geometry
features/calls/CallMedia.tsx     SDK hooks and media controls
features/calls/NativeCall.tsx    Direct media adapter
features/calls/CallScreen.tsx    Full-screen direct video route
features/calls/GroupCallScreen.tsx
                                Full-screen group video route
ui/IconButton.tsx               Bounded caption/touch width
tests/video-layout.test.ts      Grid bounds/overlap checks
```

## 4. Part D - Access and lifecycle

Video layout changes do not request new room access or publish additional sources. Microphone/camera consent, token scoping, group membership, privacy rules, room rotation, background stopping and route-leave guards continue through the existing controllers. End/Leave uses the same actions as before. No backend source or schema changed in this visual step, and no native dependency was added.

<!-- pagebreak -->

## 5. Part E - Validation

All 176 mobile tests pass. Two new geometry tests verify positive tile sizes, stage bounds, non-overlap and stage coverage for one to four participants in portrait, landscape and compact viewports. Empty or unmeasured stages produce no rectangles. The existing direct/group call tests cover consent, automatic connection, stale responses, cancellation and lifecycle behavior.

TypeScript, lint, formatting and Android development bundle export pass. These checks validate code and layout calculations; they do not render or verify real camera surfaces. The previous group's 76 backend unit tests, seven isolated PostgreSQL checks and route contract probes are historical results from Step 12, not additional UI validation.

```powershell
# From mobile/
npm run typecheck
npm run lint
npm run format:check
npm test
npx expo export --platform android --dev
```

The existing development clients load the JavaScript update through Metro. No new APK, database migration or Docker restart is required for this visual step. The earlier group-call migration remains 0005_group_calls. The current working tree includes the preceding group-call implementation as well as this redesign and remains uncommitted.

## 6. Part F - Manual verification

On two devices, start a direct video call and answer. Check that the remote feed fills the screen, the You preview stays above it and the header/dock remain readable. Switch between front/rear cameras and verify both what the other person receives and whether only the front preview is mirrored. Turn each camera off/on and mute/unmute independently. Try speaker, earpiece and Bluetooth where available.

Test a group with two, three and four connected people, including a camera-off participant. Add a fifth connection to check paging. Swipe to the last page, disconnect participants and check that the page remains valid. Rotate each device and inspect tile sizes, clipped labels, safe areas and controls. Repeat with larger system text. End as initiator and Leave as another member.

End while media is still connecting or while a camera switch is pending. Confirm that local camera/microphone indicators disappear and no late operation restarts capture. Test reconnection, backgrounding and leaving the route. Verify that an incoming video call does not open the camera before Answer.

## 7. Part G - Verification limits

Physical phone UI/media checks remain deferred at the user's request. Actual native video stacking, rounded clipping, camera facing selection and audio routes are therefore unverified on the connected phones. The preview is fixed in position, and the controls stay visible. This step does not add background calling, push wake-up, call recording or application-level end-to-end encryption.

## References

Expo SDK 58: https://docs.expo.dev/versions/v58.0.0/

LiveKit React Native: https://docs.livekit.io/transport/sdk-platforms/react-native/
