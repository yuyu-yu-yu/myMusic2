import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { getConfig, loadEnv, publicConfigStatus } from './config.mjs';
import { openDatabase, getSetting, saveTrack, setSetting } from './db.mjs';
import { NeteaseClient } from './netease.mjs';
import { extractOpenApiTokenPayload, getNeteaseLoginStatus, resolveQrOpenApiLogin, saveNeteaseUserProfile, saveOpenApiToken } from './netease-auth.mjs';
import { clearLibraryAccountSnapshot, getLibrary, getProfile, syncLibrary, updateProfile, updateProfilePlaylistSelection } from './library.mjs';
import { applyScheduleContext, chatRadio, encoreConcertRadio, getConcertAudience, getMemories, getMoodStatsSummary, getPreferences, getRadioDebug, jumpConcertRadio, jumpPlaylistRadio, nextConcertRadio, nextPlaylistRadio, nextRadioItem, playConcertHost, prefetchRadio, removeAllMemories, removeMemory, replanConcertRadio, reportPlay, restoreDeviceSnapshot, startConcertRadio, startPlaylistRadio, startRadio, submitFeedback, updateMemory, updatePreferences } from './radio.mjs';
import { generateDiary, getDiary, listDiaries, today } from './diary.mjs';
import { getDiaryOverview, getDiaryRadioContext, recordDiarySignalFeedback } from './music-recap.mjs';
import { createNcmPlayer } from './player.mjs';
import { checkCookieQrLogin, clearCookie, createCookieQrLogin, getCookieStatus, getCookieUserProfile, getSongComments, loadCookie, resolveCommunityApiFile } from './community.mjs';
import { runDemoSelfCheck } from './diagnostics.mjs';
import { publicAccountContext, resolveAccountContext } from './account-scope.mjs';
import { generateAiMusic } from './ai-music.mjs';
import { cleanupDemoGuest, cleanupExpiredDemoGuests, getVisitorIdFromRequest, resolveRequestAccountContext } from './demo-guest.mjs';
import { configWithEnvironment, resolveRequestEnvironment, resolveRequestEnvironmentContext } from './environment.mjs';
import { initializeDemoRuntime } from './startup.mjs';
import { createScheduleProvider, createScheduleService } from './schedule.mjs';
import { getStaticCacheControl, serveStaticFile } from './static-files.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
loadEnv(rootDir);
const config = getConfig();
const db = openDatabase(rootDir);
const netease = new NeteaseClient(config.netease);
const player = createNcmPlayer({ db });
const scheduleProvider = createScheduleProvider(config.schedule);
const scheduleService = createScheduleService({ db, provider: scheduleProvider, config: config.schedule });
netease.onTokenChange = (accessToken, refreshToken) => {
  setSetting(db, 'netease_access_token', accessToken);
  setSetting(db, 'netease_refresh_token', refreshToken || '');
};
const savedAccessToken = getSetting(db, 'netease_access_token');
const savedRefreshToken = getSetting(db, 'netease_refresh_token');
if (savedAccessToken) {
  netease.setTokens(savedAccessToken, savedRefreshToken || '');
  console.log('[netease] loaded saved token');
}
loadCookie(rootDir);

const publicDir = path.join(rootDir, 'public');
const cacheDir = path.join(rootDir, 'cache', 'tts');
const LIBRARY_SYNCED_USER_ID_KEY = 'library_synced_user_id';

if (config.demo?.guestMode) {
  cleanupExpiredDemoGuests(db, config.demo.guestTtlHours);
  const guestCleanupTimer = setInterval(() => {
    cleanupExpiredDemoGuests(db, config.demo.guestTtlHours);
  }, 60 * 60 * 1000);
  guestCleanupTimer.unref?.();
}

let librarySyncStatus = createIdleLibrarySyncStatus();

function createIdleLibrarySyncStatus() {
  return {
    ok: true,
    jobId: null,
    status: 'idle',
    phase: 'idle',
    source: null,
    currentPlaylistIndex: 0,
    totalPlaylists: 0,
    currentPlaylistName: '',
    currentPlaylistSynced: 0,
    currentPlaylistTotal: null,
    syncedTracks: 0,
    syncedPlaylists: 0,
    errors: [],
    diagnostics: [],
    result: null,
    startedAt: null,
    finishedAt: null
  };
}

function getLibrarySyncStatus() {
  return { ...librarySyncStatus, errors: [...librarySyncStatus.errors], diagnostics: [...librarySyncStatus.diagnostics] };
}

function patchLibrarySyncStatus(patch = {}) {
  librarySyncStatus = {
    ...librarySyncStatus,
    ...patch,
    errors: patch.errors ? [...patch.errors] : librarySyncStatus.errors,
    diagnostics: patch.diagnostics ? [...patch.diagnostics] : librarySyncStatus.diagnostics
  };
  return getLibrarySyncStatus();
}

function invalidateLibrarySyncStatus(message = 'Login state changed, please start sync again.') {
  if (librarySyncStatus.status !== 'running') return getLibrarySyncStatus();
  librarySyncStatus = {
    ...createIdleLibrarySyncStatus(),
    errors: message ? [message] : [],
    finishedAt: new Date().toISOString()
  };
  return getLibrarySyncStatus();
}

function startLibrarySyncJob() {
  if (librarySyncStatus.status === 'running') {
    const preferredSource = getCookieStatus().hasCookie ? 'cookie' : (netease.hasToken() ? 'openapi' : null);
    if (!preferredSource || !librarySyncStatus.source || librarySyncStatus.source === preferredSource) {
      return getLibrarySyncStatus();
    }
    invalidateLibrarySyncStatus('Login source changed, please start sync again.');
  }
  const jobId = crypto.randomUUID();
  librarySyncStatus = {
    ...createIdleLibrarySyncStatus(),
    jobId,
    status: 'running',
    phase: 'checking_login',
    startedAt: new Date().toISOString()
  };

  void (async () => {
    try {
      const result = await syncLibrary(db, netease, {
        llmConfig: config.llm,
        accountContext: resolveAccountContext(db),
        isCancelled: () => librarySyncStatus.jobId !== jobId,
        onProgress: (progress) => {
          if (librarySyncStatus.jobId !== jobId) return;
          patchLibrarySyncStatus({
            status: 'running',
            ...progress
          });
        }
      });
      if (librarySyncStatus.jobId !== jobId) return;
      if (result?.__error || result?.ok === false) {
        throw Object.assign(new Error(result.error || '同步失败'), { result });
      }
      patchLibrarySyncStatus({
        status: 'success',
        phase: 'done',
        source: result.source || librarySyncStatus.source,
        syncedTracks: result.tracks || librarySyncStatus.syncedTracks,
        syncedPlaylists: result.syncedPlaylists || result.playlists || librarySyncStatus.syncedPlaylists,
        totalPlaylists: result.playlists || librarySyncStatus.totalPlaylists,
        errors: result.errors || [],
        diagnostics: result.diagnostics || librarySyncStatus.diagnostics,
        result,
        finishedAt: new Date().toISOString()
      });
    } catch (error) {
      if (librarySyncStatus.jobId !== jobId) return;
      const result = error?.result || null;
      patchLibrarySyncStatus({
        status: 'failed',
        phase: librarySyncStatus.phase === 'idle' ? 'checking_login' : librarySyncStatus.phase,
        source: result?.source || librarySyncStatus.source,
        errors: result?.errors?.length ? result.errors : [error.message || '同步失败'],
        diagnostics: result?.diagnostics || librarySyncStatus.diagnostics,
        result,
        finishedAt: new Date().toISOString()
      });
    }
  })();

  return getLibrarySyncStatus();
}

const startupState = initializeDemoRuntime({
  db,
  config,
  cookieStatus: getCookieStatus(),
  startLibrarySync: startLibrarySyncJob
});
console.log(`[startup] demo library ready; shared sync ${startupState.syncScheduled ? 'scheduled' : 'not scheduled'}`);

const routes = {
  'GET /api/health': async () => ({ ok: true, config: tokenStatus(publicConfigStatus(config)) }),
  'GET /api/config/status': async (req) => tokenStatus(publicConfigStatus(await getRequestConfig(req))),
  'GET /api/environment': async (req) => ({ ok: true, environment: await resolveRequestEnvironment(req, config, { includeWeather: true }) }),
  'GET /api/account/current': async (req) => ({
    ok: true,
    account: publicAccountContext(getRequestAccount(req))
  }),
  'POST /api/demo/guest/close': async (req) => {
    const body = await readJson(req);
    const visitorId = getVisitorIdFromRequest(req, body);
    if (!visitorId) return jsonError('A valid X-Demo-Visitor-Id header is required.', 400);
    return cleanupDemoGuest(db, visitorId);
  },
  'POST /api/demo/guest/reset': async (req) => {
    const body = await readJson(req);
    const visitorId = getVisitorIdFromRequest(req, body);
    if (!visitorId) return jsonError('A valid X-Demo-Visitor-Id header is required.', 400);
    return { ...cleanupDemoGuest(db, visitorId), reset: true };
  },
  'POST /api/demo/guest/restore': async (req) => {
    if (!config.demo?.guestMode) return jsonError('Demo guest restore is only available in demo mode.', 403);
    const body = await readJson(req);
    return restoreDeviceSnapshot({ db, payload: body, accountContext: getRequestAccount(req) });
  },
  'POST /api/diagnostics/self-check': async (req) => {
    const body = await readJson(req);
    const requestConfig = await getRequestConfig(req);
    const accountContext = getRequestAccount(req);
    return runDemoSelfCheck({
      db,
      config: requestConfig,
      netease,
      rootDir,
      sessionId: body.sessionId || '',
      trackId: body.trackId || '',
      syncStatus: getLibrarySyncStatus(),
      accountContext
    });
  },
  'POST /api/auth/netease-cookie/qrcode': async () => demoAuthLocked() || attachQrImage(await createCookieQrLogin()),
  'POST /api/auth/netease-cookie/qrcode/check': async (req) => {
    const locked = demoAuthLocked();
    if (locked) return locked;
    const body = await readJson(req);
    const key = body.key || body.qrCodeKey || body.uniKey || body.unikey;
    if (!key) return jsonError('qrCodeKey is required', 400);
    const result = await checkCookieQrLogin(key, rootDir);
    if (result.loggedIn && result.userId) {
      const previousSyncedUserId = getSetting(db, LIBRARY_SYNCED_USER_ID_KEY) || '';
      invalidateLibrarySyncStatus('NetEase cookie login changed, please start sync again.');
      clearLibraryAccountSnapshot(db, resolveAccountContext(db));
      saveNeteaseUserProfile(db, { userId: result.userId, nickname: result.nickname || '' });
      setSetting(db, 'netease_login_source', 'cookie');
      setSetting(db, 'netease_cookie_user_id', result.userId);
      setSetting(db, 'netease_cookie_user_nickname', result.nickname || '');
      setSetting(db, 'netease_cookie_checked_at', new Date().toISOString());
      const syncStatus = startLibrarySyncJob();
      return {
        ...result,
        accountChanged: Boolean(previousSyncedUserId && String(previousSyncedUserId) !== String(result.userId)),
        previousSyncedUserId,
        libraryCleared: true,
        autoSyncStarted: syncStatus.status === 'running',
        syncStatus
      };
    }
    return result;
  },
  'GET /api/auth/netease-cookie/status': async () => getCookieLoginStatus(),
  'POST /api/auth/netease-cookie/logout': async () => {
    const locked = demoAuthLocked();
    if (locked) return locked;
    invalidateLibrarySyncStatus('NetEase cookie login cleared, please start sync again.');
    clearCookie(rootDir);
    clearLibraryAccountSnapshot(db, resolveAccountContext(db));
    setSetting(db, 'netease_cookie_user_id', '');
    setSetting(db, 'netease_cookie_user_nickname', '');
    setSetting(db, 'netease_cookie_checked_at', '');
    if (getSetting(db, 'netease_login_source') === 'cookie') {
      setSetting(db, 'netease_login_source', '');
      setSetting(db, 'netease_user_id', '');
      setSetting(db, 'netease_user_nickname', '');
      setSetting(db, 'netease_login_checked_at', '');
    }
    return { ok: true, loggedOut: true, ...(await getCookieLoginStatus()) };
  },
  'POST /api/auth/netease/qrcode': async () => demoAuthLocked() || attachQrImage(await netease.qrcode()),
  'POST /api/auth/netease/qrcode/check': async (req) => {
    const locked = demoAuthLocked();
    if (locked) return locked;
    const body = await readJson(req);
    const key = body.key || body.qrCodeKey;
    if (!key) return jsonError('qrCodeKey is required', 400);
    const result = await netease.qrcodeStatus(key);
    const login = await resolveQrOpenApiLogin({ db, netease, result });
    if (login.loggedIn) {
      invalidateLibrarySyncStatus('NetEase OpenAPI login changed, please start sync again.');
      clearLibraryAccountSnapshot(db, resolveAccountContext(db));
    }
    return attachLoginMeta(result, { ...login, hasToken: netease.hasToken() });
  },
  'GET /api/auth/netease/token-status': async () => ({
    ...(await getNeteaseLoginStatus({ db, netease }))
  }),
  'POST /api/auth/netease/refresh': async () => {
    const locked = demoAuthLocked();
    if (locked) return locked;
    const ok = await tryRefreshToken(db, netease);
    return { ok, token: netease.hasToken() };
  },
  'POST /api/library/sync': async () => demoGuestModeLocked('Demo 模式下曲库同步已锁定，访客会使用当前 demo 曲库快照。') || startLibrarySyncJob(),
  'GET /api/library/sync/status': async () => getLibrarySyncStatus(),
  'GET /api/library': async (req) => getLibrary(db, getRequestAccount(req)),
  'GET /api/library/profile': async (req) => getProfile(db, getRequestAccount(req)),
  'GET /api/track-comments': async (req) => {
    const url = new URL(req.url, 'http://local');
    const songId = url.searchParams.get('songId') || '';
    if (!/^\d+$/.test(songId)) return { ok: true, comments: [] };
    const comments = (await getSongComments(songId, { limit: 40 })).map(comment => ({
      ...comment,
      source: 'real',
      persona: null,
      displayName: comment.nickname || '网易云听众'
    }));
    return { ok: true, songId, comments };
  },
  'PUT /api/library/profile-playlists': async (req) => {
    const body = await readJson(req);
    if (!Array.isArray(body.selectedPlaylistIds)) return jsonError('selectedPlaylistIds must be an array', 400);
    return updateProfilePlaylistSelection(db, body.selectedPlaylistIds, getRequestAccount(req));
  },
  'POST /api/library/profile/update': async (req) => {
    const accountContext = getRequestAccount(req);
    await updateProfile(db, (await getRequestConfig(req)).llm, { force: true, accountContext });
    return getLibrary(db, accountContext);
  },
  'POST /api/radio/start': async (req) => {
    const body = await readJson(req);
    return startRadio({ db, config: await getRequestConfig(req), netease, sessionId: body.sessionId, accountContext: getRequestAccount(req) });
  },
  'POST /api/radio/prefetch': async (req) => {
    const body = await readJson(req);
    return prefetchRadio({ db, config: await getRequestConfig(req), netease, sessionId: body.sessionId, force: Boolean(body.force), accountContext: getRequestAccount(req) });
  },
  'GET /api/radio/debug': async (req) => {
    const url = new URL(req.url, 'http://local');
    const sessionId = url.searchParams.get('sessionId') || '';
    return getRadioDebug({ db, sessionId, accountContext: getRequestAccount(req) });
  },
  'POST /api/radio/chat': async (req) => {
    const body = await readJson(req);
    return chatRadio({ db, config: await getRequestConfig(req), netease, sessionId: body.sessionId, message: body.message || '', accountContext: getRequestAccount(req) });
  },
  'POST /api/radio/next': async (req) => {
    const body = await readJson(req);
    return nextRadioItem({ db, config: await getRequestConfig(req), netease, sessionId: body.sessionId || crypto.randomUUID(), userMessage: body.message || '', accountContext: getRequestAccount(req) });
  },
  'POST /api/radio/concert/start': async (req) => {
    const body = await readJson(req);
    return startConcertRadio({ db, config: await getRequestConfig(req), netease, sessionId: body.sessionId || crypto.randomUUID(), settings: body.settings || {}, message: body.message || '', musicCommand: body.musicCommand || null, accountContext: getRequestAccount(req) });
  },
  'POST /api/radio/concert/next': async (req) => {
    const body = await readJson(req);
    return nextConcertRadio({ db, config: await getRequestConfig(req), netease, sessionId: body.sessionId || crypto.randomUUID(), accountContext: getRequestAccount(req) });
  },
  'POST /api/radio/concert/host': async (req) => {
    const body = await readJson(req);
    return playConcertHost({ db, config: await getRequestConfig(req), sessionId: body.sessionId || crypto.randomUUID(), eventId: body.eventId || '', replay: body.replay, accountContext: getRequestAccount(req) });
  },
  'POST /api/radio/concert/jump': async (req) => {
    const body = await readJson(req);
    return jumpConcertRadio({ db, config: await getRequestConfig(req), netease, sessionId: body.sessionId || crypto.randomUUID(), index: body.index, accountContext: getRequestAccount(req) });
  },
  'POST /api/radio/concert/replan': async (req) => {
    const body = await readJson(req);
    return replanConcertRadio({ db, config: await getRequestConfig(req), netease, sessionId: body.sessionId || crypto.randomUUID(), message: body.message || '', musicCommand: body.musicCommand || null, accountContext: getRequestAccount(req) });
  },
  'POST /api/radio/concert/audience': async (req) => {
    const body = await readJson(req);
    return getConcertAudience({ db, config: await getRequestConfig(req), sessionId: body.sessionId || crypto.randomUUID(), trackId: body.trackId || '', accountContext: getRequestAccount(req) });
  },
  'POST /api/radio/concert/encore': async (req) => {
    const body = await readJson(req);
    return encoreConcertRadio({ db, config: await getRequestConfig(req), netease, sessionId: body.sessionId || crypto.randomUUID(), accountContext: getRequestAccount(req) });
  },
  'POST /api/radio/playlist/start': async (req) => {
    const body = await readJson(req);
    return startPlaylistRadio({ db, config: await getRequestConfig(req), netease, sessionId: body.sessionId || crypto.randomUUID(), message: body.message || '', musicCommand: body.musicCommand || null, planning: sanitizeSchedulePlanning(body.planning), scheduleService, accountContext: getRequestAccount(req) });
  },
  'POST /api/radio/playlist/next': async (req) => {
    const body = await readJson(req);
    return nextPlaylistRadio({ db, config: await getRequestConfig(req), netease, sessionId: body.sessionId || crypto.randomUUID(), planning: sanitizeSchedulePlanning(body.planning), scheduleService, accountContext: getRequestAccount(req) });
  },
  'POST /api/radio/playlist/jump': async (req) => {
    const body = await readJson(req);
    return jumpPlaylistRadio({ db, config: await getRequestConfig(req), netease, sessionId: body.sessionId || crypto.randomUUID(), index: body.index, accountContext: getRequestAccount(req) });
  },
  'POST /api/ai-music/generate': async (req) => {
    const body = await readJson(req);
    const accountContext = getRequestAccount(req);
    const recentMessages = getRecentMessagesForAiMusic(db, body.sessionId, accountContext);
    const storedSessionContext = getSessionContextForAiMusic(db, body.sessionId, accountContext);
    const environmentContext = await resolveRequestEnvironmentContext(req, config, { includeWeather: true });
    const weather = environmentContext.weather || storedSessionContext.weather || '';
    const sessionContext = {
      ...storedSessionContext,
      weather,
      environmentContext
    };
    const result = await generateAiMusic({
      config: config.minimax,
      rootDir,
      profile: getProfile(db, accountContext),
      payload: {
        ...body,
        weather,
        environmentContext,
        recentMessages: recentMessages.length ? recentMessages : (body.recentMessages || []),
        sessionContext
      }
    });
    if (result?.__error) return result;
    if (result?.track) saveTrack(db, result.track);
    return { ...result, account: publicAccountContext(accountContext) };
  },
  'POST /api/play/report': async (req) => {
    const body = await readJson(req);
    return reportPlay({ db, netease, payload: body });
  },
  'POST /api/feedback': async (req) => {
    const body = await readJson(req);
    return submitFeedback({ db, payload: body, accountContext: getRequestAccount(req) });
  },
  'GET /api/memories': async (req) => getMemories({ db, accountContext: getRequestAccount(req) }),
  'DELETE /api/memories': async (req) => removeAllMemories({ db, accountContext: getRequestAccount(req) }),
  'GET /api/mood-stats': async (req) => getMoodStatsSummary({ db, accountContext: getRequestAccount(req) }),
  'GET /api/context/schedule/status': async (req) => {
    const accountContext = getRequestAccount(req);
    const status = await scheduleService.getStatus({ accountContext });
    return {
      ...status,
      preferenceEnabled: Boolean(getPreferences({ db, accountContext }).preferences.scheduleAwareEnabled)
    };
  },
  'POST /api/context/schedule/refresh': async (req) => {
    const body = await readJson(req);
    const sessionId = sanitizeOptionalSessionId(body.sessionId);
    if (body.sessionId !== undefined && !sessionId) return jsonError('invalid sessionId', 400);
    const accountContext = getRequestAccount(req);
    const result = await scheduleService.refresh({ accountContext, force: true });
    const sessionUpdate = result.context && sessionId
      ? applyScheduleContext({ db, sessionId, scheduleContext: result.context, accountContext })
      : { changed: false };
    return { ...result, sessionChanged: Boolean(sessionUpdate.changed) };
  },
  'GET /api/preferences': async (req) => getPreferences({ db, accountContext: getRequestAccount(req) }),
  'PUT /api/preferences': async (req) => {
    const body = await readJson(req);
    return updatePreferences({ db, payload: body, accountContext: getRequestAccount(req) });
  },
  'POST /api/player/play': async (req) => {
    const body = await readJson(req);
    if (!body.trackId) return jsonError('trackId is required', 400);
    return player.play(body.trackId, { maxSkips: body.maxSkips ?? 6 });
  },
  'POST /api/player/pause': async () => player.pause(),
  'POST /api/player/resume': async () => player.resume(),
  'POST /api/player/stop': async () => player.stop(),
  'POST /api/player/next': async () => player.next(),
  'GET /api/player/state': async () => player.state(),
  'GET /api/diary': async (req) => listDiaries(db, getRequestAccount(req)),
  'GET /api/diary/today': async (req) => {
    const accountContext = getRequestAccount(req);
    return getDiary(db, today(), accountContext) || generateDiary(db, await getRequestConfig(req), today(), accountContext);
  },
  'POST /api/diary/generate': async (req) => {
    const body = await readJson(req);
    return generateDiary(db, await getRequestConfig(req), body.date || today(), getRequestAccount(req));
  },
  'GET /api/diary/overview': async (req) => {
    const url = new URL(req.url, 'http://local');
    const requestConfig = await getRequestConfig(req);
    try {
      return getDiaryOverview(db, {
        accountContext: getRequestAccount(req),
        days: url.searchParams.get('days') || 7,
        date: url.searchParams.get('date') || '',
        timeZone: requestConfig.app?.timeZone || requestConfig.weather?.timeZone || 'Asia/Shanghai'
      });
    } catch (error) {
      return jsonError(error.message, 400);
    }
  },
  'POST /api/diary/feedback': async (req) => {
    const body = await readJson(req);
    try {
      const result = recordDiarySignalFeedback(db, {
        accountContext: getRequestAccount(req),
        date: body.date,
        signalId: body.signalId,
        signalType: body.signalType,
        action: body.action
      });
      const requestConfig = await getRequestConfig(req);
      return {
        ...result,
        overview: getDiaryOverview(db, {
          accountContext: getRequestAccount(req),
          days: 7,
          date: body.date,
          timeZone: requestConfig.app?.timeZone || requestConfig.weather?.timeZone || 'Asia/Shanghai'
        })
      };
    } catch (error) {
      return jsonError(error.message, 400);
    }
  },
  'POST /api/diary/radio': async (req) => {
    const body = await readJson(req);
    const accountContext = getRequestAccount(req);
    const requestConfig = await getRequestConfig(req);
    let recapContext;
    try {
      recapContext = getDiaryRadioContext(db, {
        accountContext,
        date: body.date,
        timeZone: requestConfig.app?.timeZone || requestConfig.weather?.timeZone || 'Asia/Shanghai'
      });
    } catch (error) {
      return jsonError(error.message, 400);
    }
    if (!recapContext) return jsonError('该日期暂无有效记录', 400);
    const result = await startConcertRadio({
      db,
      config: requestConfig,
      netease,
      sessionId: body.sessionId || crypto.randomUUID(),
      settings: { length: 5, mood: '怀旧', scene: '放松', audiencePreset: '温暖' },
      message: recapContext.message,
      musicCommand: {
        action: 'recommend_and_play',
        targets: {
          searchHints: recapContext.signals.map(signal => signal.text).filter(Boolean).slice(0, 6)
        },
        constraints: [],
        vocalPolicy: 'any',
        switchNow: false,
        scope: 'session',
        confidence: 1,
        normalizedSummary: `根据 ${body.date} 的音乐回顾生成相似电台`,
        source: 'internal'
      },
      accountContext
    });
    return { ...result, diarySource: { date: body.date, signals: recapContext.signals } };
  }
};

function getRequestAccount(req) {
  return resolveRequestAccountContext(db, config, req);
}

async function getRequestConfig(req) {
  const environment = await resolveRequestEnvironment(req, config);
  return configWithEnvironment(config, environment);
}

function demoAuthLocked() {
  return demoGuestModeLocked('Demo 模式下音乐账号已锁定，访客不能退出或重扫共享账号。');
}

function demoGuestModeLocked(message) {
  if (!config.demo?.guestMode) return null;
  return jsonError(message, 403);
}

function tokenStatus(status) {
  return { ...status, neteaseToken: netease.hasToken(), neteaseCookie: getCookieStatus().hasCookie };
}

function getRecentMessagesForAiMusic(db, sessionId = '', accountContext = {}) {
  const id = String(sessionId || '').trim();
  if (!id) return [];
  try {
    return db.prepare(
      'SELECT role, content FROM messages WHERE account_id = ? AND session_id = ? ORDER BY id DESC LIMIT 12'
    ).all(accountContext.accountId, id).reverse().map(row => ({
      role: row.role,
      content: row.content
    }));
  } catch {
    return [];
  }
}

function getSessionContextForAiMusic(db, sessionId = '', accountContext = {}) {
  const id = String(sessionId || '').trim();
  if (!id) return {};
  try {
    const row = db.prepare(
      'SELECT context_json AS contextJson FROM radio_sessions WHERE id = ? AND account_id = ?'
    ).get(id, accountContext.accountId);
    return row ? JSON.parse(row.contextJson || '{}') : {};
  } catch {
    return {};
  }
}

let qrcodeModule = null;

async function attachQrImage(result) {
  const info = result?.data || result;
  const qrText = info?.qrCodeUrl || info?.qrCode || info?.qrurl || '';
  if (info?.uniKey && !info.qrCodeKey) info.qrCodeKey = info.uniKey;
  if (!qrText) return result;
  const qrImage = await renderQrDataUrl(qrText);
  if (qrImage) info.qrImage = qrImage;
  return result;
}

async function renderQrDataUrl(text) {
  try {
    if (!qrcodeModule) {
      const qrcodePath = path.join(path.dirname(resolveCommunityApiFile('main.js')), 'node_modules', 'qrcode');
      qrcodeModule = require(qrcodePath);
    }
    return await qrcodeModule.toDataURL(String(text), {
      width: 220,
      margin: 1,
      color: {
        dark: '#060816',
        light: '#f5fbff'
      }
    });
  } catch (error) {
    console.warn('[netease] QR image render failed:', error.message);
    return '';
  }
}

function attachLoginMeta(result, meta) {
  const payload = result && typeof result === 'object' ? { ...result } : { data: result };
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    payload.data = { ...payload.data, ...meta };
  }
  return { ...payload, ...meta };
}

async function tryRefreshToken(db, netease) {
  const refreshToken = getSetting(db, 'netease_refresh_token');
  if (!refreshToken) return false;
  try {
    const result = await netease.refreshToken(refreshToken);
    const token = extractOpenApiTokenPayload(result);
    if (!token?.accessToken) return false;
    saveOpenApiToken(db, netease, {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken || refreshToken
    });
    console.log('[netease] token refreshed');
    return true;
  } catch (error) {
    console.warn('[netease] token refresh failed:', error.message);
    return false;
  }
}

async function getCookieLoginStatus() {
  const base = getCookieStatus();
  const savedUserId = getSetting(db, 'netease_cookie_user_id') || '';
  const savedNickname = getSetting(db, 'netease_cookie_user_nickname') || '';
  if (!base.hasCookie) {
    return {
      ok: true,
      configured: true,
      hasCookie: false,
      profileReadable: false,
      userId: savedUserId,
      nickname: savedNickname,
      source: 'cookie',
      message: '尚未扫码登录音乐'
    };
  }
  try {
    const profile = await getCookieUserProfile();
    saveNeteaseUserProfile(db, profile);
    setSetting(db, 'netease_login_source', 'cookie');
    setSetting(db, 'netease_cookie_user_id', profile.userId);
    setSetting(db, 'netease_cookie_user_nickname', profile.nickname || '');
    setSetting(db, 'netease_cookie_checked_at', new Date().toISOString());
    return {
      ok: true,
      configured: true,
      hasCookie: true,
      profileReadable: true,
      userId: profile.userId,
      nickname: profile.nickname,
      source: 'cookie',
      message: '已登录'
    };
  } catch (error) {
    return {
      ok: true,
      configured: true,
      hasCookie: true,
      profileReadable: false,
      userId: savedUserId,
      nickname: savedNickname,
      source: 'cookie',
      message: `登录状态异常，请重新扫码：${error.message}`
    };
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/tts/')) return serveTts(req, res);
    const pathname = new URL(req.url, 'http://local').pathname;
    if (req.method === 'PUT' && /^\/api\/memories\/\d+$/.test(pathname)) {
      const result = await updateMemory({
        db,
        id: pathname.split('/').pop(),
        payload: await readJson(req),
        accountContext: getRequestAccount(req)
      });
      return sendJson(res, result, result?.status || 200);
    }
    if (req.method === 'DELETE' && /^\/api\/memories\/\d+$/.test(pathname)) {
      return sendJson(res, removeMemory({ db, id: pathname.split('/').pop(), accountContext: getRequestAccount(req) }));
    }
    const key = `${req.method} ${pathname}`;
    if (routes[key]) {
      const result = await routes[key](req, res);
      if (result?.__error) return sendJson(res, result, result.status);
      return sendJson(res, result);
    }
    if (req.url.startsWith('/api/diary/') && req.method === 'GET') {
      const date = decodeURIComponent(req.url.split('/').pop());
      const accountContext = getRequestAccount(req);
      return sendJson(res, getDiary(db, date, accountContext) || await generateDiary(db, await getRequestConfig(req), date, accountContext));
    }
    if (pathname.startsWith('/api/')) {
      return sendJson(res, { ok: false, error: `API route not found: ${req.method} ${pathname}` }, 404);
    }
    return serveStatic(req, res);
  } catch (error) {
    const status = Number(error?.status || error?.statusCode || 500);
    if (status >= 500) console.error(error);
    return sendJson(res, { ok: false, error: error.message, code: error?.code || undefined }, status);
  }
});

server.listen(config.server.port, config.server.host, () => {
  console.log(`myMusic running at http://${config.server.host}:${config.server.port}`);
});
server.on('close', () => {
  void scheduleService.close();
});

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data, null, 2));
}

function jsonError(error, status = 400) {
  return { __error: true, ok: false, error, status };
}

function sanitizeSchedulePlanning(value) {
  if (!value || value.source !== 'schedule') return null;
  return { source: 'schedule', refresh: value.refresh === true };
}

function sanitizeOptionalSessionId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  const sessionId = value.trim();
  return sessionId && sessionId.length <= 160 ? sessionId : null;
}

function serveTts(req, res) {
  const name = path.basename(new URL(req.url, 'http://local').pathname);
  const filePath = path.join(cacheDir, name);
  if (!filePath.startsWith(cacheDir) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const stat = fs.statSync(filePath);
  const baseHeaders = {
    'content-type': 'audio/mpeg',
    'cache-control': 'public, max-age=31536000',
    'accept-ranges': 'bytes'
  };
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, { ...baseHeaders, 'content-range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : stat.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
      res.writeHead(416, { ...baseHeaders, 'content-range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    const safeEnd = Math.min(end, stat.size - 1);
    res.writeHead(206, {
      ...baseHeaders,
      'content-length': String(safeEnd - start + 1),
      'content-range': `bytes ${start}-${safeEnd}/${stat.size}`
    });
    fs.createReadStream(filePath, { start, end: safeEnd }).pipe(res);
    return;
  }
  res.writeHead(200, { ...baseHeaders, 'content-length': String(stat.size) });
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://local');
  if (/^\/assets\/demo-\d+\.mp3$/.test(url.pathname)) {
    const tone = Number(url.pathname.match(/demo-(\d+)/)?.[1] || 1);
    const wav = makeToneWav(220 + tone * 70, 2.4);
    res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'public, max-age=3600' });
    res.end(wav);
    return;
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  let filePath = path.join(publicDir, pathname);
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(publicDir, 'index.html');
  }
  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg'
  };
  serveStaticFile(
    req,
    res,
    filePath,
    types[ext] || 'application/octet-stream',
    getStaticCacheControl(filePath)
  );
}

function makeToneWav(frequency = 440, seconds = 2) {
  const sampleRate = 44100;
  const samples = Math.floor(sampleRate * seconds);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i += 1) {
    const env = Math.min(1, i / 4000, (samples - i) / 4000);
    const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.18 * env;
    buffer.writeInt16LE(Math.max(-1, Math.min(1, sample)) * 32767, 44 + i * 2);
  }
  return buffer;
}
