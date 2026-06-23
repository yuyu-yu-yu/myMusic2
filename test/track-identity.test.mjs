import assert from 'node:assert/strict';
import test from 'node:test';
import { getTrackNeteaseSongId } from '../public/track-identity.js';

test('extracts NetEase song id from originalId first', () => {
  assert.equal(getTrackNeteaseSongId({ id: '66285', originalId: '1842025914' }), '1842025914');
});

test('falls back to numeric track id for synced NetEase library tracks', () => {
  assert.equal(getTrackNeteaseSongId({ id: '66285', originalId: null }), '66285');
});

test('ignores non-NetEase local or generated track ids', () => {
  assert.equal(getTrackNeteaseSongId({ id: 'demo-track-1', originalId: null }), '');
  assert.equal(getTrackNeteaseSongId({ id: 'ai-2026-06-24', originalId: '' }), '');
});
