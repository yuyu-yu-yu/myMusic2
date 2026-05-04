import { listRecentPlays, listTracks, linkPlaylistTrack, normalizeTrack, nowIso, savePlaylist, saveTrack, seedDemoLibrary } from './db.mjs';
import { getSongUrl, getLyric as getCommunityLyric } from './community.mjs';
import { generateChatCompletion } from './ai.mjs';

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

export async function updateProfile(db, llmConfig) {
  // Only analyze tracks the user actually synced from NetEase playlists (not AI recs or test searches)
  const ownedIds = db.prepare('SELECT DISTINCT track_id FROM playlist_tracks').all().map(r => r.track_id);
  const ownedIdSet = new Set(ownedIds);
  const tracks = listTracks(db, 5000).filter(t => ownedIdSet.has(t.id));
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

  // Basic summary (fallback)
  let summary = totalCount
    ? `已收录 ${totalCount} 首歌。常听艺人：${topArtists.join('、') || '待补充'}。常见专辑/歌单线索：${topAlbums.join('、') || '待补充'}。近期适合按 ${tags.join('、')} 来组织推荐。`
    : '还没有同步到音乐数据。启动同步后，我会根据红心、歌单和最近播放总结你的音乐画像。';

  // LLM enriched profile — only regenerate when needed
  const existing = getProfile(db);
  const lastUpdated = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
  const hoursSinceUpdate = (Date.now() - lastUpdated) / 3600000;
  const trackCountChanged = existing?.summary && existing.summary.includes(String(totalCount))
    ? false : Math.abs((totalCount - (existing?.summary?.match(/(\d+)\s*首/) || [])[1] || totalCount)) > totalCount * 0.05;

  if (llmConfig?.baseUrl && (hoursSinceUpdate > 24 || trackCountChanged || existing.summary.length < 150)) {
    const enriched = await generateAIPortrait(tracks, topArtists, totalCount, llmConfig);
    if (enriched) summary = enriched;
  } else if (existing?.summary && existing.summary.length > 50) {
    // Reuse existing enriched profile, update only tags/artists stats
    summary = existing.summary;
  }

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

async function generateAIPortrait(tracks, topArtists, totalCount, llmConfig) {
  // Use user's curated tracks (playlist-synced only, no AI recs)
  const sample = tracks.slice(0, 60).map(t => `${t.name} - ${(t.artists || []).join('/')}`).join('、');
  const artistSummary = topArtists.slice(0, 15).join('、');

  const text = await generateChatCompletion(llmConfig, [
    {
      role: 'system',
      content: [
        '你是音乐分析师。以下是用户主动收藏入库的歌曲（来自网易云歌单同步，不含AI推荐），请客观分析他的音乐口味。',
        '直接输出以下格式，不要打招呼：',
        '',
        '【整体风格】基于曲库数据的客观风格概括',
        '【流派偏好】3-5个常听流派+各举一首典型曲目',
        '【情绪倾向】从歌单中可观察到的情绪偏好，不要编造行为场景',
        '【艺人偏好】常听艺人共同特点（国籍、语种、年代、风格等）',
        '【风格分布】不同风格在曲库中的占比估算',
        '【惊喜建议】2-3个可探索的新方向',
        '【补充】曲库中明显的风格反差（如有）',
        '',
        '重要：不要编造用户行为、习惯、作息。只分析歌曲本身。250-400字。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `曲库总量：${totalCount} 首（全部来自用户歌单同步，非AI推荐）`,
        `常听艺人 Top 15：${artistSummary}`,
        `曲库样本（随机 60 首）：${sample}`
      ].join('\n')
    }
  ], () => null);

  return text || null;
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
  // Prefer community API (supports VIP via browser cookie)
  let url = null;
  let lyric = null;
  try {
    const songUrl = await getSongUrl(normalized.originalId || normalized.id, 'exhigh');
    if (songUrl?.url) url = songUrl.url;
  } catch { /* fall through */ }

  // Fallback: NetEase OpenAPI with descending bitrates
  if (!url) {
    for (const br of [320, 128, 96]) {
      try {
        const res = await netease.playUrl(normalized.id, br);
        const data = res?.data || res;
        const candidate = data?.url || data?.playUrl || null;
        if (candidate) { url = candidate; break; }
      } catch { /* try next bitrate */ }
    }
  }

  // Lyric - try community first
  try {
    lyric = await getCommunityLyric(normalized.id);
  } catch { /* fall through */ }
  if (!lyric) {
    try {
      const lyricRes = await netease.lyric(normalized.id);
      lyric = lyricRes?.data?.lyric || lyricRes?.data?.lrc?.lyric || null;
    } catch { /* ignore */ }
  }

  return {
    ...normalized,
    playUrl: url,
    playbackMode: 'ncm-cli',
    playable: Boolean(url),
    playbackError: url ? null : '该歌曲暂无可用播放资源',
    lyric: lyric || ''
  };
}
