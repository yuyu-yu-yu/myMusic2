import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getAccountSetting,
  getMoodStats,
  linkPlaylistTrack,
  listUserMemories,
  openDatabase,
  recordOrMergeUserMemory,
  recordMoodEvent,
  recordTrackFeedback,
  savePlaylist,
  saveTrack,
  setAccountSetting,
  setSetting
} from '../server/db.mjs';
import { cleanupDemoGuest, cleanupExpiredDemoGuests, DemoVisitorIdError, resolveRequestAccountContext } from '../server/demo-guest.mjs';
import { getLibrary, getProfile, updateProfile } from '../server/library.mjs';
import { getPreferences, restoreDeviceSnapshot, submitFeedback, updatePreferences } from '../server/radio.mjs';

function testDb(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-demo-guest-'));
  const db = openDatabase(rootDir);
  t.after(() => {
    db.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
  return db;
}

function requestFor(visitorId) {
  return { headers: { 'x-demo-visitor-id': visitorId } };
}

function seedDemoAccount(db) {
  setSetting(db, 'netease_login_source', 'cookie');
  setSetting(db, 'netease_cookie_user_id', 'base-user');
  setSetting(db, 'netease_cookie_user_nickname', 'Base Demo');
  const baseAccountId = 'netease:cookie:base-user';

  const playlist = savePlaylist(db, { id: 'pl-demo', name: 'Demo Playlist' }, 'created');
  const track = saveTrack(db, {
    id: 'track-demo',
    name: 'Demo Song',
    artists: ['Demo Artist'],
    album: 'Demo Album'
  });
  linkPlaylistTrack(db, playlist.id, track.id, 0);

  setAccountSetting(db, baseAccountId, 'library_synced_user_id', 'base-user');
  setAccountSetting(db, baseAccountId, 'library_synced_playlist_ids', JSON.stringify([playlist.id]));
  setAccountSetting(db, baseAccountId, 'user_preferences', JSON.stringify({ note: 'base note', voiceMode: 'recommendations' }));
  recordOrMergeUserMemory(db, {
    accountId: baseAccountId,
    kind: 'music_preference',
    content: 'Base account memory should not be copied into guests.'
  });
  recordTrackFeedback(db, {
    accountId: baseAccountId,
    trackId: track.id,
    eventType: 'like',
    source: 'base'
  });
  db.prepare(`
    INSERT INTO account_music_profiles (account_id, summary, tags_json, profile_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(baseAccountId, 'Base music profile', JSON.stringify(['demo']), JSON.stringify({ source: 'test' }), new Date().toISOString());
  db.prepare(`
    INSERT INTO music_profile (id, summary, tags_json, profile_json, updated_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      summary = excluded.summary,
      tags_json = excluded.tags_json,
      profile_json = excluded.profile_json,
      updated_at = excluded.updated_at
  `).run('Base music profile', JSON.stringify(['demo']), JSON.stringify({ source: 'test' }), new Date().toISOString());

  return { baseAccountId, playlistId: playlist.id, trackId: track.id };
}

test('demo guest accounts isolate preferences, memories, and feedback while sharing demo library', (t) => {
  const db = testDb(t);
  const seeded = seedDemoAccount(db);
  const config = { demo: { guestMode: true } };

  const guestA = resolveRequestAccountContext(db, config, requestFor('visitor-a-1234'));
  const guestB = resolveRequestAccountContext(db, config, requestFor('visitor-b-1234'));

  assert.equal(guestA.accountId, 'demo:guest:visitor-a-1234');
  assert.equal(guestB.accountId, 'demo:guest:visitor-b-1234');
  assert.notEqual(guestA.accountId, guestB.accountId);

  const libraryA = getLibrary(db, guestA);
  const libraryB = getLibrary(db, guestB);
  assert.equal(libraryA.totalTracks, 1);
  assert.equal(libraryB.totalTracks, 1);
  assert.equal(libraryA.profile.summary, 'Base music profile');
  assert.equal(getAccountSetting(db, guestA.accountId, 'library_synced_user_id'), 'base-user');
  assert.equal(listUserMemories(db, { accountId: guestA.accountId }).length, 0);
  assert.equal(getPreferences({ db, accountContext: guestA }).feedbackSummary.totals.likes, 0);
  assert.equal(getPreferences({ db, accountContext: guestA }).preferences.note, '');

  updatePreferences({ db, accountContext: guestA, payload: { note: 'A note', moodMode: 'focus' } });
  submitFeedback({ db, accountContext: guestA, payload: { trackId: seeded.trackId, eventType: 'like', sessionId: 'a-session' } });
  recordMoodEvent(db, { accountId: guestA.accountId, sessionId: 'a-session', mood: 'focus', energy: 'low' });
  recordOrMergeUserMemory(db, {
    accountId: guestA.accountId,
    kind: 'music_preference',
    content: 'Guest A likes sharper recommendations.'
  });

  assert.equal(getPreferences({ db, accountContext: guestA }).preferences.note, 'A note');
  assert.equal(getPreferences({ db, accountContext: guestB }).preferences.note, '');
  assert.equal(getPreferences({ db, accountContext: guestA }).feedbackSummary.totals.likes, 1);
  assert.equal(getPreferences({ db, accountContext: guestB }).feedbackSummary.totals.likes, 0);
  assert.equal(getMoodStats(db, { accountId: guestA.accountId }).total, 1);
  assert.equal(getMoodStats(db, { accountId: guestB.accountId }).total, 0);
  assert.equal(listUserMemories(db, { accountId: guestA.accountId }).length, 1);
  assert.equal(listUserMemories(db, { accountId: guestB.accountId }).length, 0);

  const guestAAgain = resolveRequestAccountContext(db, config, requestFor('visitor-a-1234'));
  assert.equal(getPreferences({ db, accountContext: guestAAgain }).preferences.note, 'A note');

  const cleanup = cleanupDemoGuest(db, 'visitor-a-1234');
  assert.equal(cleanup.ok, true);
  assert.equal(getMoodStats(db, { accountId: guestA.accountId }).total, 0);
  assert.equal(getAccountSetting(db, seeded.baseAccountId, 'library_synced_user_id'), 'base-user');
  assert.equal(getPreferences({ db, accountContext: guestB }).preferences.note, '');
});

test('demo mode rejects missing or invalid visitor ids instead of using the base account', (t) => {
  const db = testDb(t);
  const seeded = seedDemoAccount(db);
  const config = { demo: { guestMode: true } };

  assert.throws(
    () => resolveRequestAccountContext(db, config, requestFor('')),
    (error) => error instanceof DemoVisitorIdError && error.status === 400
  );
  assert.throws(
    () => resolveRequestAccountContext(db, config, requestFor('bad')),
    (error) => error instanceof DemoVisitorIdError && error.status === 400
  );
  assert.equal(getAccountSetting(db, seeded.baseAccountId, 'user_preferences'), JSON.stringify({ note: 'base note', voiceMode: 'recommendations' }));
});

test('demo guest snapshot restores same-device preferences and memories after server data reset', (t) => {
  const db = testDb(t);
  seedDemoAccount(db);
  const config = { demo: { guestMode: true } };
  const guest = resolveRequestAccountContext(db, config, requestFor('restore-device-1234'));

  const result = restoreDeviceSnapshot({
    db,
    accountContext: guest,
    payload: {
      snapshot: {
        preferences: { note: 'same browser note', moodMode: 'night', lowDistractionMode: true },
        memories: [
          {
            kind: 'music_preference',
            content: 'Same browser prefers soft late-night recommendations.',
            tags: ['night', 'soft'],
            confidence: 0.8,
            importance: 0.7
          }
        ]
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.restored.preferences, true);
  assert.equal(result.restored.memories, 1);
  assert.equal(getPreferences({ db, accountContext: guest }).preferences.note, 'same browser note');
  assert.equal(getPreferences({ db, accountContext: guest }).preferences.moodMode, 'night');
  assert.equal(listUserMemories(db, { accountId: guest.accountId }).length, 1);
  assert.equal(listUserMemories(db, { accountId: guest.accountId })[0].content, 'Same browser prefers soft late-night recommendations.');
});

test('device snapshot restore is blocked for the shared base account', (t) => {
  const db = testDb(t);
  const seeded = seedDemoAccount(db);
  const result = restoreDeviceSnapshot({
    db,
    accountContext: { accountId: seeded.baseAccountId, source: 'cookie' },
    payload: { snapshot: { preferences: { note: 'should not write' } } }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(getPreferences({ db, accountContext: { accountId: seeded.baseAccountId, source: 'cookie' } }).preferences.note, 'base note');
});

test('guest portrait updates do not overwrite the shared demo portrait', async (t) => {
  const db = testDb(t);
  const seeded = seedDemoAccount(db);
  const config = { demo: { guestMode: true } };
  const guest = resolveRequestAccountContext(db, config, requestFor('portrait-visitor-1234'));

  await updateProfile(db, {}, { force: true, accountContext: guest });

  assert.equal(getProfile(db, guest).structured.trackCount, 1);
  assert.equal(getProfile(db, { accountId: seeded.baseAccountId, source: 'cookie' }).summary, 'Base music profile');
  assert.equal(db.prepare('SELECT summary FROM music_profile WHERE id = 1').get().summary, 'Base music profile');
});

test('expired demo guest cleanup only deletes demo guest scoped data', (t) => {
  const db = testDb(t);
  const seeded = seedDemoAccount(db);
  const config = { demo: { guestMode: true } };
  const guest = resolveRequestAccountContext(db, config, requestFor('old-visitor-1234'));
  updatePreferences({ db, accountContext: guest, payload: { note: 'old guest' } });
  setAccountSetting(db, guest.accountId, 'demo_guest_last_seen', '2000-01-01T00:00:00.000Z');

  const result = cleanupExpiredDemoGuests(db, 24);
  assert.equal(result.accounts, 1);
  assert.equal(getAccountSetting(db, guest.accountId, 'user_preferences'), null);
  assert.equal(getAccountSetting(db, seeded.baseAccountId, 'library_synced_user_id'), 'base-user');
});

test('30-day cleanup removes stale guests and keeps active guests', (t) => {
  const db = testDb(t);
  seedDemoAccount(db);
  const config = { demo: { guestMode: true } };
  const stale = resolveRequestAccountContext(db, config, requestFor('stale-device-1234'));
  const active = resolveRequestAccountContext(db, config, requestFor('active-device-1234'));
  setAccountSetting(db, stale.accountId, 'demo_guest_last_seen', new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString());
  setAccountSetting(db, active.accountId, 'demo_guest_last_seen', new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString());

  const result = cleanupExpiredDemoGuests(db, 720);

  assert.equal(result.accounts, 1);
  assert.equal(getAccountSetting(db, stale.accountId, 'demo_guest_seeded_at'), null);
  assert.notEqual(getAccountSetting(db, active.accountId, 'demo_guest_seeded_at'), null);
});
