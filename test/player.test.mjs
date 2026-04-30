import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase, saveTrack } from '../server/db.mjs';
import { playTrackWithFallback } from '../server/player.mjs';

function testDb(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-player-'));
  const db = openDatabase(rootDir);
  t.after(() => {
    db.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
  return db;
}

test('ncm-cli play command includes encrypted and original ids', async (t) => {
  const db = testDb(t);
  saveTrack(db, {
    id: '330AC3639A5C32EE474A474D64654431',
    originalId: 123,
    name: 'Playable',
    artists: ['Artist']
  });

  const calls = [];
  const result = await playTrackWithFallback({
    db,
    trackId: '330AC3639A5C32EE474A474D64654431',
    runner: async (args) => {
      calls.push(args);
      if (args[0] === 'state') return { success: true, state: { status: 'playing' } };
      return { success: true, state: { status: 'playing' } };
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0], ['stop', '--output', 'json']);
  assert.deepEqual(calls[1], [
    'play',
    '--song',
    '--encrypted-id',
    '330AC3639A5C32EE474A474D64654431',
    '--original-id',
    '123',
    '--output',
    'json'
  ]);
});

test('missing originalId does not call ncm-cli', async (t) => {
  const db = testDb(t);
  saveTrack(db, {
    id: 'NO_ORIGINAL_ID',
    name: 'Missing id',
    artists: ['Artist']
  });

  let called = false;
  const result = await playTrackWithFallback({
    db,
    trackId: 'NO_ORIGINAL_ID',
    maxSkips: 0,
    runner: async () => {
      called = true;
      return { success: true };
    }
  });

  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.match(result.error, /originalId/);
});

test('playback failure skips to the next playable track', async (t) => {
  const db = testDb(t);
  saveTrack(db, {
    id: 'FAIL_TRACK',
    originalId: 111,
    name: 'VIP track',
    artists: ['Artist']
  });
  saveTrack(db, {
    id: 'OK_TRACK',
    originalId: 222,
    name: 'Normal track',
    artists: ['Artist']
  });

  const calls = [];
  const result = await playTrackWithFallback({
    db,
    trackId: 'FAIL_TRACK',
    maxSkips: 2,
    runner: async (args) => {
      calls.push(args);
      if (args.includes('111')) {
        throw new Error('会员歌曲无法播放');
      }
      if (args[0] === 'state') return { success: true, state: { status: 'playing' } };
      return { success: true };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.track.id, 'OK_TRACK');
  assert.equal(result.skipped.length, 1);
  assert.equal(calls.filter((args) => args[0] === 'play').length, 2);
});
