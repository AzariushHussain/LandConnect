import assert from 'node:assert/strict';
import test from 'node:test';
import type { Room } from 'livekit-client';
import { cameraCapture, videoPublishDefaults } from '../src/features/media/capture';
import { summarizeVideoStats } from '../src/features/media/video-stats';
import { startVideoDiagnostics } from '../src/features/media/video-diagnostics';
import { deferred } from './fixtures/listings';

type Row = Record<string, unknown>;
const report = (rows: Row[]) => new Map(rows.map((row) => [String(row.id), row]));
const initial: Row = {
  id: 'private-stream-id',
  type: 'inbound-rtp',
  kind: 'video',
  codecId: 'codec',
  timestamp: 1000,
  bytesReceived: 1000,
  framesDecoded: 10,
  packetsReceived: 100,
  packetsLost: 1,
  framesDropped: 1,
  totalDecodeTime: 0.05,
  jitterBufferDelay: 1,
  jitterBufferEmittedCount: 10,
  frameWidth: 1280,
  frameHeight: 720,
  transportId: 'transport',
};
const context: Row[] = [
  { id: 'codec', type: 'codec', mimeType: 'video/VP8' },
  { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' },
  { id: 'pair', type: 'candidate-pair', currentRoundTripTime: 0.04, address: '192.168.1.1' },
];

test('switching camera retains the 480p resolution/frame-rate target instead of using native defaults', () => {
  const front = cameraCapture('user'),
    rear = cameraCapture('environment');
  assert.equal(front.facingMode, 'user');
  assert.equal(rear.facingMode, 'environment');
  assert.deepEqual(front.resolution, rear.resolution);
  assert.equal(rear.resolution?.width, 854);
  assert.equal(rear.resolution?.height, 480);
  assert.equal(rear.resolution?.frameRate, 30);
});

test('480p video prioritizes frame rate with one low-bandwidth fallback encoding', () => {
  assert.equal(videoPublishDefaults.videoEncoding?.maxBitrate, 550_000);
  assert.equal(videoPublishDefaults.videoEncoding?.maxFramerate, 30);
  assert.equal(videoPublishDefaults.degradationPreference, 'maintain-framerate');
  assert.equal(videoPublishDefaults.videoSimulcastLayers?.length, 1);
  assert.equal(videoPublishDefaults.videoSimulcastLayers?.[0]?.height, 180);
  assert.equal(videoPublishDefaults.videoSimulcastLayers?.[0]?.encoding.maxBitrate, 120_000);
  assert.equal(videoPublishDefaults.videoSimulcastLayers?.[0]?.encoding.maxFramerate, 15);
});

test('received-video diagnostics compute interval fps, bitrate, loss, decode and buffering costs', () => {
  const first = summarizeVideoStats(report([initial, ...context]), new Map());
  assert.equal(first.streams[0]?.fps, null);
  const next = {
    ...initial,
    timestamp: 6000,
    bytesReceived: 501000,
    framesDecoded: 130,
    packetsReceived: 590,
    packetsLost: 11,
    framesDropped: 3,
    totalDecodeTime: 0.65,
    jitterBufferDelay: 7,
    jitterBufferEmittedCount: 130,
    jitter: 0.02,
  };
  const stream = summarizeVideoStats(report([next, ...context]), first.next).streams[0]!;
  assert.equal(stream.fps, 24);
  assert.equal(stream.kbps, 800);
  assert.equal(stream.lossPct, 2);
  assert.equal(stream.processingMs, 5);
  assert.equal(stream.jitterBufferMs, 50);
  assert.equal(stream.jitterMs, 20);
  assert.equal(stream.rttMs, 40);
  assert.equal(stream.droppedFps, 0.4);
});

test('counter resets and unsupported fields stay unknown rather than report invalid rates', () => {
  const first = summarizeVideoStats(report([initial]), new Map());
  const reset = summarizeVideoStats(
    report([
      {
        ...initial,
        timestamp: 500,
        bytesReceived: 0,
        framesDecoded: 0,
        packetsReceived: 0,
        packetsLost: 0,
        totalDecodeTime: 0,
      },
    ]),
    first.next,
  );
  assert.equal(reset.streams[0]?.fps, null);
  assert.equal(reset.streams[0]?.kbps, null);
  assert.equal(reset.streams[0]?.lossPct, null);
  assert.equal(reset.streams[0]?.rttMs, null);
  assert.equal(reset.streams[0]?.jitterMs, null);
  assert.equal(summarizeVideoStats(new Map(), reset.next).next.size, 0);
});

test('diagnostics skip audio/repair streams and never serialize IDs, addresses, names or tokens', () => {
  const result = summarizeVideoStats(
    report([
      { ...initial, email: 'private@example.com', token: 'secret-token' },
      ...context,
      { id: 'audio', type: 'inbound-rtp', kind: 'audio' },
      { id: 'repair', type: 'inbound-rtp', kind: 'video', codecId: 'rtx' },
      { id: 'rtx', type: 'codec', mimeType: 'video/rtx' },
      { id: 'send', type: 'outbound-rtp', kind: 'video', qualityLimitationReason: 'cpu' },
    ]),
    new Map(),
  );
  assert.equal(result.streams.length, 2);
  assert.equal(result.streams.find((s) => s.direction === 'send')?.qualityLimit, 'cpu');
  assert.doesNotMatch(
    JSON.stringify(result.streams),
    /private|secret-token|192\.168|transport|pair/,
  );
});

test('stopping video diagnostics cancels the timer and ignores an in-flight native stats response', async () => {
  const pending = deferred<ReturnType<typeof report>>();
  const room = {
    state: 'connected',
    localParticipant: {
      getTrackPublication: () => ({ videoTrack: { getRTCStatsReport: () => pending.promise } }),
    },
    remoteParticipants: new Map(),
  } as unknown as Room;
  const writes: unknown[] = [];
  const stop = startVideoDiagnostics(room, (value) => writes.push(value));
  stop();
  pending.resolve(report([initial, ...context]));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, []);
});
