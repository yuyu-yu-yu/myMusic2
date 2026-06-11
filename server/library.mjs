import { deleteAccountSettings, getAccountSetting, getSetting, listRecentPlays, normalizeTrack, nowIso, replacePlaylistTracks, savePlaylist, saveTrack, seedDemoLibrary, setAccountSetting, setSetting } from './db.mjs';
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
import { normalizeAccountContext, resolveAccountContext } from './account-scope.mjs';

const PROFILE_EXCLUDED_PLAYLIST_IDS_KEY = 'profile_excluded_playlist_ids';
const EMPTY_PROFILE_SUMMARY = '尚未选择用于生成音乐画像的歌单。';
const UNSYNCED_ACCOUNT_SUMMARY = '当前音乐账号尚未同步歌单。';
const PLAYLIST_SYNC_PAGE_SIZE = 200;
const LIBRARY_SYNCED_USER_ID_KEY = 'library_synced_user_id';
const LIBRARY_SYNCED_PLAYLIST_IDS_KEY = 'library_synced_playlist_ids';

export async function syncLibrary(db, netease, options = {}) {
  let accountContext = getLibraryAccountContext(db, options.accountContext);
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
  clearLibraryAccountSnapshot(db, accountContext);
  result.tracks = 0;
  result.syncedPlaylists = 0;
  result.diagnostics.push({
    kind: 'account_library_reset',
    ok: true,
    recordCount: 0,
    message: '开始同步当前账号前，已清理旧歌单快照。',
    dataKeys: []
  });

  const syncSource = await resolveLibrarySyncSource(db, netease, result);
  assertNotCancelled();
  result.mode = syncSource.mode;
  result.source = syncSource.source;
  result.user = syncSource.user;
  accountContext = accountContextFromSyncSource(syncSource, accountContext);
  clearLibraryAccountSnapshot(db, accountContext);

  if (syncSource.source === 'demo') {
    progress({ phase: 'syncing_tracks', currentPlaylistIndex: 1, totalPlaylists: 1, currentPlaylistName: 'Demo Library' });
    seedDemoLibrary(db);
    setActiveLibraryPlaylistIds(db, ['demo-liked'], accountContext);
    const tracks = listLibraryTracks(db, 100, accountContext);
    result.tracks = tracks.length;
    result.playlists = 1;
    result.syncedPlaylists = 1;
    progress({ phase: 'updating_profile', syncedTracks: result.tracks, syncedPlaylists: result.syncedPlaylists });
    await updateProfile(db, llmConfig, { accountContext });
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
      tracks: countLibraryTracks(db, accountContext),
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
        result.errors.push(`${kind}: ${formatErrorMessage(error, '音乐歌单列表接口失败')}`);
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
      tracks: countLibraryTracks(db, accountContext),
      errors: [noPlaylistMessage, ...result.errors],
      diagnostics: result.diagnostics,
      user: result.user
    };
  }

  const playlistById = new Map();
  for (const { kind, item } of playlistRecords) {
    const playlist = savePlaylist(db, item, kind);
    if (!playlistById.has(playlist.id)) playlistById.set(playlist.id, playlist);
  }
  pruneStalePlaylists(db, playlistById.keys());
  const playlists = [...playlistById.values()];
  result.playlists = playlists.length;
  setActiveLibraryPlaylistIds(db, playlists.map((playlist) => playlist.id), accountContext);

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
      result.tracks = countLibraryTracks(db, accountContext);
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
      result.errors.push(formatPlaylistSyncError(playlist, error));
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
        INSERT INTO plays (account_id, track_id, played_at, source, reason, report_status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(accountContext.accountId, track.id, item.playTime ? new Date(Number(item.playTime)).toISOString() : nowIso(), 'netease-recent', 'netease recent play', 'imported');
    });
  } catch (error) {
    result.errors.push(`最近播放同步失败：${formatErrorMessage(error, '音乐最近播放接口失败')}`);
  }

  result.tracks = countLibraryTracks(db, accountContext);
  progress({ phase: 'updating_profile', syncedTracks: result.tracks, syncedPlaylists: result.syncedPlaylists });
  await updateProfile(db, llmConfig, { accountContext });
  if (result.user.userId) setAccountSetting(db, accountContext.accountId, LIBRARY_SYNCED_USER_ID_KEY, result.user.userId);
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
        error: `音乐试用版扫码登录状态异常，请在设置页重新扫码：${error.message}`
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
      error: '请先在设置页扫码登录音乐'
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

export async function updateProfile(db, llmConfig, options = {}) {
  const accountContext = getLibraryAccountContext(db, options.accountContext);
  const force = Boolean(options.force);
  // Only analyze tracks the user actually synced from NetEase playlists (not AI recs or test searches)
  const profileSelection = getProfileSelection(db, undefined, accountContext);
  const playlists = getProfilePlaylists(db, { selectedOnly: true }, accountContext);
  const tracks = dedupePlaylistTracks(playlists);
  const stats = buildProfileStats(tracks, playlists);
  stats.selectedPlaylistIds = profileSelection.selectedIds;
  stats.excludedPlaylistIds = profileSelection.excludedIds;
  let structured = buildFallbackStructuredProfile(stats);
  let summary = structured.summary;
  const tags = inferTags(tracks);

  if (!stats.trackCount || !stats.playlistCount) {
    structured = normalizeStructuredProfile({ summary: EMPTY_PROFILE_SUMMARY }, stats);
    saveMusicProfile(db, accountContext, EMPTY_PROFILE_SUMMARY, [], structured);
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
  const existing = getProfile(db, accountContext);
  const lastUpdated = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
  const hoursSinceUpdate = (Date.now() - lastUpdated) / 3600000;
  const previousCount = Number(existing?.structured?.trackCount || 0);
  const sourceChanged = !sameStringSet(existing?.structured?.selectedPlaylistIds, stats.selectedPlaylistIds);
  const trackCountChanged = previousCount
    ? Math.abs(stats.trackCount - previousCount) > Math.max(10, stats.trackCount * 0.05)
    : true;
  const missingStructured = !existing?.structured || !Object.keys(existing.structured || {}).length;

  if (llmConfig?.baseUrl && (force || hoursSinceUpdate > 24 || trackCountChanged || sourceChanged || missingStructured || existing.summary.length < 150)) {
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

  saveMusicProfile(db, accountContext, summary, tags, structured);
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
        '你是 AI 私人电台的音乐画像撰写者。只返回严格 JSON，不要 markdown。',
        '根据歌单名称、艺人、专辑、曲风、场景和抽样歌曲，写一份有审美、有画面感的中文音乐人格画像。',
        'summary 必须是 180-320 个中文字符，写成一段完整自然的画像文案，像私人电台在描述这个人的音乐世界。',
        'summary 必须包含：核心曲风/审美、代表艺人或作品线索、常见听歌场景、情绪气质、后续探索方向。',
        '不要写成冷冰冰的数据报告；禁止用“用户以”“该用户”“数据显示”“从数据看”“偏好为”开头。',
        '可以有一点文学感，但所有判断都必须来自输入证据，不要编造不存在的艺人或歌单。',
        '所有 name 字段用于前端标签展示，要短、清楚、有质感；优先中文或“中文/英文”组合，例如“华语流行/独立”“影视/游戏原声”“夜晚/宁静”。',
        'Also return llmProfile for recommendation prompts. llmProfile.summary must be objective and must not contain concrete artist names, song names, or album names.',
        'JSON schema: {"summary":"180-320 Chinese chars for user display","llmProfile":{"summary":"objective preference summary without concrete artist/song/album names"},"genres":[{"name":"...","weight":0-1,"evidence":["..."]}],"moods":[...],"artists":[...],"albums":[...],"languages":[...],"scenes":[...],"eras":[...],"energy":[...],"discoveryDirections":[{"name":"...","weight":0-1,"evidence":["..."]}],"avoidSignals":[{"name":"...","weight":0-1,"evidence":["..."]}]}'
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

function saveMusicProfile(db, accountContext, summary, tags, structured) {
  const account = getLibraryAccountContext(db, accountContext);
  const updatedAt = nowIso();
  const tagsJson = JSON.stringify(tags || []);
  const profileJson = JSON.stringify(structured || {});
  db.prepare(`
    INSERT INTO account_music_profiles (account_id, summary, tags_json, profile_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET
      summary = excluded.summary,
      tags_json = excluded.tags_json,
      profile_json = excluded.profile_json,
      updated_at = excluded.updated_at
  `).run(account.accountId, summary, tagsJson, profileJson, updatedAt);
  db.prepare(`
    INSERT INTO music_profile (id, summary, tags_json, profile_json, updated_at)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      summary = excluded.summary,
      tags_json = excluded.tags_json,
      profile_json = excluded.profile_json,
      updated_at = excluded.updated_at
  `).run(summary, tagsJson, profileJson, updatedAt);
}

function getLibraryAccountContext(db, accountContext = null) {
  return accountContext ? normalizeAccountContext(accountContext) : resolveAccountContext(db);
}

function accountContextFromSyncSource(syncSource = {}, fallbackContext = {}) {
  const userId = String(syncSource.user?.userId || fallbackContext.providerUserId || '').trim();
  if (!userId) return normalizeAccountContext(fallbackContext);
  const source = syncSource.source === 'cookie' ? 'cookie' : (syncSource.source === 'openapi' ? 'openapi' : fallbackContext.source);
  if (source !== 'cookie' && source !== 'openapi') return normalizeAccountContext(fallbackContext);
  return normalizeAccountContext({
    accountId: `netease:${source}:${userId}`,
    provider: 'netease',
    providerUserId: userId,
    source,
    nickname: syncSource.user?.nickname || fallbackContext.nickname || '',
    isAuthenticated: true,
    cloudAccountId: fallbackContext.cloudAccountId || ''
  });
}

function getScopedLibrarySetting(db, accountContext, key) {
  const account = getLibraryAccountContext(db, accountContext);
  const scoped = getAccountSetting(db, account.accountId, key);
  return scoped ?? getSetting(db, key);
}

export function getProfile(db, accountContext = null) {
  const account = getLibraryAccountContext(db, accountContext);
  if (!hasCurrentAccountSnapshot(db, account)) return emptyProfile(UNSYNCED_ACCOUNT_SUMMARY);
  const row = db.prepare('SELECT summary, tags_json AS tagsJson, profile_json AS profileJson, updated_at AS updatedAt FROM account_music_profiles WHERE account_id = ?').get(account.accountId)
    || db.prepare('SELECT summary, tags_json AS tagsJson, profile_json AS profileJson, updated_at AS updatedAt FROM music_profile WHERE id = 1').get();
  if (!row) return { summary: '尚未生成音乐画像，请先同步当前音乐账号歌单。', tags: [], structured: {}, updatedAt: null };
  return {
    summary: row.summary,
    tags: safeJson(row.tagsJson, []),
    structured: safeJson(row.profileJson, {}),
    updatedAt: row.updatedAt
  };
}

export function getLibrary(db, accountContext = null) {
  const accountContextResolved = getLibraryAccountContext(db, accountContext);
  const account = getCurrentLibraryAccount(db, accountContextResolved);
  const loginUserId = account.userId;
  const loginNickname = account.nickname;
  const loginSource = account.source;
  const syncedUserId = getScopedLibrarySetting(db, accountContextResolved, LIBRARY_SYNCED_USER_ID_KEY) || '';
  if (!hasCurrentAccountSnapshot(db, accountContextResolved)) {
    return {
      profile: emptyProfile(UNSYNCED_ACCOUNT_SUMMARY),
      tracks: [],
      playlists: [],
      recent: [],
      totalTracks: 0,
      totalPlaylistTracks: 0,
      profileSelection: { selectedIds: [], excludedIds: [], selectedCount: 0, totalCount: 0 },
      account: {
        userId: loginUserId,
        nickname: loginNickname,
        source: loginSource,
        syncedUserId,
        accountMismatch: Boolean(loginUserId && syncedUserId && loginUserId !== syncedUserId),
        needsSync: Boolean(loginUserId)
      }
    };
  }
  const playlists = getLibraryPlaylists(db, accountContextResolved);
  const profileSelection = getProfileSelection(db, playlists, accountContextResolved);
  const selectedIds = new Set(profileSelection.selectedIds);
  return {
    profile: getProfile(db, accountContextResolved),
    tracks: listLibraryTracks(db, 5000, accountContextResolved),
    playlists: playlists.map((playlist) => ({
      ...playlist,
      profileSelected: selectedIds.has(playlist.id)
    })),
    recent: listRecentPlays(db, 50, accountContextResolved.accountId),
    totalTracks: countLibraryTracks(db, accountContextResolved),
    totalPlaylistTracks: countPlaylistTrackLinks(db, accountContextResolved),
    profileSelection,
    account: {
      userId: loginUserId,
      nickname: loginNickname,
      source: loginSource,
      syncedUserId,
      accountMismatch: Boolean(loginUserId && syncedUserId && loginUserId !== syncedUserId),
      needsSync: Boolean(loginUserId && syncedUserId !== loginUserId)
    }
  };
}

export function listProfileFallbackTracks(db, limit = 180, accountContext = null) {
  const account = getLibraryAccountContext(db, accountContext);
  const playlists = getProfilePlaylists(db, { selectedOnly: true }, account);
  const tracks = [];
  const seen = new Set();
  for (const playlist of playlists) {
    for (const [index, track] of (playlist.tracks || []).entries()) {
      const id = String(track?.id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const originalId = extractTrackOriginalId(track);
      tracks.push({
        ...track,
        originalId,
        playbackMode: originalId ? 'ncm-cli' : track.playbackMode || null,
        playable: Boolean(originalId || track.playable),
        playlistId: playlist.id,
        playlistName: playlist.name,
        playlistKind: playlist.kind,
        playlistPosition: index
      });
      if (tracks.length >= limit) return tracks;
    }
  }
  return tracks;
}

export function clearLibraryAccountSnapshot(db, accountContext = null) {
  const account = getLibraryAccountContext(db, accountContext);
  const activeIds = getActiveLibraryPlaylistIds(db, account) || [];
  if (activeIds.length) {
    const placeholders = activeIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM playlist_tracks WHERE playlist_id IN (${placeholders})`).run(...activeIds);
  } else if (getSetting(db, LIBRARY_SYNCED_USER_ID_KEY) && getSetting(db, LIBRARY_SYNCED_USER_ID_KEY) === account.providerUserId) {
    db.prepare('DELETE FROM playlist_tracks').run();
  }
  db.prepare('DELETE FROM account_music_profiles WHERE account_id = ?').run(account.accountId);
  db.prepare('DELETE FROM music_profile WHERE id = 1').run();
  deleteAccountSettings(db, account.accountId, [
    PROFILE_EXCLUDED_PLAYLIST_IDS_KEY,
    LIBRARY_SYNCED_USER_ID_KEY,
    LIBRARY_SYNCED_PLAYLIST_IDS_KEY
  ]);
}

function isCurrentAccountSnapshotUsable(db, accountContext = null) {
  const account = getLibraryAccountContext(db, accountContext);
  const loginUserId = getCurrentLibraryAccount(db, account).userId;
  if (!loginUserId) return true;
  const syncedUserId = getScopedLibrarySetting(db, account, LIBRARY_SYNCED_USER_ID_KEY) || '';
  return Boolean(syncedUserId && syncedUserId === loginUserId);
}

function hasCurrentAccountSnapshot(db, accountContext = null) {
  const account = getLibraryAccountContext(db, accountContext);
  if (!isCurrentAccountSnapshotUsable(db, account)) return false;
  const loginUserId = getCurrentLibraryAccount(db, account).userId;
  if (!loginUserId) return true;
  return getActiveLibraryPlaylistIds(db, account).length > 0;
}

function getCurrentLibraryAccount(db, accountContext = null) {
  const account = getLibraryAccountContext(db, accountContext);
  return {
    userId: account.providerUserId || '',
    nickname: account.nickname || '',
    source: account.source
  };
}

function setActiveLibraryPlaylistIds(db, playlistIds = [], accountContext = null) {
  const account = getLibraryAccountContext(db, accountContext);
  const ids = normalizeIdList(playlistIds);
  setAccountSetting(db, account.accountId, LIBRARY_SYNCED_PLAYLIST_IDS_KEY, JSON.stringify(ids));
}

function getActiveLibraryPlaylistIds(db, accountContext = null) {
  const account = getLibraryAccountContext(db, accountContext);
  const ids = normalizeIdList(safeJson(getScopedLibrarySetting(db, account, LIBRARY_SYNCED_PLAYLIST_IDS_KEY), []));
  if (ids.length) return ids;
  const loginUserId = getCurrentLibraryAccount(db, account).userId;
  if (loginUserId) return [];
  return null;
}

function emptyProfile(summary = '尚未生成音乐画像，请先同步当前音乐账号歌单。') {
  return {
    summary,
    tags: [],
    structured: {},
    updatedAt: null
  };
}

export function updateProfilePlaylistSelection(db, selectedPlaylistIds = [], accountContext = null) {
  const account = getLibraryAccountContext(db, accountContext);
  setProfilePlaylistSelection(db, selectedPlaylistIds, account);
  return getLibrary(db, account);
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
    message: error ? formatErrorMessage(error, '') : dataObject.message || dataObject.msg || response?.message || response?.msg || '',
    dataKeys: Object.keys(dataObject).slice(0, 12)
  };
}

function formatPlaylistSyncError(playlist = {}, error) {
  const name = String(playlist.name || '').trim();
  const label = name ? `《${name}》` : `ID ${playlist.id || '未知'}`;
  return `歌单${label}同步失败：${formatErrorMessage(error, '音乐接口没有返回明确原因，可能是歌单权限限制或接口临时失败')}`;
}

function formatErrorMessage(error, fallback = '未知错误') {
  const message = extractErrorMessage(error);
  if (!message) return fallback;
  return message === 'undefined' || message === '[object Object]' ? fallback : message;
}

function extractErrorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error.trim();
  if (typeof error === 'number') return `错误码 ${error}`;
  const candidates = [
    error.message,
    error.msg,
    error.error,
    error.reason,
    error.body?.message,
    error.body?.msg,
    error.body?.error,
    error.data?.message,
    error.data?.msg,
    error.data?.error,
    error.response?.data?.message,
    error.response?.data?.msg,
    error.response?.data?.error
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }
  const code = error.code ?? error.body?.code ?? error.data?.code ?? error.response?.data?.code;
  if (code !== undefined && code !== null && String(code).trim()) return `音乐返回 code ${code}`;
  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') return serialized.slice(0, 180);
  } catch {
    // Ignore serialization failures and use the fallback.
  }
  return '';
}

function isPlaylistLike(item) {
  return Boolean(item && typeof item === 'object' && !Array.isArray(item) && (
    item.id !== undefined ||
    item.playlistId !== undefined ||
    item.resourceId !== undefined ||
    item.coverId !== undefined
  ));
}

function pruneStalePlaylists(db, activePlaylistIds = []) {
  // Tracks and playlists are shared cache rows. Account visibility is controlled
  // by each account's active playlist-id snapshot.
  void db;
  void activePlaylistIds;
}

async function fetchAllPlaylistSongs(netease, playlist, pageSize = PLAYLIST_SYNC_PAGE_SIZE, onPage = null) {
  const expectedCount = getPlaylistRemoteTrackCount(playlist);
  const records = [];
  let offset = 0;
  while (true) {
    if (expectedCount !== null && offset >= expectedCount) break;
    const response = await netease.playlistSongs(playlist.id, offset, pageSize);
    const data = response?.data ?? response ?? {};
    const pageRecords = extractRecords(data);
    if (!pageRecords.length) {
      if (isFailedApiPayload(data)) {
        throw new Error(formatErrorMessage(data, '音乐接口返回失败'));
      }
      if ((expectedCount ?? 0) > offset) {
        throw new Error('音乐接口未返回歌曲列表，可能是歌单权限限制、歌单不可访问或接口临时失败');
      }
      break;
    }
    records.push(...pageRecords);
    if (typeof onPage === 'function') {
      onPage({ synced: records.length, total: expectedCount ?? null, offset, pageSize });
    }
    offset += pageRecords.length;
    if (pageRecords.length < pageSize) break;
  }
  return records;
}

function isFailedApiPayload(data) {
  if (!data || typeof data !== 'object') return false;
  const code = data.code ?? data.status ?? data.data?.code;
  if (code === undefined || code === null || code === '') return false;
  const normalized = Number(code);
  if (Number.isNaN(normalized)) return false;
  return normalized !== 200;
}

function getProfilePlaylists(db, { selectedOnly = false } = {}, accountContext = null) {
  const account = getLibraryAccountContext(db, accountContext);
  const playlists = getLibraryPlaylists(db, account);
  const profileSelection = getProfileSelection(db, playlists, account);
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

function getLibraryPlaylists(db, accountContext = null) {
  const scope = getActiveLibraryPlaylistIds(db, accountContext);
  if (scope && !scope.length) return [];
  const where = scope ? `WHERE p.id IN (${scope.map(() => '?').join(',')})` : '';
  return db.prepare(`
    SELECT p.id, p.name, p.kind, p.cover_url AS coverUrl, p.raw_json AS rawJson, COUNT(pt.track_id) AS syncedTrackCount
    FROM playlists p
    LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
    ${where}
    GROUP BY p.id, p.name, p.kind, p.cover_url, p.raw_json, p.updated_at
    ORDER BY p.updated_at DESC
  `).all(...(scope || [])).map((playlist) => {
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

function countLibraryTracks(db, accountContext = null) {
  const scope = getActiveLibraryPlaylistIds(db, accountContext);
  if (scope && !scope.length) return 0;
  const where = scope ? `WHERE playlist_id IN (${scope.map(() => '?').join(',')})` : '';
  return db.prepare(`SELECT COUNT(DISTINCT track_id) AS count FROM playlist_tracks ${where}`).get(...(scope || [])).count;
}

function countPlaylistTrackLinks(db, accountContext = null) {
  const scope = getActiveLibraryPlaylistIds(db, accountContext);
  if (scope && !scope.length) return 0;
  const where = scope ? `WHERE playlist_id IN (${scope.map(() => '?').join(',')})` : '';
  return db.prepare(`SELECT COUNT(*) AS count FROM playlist_tracks ${where}`).get(...(scope || [])).count;
}

function listLibraryTracks(db, limit = 5000, accountContext = null) {
  const scope = getActiveLibraryPlaylistIds(db, accountContext);
  if (scope && !scope.length) return [];
  const where = scope ? `WHERE pt.playlist_id IN (${scope.map(() => '?').join(',')})` : '';
  return db.prepare(`
    SELECT t.id, t.name, t.artists, t.album, t.cover_url AS coverUrl, t.duration_ms AS durationMs,
           t.raw_json AS rawJson, MIN(pt.position) AS firstPosition, MAX(p.updated_at) AS playlistUpdatedAt
    FROM playlist_tracks pt
    JOIN tracks t ON t.id = pt.track_id
    JOIN playlists p ON p.id = pt.playlist_id
    ${where}
    GROUP BY t.id, t.name, t.artists, t.album, t.cover_url, t.duration_ms, t.raw_json
    ORDER BY playlistUpdatedAt DESC, firstPosition ASC, t.name ASC
    LIMIT ?
  `).all(...(scope || []), limit).map(hydrateLibraryTrackRow);
}

function hydrateLibraryTrackRow(row) {
  const raw = safeJson(row.rawJson, {});
  const rawOriginalId = extractTrackOriginalId({ raw });
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

function extractTrackOriginalId(track = {}) {
  const raw = track.raw || {};
  const rawOriginalId = raw?.originalId ?? raw?.song?.originalId ?? raw?.track?.originalId ?? track.originalId ?? null;
  return rawOriginalId === null || rawOriginalId === undefined || rawOriginalId === '' ? null : String(rawOriginalId);
}

function getProfileSelection(db, playlists = null, accountContext = null) {
  const account = getLibraryAccountContext(db, accountContext);
  playlists = playlists || getLibraryPlaylists(db, account);
  const playlistIds = normalizeIdList(playlists.map((playlist) => playlist.id));
  const excludedIds = normalizeIdList(safeJson(getScopedLibrarySetting(db, account, PROFILE_EXCLUDED_PLAYLIST_IDS_KEY), []))
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

function setProfilePlaylistSelection(db, selectedPlaylistIds = [], accountContext = null) {
  const account = getLibraryAccountContext(db, accountContext);
  const playlistIds = normalizeIdList(getLibraryPlaylists(db, account).map((playlist) => playlist.id));
  const selectedSet = new Set(normalizeIdList(selectedPlaylistIds));
  const excludedIds = playlistIds.filter((id) => !selectedSet.has(id));
  setAccountSetting(db, account.accountId, PROFILE_EXCLUDED_PLAYLIST_IDS_KEY, JSON.stringify(excludedIds));
  return getProfileSelection(db, null, account);
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
  const sampleTracks = selectRepresentativeTracks(profilePlaylists, 120, 6);
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
    sampleTracks,
    playlistProfiles,
    ruleSignals: inferRuleSignals(tracks, profilePlaylists)
  };
}

function selectRepresentativeTracks(playlists, limit = 120, perPlaylist = 6) {
  const selected = [];
  const seen = new Set();
  const addTrack = (track) => {
    if (!track || selected.length >= limit) return;
    const key = normalizeProfileSampleKey(track.name || '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    selected.push({ name: track.name, artists: track.artists || [], album: track.album || '' });
  };
  for (let index = 0; index < perPlaylist; index += 1) {
    for (const playlist of playlists) addTrack(playlist.tracks[index]);
  }
  for (const playlist of playlists) {
    for (const track of playlist.tracks) addTrack(track);
    if (selected.length >= limit) break;
  }
  return selected;
}

function normalizeProfileSampleKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, '')
    .replace(/\s+/g, '')
    .trim();
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
    evidence: [`在已同步歌单中出现 ${item.count} 次`]
  }));
  const albums = stats.topAlbums.slice(0, 10).map((item) => ({
    name: item.name,
    weight: weightedByCount(item.count, stats.trackCount),
    evidence: [`在已同步歌单中出现 ${item.count} 次`]
  }));
  const discoveryDirections = normalizeWeightedList([
    ...genres.slice(0, 4).map(item => ({ ...item, evidence: [...(item.evidence || []), 'Derived from playlist genre signals'] })),
    ...moods.slice(0, 3).map(item => ({ ...item, evidence: [...(item.evidence || []), 'Derived from playlist mood signals'] })),
    ...scenes.slice(0, 3).map(item => ({ ...item, evidence: [...(item.evidence || []), 'Derived from listening scene signals'] }))
  ]).slice(0, 8);
  const topArtistText = artists.slice(0, 4).map(item => item.name).join('、') || '多元艺人';
  const topGenreText = genres.slice(0, 4).map(item => item.name).join('、') || '多元曲风';
  const topMoodText = moods.slice(0, 3).map(item => item.name).join('、') || '复合情绪';
  const sceneText = scenes.slice(0, 3).map(item => item.name).join('、') || '日常陪伴';
  const summary = stats.trackCount
    ? `你的音乐世界像一间按心情调光的私人电台：${topGenreText}构成主要底色，${topArtistText}等声音常常出现，把熟悉旋律、情绪回声和一点探索欲连接起来。歌单里的线索更偏向${topMoodText}，适合${sceneText}这样的时刻，也保留着继续向原声、独立或小众方向延伸的空间。`
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
      evidence: [`在已同步歌单中出现 ${item.count} 次`]
    }));
  }
  if (!normalized.albums.length && stats.topAlbums?.length) {
    normalized.albums = stats.topAlbums.slice(0, 10).map(item => ({
      name: item.name,
      weight: weightedByCount(item.count, stats.trackCount),
      evidence: [`在已同步歌单中出现 ${item.count} 次`]
    }));
  }
  if (!normalized.summary) {
    const artistText = normalized.artists.slice(0, 4).map(item => item.name).join('、') || '多元艺人';
    const genreText = normalized.genres.slice(0, 4).map(item => item.name).join('、') || '多元曲风';
    normalized.summary = normalized.trackCount
      ? `你的音乐世界围绕${genreText}展开，${artistText}等声音构成了最常出现的坐标。它既保留熟悉旋律带来的安全感，也留着继续探索新场景、新原声和小众表达的余地。`
      : EMPTY_PROFILE_SUMMARY;
  }
  normalized.llmProfile = normalizeLlmProfile(profile.llmProfile, normalized, stats);
  return normalized;
}

function normalizeLlmProfile(input = {}, structured = {}, stats = {}) {
  const raw = typeof input === 'string' ? { summary: input } : (input || {});
  const cleanedSummary = sanitizeLlmProfileSummary(raw.summary, structured, stats);
  const fallbackSummary = buildObjectiveLlmProfileSummary(structured);
  const summary = (cleanedSummary || fallbackSummary || EMPTY_PROFILE_SUMMARY).slice(0, 420);
  return {
    version: 1,
    source: cleanedSummary ? String(raw.source || 'llm').trim() || 'llm' : 'structured',
    summary
  };
}

function buildObjectiveLlmProfileSummary(structured = {}) {
  const groups = [
    ['genres', structured.genres],
    ['moods', structured.moods],
    ['scenes', structured.scenes],
    ['languages', structured.languages],
    ['energy', structured.energy],
    ['eras', structured.eras],
    ['discovery', structured.discoveryDirections],
    ['avoid', structured.avoidSignals]
  ]
    .map(([label, values]) => {
      const names = weightedNames(values, label === 'discovery' ? 5 : 4);
      return names.length ? `${label}: ${names.join(' / ')}` : '';
    })
    .filter(Boolean);
  return groups.length ? `Objective listening profile. ${groups.join('; ')}.` : '';
}

function weightedNames(values = [], limit = 4) {
  return (Array.isArray(values) ? values : [])
    .map(item => String(item?.name || item || '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function sanitizeLlmProfileSummary(summary = '', structured = {}, stats = {}) {
  let text = String(summary || '').replace(/《[^》]{1,80}》/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  for (const term of concreteProfileTerms(structured, stats)) {
    if (term.length < 2) continue;
    text = text.replace(new RegExp(escapeRegExp(term), 'gi'), '');
  }
  return text
    .replace(/[、，,;；]{2,}/g, '、')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[、，,;；\s]+|[、，,;；\s]+$/g, '')
    .trim();
}

function concreteProfileTerms(structured = {}, stats = {}) {
  const terms = [
    ...(structured.artists || []).map(item => item?.name),
    ...(structured.albums || []).map(item => item?.name),
    ...(stats.topArtists || []).map(item => item?.name),
    ...(stats.topAlbums || []).map(item => item?.name),
    ...(stats.sampleTracks || []).flatMap(track => [track?.name, track?.album, ...(track?.artists || [])])
  ];
  return [...new Set(terms.map(term => String(term || '').trim()).filter(Boolean))];
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  if (!tags.length) tags.push('音乐歌单');
  return tags.slice(0, 5);
}

export async function resolvePlayableTrack(db, netease, track, { includeLyric = true, requireBrowserPlayUrl = false } = {}) {
  if (!track) return null;
  const normalized = normalizeTrack(track);
  if (!netease.isConfigured() || normalized.id.startsWith('demo-')) {
    const demoUrl = `/assets/${normalized.id}.mp3`;
    return {
      ...normalized,
      playUrl: demoUrl,
      playbackMode: requireBrowserPlayUrl ? 'browser-demo' : (normalized.originalId ? 'ncm-cli' : 'browser-demo'),
      playable: requireBrowserPlayUrl ? normalized.id.startsWith('demo-') : Boolean(normalized.originalId),
      playbackError: requireBrowserPlayUrl
        ? (normalized.id.startsWith('demo-') ? null : 'No browser-playable URL found.')
        : (normalized.originalId ? null : 'Demo track does not have a NetEase originalId.'),
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
    playbackMode: url ? 'browser-direct' : (requireBrowserPlayUrl ? null : 'ncm-cli'),
    playable: requireBrowserPlayUrl ? Boolean(url) : Boolean(url || normalized.originalId),
    playbackError: (requireBrowserPlayUrl ? url : (url || normalized.originalId)) ? null : 'No browser-playable URL found.',
    lyric: lyric || ''
  };
}
