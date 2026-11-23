# LandConnect - Mobile Step 14

480p video and smoother-motion tuning | 23 November 2026

## 1. Part A - Commit and reported symptoms

The completed group-calling and video-screen work was committed as 8da85b2: Add group audio/video calling and redesign video call screens. This step investigates the reported poor quality and lag in both direct and group calls. The local You preview stayed smooth while received video lagged, directing the investigation toward encoding, transport and reception.

At the user's request, the final profile targets 480p at up to 30 fps on the existing connection. The main video encoding is capped at 550 kbit/s, with one 180p/15 fps fallback capped at 120 kbit/s. Frame-rate preservation is explicit. These changes remain uncommitted; the measurements below came before this final profile, and smoother post-change device playback is not yet verified.

## 2. Part B - What the live measurements showed

Development-only WebRTC statistics were collected from the connected Android phone during a user-started direct video call. A later wireless-debugging connection to the second phone was refused, so there is no independent capture from that device. The first phone's sender and receiver reports were available.

```text
Received resolution                 180 x 320
Received decoded frame rate         about 2.2 to 3.2 fps
Received video bitrate              about 33 to 55 kbit/s
Received packet loss                about 8.4% to 35.1%
Jitter                              about 134 to 224 ms
Average jitter-buffer delay         about 261 to 342 ms
Receiver processing time             about 2.3 to 2.4 ms/frame
Sender quality limitation           bandwidth
```

Earlier SFU publication logs showed a 720p VP8 source with three negotiated simulcast layers and UDP transport. That describes the available source/layers, not the resolution actually received. The live reports showed the much smaller received layer above. SFU CPU was about 2.6% in one in-call snapshot. These observations support transport/bandwidth impairment as the primary measured bottleneck; they do not establish the quality of every device or call.

The computer-to-phone ping also showed 33% packet loss in one run. A fresh run showed 12% loss and an average round trip of about 103 ms. A computer-to-default-router run showed 16% loss with variable delay. A later 15-ping router run had no loss but varied from 1 to 220 ms (78 ms average); a later 10-ping phone run still lost 10% (68 ms average). The default router was verified as 192.168.29.1. Connectivity briefly became unreachable, including wireless ADB. These checks exercise the LAN outside the media application and show variable conditions rather than a constant loss rate.

The phone reported 2442 MHz (2.4 GHz), roughly -69 to -71 dBm signal and 65 to 72 Mbit/s link rates. The computer was also using Wi-Fi; Ethernet was disconnected. A negotiated link rate is not a measurement of usable video throughput. The user reported that another call still lagged after the suggested network check.

<!-- pagebreak -->

## 3. Part C - Software fixes applied

Off-screen group pages no longer mount native VideoTrack renderers. Only the current page's participants render camera surfaces. The installed native SDK's viewport detector treats a nonzero-size mounted view as visible, including neighbouring pages kept mounted by FlatList. Removing those native video elements lets adaptive stream pause their remote tracks and reduces unnecessary receiving/decoding. Audio participation remains unchanged.

The room now enables the SDK's default adaptive-stream policy instead of requesting the screen's full pixel density. The documented default caps the density used on high-density screens. The full-screen and tile sizes still drive layer selection; network adaptation and dynacast remain enabled.

Camera startup and switching now share an explicit 854-by-480, 30 fps capture target, including the rotated portrait equivalent. Previously switching passed only facingMode to restartTrack, which replaces capture constraints and can fall back to platform defaults. The requested constraints now stay consistent. The device and congestion controller determine actual capture and transmitted output.

The publisher uses a 550 kbit/s, 30 fps main encoding and one 320-by-180, 120 kbit/s, 15 fps fallback. This replaces the earlier three-layer budget with two layers. Maintain-framerate prioritizes motion as bandwidth changes, and dynacast pauses unneeded layers. Native startup passes the same capture/publish profile explicitly so room defaults cannot restore the previous settings. Congestion control can still select a resolution below 480p when necessary.

```text
features/calls/CallVideoStage.tsx Current-page native videos only
features/calls/CallMedia.tsx      Preserve capture on camera switch
features/media/NativeMedia.tsx   Balanced adaptive stream/capture
features/media/capture.ts        Shared camera capture constraints
features/media/video-stats.ts    Safe interval statistics
features/media/video-diagnostics.ts
                                Development-only native sampler
tests/video-performance.test.ts Math, privacy and cleanup checks
```

## 4. Part D - Diagnostics and interpretation

While a development video session is ready and connected, a sampler reads WebRTC reports every five seconds. It writes numeric summaries to the local development log with the call-video tag. There is no telemetry upload. Production builds do not start this sampler. It stops on teardown and ignores an in-flight response after stopping.

Summaries include send/receive direction, codec, dimensions, interval frame rate/bitrate, packet loss, dropped frames, jitter, round-trip time, processing cost and jitter-buffer delay where available. The first interval, counter resets and unsupported fields are reported as null rather than invented zeros. Audio/repair streams are omitted. Names, emails, tokens, room IDs, track IDs and candidate addresses are not serialized.

Low decoded frame rate with high loss/jitter suggests a transport impairment; high decode cost/dropped frames on a clean path would instead point toward receiver load. Sender qualityLimit can identify bandwidth or CPU limitation. These values are diagnostic evidence, not a guarantee about subjective quality. Cumulative RTCP reports can update at different intervals.

<!-- pagebreak -->

## 5. Part E - Validation

All 182 mobile tests pass. Six new checks cover 480p camera constraint preservation, bitrate/frame-rate/fallback policy, interval fps/bitrate/loss/decode calculations, missing/reset counters, exclusion of private or non-video fields, and stopping a sampler with a native read still pending. TypeScript, lint, formatting and Android development bundle export pass.

```powershell
# From mobile/
npm run typecheck
npm run lint
npm run format:check
npm test
npx expo export --platform android --dev
```

No backend schema, server configuration or native dependency changed in this step. No Docker restart or new APK is required. The installed development clients receive the JavaScript changes from Metro. The earlier group-call migration remains 0005_group_calls. Existing media consent, token scope, privacy checks, room rotation and teardown behavior remain in place.

## 6. Part F - What remains to verify

The final implementation follows the request to use 480p and improve motion on the current connection. End the existing call and start a fresh one so its capture and encoding settings use the new profile. No Wi-Fi, router or operating-system setting is changed by this implementation.

During a repeat test, collect at least two statistics intervals after the call connects. Check that receive fps, bitrate and resolution recover while loss/jitter decrease. Also check both call directions, a group call, a camera switch and a swipe between group pages. Off-screen group video should pause and resume when its page becomes current. End while switching cameras and confirm that capture stops.

If video remains poor, use the per-direction reports to determine whether packet loss, buffering or processing cost remains dominant. The earlier loss measurements mean a 30 fps output cannot be guaranteed on this link. The 480p profile lowers the configured send budget and avoids requesting unnecessary group video; it does not remove packet loss from the network. A fresh-device performance comparison remains outstanding.

## References

LiveKit adaptive stream: https://docs.livekit.io/transport/media/subscribe/#adaptive-stream

Pixel-density settings:

https://docs.livekit.io/reference/client-sdk-js/types/AdaptiveStreamSettings.html

Expo SDK 58: https://docs.expo.dev/versions/v58.0.0/
