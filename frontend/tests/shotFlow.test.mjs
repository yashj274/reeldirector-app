import test from 'node:test';
import assert from 'node:assert/strict';
import { nextUnfilmedShotIndex } from '../src/shotFlow.ts';
import { isClipProgress, isClipStartTime, shouldAdvanceOnEndEvent } from '../src/reelPlayback.ts';

test('finishing the last scene does not wrap to an earlier retake', () => {
  const storyboard = [
    { status: 'retake' },
    { status: 'captured' },
    { status: 'captured' },
    { status: 'captured' },
  ];
  const clips = [0, 1, 2, 3].map((shot_index) => ({ shot_index }));

  assert.equal(nextUnfilmedShotIndex(storyboard, clips, 3), -1);
});

test('advancing skips filmed and skipped scenes but preserves later retakes', () => {
  const storyboard = [
    { status: 'retake' },
    { status: 'captured' },
    { status: 'skipped' },
    { status: 'retake' },
  ];
  const clips = [0, 1, 3].map((shot_index) => ({ shot_index }));

  assert.equal(nextUnfilmedShotIndex(storyboard, clips, 0), 3);
});

test('advances when a loaded clip ends even if saved duration metadata is longer', () => {
  assert.equal(shouldAdvanceOnEndEvent(false), false);
  assert.equal(shouldAdvanceOnEndEvent(true), true);
});

test('does not count a stale outgoing timestamp as progress in the new clip', () => {
  assert.equal(isClipStartTime(4.6, 0, 3.4), false);
  assert.equal(isClipStartTime(0.12, 0, 3.4), true);
  assert.equal(isClipStartTime(2.5, 2.3, 3.4), true);
  assert.equal(isClipProgress(4.6, 0, 3.4), false);
  assert.equal(isClipProgress(1.2, 0, 3.4), true);
});
