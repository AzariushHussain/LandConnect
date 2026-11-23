import assert from 'node:assert/strict';
import test from 'node:test';
import { videoGrid } from '../src/features/calls/video-layout';

test('one to four video participants fit without overlap in portrait, landscape and compact stages', () => {
  for (const [width, height] of [
    [320, 520],
    [720, 220],
    [200, 100],
  ] as const) {
    for (let count = 1; count <= 4; count++) {
      const frames = videoGrid(count, width, height);
      assert.equal(frames.length, count);
      for (const [index, frame] of frames.entries()) {
        assert.ok(frame.width > 0 && frame.height > 0);
        assert.ok(frame.left >= 0 && frame.top >= 0);
        assert.ok(frame.left + frame.width <= width + 0.001);
        assert.ok(frame.top + frame.height <= height + 0.001);
        for (const other of frames.slice(index + 1)) {
          const overlapWidth =
            Math.min(frame.left + frame.width, other.left + other.width) -
            Math.max(frame.left, other.left);
          const overlapHeight =
            Math.min(frame.top + frame.height, other.top + other.height) -
            Math.max(frame.top, other.top);
          assert.ok(overlapWidth <= 0 || overlapHeight <= 0, 'participant tiles must not overlap');
        }
      }
      const coverage = frames.reduce((area, f) => area + f.width * f.height, 0) / (width * height);
      assert.ok(
        coverage > 0.9,
        'the grid should use the stage rather than leave an empty quadrant',
      );
    }
  }
});

test('empty or unmeasured video stages do not place invalid native surfaces', () => {
  assert.deepEqual(videoGrid(0, 320, 520), []);
  assert.deepEqual(videoGrid(4, 0, 520), []);
  assert.deepEqual(videoGrid(4, 320, 0), []);
});
