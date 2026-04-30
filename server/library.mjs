import { listRecentPlays, listTracks, linkPlaylistTrack, normalizeTrack, nowIso, savePlaylist, saveTrack, seedDemoLibrary } from './db.mjs';

export async function syncLibrary(db, netease) {
  const result = {
    mode: netease.isConfigured() ? 'netease' : 'demo',
    playlists: 0,
    tracks: 0,
    errors: []
  };

  if (!netease.isConfigured()) {
    seedDemoLibrary(db);
    const tracks = listTracks(db, 100);
    result.tracks = tracks.length;
    result.playlists = 1;
    return result;
  }

  const playlistJobs = [
    ['star', () => netease.starPlaylist()],
    ['subscribed', () => netease.subscribedPlaylists()],
    ['created', () => netease.createdPlaylists()]
  ];

  const playlists = [];
  for (const [kind, job] of playlistJobs) {
    try {
      const response = await job();
      const records = extractRecords(response.data);
      for (const item of records.length ? records : [response.data].filter(Boolean)) {
        const playlist = savePlaylist(db, item, kind);
        playlists.push(playlist);
      }
    } catch (error) {
      result.errors.push(`${kind}: ${error.message}`);
    }
  }

  for (const playlist of playlists.slice(0, 30)) {
    try {
      const response = await netease.playlistSongs(playlist.id, 0, 200);
      const records = extractRecords(response.data);
      records.forEach((item, index) => {
        const track = saveTrack(db, item);
        linkPlaylistTrack(db, playlist.id, track.id, index);
        result.tracks += 1;
      });
    } catch (error) {
      result.errors.push(`playlist ${playlist.id}: ${error.message}`);
    }
  }

  try {
    const response = await netease.recentSongs(0, 50);
    const records = extractRecords(response.data);
    records.forEach((item) => {
      const track = saveTrack(db, item);
      db.prepare(`
        INSERT INTO plays (track_id, played_at, source, reason, report_status)
        VALUES (?, ?, ?, ?, ?)
      `).run(track.id, item.playTime ? new Date(Number(item.playTime)).toISOString() : nowIso(), 'netease-recent', '网易云最近播放', 'imported');
      result.tracks += 1;
    });
  } catch (error) {
    result.errors.push(`recent: ${error.message}`);
  }

  result.playlists = playlists.length;
  await updateProfile(db);
  return result;
}

export async function updateProfile(db) {
  const tracks = listTracks(db, 5000);
  const recent = listRecentPlays(db, 50);
  const artistCounts = new Map();
  const albumCounts = new Map();
  for (const track of tracks) {
    for (const artist of track.artists || []) artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
    if (track.album) albumCounts.set(track.album, (albumCounts.get(track.album) || 0) + 1);
  }
  const topArtists = [...artistCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name);
  const topAlbums = [...albumCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name);
  const tags = inferTags(tracks, recent);
  const totalCount = db.prepare('SELECT COUNT(*) AS count FROM tracks').get().count;
  const summary = totalCount
    ? `已收录 ${totalCount} 首歌。常听艺人：${topArtists.join('、') || '待补充'}。常见专辑/歌单线索：${topAlbums.join('、') || '待补充'}。近期适合按 ${tags.join('、')} 来组织推荐。`
    : '还没有同步到音乐数据。启动同步后，我会根据红心、歌单和最近播放总结你的音乐画像。';

  db.prepare(`
    INSERT INTO music_profile (id, summary, tags_json, updated_at)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      summary = excluded.summary,
      tags_json = excluded.tags_json,
      updated_at = excluded.updated_at
  `).run(summary, JSON.stringify(tags), nowIso());
  return { summary, tags, topArtists, topAlbums, trackCount: tracks.length };
}

export function getProfile(db) {
  const row = db.prepare('SELECT summary, tags_json AS tagsJson, updated_at AS updatedAt FROM music_profile WHERE id = 1').get();
  if (!row) return { summary: '尚未生成音乐画像。', tags: [], updatedAt: null };
  return { summary: row.summary, tags: JSON.parse(row.tagsJson || '[]'), updatedAt: row.updatedAt };
}

export function getLibrary(db) {
  const playlists = db.prepare('SELECT id, name, kind, cover_url AS coverUrl FROM playlists ORDER BY updated_at DESC').all();
  const total = db.prepare('SELECT COUNT(*) AS count FROM tracks').get().count;
  return {
    profile: getProfile(db),
    tracks: listTracks(db, 5000),
    playlists,
    recent: listRecentPlays(db, 50),
    totalTracks: total
  };
}

export function extractRecords(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.records)) return data.records;
  if (Array.isArray(data.list)) return data.list;
  if (Array.isArray(data.songs)) return data.songs;
  if (Array.isArray(data.songList)) return data.songList;
  if (Array.isArray(data.playlists)) return data.playlists;
  if (Array.isArray(data.playlist)) return data.playlist;
  if (Array.isArray(data.resources)) return data.resources;
  if (Array.isArray(data.data)) return data.data;
  return [];
}

function inferTags(tracks, recent) {
  const names = [...tracks, ...recent].map((track) => `${track.name} ${track.album || ''}`).join(' ').toLowerCase();
  const tags = [];
  if (/雨|rain|夜|night|凌晨|moon/.test(names)) tags.push('夜晚');
  if (/live|现场|concert/.test(names)) tags.push('现场');
  if (/lofi|jazz|爵士|ambient|氛围/.test(names)) tags.push('放松');
  if (/rock|摇滚|metal|punk/.test(names)) tags.push('能量');
  if (/classic|古典|piano|钢琴/.test(names)) tags.push('专注');
  if (!tags.length) tags.push('私人收藏', '日常陪伴');
  return tags.slice(0, 5);
}

export async function resolvePlayableTrack(db, netease, track) {
  if (!track) return null;
  const normalized = normalizeTrack(track);
  if (!netease.isConfigured() || normalized.id.startsWith('demo-')) {
    return {
      ...normalized,
      playUrl: `/assets/${normalized.id}.mp3`,
      playbackMode: normalized.originalId ? 'ncm-cli' : 'browser-demo',
      playable: Boolean(normalized.originalId),
      playbackError: normalized.originalId ? null : 'Demo track does not have a NetEase originalId.',
      lyric: '[00:00.00] 本地演示曲目'
    };
  }
  const [lyricResponse] = await Promise.allSettled([
    netease.lyric(normalized.id)
  ]);
  const lyricData = lyricResponse.status === 'fulfilled' ? lyricResponse.value.data : null;
  return {
    ...normalized,
    playUrl: null,
    playbackMode: 'ncm-cli',
    playable: Boolean(normalized.originalId),
    playbackError: normalized.originalId ? null : 'Track does not have originalId for ncm-cli playback.',
    lyric: lyricData?.lyric || lyricData?.lrc?.lyric || ''
  };
}
