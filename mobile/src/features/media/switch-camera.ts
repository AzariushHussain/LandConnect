import { TrackEvent, type LocalVideoTrack } from 'livekit-client';
import { cameraCapture } from './capture';

type Facing = 'user' | 'environment';
type Acquire = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

// Acquire at the final size: SDK restartTrack first opens at native defaults, then resizes.
export async function switchCameraSource(
  track: LocalVideoTrack,
  facing: Facing,
  active: () => boolean,
  acquire: Acquire = (constraints) => navigator.mediaDevices.getUserMedia(constraints),
): Promise<Facing | null> {
  if (!active()) return null;
  const previous =
    track.mediaStreamTrack.getSettings().facingMode === 'environment' ? 'environment' : 'user';
  async function replace(target: Facing) {
    const resolution = cameraCapture(target).resolution!;
    const stream = await acquire({
      audio: false,
      video: {
        facingMode: target,
        width: resolution.width,
        height: resolution.height,
        frameRate: resolution.frameRate,
      },
    });
    const source = stream.getVideoTracks()[0];
    const stop = () => stream.getTracks().forEach((item) => item.stop());
    if (!active()) {
      stop();
      return null;
    }
    if (!source) {
      stop();
      throw new Error('Camera unavailable');
    }
    const actual = source.getSettings().facingMode;
    if (actual && actual !== target) {
      stop();
      throw new Error('Requested camera unavailable');
    }
    try {
      await track.replaceTrack(source, { userProvidedTrack: false });
      if (!active()) {
        stop();
        return null;
      }
      // The native renderer listens for Restarted when its underlying stream changes.
      track.emit(TrackEvent.Restarted, track);
      return target;
    } catch (error) {
      stop();
      throw error;
    }
  }
  track.mediaStreamTrack.stop();
  try {
    return await replace(facing);
  } catch {
    if (active()) {
      try {
        await replace(previous);
      } catch {
        await track.mute().catch(() => {});
      }
    }
    throw new Error('Could not switch cameras. The previous camera was restored if available.');
  }
}
