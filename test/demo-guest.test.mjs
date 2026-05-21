import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  getAccountSetting,
  linkPlaylistTrack,
  listUserMemories,
  openDatabase,
  recordOrMergeUserMemory,
  recordTrackFeedback,
  savePlaylist,
  saveTrack,
  setAccountSetting,
  setSetting
} from '../server/db.mjs';
import { cleanupDemoGuest, cleanupExpiredDemoGuests, resolveRequestAccountContext } from '../server/demo-guest.mjs';
import { getLibrary } from '../server/library.mjs';
import { getPreferences, submitFeedback, updatePreferences } from '../server/radio.mjs';

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

  updatePreferences({ db, accountContext: guestA, payload: { note: 'A note', moodMode: 'focus' } });
  submitFeedback({ db, accountContext: guestA, payload: { trackId: seeded.trackId, eventType: 'like', sessionId: 'a-session' } });
  recordOrMergeUserMemory(db, {
    accountId: guestA.accountId,
    kind: 'music_preference',
    content: 'Guest A likes sharper recommendations.'
  });

  assert.equal(getPreferences({ db, accountContext: guestA }).preferences.note, 'A note');
  assert.equal(getPreferences({ db, accountContext: guestB }).preferences.note, 'base note');
  assert.equal(getPreferences({ db, accountContext: guestA }).feedbackSummary.totals.likes, 1);
  assert.equal(getPreferences({ db, accountContext: guestB }).feedbackSummary.totals.likes, 0);
  assert.equal(listUserMemories(db, { accountId: guestA.accountId }).length, 1);
  assert.equal(listUserMemories(db, { accountId: guestB.accountId }).length, 0);

  const guestAAgain = resolveRequestAccountContext(db, config, requestFor('visitor-a-1234'));
  assert.equal(getPreferences({ db, accountContext: guestAAgain }).preferences.note, 'A note');

  const cleanup = cleanupDemoGuest(db, 'visitor-a-1234');
  assert.equal(cleanup.ok, true);
  assert.equal(getAccountSetting(db, seeded.baseAccountId, 'library_synced_user_id'), 'base-user');
  assert.equal(getPreferences({ db, accountContext: guestB }).preferences.note, 'base note');
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
