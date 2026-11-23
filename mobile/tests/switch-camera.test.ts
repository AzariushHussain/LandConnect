import assert from 'node:assert/strict';
import test from 'node:test';
import { TrackEvent, type LocalVideoTrack } from 'livekit-client';
import { switchCameraSource } from '../src/features/media/switch-camera';
import { deferred } from './fixtures/listings';

function source(facingMode = 'user') {
  let stops = 0;
  return {
    getSettings: () => ({ facingMode }),
    stop: () => {
      stops++;
    },
    get stops() {
      return stops;
    },
  };
}
function stream(camera: ReturnType<typeof source>) {
  return { getVideoTracks: () => [camera], getTracks: () => [camera] } as unknown as MediaStream;
}
function publication() {
  const original = source();
  const replacements: unknown[] = [],
    events: unknown[] = [];
  let muted = false;
  const track = {
    mediaStreamTrack: original,
    replaceTrack: async (next: unknown, options: unknown) => {
      replacements.push([next, options]);
    },
    emit: (...args: unknown[]) => events.push(args),
    mute: async () => {
      muted = true;
    },
  } as unknown as LocalVideoTrack;
  return {
    track,
    original,
    replacements,
    events,
    get muted() {
      return muted;
    },
  };
}

test('camera switch captures at 480p and replaces only the existing video source', async () => {
  const camera = source('environment'),
    p = publication();
  const actual = await switchCameraSource(
    p.track,
    'environment',
    () => true,
    async (constraints) => {
      assert.equal(p.original.stops, 1);
      assert.deepEqual(constraints, {
        audio: false,
        video: { facingMode: 'environment', width: 854, height: 480, frameRate: 30 },
      });
      return stream(camera);
    },
  );
  assert.equal(actual, 'environment');
  assert.deepEqual(p.replacements, [[camera, { userProvidedTrack: false }]]);
  assert.deepEqual(p.events, [[TrackEvent.Restarted, p.track]]);
  assert.equal(camera.stops, 0);
  assert.equal(p.muted, false);
});

test('failed rear-camera capture restores the front camera without ending the call', async () => {
  const p = publication(),
    front = source(),
    requested: unknown[] = [];
  await assert.rejects(
    switchCameraSource(
      p.track,
      'environment',
      () => true,
      async (constraints) => {
        requested.push(constraints.video);
        if (requested.length === 1) throw new Error('Camera busy');
        return stream(front);
      },
    ),
    /previous camera was restored/,
  );
  assert.equal(requested.length, 2);
  assert.deepEqual(p.replacements, [[front, { userProvidedTrack: false }]]);
  assert.equal(p.muted, false);
});

test('leaving while native capture is pending stops the late camera and never publishes it', async () => {
  const p = publication(),
    rear = source('environment'),
    pending = deferred<MediaStream>();
  let active = true;
  const switching = switchCameraSource(
    p.track,
    'environment',
    () => active,
    () => pending.promise,
  );
  active = false;
  pending.resolve(stream(rear));
  assert.equal(await switching, null);
  assert.equal(rear.stops, 1);
  assert.deepEqual(p.replacements, []);
  assert.deepEqual(p.events, []);
});

test('a failed sender replacement releases the new source and restores the old facing', async () => {
  const p = publication(),
    rear = source('environment'),
    front = source();
  let attempts = 0;
  p.track.replaceTrack = async () => {
    if (++attempts === 1) throw new Error('replace failed');
    return p.track;
  };
  await assert.rejects(
    switchCameraSource(
      p.track,
      'environment',
      () => true,
      async () => stream(attempts ? front : rear),
    ),
    /Could not switch/,
  );
  assert.equal(rear.stops, 1);
  assert.equal(front.stops, 0);
  assert.equal(attempts, 2);
});

test('leaving during sender replacement releases the adopted camera without refreshing its view', async () => {
  const p = publication(),
    rear = source('environment'),
    pending = deferred<LocalVideoTrack>();
  let active = true;
  p.track.replaceTrack = () => pending.promise;
  const switching = switchCameraSource(
    p.track,
    'environment',
    () => active,
    async () => stream(rear),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  active = false;
  pending.resolve(p.track);
  assert.equal(await switching, null);
  assert.equal(rear.stops, 1);
  assert.deepEqual(p.events, []);
});

test('when neither camera opens, only video is muted and the error is recoverable', async () => {
  const p = publication();
  await assert.rejects(
    switchCameraSource(
      p.track,
      'environment',
      () => true,
      async () => {
        throw new Error('Camera unavailable');
      },
    ),
    /Could not switch/,
  );
  assert.equal(p.muted, true);
  assert.deepEqual(p.events, []);
});
