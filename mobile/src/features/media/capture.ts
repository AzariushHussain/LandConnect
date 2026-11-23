import { VideoPreset, type TrackPublishDefaults, type VideoCaptureOptions } from 'livekit-client';

const video480 = new VideoPreset(854, 480, 550_000, 30);
export const videoPublishDefaults: TrackPublishDefaults = {
  videoCodec: 'vp8',
  videoEncoding: { ...video480.encoding },
  simulcast: true,
  videoSimulcastLayers: [new VideoPreset(320, 180, 120_000, 15)],
  degradationPreference: 'maintain-framerate',
};

export function cameraCapture(facingMode: 'user' | 'environment'): VideoCaptureOptions {
  return { facingMode, resolution: { ...video480.resolution } };
}
