import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { linkPlaylistTrack, openDatabase, savePlaylist, saveTrack } from '../server/db.mjs';
import { getLibrary, getProfile, syncLibrary, updateProfile, updateProfilePlaylistSelection } from '../server/library.mjs';

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

test('library only lists real playlist tracks while recent plays stay separate', async (t) => {
  const db = testDb(t);
  const playlist = savePlaylist(db, { id: 'pl-real', name: 'Real Playlist' }, 'created');
  addPlaylistTrack(db, playlist, {
    id: 'owned-real',
    name: 'Owned Song',
    artists: ['Owned Artist'],
    album: 'Owned Album'
  });

  const playedOnly = saveTrack(db, {
    id: 'played-only',
    name: 'Played Only Song',
    artists: ['History Artist'],
    album: 'History Album'
  });
  db.prepare(`
    INSERT INTO plays (track_id, played_at, source, reason, report_status)
    VALUES (?, ?, ?, ?, ?)
  `).run(playedOnly.id, new Date().toISOString(), 'netease-recent', 'recent import', 'imported');

  await updateProfile(db, {});
  const library = getLibrary(db);

  assert.deepEqual(library.tracks.map(track => track.id), ['owned-real']);
  assert.equal(library.totalTracks, 1);
  assert.equal(library.recent.some(play => play.track_id === playedOnly.id), true);
  assert.equal(library.playlists[0].trackCount, 1);
  assert.equal(library.playlists[0].profileSelected, true);
});

test('library sync paginates all playlists and replaces stale playlist links', async (t) => {
  const db = testDb(t);
  const stalePlaylist = savePlaylist(db, { id: 'pl-big', name: 'Big Playlist' }, 'created');
  const staleTrack = addPlaylistTrack(db, stalePlaylist, {
    id: 'stale-track',
    name: 'Stale Song',
    artists: ['Old Artist'],
    album: 'Old Album'
  });
  const playlists = [
    { id: 'pl-big', name: 'Big Playlist', trackCount: 450 },
    ...Array.from({ length: 30 }, (_, index) => ({
      id: `pl-extra-${index}`,
      name: `Extra Playlist ${index}`,
      trackCount: 1
    }))
  ];
  const songMap = new Map([
    ['pl-big', Array.from({ length: 450 }, (_, index) => ({
      id: `big-${index}`,
      name: `Big Song ${index}`,
      artists: ['Paged Artist'],
      album: 'Paged Album'
    }))]
  ]);
  for (const playlist of playlists.slice(1)) {
    songMap.set(playlist.id, [{
      id: `${playlist.id}-song`,
      name: `${playlist.name} Song`,
      artists: ['Extra Artist'],
      album: 'Extra Album'
    }]);
  }
  const calls = [];
  const netease = {
    isConfigured: () => true,
    starPlaylist: async () => ({ data: { records: [playlists[0]] } }),
    subscribedPlaylists: async () => ({ data: { records: playlists.slice(1) } }),
    createdPlaylists: async () => ({ data: { records: [] } }),
    playlistSongs: async (playlistId, offset, limit) => {
      calls.push({ playlistId, offset, limit });
      const songs = songMap.get(playlistId) || [];
      return { data: { songs: songs.slice(offset, offset + limit) } };
    },
    recentSongs: async () => ({ data: { records: [] } })
  };

  const result = await syncLibrary(db, netease);
  const library = getLibrary(db);
  const big = library.playlists.find(playlist => playlist.id === 'pl-big');

  assert.equal(result.errors.length, 0);
  assert.equal(result.playlists, 31);
  assert.equal(big.trackCount, 450);
  assert.equal(big.syncedTrackCount, 450);
  assert.equal(big.syncComplete, true);
  assert.equal(library.playlists.find(playlist => playlist.id === 'pl-extra-29').syncedTrackCount, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').get('pl-big', staleTrack.id).count, 0);
  assert.deepEqual(calls.filter(call => call.playlistId === 'pl-big').map(call => call.offset), [0, 200, 400]);
});

test('failed playlist sync keeps previous playlist links and reports the error', async (t) => {
  const db = testDb(t);
  const playlist = savePlaylist(db, { id: 'pl-fail', name: 'Fail Playlist', trackCount: 2 }, 'created');
  const existing = addPlaylistTrack(db, playlist, {
    id: 'existing-track',
    name: 'Existing Song',
    artists: ['Existing Artist'],
    album: 'Existing Album'
  });
  const netease = {
    isConfigured: () => true,
    starPlaylist: async () => ({ data: { records: [{ id: 'pl-fail', name: 'Fail Playlist', trackCount: 2 }] } }),
    subscribedPlaylists: async () => ({ data: { records: [] } }),
    createdPlaylists: async () => ({ data: { records: [] } }),
    playlistSongs: async () => { throw new Error('page failed'); },
    recentSongs: async () => ({ data: { records: [] } })
  };

  const result = await syncLibrary(db, netease);
  const library = getLibrary(db);
  const failed = library.playlists.find(item => item.id === 'pl-fail');

  assert.equal(result.errors.some(error => error.includes('page failed')), true);
  assert.equal(failed.trackCount, 2);
  assert.equal(failed.syncedTrackCount, 1);
  assert.equal(failed.syncComplete, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').get('pl-fail', existing.id).count, 1);
});

test('profile playlist selection filters portrait source and keeps new playlists selected by default', async (t) => {
  const db = testDb(t);
  const selected = savePlaylist(db, { id: 'pl-selected', name: 'Selected Playlist' }, 'created');
  const excluded = savePlaylist(db, { id: 'pl-excluded', name: 'Excluded Playlist' }, 'subscribed');
  addPlaylistTrack(db, selected, {
    id: 'selected-track',
    name: 'Selected Song',
    artists: ['Selected Artist'],
    album: 'Selected Album'
  });
  addPlaylistTrack(db, excluded, {
    id: 'excluded-track',
    name: 'Excluded Song',
    artists: ['Excluded Artist'],
    album: 'Excluded Album'
  });

  await updateProfile(db, {});
  const profileUpdatedAt = db.prepare('SELECT updated_at AS updatedAt FROM music_profile WHERE id = 1').get().updatedAt;
  let library = updateProfilePlaylistSelection(db, [selected.id]);
  const unchangedUpdatedAt = db.prepare('SELECT updated_at AS updatedAt FROM music_profile WHERE id = 1').get().updatedAt;
  let artistNames = library.profile.structured.artists.map(item => item.name);

  assert.equal(unchangedUpdatedAt, profileUpdatedAt);
  assert.equal(library.profile.structured.trackCount, 2);
  assert.equal(artistNames.includes('Selected Artist'), true);
  assert.equal(artistNames.includes('Excluded Artist'), true);
  assert.equal(library.profileSelection.selectedCount, 1);
  assert.equal(library.playlists.find(playlist => playlist.id === selected.id).profileSelected, true);
  assert.equal(library.playlists.find(playlist => playlist.id === excluded.id).profileSelected, false);

  await updateProfile(db, {});
  library = getLibrary(db);
  artistNames = library.profile.structured.artists.map(item => item.name);

  assert.equal(library.profile.structured.trackCount, 1);
  assert.equal(artistNames.includes('Selected Artist'), true);
  assert.equal(artistNames.includes('Excluded Artist'), false);

  const added = savePlaylist(db, { id: 'pl-new', name: 'New Playlist' }, 'created');
  addPlaylistTrack(db, added, {
    id: 'new-track',
    name: 'New Song',
    artists: ['New Artist'],
    album: 'New Album'
  });

  library = getLibrary(db);
  assert.equal(library.playlists.find(playlist => playlist.id === added.id).profileSelected, true);

  library = updateProfilePlaylistSelection(db, []);
  assert.equal(library.profile.structured.trackCount, 1);
  assert.equal(library.profileSelection.selectedCount, 0);

  await updateProfile(db, {});
  library = getLibrary(db);
  assert.equal(library.profile.structured.trackCount, 0);
  assert.equal(library.profile.structured.artists.length, 0);
  assert.equal(library.profileSelection.selectedCount, 0);
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
