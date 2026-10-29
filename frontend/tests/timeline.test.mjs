import test from 'node:test';
import assert from 'node:assert/strict';
import { clipWindow, locateTimelinePosition, splitTimelineRange, timelineDuration } from '../src/timeline.ts';

test('split points create ordered, contiguous segments and ignore invalid cuts', () => {
  const segments = splitTimelineRange(2, 10, [7, 4, 4, 2, 10, Number.NaN, Infinity]);
  assert.deepEqual(segments, [
    { start: 2, end: 4 },
    { start: 4, end: 7 },
    { start: 7, end: 10 },
  ]);
  assert.deepEqual(splitTimelineRange(5, 5, [5]), []);
});

test('speed changes timeline duration without changing clip source bounds', () => {
  const segments = [
    { start: 0, end: 4, playbackRate: 2 },
    { start: 4, end: 8, playbackRate: 0.5 },
    { start: 10, end: 12, playbackRate: 1 },
  ];
  assert.equal(timelineDuration(segments), 12);
});

test('playhead seek crosses split and clip boundaries at the next segment start', () => {
  const segments = [
    { start: 0, end: 4, playbackRate: 2 },
    { start: 4, end: 8, playbackRate: 0.5 },
    { start: 10, end: 12, playbackRate: 1 },
  ];
  assert.deepEqual(locateTimelinePosition(segments, 1), { index: 0, sourceTime: 2 });
  assert.deepEqual(locateTimelinePosition(segments, 2), { index: 1, sourceTime: 4 });
  assert.deepEqual(locateTimelinePosition(segments, 6), { index: 1, sourceTime: 6 });
  assert.deepEqual(locateTimelinePosition(segments, 10), { index: 2, sourceTime: 10 });
  assert.deepEqual(locateTimelinePosition(segments, 99), { index: 2, sourceTime: 12 });
  assert.deepEqual(locateTimelinePosition(segments, -3), { index: 0, sourceTime: 0 });
});


test('preview and export clamp estimated recording time to actual video duration', () => {
  const clip = { duration_seconds: 3.418 };
  assert.deepEqual(clipWindow(clip, 0, { trim_start_seconds: 0, trim_end_seconds: 3.418 }, { 0: 3 }),
    { start: 0, end: 3, duration: 3 });
  assert.deepEqual(clipWindow(clip, 0, { trim_start_seconds: 0.5, trim_end_seconds: 2 }, { 0: 3 }),
    { start: 0.5, end: 2, duration: 1.5 });
  assert.equal(clipWindow(clip, 0, { trim_start_seconds: 0, trim_end_seconds: 3.418 }, {}).end, 3.418);
});
