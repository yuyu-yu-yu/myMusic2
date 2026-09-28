import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getLibrary } from '../server/library.mjs';
import { openDatabase } from '../server/db.mjs';
import { initializeDemoRuntime, sharedLibrarySyncGuard } from '../server/startup.mjs';

function testDb(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-startup-'));
  const db = openDatabase(rootDir);
  t.after(() => {
    db.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
  return db;
}

test('cold start seeds a usable demo library without credentials', (t) => {
  const db = testDb(t);
  const result = initializeDemoRuntime({ db, config: { demo: { guestMode: true } } });
  const library = getLibrary(db);

  assert.deepEqual(result, { demoSeeded: true, syncScheduled: false });
  assert.equal(library.playlists.length, 1);
  assert.equal(library.tracks.length, 3);
});

test('shared sync failure keeps the seeded demo library available', async (t) => {
  const db = testDb(t);
  let scheduledTask;
  const warnings = [];
  const result = initializeDemoRuntime({
    db,
    config: { demo: { guestMode: true } },
    cookieStatus: { hasCookie: true },
    startLibrarySync: async () => { throw new Error('sync unavailable'); },
    schedule: (task) => { scheduledTask = task; },
    logger: { warn: (...args) => warnings.push(args.join(' ')) }
  });

  assert.deepEqual(result, { demoSeeded: true, syncScheduled: true });
  scheduledTask();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(getLibrary(db).tracks.length, 3);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /keeping demo library/);
});

test('guest radio routes wait for the shared library sync instead of playing demo tracks', () => {
  const config = { demo: { guestMode: true } };
  const running = { status: 'running', phase: 'syncing_tracks', currentPlaylistIndex: 3, totalPlaylists: 16 };

  for (const pathname of ['/api/radio/start', '/api/radio/next', '/api/radio/chat', '/api/radio/concert/start', '/api/radio/playlist/start']) {
    const blocked = sharedLibrarySyncGuard({ config, syncStatus: running, method: 'POST', pathname });
    assert.equal(blocked?.status, 503, pathname);
    assert.equal(blocked.code, 'library_syncing');
    assert.match(blocked.error, /共享曲库正在同步/);
    assert.deepEqual(blocked.syncProgress, { phase: 'syncing_tracks', currentPlaylistIndex: 3, totalPlaylists: 16 });
  }

  assert.equal(sharedLibrarySyncGuard({ config, syncStatus: running, method: 'GET', pathname: '/api/radio/debug' }), null);
  assert.equal(sharedLibrarySyncGuard({ config, syncStatus: running, method: 'GET', pathname: '/api/library' }), null);
  assert.equal(sharedLibrarySyncGuard({ config, syncStatus: running, method: 'POST', pathname: '/api/library/profile/update' }), null);
  for (const status of ['idle', 'success', 'failed']) {
    assert.equal(sharedLibrarySyncGuard({ config, syncStatus: { status }, method: 'POST', pathname: '/api/radio/start' }), null, status);
  }
  assert.equal(sharedLibrarySyncGuard({ config: { demo: { guestMode: false } }, syncStatus: running, method: 'POST', pathname: '/api/radio/start' }), null);
});
