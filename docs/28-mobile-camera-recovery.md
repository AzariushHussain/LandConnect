# LandConnect Mobile Step 15

Camera switching and reconnect recovery

This step addresses the reported freeze when changing to the rear camera and frequent call disconnections. It retains the requested 480p video profile. The shared camera controls serve direct and group video calls; the new database recovery timer applies to direct calls. Group calls also use the shared SFU room timeout.

## 1. Part A - What caused early call termination

The direct-call maintenance worker previously examined accepted calls once they were at least 45 seconds old. When fewer than two participants were present, it ended the call immediately. That compared the age of the call with a join timeout; it did not measure how long the participant had actually been absent.

For example, a five-minute call could end as soon as one phone briefly lost its media connection. The server would delete the room while the SDK was attempting to recover. Earlier SFU logs contained peer-disconnect events followed by API-driven room deletion. This establishes an application-side termination path, although it does not explain every observed disconnect.

The worker now stores the start of each continuous absence. A healthy two-person connection clears that timestamp. A later interruption starts a fresh recovery window instead of inheriting the age of the call.

## Files and responsibilities

backend/app/models/call.py and the 0006 migration persist media_missing_since. backend/app/services/calls.py initializes it when accepting a call and clears it when finishing. call_worker.py uses it to decide whether a dropout has lasted long enough to end the call.

mobile/src/features/media/switch-camera.ts owns camera source capture, replacement, restoration and late-source cleanup. CallMedia.tsx connects that helper to the common call controls. VideoCallFrame.tsx gives the camera its own busy state. Existing capture.ts keeps startup, switching and camera re-enable on the same 480p profile.

The implementation adds no dependency and changes no generated Android native file. Installed development clients receive the JavaScript update through Metro.

<!-- pagebreak -->

## 2. Part B - Safer camera switching

In the installed SDK, restartTrack opens the camera using its device/facing selection, then applies size and frame-rate constraints. The native camera's initial defaults can differ from the desired final size. That introduces a second reconfiguration while changing lenses. The new helper requests the final constraints during acquisition instead.

```typescript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: false,
  video: {
    facingMode: target,
    width: 854,
    height: 480,
    frameRate: 30,
  },
});
await track.replaceTrack(stream.getVideoTracks()[0], {
  userProvidedTrack: false,
});
```

Before acquisition, it stops the old raw camera source so phones do not need to open both cameras at once. It keeps the existing LiveKit video publication and sender, microphone track, participant and room. The replacement remains SDK-owned so normal camera mute/teardown can release it. The helper emits the SDK's Restarted event after adoption so the React Native video renderer refreshes its underlying stream.

The helper checks whether the media screen still owns the call before adopting a late native result. If the user leaves while capture or replacement is pending, it stops the newly acquired source and avoids refreshing the abandoned preview. Normal media teardown still disconnects the old room and stops capture.

If the rear camera cannot open, the helper tries to restore the previous camera. If restoration also fails, it mutes video and shows an error. This path does not intentionally stop the microphone or end the call. Camera-off followed by camera-on creates a fresh camera publication with the same final capture settings.

## Controls while the camera changes

Repeated camera taps share one camera-operation lock. Microphone and audio routing have their own control state, while End keeps its existing independent action. After eight seconds, a slow camera operation shows a message explaining that Audio and End remain available. The camera lock stays held until native work settles, preventing overlapping camera acquisitions.

Reconnecting status now covers both media and signaling reconnection. The call remains a foreground feature: backgrounding, explicit End and failed authorization verification retain their existing teardown behavior.

<!-- pagebreak -->

## 3. Part C - Reconnect timing and migration

There are three distinct timers. Initial acceptance allows 45 seconds for both people to join. After a healthy two-person connection has been observed, a continuous absence gets 60 seconds from the worker's observation. LiveKit rooms created by the API use a 90-second departure timeout when everyone has left.

```python
if room.num_participants >= 2:
    call.media_missing_since = None
elif call.media_missing_since is None:
    call.media_missing_since = now()
else:
    # End only after the applicable continuous-absence grace.
    ...
```

Returning before the deadline resets the absence timer. A second interruption gets its own window. The worker keeps its bounded, fair polling order and skips locked rows. The timestamp lives in PostgreSQL, so an API restart does not reset an already recorded dropout. Media-server listing failures roll back that maintenance pass and retry later.

A missing or replaced SFU room still ends the call: there is no matching room left to recover. Explicit End, block and permission-revocation cleanup do not wait for this timeout. Group calls keep their existing membership/consent rules; the direct-call two-person timer is not applied to them.

The SFU YAML departure timeout also changes to 90 seconds. The running SFU was not restarted during this update; the API sends the new timeout explicitly for newly created rooms. Existing rooms keep their earlier creation settings, so finish an old call and start a fresh one for verification.

## Database deployment

Migration 0006_call_reconnect adds one nullable timestamp to calls. Existing records are preserved; an existing accepted call with no timestamp begins an absence window when first observed short of participants. Downgrade refuses while accepted calls remain, preventing removal of their active recovery state.

The API image was rebuilt, Alembic upgraded the existing local database from 0005_group_calls, and the API container was recreated. Readiness at http://192.168.29.22:8000/health/ready reports ready, current migrations and healthy database/Redis. No developer database or upload volume was reset.

The API remains the permission authority. A failed REST verification still removes media authorization until explicit recovery. This change gives SDK transport reconnection time to work while authorization remains valid; it does not bypass privacy checks when the API is unreachable.

<!-- pagebreak -->

## 4. Part D - Validation and device checks

All 188 mobile tests pass. Six camera tests exercise final capture constraints and sender replacement, restoration after acquisition failure, leaving during capture, cleanup after replacement failure, leaving during replacement, and video-only muting when neither camera opens. They use controlled fake tracks and do not prove native camera performance.

The selected backend call/meeting/chat/user-search suite passes 78 tests. Recovery checks cover first-join expiry, a fresh interruption on an old healthy call, reset on rejoin, a later interruption exceeding its deadline, and immediate explicit End. Six isolated PostgreSQL checks pass, covering migration/model agreement, rollback/upgrade, preservation and call integration; the Redis realtime case was deselected. Temporary schemas were removed after testing.

TypeScript, ESLint, Prettier, Ruff checks/format and Android development bundle export pass. The installed FastAPI TestClient emits an upstream HTTPX deprecation warning. The local backend is healthy on the new schema; Metro is listening on port 8081. No APK rebuild is required for these JavaScript/server changes.

## Manual verification on both phones

1. Reload the installed LandConnect development apps with Metro reachable. End any previous call and start a new direct video call. Confirm both microphone directions work.

2. Switch front/rear repeatedly on each phone. Confirm local and received video resume, the local preview has the correct mirroring, and the 480p profile remains active. During a slow switch, verify Mute, audio routing and End remain usable.

3. Turn the camera off and back on. End during a camera switch and verify that camera/microphone indicators turn off and no late preview reappears.

4. Repeat the camera checks in a group video call. Switch group pages and confirm visible participants resume video. These controls use the same camera helper.

5. During a direct call, briefly interrupt one phone's network and restore it before the recovery deadline. Confirm SDK reconnection where authorization remains verified. Separately check explicit End during an interruption. A failed API verification deliberately requires explicit recovery.

## Limits and references

No new two-phone camera or recovery run was performed for this stage; ADB listed no connected devices at verification time. Previous LAN loss/jitter can still interrupt media and lower frame rate. These changes remove an early server termination path and reduce camera reconfiguration; smooth 30 fps or uninterrupted calls are not guaranteed.

SDK behavior was checked against the installed LiveKit 2.25.0 and React Native WebRTC 150.2.0 sources. Official event reference: https://docs.livekit.io/reference/client-sdk-js/enums/RoomEvent.html

Expo SDK 58: https://docs.expo.dev/versions/v58.0.0/
