import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { linkPlaylistTrack, openDatabase, savePlaylist, saveTrack } from '../server/db.mjs';
import { getProfile, updateProfile } from '../server/library.mjs';

function testDb(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-library-'));
  const db = openDatabase(rootDir);
  t.after(() => {
    db.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
  return db;
}

function addPlaylistTrack(db, playlist, track, position = 0) {
  const saved = saveTrack(db, track);
  linkPlaylistTrack(db, playlist.id, saved.id, position);
  return saved;
}

test('profile generation only uses synced playlist tracks, not plays', async (t) => {
  const db = testDb(t);
  const playlist = savePlaylist(db, { id: 'pl-1', name: '夜晚治愈歌单' }, 'created');
  addPlaylistTrack(db, playlist, {
    id: 'owned-1',
    name: '夜晚温柔',
    artists: ['Owned Artist'],
    album: 'Owned Album'
  });

  const radioTrack = saveTrack(db, {
    id: 'radio-1',
    name: 'Radio Metal Hit',
    artists: ['Radio Artist'],
    album: 'Radio Album'
  });
  db.prepare(`
    INSERT INTO plays (track_id, played_at, source, reason, report_status)
    VALUES (?, ?, ?, ?, ?)
  `).run(radioTrack.id, new Date().toISOString(), 'radio', 'DJ recommendation', 'imported');

  const result = await updateProfile(db, {});
  const artistNames = result.structured.artists.map(item => item.name);
  const albumNames = result.structured.albums.map(item => item.name);

  assert.equal(result.structured.source, 'playlist_tracks');
  assert.equal(result.structured.trackCount, 1);
  assert.ok(artistNames.includes('Owned Artist'));
  assert.ok(albumNames.includes('Owned Album'));
  assert.equal(artistNames.includes('Radio Artist'), false);
  assert.equal(albumNames.includes('Radio Album'), false);
});

test('getProfile returns structured profile and remains backward compatible', async (t) => {
  const db = testDb(t);
  const playlist = savePlaylist(db, { id: 'pl-2', name: '工作专注' }, 'created');
  addPlaylistTrack(db, playlist, {
    id: 'owned-2',
    name: 'Focus Piano',
    artists: ['Pianist'],
    album: 'Focus Album'
  });

  await updateProfile(db, {});
  const profile = getProfile(db);

  assert.equal(typeof profile.summary, 'string');
  assert.ok(Array.isArray(profile.tags));
  assert.ok(profile.updatedAt);
  assert.equal(profile.structured.source, 'playlist_tracks');
  assert.equal(profile.structured.trackCount, 1);
});

test('LLM JSON profile is parsed into profile_json', async (t) => {
  const db = testDb(t);
  const playlist = savePlaylist(db, { id: 'pl-3', name: '电子夜跑' }, 'created');
  addPlaylistTrack(db, playlist, {
    id: 'owned-3',
    name: 'Night Run',
    artists: ['Runner DJ'],
    album: 'Run Album'
  });

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          summary: '这是一个偏向夜晚电子和运动场景的长期音乐画像。',
          genres: [{ name: '电子', weight: 0.9, evidence: ['歌单名'] }],
          moods: [{ name: '夜晚', weight: 0.8, evidence: ['歌单名'] }],
          artists: [{ name: 'Runner DJ', weight: 0.7, evidence: ['歌单曲目'] }],
          albums: [{ name: 'Run Album', weight: 0.6, evidence: ['歌单曲目'] }],
          languages: [],
          scenes: [{ name: '运动', weight: 0.8, evidence: ['歌单名'] }],
          eras: [],
          energy: [{ name: '高能量', weight: 0.8, evidence: ['歌单名'] }],
          discoveryDirections: [{ name: '夜跑电子', weight: 0.8, evidence: ['歌单名'] }],
          avoidSignals: [{ name: '重金属', weight: 0.4, evidence: ['歌单未体现'] }]
        })
      }
    }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const profile = await updateProfile(db, { baseUrl: 'https://llm.test', apiKey: 'key', model: 'model' });

  assert.equal(profile.summary, '这是一个偏向夜晚电子和运动场景的长期音乐画像。');
  assert.equal(profile.structured.genres[0].name, '电子');
  assert.equal(profile.structured.discoveryDirections[0].name, '夜跑电子');
  assert.equal(getProfile(db).structured.avoidSignals[0].name, '重金属');
});

test('invalid LLM output falls back to rule-based structured profile', async (t) => {
  const db = testDb(t);
  const playlist = savePlaylist(db, { id: 'pl-4', name: '安静睡前' }, 'created');
  addPlaylistTrack(db, playlist, {
    id: 'owned-4',
    name: 'Calm Sleep Piano',
    artists: ['Sleep Artist'],
    album: 'Sleep Album'
  });

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'not json' } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const profile = await updateProfile(db, { baseUrl: 'https://llm.test', apiKey: 'key', model: 'model' });

  assert.equal(profile.structured.source, 'playlist_tracks');
  assert.equal(profile.structured.artists[0].name, 'Sleep Artist');
  assert.equal(profile.structured.trackCount, 1);
});
