import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getLibrary } from '../server/library.mjs';
import { openDatabase } from '../server/db.mjs';
import { initializeDemoRuntime } from '../server/startup.mjs';

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
