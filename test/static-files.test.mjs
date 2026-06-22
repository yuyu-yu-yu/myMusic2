import assert from 'node:assert/strict';
import test from 'node:test';
import { getStaticCacheControl, parseByteRange } from '../server/static-files.mjs';

test('parses bounded, open-ended and suffix byte ranges', () => {
  assert.deepEqual(parseByteRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(parseByteRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange('bytes=90-200', 100), { start: 90, end: 99 });
});

test('rejects malformed or unsatisfiable byte ranges', () => {
  assert.deepEqual(parseByteRange('bytes=100-120', 100), { invalid: true });
  assert.deepEqual(parseByteRange('bytes=20-10', 100), { invalid: true });
  assert.deepEqual(parseByteRange('items=0-10', 100), { invalid: true });
  assert.deepEqual(parseByteRange('bytes=-0', 100), { invalid: true });
});

test('uses immutable caching for generated video assets', () => {
  assert.equal(getStaticCacheControl('idle.webm'), 'public, max-age=31536000, immutable');
  assert.equal(getStaticCacheControl('idle.mp4'), 'public, max-age=31536000, immutable');
  assert.equal(getStaticCacheControl('app.js'), 'no-store');
  assert.equal(getStaticCacheControl('cover.png'), 'public, max-age=3600');
});
