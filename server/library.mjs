import { clearPlaylistLibrary, getSetting, listRecentPlays, normalizeTrack, nowIso, replacePlaylistTracks, savePlaylist, saveTrack, seedDemoLibrary, setSetting } from './db.mjs';
import {
  getSongUrl,
  getLyric as getCommunityLyric,
  getCookieUserProfile,
  hasCookie as hasCommunityCookie,
  playlistTrackAll as communityPlaylistTrackAll,
  recentSongs as communityRecentSongs,
  userPlaylists as communityUserPlaylists
} from './community.mjs';
import { generateChatCompletion } from './ai.mjs';
import { getNeteaseLoginStatus } from './netease-auth.mjs';

const PROFILE_EXCLUDED_PLAYLIST_IDS_KEY = 'profile_excluded_playlist_ids';
const EMPTY_PROFILE_SUMMARY = 'No playlist selected for music profile.';
const PLAYLIST_SYNC_PAGE_SIZE = 200;
const LIBRARY_SYNCED_USER_ID_KEY = 'library_synced_user_id';

export async function syncLibrary(db, netease, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const isCancelled = typeof options.isCancelled === 'function' ? options.isCancelled : () => false;
  const llmConfig = options.llmConfig;
  const result = {
    mode: 'demo',
    source: 'demo',
    playlists: 0,
    tracks: 0,
    errors: [],
    diagnostics: [],
    user: null,
    syncedPlaylists: 0
  };
  const progress = (patch = {}) => onProgress({
    phase: patch.phase || 'syncing_tracks',
    source: patch.source || result.source,
    syncedTracks: result.tracks,
    syncedPlaylists: result.syncedPlaylists || 0,
    errors: [...result.errors],
    diagnostics: [...result.diagnostics],
    ...patch
  });
  const assertNotCancelled = () => {
    if (!isCancelled()) return;
    const error = new Error('Sync cancelled by newer login state');
    error.code = 'SYNC_CANCELLED';
    throw error;
  };

  progress({ phase: 'checking_login' });
  assertNotCancelled();
  const syncSource = await resolveLibrarySyncSource(db, netease, result);
  assertNotCancelled();
  result.mode = syncSource.mode;
  result.source = syncSource.source;
  result.user = syncSource.user;

  if (syncSource.source === 'demo') {
    progress({ phase: 'syncing_tracks', currentPlaylistIndex: 1, totalPlaylists: 1, currentPlaylistName: 'Demo Library' });
    seedDemoLibrary(db);
    const tracks = listLibraryTracks(db, 100);
    result.tracks = tracks.length;
    result.playlists = 1;
    result.syncedPlaylists = 1;
    progress({ phase: 'updating_profile', syncedTracks: result.tracks, syncedPlaylists: result.syncedPlaylists });
    await updateProfile(db, llmConfig);
    progress({ phase: 'done', syncedTracks: result.tracks, syncedPlaylists: result.syncedPlaylists });
    return result;
  }

  if (syncSource.error) {
    return {
      __error: true,
      ok: false,
      status: 401,
      error: syncSource.error,
      mode: result.mode,
      source: result.source,
      playlists: 0,
      tracks: countLibraryTracks(db),
      errors: [syncSource.error, ...result.errors],
      diagnostics: result.diagnostics,
      user: result.user
    };
  }

  const playlistJobs = [
    ['star', () => netease.starPlaylist()],
    ['subscribed', () => netease.subscribedPlaylists()],
    ['created', () => netease.createdPlaylists()]
  ];

  const playlistRecords = [];
  progress({ phase: 'fetching_playlists', user: result.user });
  assertNotCancelled();
  if (syncSource.source === 'cookie') {
    playlistRecords.push(...await fetchCookiePlaylistRecords(syncSource.client, result.user.userId, result, progress));
  } else {
    for (const [kind, job] of playlistJobs) {
      assertNotCancelled();
      try {
        const response = await job();
        const records = extractPlaylistRecords(response.data);
        result.diagnostics.push(buildPlaylistDiagnostic(kind, response, records));
        playlistRecords.push(...records.map(item => ({ kind, item })));
        progress({ phase: 'fetching_playlists', totalPlaylists: playlistRecords.length });
      } catch (error) {
        result.errors.push(`${kind}: ${error.message}`);
        result.diagnostics.push(buildPlaylistDiagnostic(kind, null, [], error));
        progress({ phase: 'fetching_playlists' });
      }
    }
  }

  if (!playlistRecords.length) {
    const noPlaylistMessage = result.source === 'cookie'
      ? 'Cookie login succeeded but no NetEase playlists were read. Please rescan or check account permissions.'
      : 'Login succeeded but no NetEase playlists were read. Please check account permissions or rescan.';
    return {
      __error: true,
      ok: false,
      status: 502,
      error: noPlaylistMessage,
      mode: result.mode,
      source: result.source,
      playlists: 0,
      tracks: countLibraryTracks(db),
      errors: [noPlaylistMessage, ...result.errors],
      diagnostics: result.diagnostics,
      user: result.user
    };
  }

  const previousSyncedUserId = getSetting(db, LIBRARY_SYNCED_USER_ID_KEY) || '';
  if (result.user.userId && previousSyncedUserId && previousSyncedUserId !== result.user.userId) {
    clearPlaylistLibrary(db);
  }

  const playlistById = new Map();
  for (const { kind, item } of playlistRecords) {
    const playlist = savePlaylist(db, item, kind);
    if (!playlistById.has(playlist.id)) playlistById.set(playlist.id, playlist);
  }
  const playlists = [...playlistById.values()];
  result.playlists = playlists.length;

  for (const playlist of playlists) {
    assertNotCancelled();
    try {
      const currentPlaylistIndex = playlists.indexOf(playlist) + 1;
      progress({
        phase: 'syncing_tracks',
        currentPlaylistIndex,
        totalPlaylists: playlists.length,
        currentPlaylistName: playlist.name,
        currentPlaylistSynced: 0,
        currentPlaylistTotal: playlist.trackCount ?? null
      });
      const records = await fetchAllPlaylistSongs(syncSource.client || netease, playlist, PLAYLIST_SYNC_PAGE_SIZE, ({ synced, total }) => {
        assertNotCancelled();
        progress({
          phase: 'syncing_tracks',
          currentPlaylistIndex,
          totalPlaylists: playlists.length,
          currentPlaylistName: playlist.name,
          currentPlaylistSynced: synced,
          currentPlaylistTotal: total
        });
      });
      const trackIds = records.map((item) => saveTrack(db, item).id);
      replacePlaylistTracks(db, playlist.id, trackIds);
      result.tracks += trackIds.length;
      result.syncedPlaylists += 1;
      progress({
        phase: 'syncing_tracks',
        currentPlaylistIndex,
        totalPlaylists: playlists.length,
        currentPlaylistName: playlist.name,
        currentPlaylistSynced: trackIds.length,
        currentPlaylistTotal: playlist.trackCount ?? trackIds.length,
        syncedTracks: result.tracks,
        syncedPlaylists: result.syncedPlaylists
      });
    } catch (error) {
      result.errors.push(`playlist ${playlist.id}: ${error.message}`);
      progress({ phase: 'syncing_tracks' });
    }
  }

  try {
    assertNotCancelled();
    const response = await (syncSource.client || netease).recentSongs(0, 50);
    const records = extractRecords(response.data);
    records.forEach((item) => {
      const track = saveTrack(db, item);
      db.prepare(`
        INSERT INTO plays (track_id, played_at, source, reason, report_status)
        VALUES (?, ?, ?, ?, ?)
      `).run(track.id, item.playTime ? new Date(Number(item.playTime)).toISOString() : nowIso(), 'netease-recent', 'netease recent play', 'imported');
    });
  } catch (error) {
    result.errors.push(`recent: ${error.message}`);
  }

  result.tracks = countLibraryTracks(db);
  progress({ phase: 'updating_profile', syncedTracks: result.tracks, syncedPlaylists: result.syncedPlaylists });
  await updateProfile(db, llmConfig);
  if (result.user.userId) setSetting(db, LIBRARY_SYNCED_USER_ID_KEY, result.user.userId);
  progress({ phase: 'done', syncedTracks: result.tracks, syncedPlaylists: result.syncedPlaylists });
  return result;
}

async function resolveLibrarySyncSource(db, netease, result) {
  const hasCookie = hasCommunityCookie();
  if (hasCookie) {
    try {
      const profile = await getCookieUserProfile();
      setSetting(db, 'netease_user_id', profile.userId);
      setSetting(db, 'netease_user_nickname', profile.nickname || '');
      setSetting(db, 'netease_login_checked_at', nowIso());
      setSetting(db, 'netease_login_source', 'cookie');
      result.diagnostics.push({
        kind: 'cookie_login',
        ok: true,
        recordCount: 1,
        message: profile.nickname || profile.userId,
        dataKeys: ['profile', 'account']
      });
      return {
        source: 'cookie',
        mode: 'cookie',
        user: profile,
        client: createCookieLibraryClient()
      };
    } catch (error) {
      result.diagnostics.push({
        kind: 'cookie_login',
        ok: false,
        recordCount: 0,
        message: error.message,
        dataKeys: []
      });
      return {
        source: 'cookie',
        mode: 'cookie',
        user: null,
        error: `网易云试用版扫码登录状态异常，请在设置页重新扫码：${error.message}`
      };
    }
  }

  if (!netease.isConfigured()) {
    return {
      source: 'demo',
      mode: 'demo',
      user: null
    };
  }

  if (typeof netease.hasToken === 'function' && !netease.hasToken()) {
    return {
      source: 'openapi',
      mode: 'netease',
      user: null,
      error: '请先在设置页扫码登录网易云'
    };
  }

  const login = await getNeteaseLoginStatus({ db, netease });
  const user = {
    userId: login.userId || '',
    nickname: login.nickname || ''
  };
  if (!login.profileReadable) {
    return {
      source: 'openapi',
      mode: 'netease',
      user,
      error: login.message || 'Please rescan NetEase login.'
    };
  }
  setSetting(db, 'netease_login_source', 'openapi');
  return {
    source: 'openapi',
    mode: 'netease',
    user,
    client: netease
  };
}

function createCookieLibraryClient() {
  return {
    userPlaylists: communityUserPlaylists,
    playlistSongs: communityPlaylistTrackAll,
    recentSongs: communityRecentSongs
  };
}

async function fetchCookiePlaylistRecords(client, userId, result, progress) {
  const records = [];
  const limit = 1000;
  let offset = 0;
  let pageCount = 0;
  while (true) {
    const response = await client.userPlaylists(userId, offset, limit);
    const pageRecords = extractPlaylistRecords(response.data);
    records.push(...pageRecords.map(item => ({ kind: classifyCookiePlaylist(item, userId), item })));
    pageCount += 1;
    progress({ phase: 'fetching_playlists', totalPlaylists: records.length });
    const more = Boolean(response.data?.more);
    if (!pageRecords.length || pageRecords.length < limit || !more) break;
    offset += pageRecords.length;
  }
  result.diagnostics.push({
    kind: 'cookie_user_playlist',
    ok: true,
    recordCount: records.length,
    message: `${pageCount} page(s)`,
    dataKeys: ['playlist', 'more']
  });
  return records;
}

function classifyCookiePlaylist(playlist = {}, userId = '') {
  if (Number(playlist.specialType) === 5) return 'star';
  const ownerId = playlist.userId ?? playlist.creator?.userId ?? playlist.creatorId;
  if (String(ownerId || '') === String(userId || '')) return 'created';
  if (playlist.subscribed === true || playlist.ordered === true) return 'subscribed';
  return 'playlist';
}

export async function updateProfile(db, llmConfig) {
  // Only analyze tracks the user actually synced from NetEase playlists (not AI recs or test searches)
  const profileSelection = getProfileSelection(db);
  const playlists = getProfilePlaylists(db, { selectedOnly: true });
  const tracks = dedupePlaylistTracks(playlists);
  const stats = buildProfileStats(tracks, playlists);
  stats.selectedPlaylistIds = profileSelection.selectedIds;
  stats.excludedPlaylistIds = profileSelection.excludedIds;
  let structured = buildFallbackStructuredProfile(stats);
  let summary = structured.summary;
  const tags = inferTags(tracks);

  if (!stats.trackCount || !stats.playlistCount) {
    structured = normalizeStructuredProfile({ summary: EMPTY_PROFILE_SUMMARY }, stats);
    db.prepare(`
      INSERT INTO music_profile (id, summary, tags_json, profile_json, updated_at)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        summary = excluded.summary,
        tags_json = excluded.tags_json,
        profile_json = excluded.profile_json,
        updated_at = excluded.updated_at
    `).run(EMPTY_PROFILE_SUMMARY, JSON.stringify([]), JSON.stringify(structured), nowIso());
    return {
      summary: EMPTY_PROFILE_SUMMARY,
      tags: [],
      structured,
      topArtists: [],
      topAlbums: [],
      trackCount: 0
    };
  }

  // LLM enriched profile 闂?only regenerate when needed
  const existing = getProfile(db);
  const lastUpdated = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
  const hoursSinceUpdate = (Date.now() - lastUpdated) / 3600000;
  const previousCount = Number(existing?.structured?.trackCount || 0);
  const sourceChanged = !sameStringSet(existing?.structured?.selectedPlaylistIds, stats.selectedPlaylistIds);
  const trackCountChanged = previousCount
    ? Math.abs(stats.trackCount - previousCount) > Math.max(10, stats.trackCount * 0.05)
    : true;
  const missingStructured = !existing?.structured || !Object.keys(existing.structured || {}).length;

  if (llmConfig?.baseUrl && (hoursSinceUpdate > 24 || trackCountChanged || sourceChanged || missingStructured || existing.summary.length < 150)) {
    const enriched = await generateAIPortrait(stats, llmConfig);
    if (enriched) {
      structured = normalizeStructuredProfile({ ...structured, ...enriched.structured, summary: enriched.summary || structured.summary }, stats);
      summary = enriched.summary || structured.summary;
    }
  } else if (!sourceChanged && existing?.summary && existing.summary.length > 50 && existing?.structured) {
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
  const sample = stats.sampleTracks.map(t => `${t.name} - ${(t.artists || []).join('/')}`).join(', ');
  const playlistText = stats.playlistProfiles.map(p =>
    `${p.name} (${p.kind}, ${p.trackCount} tracks): ${p.sampleTracks.map(t => `${t.name}-${(t.artists || []).join('/')}`).join(', ')}`
  ).join('\n');

  const text = await generateChatCompletion(llmConfig, [
    {
      role: 'system',
      content: [
        'You are a music profile analyst. Return strict JSON only, no markdown.',
        'Summarize the user music taste from playlist statistics and sampled tracks.',
        'JSON schema: {"summary":"20-400 Chinese chars","genres":[{"name":"...","weight":0-1,"evidence":["..."]}],"moods":[...],"artists":[...],"albums":[...],"languages":[...],"scenes":[...],"eras":[...],"energy":[...],"discoveryDirections":[{"name":"...","weight":0-1,"evidence":["..."]}],"avoidSignals":[{"name":"...","weight":0-1,"evidence":["..."]}]}'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `Track count: ${stats.trackCount}; playlist count: ${stats.playlistCount}`,
        `Top artists: ${stats.topArtists.map(item => `${item.name}(${item.count})`).join(', ')}`,
        `Top albums: ${stats.topAlbums.map(item => `${item.name}(${item.count})`).join(', ')}`,
        `Rule signals: ${JSON.stringify(stats.ruleSignals)}`,
        `Playlist samples: ${playlistText}`,
        `Track samples: ${sample}`
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
  if (!row) return { summary: 'No music profile generated yet.', tags: [], structured: {}, updatedAt: null };
  return {
    summary: row.summary,
    tags: safeJson(row.tagsJson, []),
    structured: safeJson(row.profileJson, {}),
    updatedAt: row.updatedAt
  };
}

export function getLibrary(db) {
  const playlists = getLibraryPlaylists(db);
  const profileSelection = getProfileSelection(db, playlists);
  const selectedIds = new Set(profileSelection.selectedIds);
  const loginUserId = getSetting(db, 'netease_user_id') || '';
  const loginNickname = getSetting(db, 'netease_user_nickname') || '';
  const loginSource = getSetting(db, 'netease_login_source') || '';
  const syncedUserId = getSetting(db, LIBRARY_SYNCED_USER_ID_KEY) || '';
  return {
    profile: getProfile(db),
    tracks: listLibraryTracks(db, 5000),
    playlists: playlists.map((playlist) => ({
      ...playlist,
      profileSelected: selectedIds.has(playlist.id)
    })),
    recent: listRecentPlays(db, 50),
    totalTracks: countLibraryTracks(db),
    totalPlaylistTracks: countPlaylistTrackLinks(db),
    profileSelection,
    account: {
      userId: loginUserId,
      nickname: loginNickname,
      source: loginSource,
      syncedUserId,
      accountMismatch: Boolean(loginUserId && syncedUserId && loginUserId !== syncedUserId)
    }
  };
}

export function updateProfilePlaylistSelection(db, selectedPlaylistIds = []) {
  setProfilePlaylistSelection(db, selectedPlaylistIds);
  return getLibrary(db);
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

function extractPlaylistRecords(data) {
  const records = extractRecords(data);
  if (records.length) return records;
  if (isPlaylistLike(data)) return [data];
  if (isPlaylistLike(data?.playlist)) return [data.playlist];
  return [];
}

function buildPlaylistDiagnostic(kind, response, records = [], error = null) {
  const data = response?.data ?? response ?? {};
  const dataObject = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return {
    kind,
    ok: !error,
    recordCount: records.length,
    message: error?.message || dataObject.message || dataObject.msg || response?.message || response?.msg || '',
    dataKeys: Object.keys(dataObject).slice(0, 12)
  };
}

function isPlaylistLike(item) {
  return Boolean(item && typeof item === 'object' && !Array.isArray(item) && (
    item.id !== undefined ||
    item.playlistId !== undefined ||
    item.resourceId !== undefined ||
    item.coverId !== undefined
  ));
}

async function fetchAllPlaylistSongs(netease, playlist, pageSize = PLAYLIST_SYNC_PAGE_SIZE, onPage = null) {
  const expectedCount = getPlaylistRemoteTrackCount(playlist);
  const records = [];
  let offset = 0;
  while (true) {
    if (expectedCount !== null && offset >= expectedCount) break;
    const response = await netease.playlistSongs(playlist.id, offset, pageSize);
    const pageRecords = extractRecords(response.data);
    if (!pageRecords.length) break;
    records.push(...pageRecords);
    if (typeof onPage === 'function') {
      onPage({ synced: records.length, total: expectedCount ?? null, offset, pageSize });
    }
    offset += pageRecords.length;
    if (pageRecords.length < pageSize) break;
  }
  return records;
}

function getProfilePlaylists(db, { selectedOnly = false } = {}) {
  const playlists = getLibraryPlaylists(db);
  const profileSelection = getProfileSelection(db, playlists);
  const selectedIds = new Set(profileSelection.selectedIds);
  const scopedPlaylists = selectedOnly
    ? playlists.filter((playlist) => selectedIds.has(playlist.id))
    : playlists;
  const trackStmt = db.prepare(`
    SELECT t.id, t.name, t.artists, t.album, t.cover_url AS coverUrl, t.duration_ms AS durationMs, t.raw_json AS rawJson
    FROM playlist_tracks pt
    JOIN tracks t ON t.id = pt.track_id
    WHERE pt.playlist_id = ?
    ORDER BY pt.position ASC
  `);
  return scopedPlaylists.map((playlist) => ({
    ...playlist,
    profileSelected: selectedIds.has(playlist.id),
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

function getLibraryPlaylists(db) {
  return db.prepare(`
    SELECT p.id, p.name, p.kind, p.cover_url AS coverUrl, p.raw_json AS rawJson, COUNT(pt.track_id) AS syncedTrackCount
    FROM playlists p
    LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
    GROUP BY p.id, p.name, p.kind, p.cover_url, p.raw_json, p.updated_at
    ORDER BY p.updated_at DESC
  `).all().map((playlist) => {
    const { rawJson, ...base } = playlist;
    const raw = safeJson(rawJson, {});
    const remoteCount = getPlaylistRemoteTrackCount(raw);
    const syncedTrackCount = Number(playlist.syncedTrackCount) || 0;
    const trackCount = remoteCount ?? syncedTrackCount;
    return {
      ...base,
      trackCount,
      syncedTrackCount,
      syncComplete: remoteCount === null ? true : syncedTrackCount >= remoteCount
    };
  });
}

function countLibraryTracks(db) {
  return db.prepare('SELECT COUNT(DISTINCT track_id) AS count FROM playlist_tracks').get().count;
}

function countPlaylistTrackLinks(db) {
  return db.prepare('SELECT COUNT(*) AS count FROM playlist_tracks').get().count;
}

function listLibraryTracks(db, limit = 5000) {
  return db.prepare(`
    SELECT t.id, t.name, t.artists, t.album, t.cover_url AS coverUrl, t.duration_ms AS durationMs,
           t.raw_json AS rawJson, MIN(pt.position) AS firstPosition, MAX(p.updated_at) AS playlistUpdatedAt
    FROM playlist_tracks pt
    JOIN tracks t ON t.id = pt.track_id
    JOIN playlists p ON p.id = pt.playlist_id
    GROUP BY t.id, t.name, t.artists, t.album, t.cover_url, t.duration_ms, t.raw_json
    ORDER BY playlistUpdatedAt DESC, firstPosition ASC, t.name ASC
    LIMIT ?
  `).all(limit).map(hydrateLibraryTrackRow);
}

function hydrateLibraryTrackRow(row) {
  const raw = safeJson(row.rawJson, {});
  const rawOriginalId = raw?.originalId ?? raw?.song?.originalId ?? raw?.track?.originalId ?? null;
  const playUrl = typeof raw?.playUrl === 'string' && raw.playUrl ? raw.playUrl : null;
  const { rawJson, firstPosition, playlistUpdatedAt, ...track } = row;
  return {
    ...track,
    originalId: rawOriginalId === null || rawOriginalId === undefined || rawOriginalId === '' ? null : String(rawOriginalId),
    playbackMode: rawOriginalId ? 'ncm-cli' : null,
    playable: Boolean(rawOriginalId),
    playUrl,
    artists: safeJson(row.artists, [])
  };
}

function getProfileSelection(db, playlists = getLibraryPlaylists(db)) {
  const playlistIds = normalizeIdList(playlists.map((playlist) => playlist.id));
  const excludedIds = normalizeIdList(safeJson(getSetting(db, PROFILE_EXCLUDED_PLAYLIST_IDS_KEY), []))
    .filter((id) => playlistIds.includes(id));
  const excludedSet = new Set(excludedIds);
  const selectedIds = playlistIds.filter((id) => !excludedSet.has(id));
  return {
    selectedIds,
    excludedIds,
    selectedCount: selectedIds.length,
    totalCount: playlistIds.length
  };
}

function getPlaylistRemoteTrackCount(playlist = {}) {
  const value = playlist.trackCount
    ?? playlist.songCount
    ?? playlist.count
    ?? playlist.resourceCount
    ?? playlist.musicCount
    ?? playlist.size
    ?? playlist.playlist?.trackCount;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

function setProfilePlaylistSelection(db, selectedPlaylistIds = []) {
  const playlistIds = normalizeIdList(getLibraryPlaylists(db).map((playlist) => playlist.id));
  const selectedSet = new Set(normalizeIdList(selectedPlaylistIds));
  const excludedIds = playlistIds.filter((id) => !selectedSet.has(id));
  setSetting(db, PROFILE_EXCLUDED_PLAYLIST_IDS_KEY, JSON.stringify(excludedIds));
  return getProfileSelection(db);
}

function dedupePlaylistTracks(playlists = []) {
  const byId = new Map();
  for (const playlist of playlists) {
    for (const track of playlist.tracks || []) {
      const id = String(track?.id || '').trim();
      if (id && !byId.has(id)) byId.set(id, track);
    }
  }
  return [...byId.values()];
}

function normalizeIdList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function countTop(values = [], limit = 10) {
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

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const leftIds = normalizeIdList(left).sort();
  const rightIds = normalizeIdList(right).sort();
  return leftIds.length === rightIds.length && leftIds.every((id, index) => id === rightIds[index]);
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
  const artists = stats.topArtists.slice(0, 12).map((item) => ({
    name: item.name,
    weight: weightedByCount(item.count, stats.trackCount),
    evidence: [`Appears in ${item.count} synced playlist tracks`]
  }));
  const albums = stats.topAlbums.slice(0, 10).map((item) => ({
    name: item.name,
    weight: weightedByCount(item.count, stats.trackCount),
    evidence: [`Appears in ${item.count} synced playlist tracks`]
  }));
  const discoveryDirections = normalizeWeightedList([
    ...genres.slice(0, 4).map(item => ({ ...item, evidence: [...(item.evidence || []), 'Derived from playlist genre signals'] })),
    ...moods.slice(0, 3).map(item => ({ ...item, evidence: [...(item.evidence || []), 'Derived from playlist mood signals'] })),
    ...scenes.slice(0, 3).map(item => ({ ...item, evidence: [...(item.evidence || []), 'Derived from listening scene signals'] }))
  ]).slice(0, 8);
  const topArtistText = artists.slice(0, 4).map(item => item.name).join(', ') || 'mixed artists';
  const topMoodText = moods.slice(0, 3).map(item => item.name).join(', ') || 'mixed moods';
  const summary = stats.trackCount
    ? `Based on ${stats.trackCount} synced playlist tracks, this profile leans toward ${topArtistText}, with mood signals around ${topMoodText}.`
    : EMPTY_PROFILE_SUMMARY;

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
    selectedPlaylistIds: normalizeIdList(stats.selectedPlaylistIds || profile.selectedPlaylistIds),
    excludedPlaylistIds: normalizeIdList(stats.excludedPlaylistIds || profile.excludedPlaylistIds),
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
      evidence: [`Appears in ${item.count} synced playlist tracks`]
    }));
  }
  if (!normalized.albums.length && stats.topAlbums?.length) {
    normalized.albums = stats.topAlbums.slice(0, 10).map(item => ({
      name: item.name,
      weight: weightedByCount(item.count, stats.trackCount),
      evidence: [`Appears in ${item.count} synced playlist tracks`]
    }));
  }
  if (!normalized.summary) {
    const artistText = normalized.artists.slice(0, 4).map(item => item.name).join(', ') || 'mixed artists';
    normalized.summary = normalized.trackCount
      ? `Based on ${normalized.trackCount} synced playlist tracks, the profile leans toward ${artistText}.`
      : EMPTY_PROFILE_SUMMARY;
  }
  return normalized;
}

function inferRuleSignals(tracks, playlists = []) {
  const baseText = [
    ...tracks.flatMap(track => [track.name, track.album, ...(track.artists || [])]),
    ...playlists.map(playlist => playlist.name)
  ].filter(Boolean).join(' ').toLowerCase();
  const count = tracks.length || 1;
  return {
    genres: scoreRuleSignals(baseText, [
      ['pop', /pop|娴佽|鍗庤|chinese/gi],
      ['electronic', /electronic|edm|鐢甸煶|鐢靛瓙/gi],
      ['soundtrack', /ost|soundtrack|鍘熷０|鍔ㄦ极|娓告垙/gi],
      ['folk', /folk|姘戣埃/gi],
      ['classical', /classical|piano|閽㈢惔|鍙ゅ吀/gi]
    ], count),
    moods: scoreRuleSignals(baseText, [
      ['calm', /calm|quiet|瀹夐潤|娌绘剤|娓╂煍/gi],
      ['nostalgic', /nostalgia|鎬€鏃鍥炲繂/gi],
      ['sad', /sad|浼ゆ劅|emo|闅捐繃/gi],
      ['bright', /happy|寮€蹇億蹇箰|鍏冩皵/gi]
      ['romantic', /love|romantic|鐖辨儏|娴极/gi]
    ], count),
    languages: scoreRuleSignals(baseText, [
      ['Chinese', /鍗庤|涓枃|鍥借|绮よ/gi],
      ['English', /english|娆х編|ed sheeran|taylor|charlie puth/gi],
      ['Japanese', /japanese|鏃ヨ|jpop|anime|鍔ㄦ极/gi]
    ], count),
    scenes: scoreRuleSignals(baseText, [
      ['night', /night|娣卞|澶滄櫄|鐫″墠/gi],
      ['focus', /focus|study|瀛︿範|涓撴敞/gi],
      ['commute', /drive|commute|閫氬嫟/gi],
      ['relax', /relax|鏀炬澗|chill/gi]
    ], count),
    eras: scoreRuleSignals(baseText, [
      ['2010s', /2010|2011|2012|2013|2014|2015|2016|2017|2018|2019/gi],
      ['2020s', /2020|2021|2022|2023|2024|2025|2026/gi]
    ], count),
    energy: scoreRuleSignals(baseText, [
      ['low', /quiet|calm|piano|瀹夐潤|杞绘煍/gi],
      ['medium', /pop|娴佽|鍗庤/gi],
      ['high', /edm|rock|鐕億杩愬姩|鐢甸煶/gi]
    ], count)
  };
}

function scoreRuleSignals(text, rules, trackCount) {
  return rules.filter(Array.isArray).map(([name, pattern]) => {
    if (!(pattern instanceof RegExp)) return null;
    const flags = new Set(String(pattern.flags || '').split('').filter(Boolean));
    flags.add('g');
    flags.add('i');
    const matches = text.match(new RegExp(pattern.source, [...flags].join(''))) || [];
    return {
      name,
      weight: clampWeight(matches.length / Math.max(trackCount, 1) * 8),
      evidence: matches.length ? [`${matches.length} text matches`] : []
    };
  }).filter(item => item?.weight > 0).sort((a, b) => b.weight - a.weight);
}

function normalizeWeightedList(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === 'string') return { name: item, weight: 0.5, evidence: [] };
      return {
        name: String(item?.name || '').trim(),
        weight: clampWeight(item?.weight ?? item?.score ?? 0.5),
        evidence: Array.isArray(item?.evidence) ? item.evidence.map(String).slice(0, 5) : []
      };
    })
    .filter(item => item.name)
    .sort((a, b) => b.weight - a.weight);
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
  if (/pop|流行|华语|chinese/.test(names)) tags.push('华语流行');
  if (/live|现场|concert/.test(names)) tags.push('现场');
  if (/lofi|jazz|chill|安静|治愈/.test(names)) tags.push('放松');
  if (/rock|punk|摇滚/.test(names)) tags.push('能量');
  if (/classic|piano|古典|钢琴/.test(names)) tags.push('古典/器乐');
  if (!tags.length) tags.push('私人曲库');
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
      lyric: '[00:00.00] Pure music, please enjoy.',
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
    playbackError: (url || normalized.originalId) ? null : 'No playable URL found.',
    lyric: lyric || ''
  };
}
