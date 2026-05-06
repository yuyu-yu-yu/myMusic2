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
  const playlists = getProfilePlaylists(db);
  const stats = buildProfileStats(tracks, playlists);
  let structured = buildFallbackStructuredProfile(stats);
  let summary = structured.summary;
  const tags = inferTags(tracks);

  // LLM enriched profile — only regenerate when needed
  const existing = getProfile(db);
  const lastUpdated = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
  const hoursSinceUpdate = (Date.now() - lastUpdated) / 3600000;
  const previousCount = Number(existing?.structured?.trackCount || existing?.summary?.match(/(\d+)\s*首/)?.[1] || 0);
  const trackCountChanged = previousCount
    ? Math.abs(stats.trackCount - previousCount) > Math.max(10, stats.trackCount * 0.05)
    : true;
  const missingStructured = !existing?.structured || !Object.keys(existing.structured || {}).length;

  if (llmConfig?.baseUrl && (hoursSinceUpdate > 24 || trackCountChanged || missingStructured || existing.summary.length < 150)) {
    const enriched = await generateAIPortrait(stats, llmConfig);
    if (enriched) {
      structured = normalizeStructuredProfile({ ...structured, ...enriched.structured, summary: enriched.summary || structured.summary }, stats);
      summary = enriched.summary || structured.summary;
    }
  } else if (existing?.summary && existing.summary.length > 50 && existing?.structured) {
    // Reuse existing enriched profile, update only tags/artists stats
    summary = existing.summary;
    structured = normalizeStructuredProfile({ ...structured, ...existing.structured, generatedAt: nowIso() }, stats);
  }

  db.prepare(`
    INSERT INTO music_profile (id, summary, tags_json, profile_json, updated_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      summary = excluded.summary,
      tags_json = excluded.tags_json,
      profile_json = excluded.profile_json,
      updated_at = excluded.updated_at
  `).run(summary, JSON.stringify(tags), JSON.stringify(structured), nowIso());
  return {
    summary,
    tags,
    structured,
    topArtists: structured.artists.map(item => item.name),
    topAlbums: structured.albums.map(item => item.name),
    trackCount: tracks.length
  };
}

async function generateAIPortrait(stats, llmConfig) {
  const sample = stats.sampleTracks.map(t => `${t.name} - ${(t.artists || []).join('/')}`).join('、');
  const playlistText = stats.playlistProfiles.map(p =>
    `${p.name}（${p.kind}，${p.trackCount}首）：${p.sampleTracks.map(t => `${t.name}-${(t.artists || []).join('/')}`).join('、')}`
  ).join('\n');

  const text = await generateChatCompletion(llmConfig, [
    {
      role: 'system',
      content: [
        '你是音乐画像分析师。只分析用户主动同步的网易云歌单曲目。',
        '不要使用最近播放、AI电台推荐、在线搜索结果来推断长期口味。',
        '只输出严格 JSON，不要 Markdown。',
        'JSON schema: {"summary":"中文摘要120-400字","genres":[{"name":"...","weight":0-1,"evidence":["..."]}],"moods":[...],"artists":[...],"albums":[...],"languages":[...],"scenes":[...],"eras":[...],"energy":[...],"discoveryDirections":[{"name":"...","weight":0-1,"evidence":["..."]}],"avoidSignals":[{"name":"...","weight":0-1,"evidence":["..."]}]}',
        'weight 表示长期偏好强度。avoidSignals 只填写曲库明显少或反差大的方向，不要凭空编造。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `曲库总量：${stats.trackCount} 首，歌单数：${stats.playlistCount}`,
        `艺人 Top：${stats.topArtists.map(item => `${item.name}(${item.count})`).join('、')}`,
        `专辑 Top：${stats.topAlbums.map(item => `${item.name}(${item.count})`).join('、')}`,
        `规则初判：${JSON.stringify(stats.ruleSignals)}`,
        `歌单级样本：\n${playlistText}`,
        `曲库样本：${sample}`
      ].join('\n')
    }
  ], () => null);

  const parsed = parseJsonObject(text);
  if (!parsed?.summary) return null;
  return {
    summary: String(parsed.summary).trim(),
    structured: parsed
  };
}

export function getProfile(db) {
  const row = db.prepare('SELECT summary, tags_json AS tagsJson, profile_json AS profileJson, updated_at AS updatedAt FROM music_profile WHERE id = 1').get();
  if (!row) return { summary: '尚未生成音乐画像。', tags: [], structured: {}, updatedAt: null };
  return {
    summary: row.summary,
    tags: safeJson(row.tagsJson, []),
    structured: safeJson(row.profileJson, {}),
    updatedAt: row.updatedAt
  };
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

function getProfilePlaylists(db) {
  const playlists = db.prepare('SELECT id, name, kind FROM playlists ORDER BY updated_at DESC').all();
  const trackStmt = db.prepare(`
    SELECT t.id, t.name, t.artists, t.album, t.cover_url AS coverUrl, t.duration_ms AS durationMs, t.raw_json AS rawJson
    FROM playlist_tracks pt
    JOIN tracks t ON t.id = pt.track_id
    WHERE pt.playlist_id = ?
    ORDER BY pt.position ASC
    LIMIT 120
  `);
  return playlists.map((playlist) => ({
    ...playlist,
    tracks: trackStmt.all(playlist.id).map((row) => {
      const { rawJson, ...track } = row;
      return {
        ...track,
        raw: safeJson(rawJson, {}),
        artists: safeJson(row.artists, [])
      };
    })
  }));
}

function buildProfileStats(tracks, playlists) {
  const profilePlaylists = playlists.filter(p => p.tracks.length);
  const topArtists = countTop(tracks.flatMap(t => t.artists || []), 20);
  const topAlbums = countTop(tracks.map(t => t.album).filter(Boolean), 20);
  const playlistProfiles = profilePlaylists.slice(0, 30).map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    kind: playlist.kind,
    trackCount: playlist.tracks.length,
    sampleTracks: playlist.tracks.slice(0, 18).map(t => ({ name: t.name, artists: t.artists || [], album: t.album || '' })),
    signals: inferRuleSignals(playlist.tracks, [playlist])
  }));
  return {
    trackCount: tracks.length,
    playlistCount: profilePlaylists.length,
    topArtists,
    topAlbums,
    playlistNames: profilePlaylists.map(p => p.name),
    sampleTracks: tracks.slice(0, 120).map(t => ({ name: t.name, artists: t.artists || [], album: t.album || '' })),
    playlistProfiles,
    ruleSignals: inferRuleSignals(tracks, profilePlaylists)
  };
}

function buildFallbackStructuredProfile(stats) {
  const genres = normalizeWeightedList(stats.ruleSignals.genres);
  const moods = normalizeWeightedList(stats.ruleSignals.moods);
  const languages = normalizeWeightedList(stats.ruleSignals.languages);
  const scenes = normalizeWeightedList(stats.ruleSignals.scenes);
  const eras = normalizeWeightedList(stats.ruleSignals.eras);
  const energy = normalizeWeightedList(stats.ruleSignals.energy);
  const artists = stats.topArtists.slice(0, 12).map((item, index) => ({
    name: item.name,
    weight: weightedByCount(item.count, stats.trackCount),
    evidence: [`用户歌单中出现 ${item.count} 首`, index < 3 ? '常听艺人 Top' : '歌单艺人频次较高'].filter(Boolean)
  }));
  const albums = stats.topAlbums.slice(0, 10).map((item) => ({
    name: item.name,
    weight: weightedByCount(item.count, stats.trackCount),
    evidence: [`用户歌单中出现 ${item.count} 首`]
  }));
  const discoveryDirections = normalizeWeightedList([
    ...genres.slice(0, 4).map(item => ({ ...item, evidence: [...(item.evidence || []), '由歌单曲目关键词推断'] })),
    ...moods.slice(0, 3).map(item => ({ ...item, evidence: [...(item.evidence || []), '适合作为后续探索方向'] })),
    ...scenes.slice(0, 3).map(item => ({ ...item, evidence: [...(item.evidence || []), '歌单场景信号'] }))
  ]).slice(0, 8);
  const topArtistText = artists.slice(0, 4).map(item => item.name).join('、') || '暂不明显';
  const topMoodText = moods.slice(0, 3).map(item => item.name).join('、') || '日常陪伴';
  const summary = stats.trackCount
    ? `已基于 ${stats.trackCount} 首用户主动同步的网易云歌单歌曲生成长期画像。你的歌单里常见艺人包括 ${topArtistText}，整体情绪偏向 ${topMoodText}。这份画像不会使用电台 DJ 推荐、在线搜索结果、播放记录或最近播放，避免推荐结果反向污染长期口味。`
    : '尚未从用户歌单中找到可分析的歌曲。同步网易云歌单后，会只基于歌单内容生成长期音乐画像。';

  return normalizeStructuredProfile({
    summary,
    genres,
    moods,
    artists,
    albums,
    languages,
    scenes,
    eras,
    energy,
    discoveryDirections,
    avoidSignals: []
  }, stats);
}

function normalizeStructuredProfile(profile = {}, stats = {}) {
  const normalized = {
    source: 'playlist_tracks',
    version: 1,
    trackCount: stats.trackCount || Number(profile.trackCount) || 0,
    playlistCount: stats.playlistCount || Number(profile.playlistCount) || 0,
    generatedAt: nowIso(),
    summary: String(profile.summary || '').trim(),
    genres: normalizeWeightedList(profile.genres).slice(0, 12),
    moods: normalizeWeightedList(profile.moods).slice(0, 12),
    artists: normalizeWeightedList(profile.artists).slice(0, 15),
    albums: normalizeWeightedList(profile.albums).slice(0, 12),
    languages: normalizeWeightedList(profile.languages).slice(0, 8),
    scenes: normalizeWeightedList(profile.scenes).slice(0, 10),
    eras: normalizeWeightedList(profile.eras).slice(0, 8),
    energy: normalizeWeightedList(profile.energy).slice(0, 6),
    discoveryDirections: normalizeWeightedList(profile.discoveryDirections).slice(0, 10),
    avoidSignals: normalizeWeightedList(profile.avoidSignals).slice(0, 10)
  };
  if (!normalized.artists.length && stats.topArtists?.length) {
    normalized.artists = stats.topArtists.slice(0, 12).map(item => ({
      name: item.name,
      weight: weightedByCount(item.count, stats.trackCount),
      evidence: [`用户歌单中出现 ${item.count} 首`]
    }));
  }
  if (!normalized.albums.length && stats.topAlbums?.length) {
    normalized.albums = stats.topAlbums.slice(0, 10).map(item => ({
      name: item.name,
      weight: weightedByCount(item.count, stats.trackCount),
      evidence: [`用户歌单中出现 ${item.count} 首`]
    }));
  }
  if (!normalized.summary) {
    const artistText = normalized.artists.slice(0, 4).map(item => item.name).join('、') || '暂不明显';
    normalized.summary = normalized.trackCount
      ? `已基于 ${normalized.trackCount} 首用户歌单歌曲生成结构化画像，常听艺人包括 ${artistText}。`
      : '尚未生成音乐画像。';
  }
  return normalized;
}

function inferRuleSignals(tracks, playlists = []) {
  const baseText = [
    ...tracks.flatMap(track => [track.name, track.album, ...(track.artists || [])]),
    ...playlists.map(playlist => playlist.name)
  ].filter(Boolean).join(' ').toLowerCase();
  const cjkText = [
    ...tracks.flatMap(track => [track.name, track.album, ...(track.artists || [])]),
    ...playlists.map(playlist => playlist.name)
  ].filter(Boolean).join(' ');

  return {
    genres: scoreRuleSignals(baseText, [
      ['华语流行', /华语|中文|国语|粤语|陈奕迅|周杰伦|林俊杰|五月天|苏打绿|吴青峰|王菲|孙燕姿/],
      ['电子', /electronic|edm|remix|dj|house|techno|trance|dubstep|future bass|synth|电子|电音|混音/],
      ['民谣', /folk|民谣|赵雷|宋冬野|马頔|尧十三/],
      ['摇滚', /rock|摇滚|metal|punk|alternative/],
      ['爵士', /jazz|爵士|swing|bossa/],
      ['古典/器乐', /classic|classical|古典|piano|钢琴|orchestra|管弦|instrumental|纯音乐/],
      ['影视原声', /ost|score|soundtrack|theme|原声|配乐|影视|电影|动画/],
      ['说唱', /hip.?hop|rap|说唱|嘻哈/],
      ['氛围/Lo-Fi', /ambient|lofi|lo-fi|氛围|白噪|冥想/]
    ], tracks.length),
    moods: scoreRuleSignals(baseText, [
      ['夜晚', /night|moon|深夜|夜|晚安|凌晨|星|月/],
      ['安静', /calm|quiet|silent|安静|轻柔|慢|独处/],
      ['治愈', /heal|comfort|治愈|温柔|陪伴|暖|拥抱/],
      ['怀旧', /old|classic|memory|nostalg|回忆|怀旧|老歌|从前/],
      ['忧伤', /sad|blue|rain|melancholy|雨|伤心|难过|孤独|离别/],
      ['浪漫', /love|romantic|恋爱|浪漫|情歌|喜欢/],
      ['能量', /energy|power|燃|热血|快乐|兴奋|舞曲/]
    ], tracks.length),
    languages: detectLanguages(cjkText, tracks.length),
    scenes: scoreRuleSignals(baseText, [
      ['睡前', /sleep|bed|晚安|睡前|失眠|深夜/],
      ['专注', /focus|study|work|学习|工作|专注|钢琴|lofi/],
      ['放松', /relax|chill|放松|休息|慢歌|咖啡/],
      ['通勤', /drive|road|city|公路|城市|通勤|地铁/],
      ['运动', /run|workout|运动|跑步|健身|燃/],
      ['独处', /alone|solo|独处|一个人|孤独/]
    ], tracks.length),
    eras: detectEras(baseText, tracks.length),
    energy: detectEnergy(baseText, tracks.length)
  };
}

function scoreRuleSignals(text, rules, trackCount) {
  return rules.map(([name, pattern]) => {
    const matches = text.match(new RegExp(pattern.source, `${pattern.flags.includes('i') ? pattern.flags : `${pattern.flags}i`}g`)) || [];
    return {
      name,
      weight: weightedByCount(matches.length, Math.max(trackCount, 1)),
      evidence: matches.length ? [`关键词命中 ${matches.length} 次`] : []
    };
  }).filter(item => item.weight > 0);
}

function detectLanguages(text, trackCount) {
  const signals = [];
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  const kana = (text.match(/[\u3040-\u30ff]/g) || []).length;
  if (cjk) signals.push({ name: '中文', weight: weightedByCount(cjk / 12, trackCount), evidence: ['歌名/艺人中有中文信号'] });
  if (latin) signals.push({ name: '英文/欧美', weight: weightedByCount(latin / 18, trackCount), evidence: ['歌名/艺人中有英文信号'] });
  if (kana || /j-?pop|anime|日本|日语/.test(text.toLowerCase())) signals.push({ name: '日语', weight: weightedByCount(kana || 2, trackCount), evidence: ['歌名/歌单中有日语或日本音乐信号'] });
  return signals;
}

function detectEras(text, trackCount) {
  return scoreRuleSignals(text, [
    ['经典老歌', /80s|90s|八十|九十|老歌|classic/],
    ['千禧年代', /2000|00s|千禧|周杰伦|孙燕姿|王心凌|陶喆/],
    ['近年流行', /2020|2021|2022|2023|2024|2025|2026|新歌/]
  ], trackCount);
}

function detectEnergy(text, trackCount) {
  const high = scoreRuleSignals(text, [['高能量', /edm|rock|燃|热血|舞曲|跑步|运动|快歌|power|energy/]], trackCount);
  const low = scoreRuleSignals(text, [['低能量', /calm|sleep|安静|轻柔|慢歌|钢琴|lofi|氛围|晚安/]], trackCount);
  const medium = trackCount ? [{ name: '中等能量', weight: 0.35, evidence: ['作为默认日常收听能量'] }] : [];
  return [...high, ...low, ...medium];
}

function countTop(values, limit) {
  const counts = new Map();
  for (const value of values) {
    const name = String(value || '').trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function normalizeWeightedList(items = []) {
  const byName = new Map();
  for (const raw of items || []) {
    const name = String(typeof raw === 'string' ? raw : raw?.name || '').trim();
    if (!name) continue;
    const existing = byName.get(name.toLowerCase());
    const weight = clampWeight(raw?.weight ?? raw?.score ?? 0.35);
    const evidence = Array.isArray(raw?.evidence)
      ? raw.evidence.map(item => String(item).trim()).filter(Boolean).slice(0, 4)
      : [];
    if (!existing || weight > existing.weight) {
      byName.set(name.toLowerCase(), { name, weight, evidence });
    } else if (existing) {
      existing.evidence = [...new Set([...existing.evidence, ...evidence])].slice(0, 4);
    }
  }
  return [...byName.values()].sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
}

function weightedByCount(count, total) {
  if (!count || !total) return 0;
  return clampWeight(0.18 + Math.min(0.75, Number(count) / Math.max(Number(total), 1) * 4));
}

function clampWeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, Math.round(number * 100) / 100));
}

function parseJsonObject(text) {
  const value = String(text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch {
    return null;
  }
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function inferTags(tracks) {
  const names = tracks.map((track) => `${track.name} ${track.album || ''}`).join(' ').toLowerCase();
  const tags = [];
  if (/雨|rain|夜|night|凌晨|moon/.test(names)) tags.push('夜晚');
  if (/live|现场|concert/.test(names)) tags.push('现场');
  if (/lofi|jazz|爵士|ambient|氛围/.test(names)) tags.push('放松');
  if (/rock|摇滚|metal|punk/.test(names)) tags.push('能量');
  if (/classic|古典|piano|钢琴/.test(names)) tags.push('专注');
  if (!tags.length) tags.push('私人收藏', '日常陪伴');
  return tags.slice(0, 5);
}

export async function resolvePlayableTrack(db, netease, track, { includeLyric = true } = {}) {
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
  // Prefer community API direct URL, then keep ncm-cli as a playable fallback
  // for tracks that still have a NetEase originalId.
  let url = null;
  let lyric = null;
  try {
    const songUrl = await getSongUrl(normalized.originalId || normalized.id, ['exhigh', 'higher', 'standard']);
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

  if (includeLyric) {
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
  }

  return {
    ...normalized,
    playUrl: url,
    playbackMode: url ? 'browser-direct' : 'ncm-cli',
    playable: Boolean(url || normalized.originalId),
    playbackError: (url || normalized.originalId) ? null : '该歌曲暂无可用播放资源',
    lyric: lyric || ''
  };
}
