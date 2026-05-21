import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase, saveTrack } from '../server/db.mjs';
import { extractNcmState, parseNcmOutput, playTrackWithFallback } from '../server/player.mjs';

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

test('ncm-cli mixed upgrade notice output still parses state JSON', () => {
  const result = parseNcmOutput([
    '│ 有新版本: 0.1.3 → 0.1.4  运行 ncm-cli upgrade 升级',
    '',
    '{',
    '  "success": true,',
    '  "state": {',
    '    "status": "stopped",',
    '    "position": 0',
    '  }',
    '}'
  ].join('\n'), '');

  assert.equal(result.success, true);
  assert.equal(extractNcmState(result).status, 'stopped');
});

test('ncm-cli mixed state output can report playing state', async (t) => {
  const db = testDb(t);
  saveTrack(db, {
    id: 'MIXED_OUTPUT_TRACK',
    originalId: 321,
    name: 'Mixed Output',
    artists: ['Artist']
  });

  const result = await playTrackWithFallback({
    db,
    trackId: 'MIXED_OUTPUT_TRACK',
    runner: async (args) => {
      if (args[0] === 'state') {
        return parseNcmOutput('│ 有新版本: 0.1.3 → 0.1.4\n{"success":true,"state":{"status":"playing"}}', '');
      }
      return { success: true };
    }
  });

  assert.equal(result.ok, true);
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
