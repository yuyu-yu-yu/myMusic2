import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  motionPlaybackSpeeds,
  resolveUnifyPaths
} from '../scripts/unify-avatar-videos.mjs';

test('keeps slowed motions at their accepted playback speed', () => {
  assert.equal(motionPlaybackSpeeds.idle, 0.5);
  assert.equal(motionPlaybackSpeeds.talking, 0.5);
  assert.equal(motionPlaybackSpeeds.listening, 1);
  assert.equal(motionPlaybackSpeeds.happy, 1);
});

test('writes processed files without overwriting generated source MP4 files', () => {
  const root = path.resolve('C:/avatar-test');
  const paths = resolveUnifyPaths(root, 'idle');
  assert.equal(paths.input, path.join(root, 'public/avatar/generated/idle.mp4'));
  assert.equal(paths.output, path.join(root, 'public/avatar/processed/idle.mp4'));
  assert.equal(paths.webm, path.join(root, 'public/avatar/webm/idle.webm'));
  assert.notEqual(paths.input, paths.output);
});
