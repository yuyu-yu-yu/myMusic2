import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { getConfig, loadEnv, publicConfigStatus } from './config.mjs';
import { openDatabase, getSetting, setSetting } from './db.mjs';
import { NeteaseClient } from './netease.mjs';
import { extractOpenApiTokenPayload, getNeteaseLoginStatus, resolveQrOpenApiLogin, saveNeteaseUserProfile, saveOpenApiToken } from './netease-auth.mjs';
import { clearLibraryAccountSnapshot, getLibrary, getProfile, syncLibrary, updateProfile, updateProfilePlaylistSelection } from './library.mjs';
import { chatRadio, getMemories, getPreferences, getRadioDebug, nextRadioItem, prefetchRadio, removeAllMemories, removeMemory, reportPlay, startRadio, submitFeedback, updatePreferences } from './radio.mjs';
import { generateDiary, getDiary, listDiaries, today } from './diary.mjs';
import { createNcmPlayer } from './player.mjs';
import { checkCookieQrLogin, clearCookie, createCookieQrLogin, getCookieStatus, getCookieUserProfile, loadCookie, resolveCommunityApiFile } from './community.mjs';
import { runDemoSelfCheck } from './diagnostics.mjs';
import { publicAccountContext, resolveAccountContext } from './account-scope.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
loadEnv(rootDir);
const config = getConfig();
const db = openDatabase(rootDir);
const netease = new NeteaseClient(config.netease);
const player = createNcmPlayer({ db });
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

const routes = {
  'GET /api/health': async () => ({ ok: true, config: tokenStatus(publicConfigStatus(config)) }),
  'GET /api/config/status': async () => tokenStatus(publicConfigStatus(config)),
  'GET /api/account/current': async () => ({
    ok: true,
    account: publicAccountContext(resolveAccountContext(db))
  }),
  'POST /api/diagnostics/self-check': async (req) => {
    const body = await readJson(req);
    return runDemoSelfCheck({
      db,
      config,
      netease,
      rootDir,
      sessionId: body.sessionId || '',
      trackId: body.trackId || '',
      syncStatus: getLibrarySyncStatus()
    });
  },
  'POST /api/auth/netease-cookie/qrcode': async () => attachQrImage(await createCookieQrLogin()),
  'POST /api/auth/netease-cookie/qrcode/check': async (req) => {
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
  'POST /api/auth/netease/qrcode': async () => attachQrImage(await netease.qrcode()),
  'POST /api/auth/netease/qrcode/check': async (req) => {
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
    const ok = await tryRefreshToken(db, netease);
    return { ok, token: netease.hasToken() };
  },
  'POST /api/library/sync': async () => startLibrarySyncJob(),
  'GET /api/library/sync/status': async () => getLibrarySyncStatus(),
  'GET /api/library': async () => getLibrary(db, resolveAccountContext(db)),
  'GET /api/library/profile': async () => getProfile(db, resolveAccountContext(db)),
  'PUT /api/library/profile-playlists': async (req) => {
    const body = await readJson(req);
    if (!Array.isArray(body.selectedPlaylistIds)) return jsonError('selectedPlaylistIds must be an array', 400);
    return updateProfilePlaylistSelection(db, body.selectedPlaylistIds, resolveAccountContext(db));
  },
  'POST /api/library/profile/update': async () => {
    const accountContext = resolveAccountContext(db);
    await updateProfile(db, config.llm, { force: true, accountContext });
    return getLibrary(db, accountContext);
  },
  'POST /api/radio/start': async (req) => {
    const body = await readJson(req);
    return startRadio({ db, config, netease, sessionId: body.sessionId, accountContext: resolveAccountContext(db) });
  },
  'POST /api/radio/prefetch': async (req) => {
    const body = await readJson(req);
    return prefetchRadio({ db, config, netease, sessionId: body.sessionId, force: Boolean(body.force), accountContext: resolveAccountContext(db) });
  },
  'GET /api/radio/debug': async (req) => {
    const url = new URL(req.url, 'http://local');
    const sessionId = url.searchParams.get('sessionId') || '';
    return getRadioDebug({ db, sessionId, accountContext: resolveAccountContext(db) });
  },
  'POST /api/radio/chat': async (req) => {
    const body = await readJson(req);
    return chatRadio({ db, config, netease, sessionId: body.sessionId, message: body.message || '', accountContext: resolveAccountContext(db) });
  },
  'POST /api/radio/next': async (req) => {
    const body = await readJson(req);
    return nextRadioItem({ db, config, netease, sessionId: body.sessionId || crypto.randomUUID(), userMessage: body.message || '', accountContext: resolveAccountContext(db) });
  },
  'POST /api/play/report': async (req) => {
    const body = await readJson(req);
    return reportPlay({ db, netease, payload: body });
  },
  'POST /api/feedback': async (req) => {
    const body = await readJson(req);
    return submitFeedback({ db, payload: body, accountContext: resolveAccountContext(db) });
  },
  'GET /api/memories': async () => getMemories({ db, accountContext: resolveAccountContext(db) }),
  'DELETE /api/memories': async () => removeAllMemories({ db, accountContext: resolveAccountContext(db) }),
  'GET /api/preferences': async () => getPreferences({ db, accountContext: resolveAccountContext(db) }),
  'PUT /api/preferences': async (req) => {
    const body = await readJson(req);
    return updatePreferences({ db, payload: body, accountContext: resolveAccountContext(db) });
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
  'GET /api/diary': async () => listDiaries(db, resolveAccountContext(db)),
  'GET /api/diary/today': async () => {
    const accountContext = resolveAccountContext(db);
    return getDiary(db, today(), accountContext) || generateDiary(db, config, today(), accountContext);
  },
  'POST /api/diary/generate': async (req) => {
    const body = await readJson(req);
    return generateDiary(db, config, body.date || today(), resolveAccountContext(db));
  }
};

function tokenStatus(status) {
  return { ...status, neteaseToken: netease.hasToken(), neteaseCookie: getCookieStatus().hasCookie };
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
      message: '尚未扫码登录网易云'
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
    if (req.method === 'DELETE' && /^\/api\/memories\/\d+$/.test(pathname)) {
      return sendJson(res, removeMemory({ db, id: pathname.split('/').pop(), accountContext: resolveAccountContext(db) }));
    }
    const key = `${req.method} ${pathname}`;
    if (routes[key]) {
      const result = await routes[key](req, res);
      if (result?.__error) return sendJson(res, result, result.status);
      return sendJson(res, result);
    }
    if (req.url.startsWith('/api/diary/') && req.method === 'GET') {
      const date = decodeURIComponent(req.url.split('/').pop());
      const accountContext = resolveAccountContext(db);
      return sendJson(res, getDiary(db, date, accountContext) || await generateDiary(db, config, date, accountContext));
    }
    if (pathname.startsWith('/api/')) {
      return sendJson(res, { ok: false, error: `API route not found: ${req.method} ${pathname}` }, 404);
    }
    return serveStatic(req, res);
  } catch (error) {
    console.error(error);
    return sendJson(res, { ok: false, error: error.message }, 500);
  }
});

server.listen(config.server.port, config.server.host, () => {
  console.log(`myMusic running at http://${config.server.host}:${config.server.port}`);
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

function serveTts(req, res) {
  const name = path.basename(new URL(req.url, 'http://local').pathname);
  const filePath = path.join(cacheDir, name);
  if (!filePath.startsWith(cacheDir) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000' });
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
  const cacheControl = ['.html', '.js', '.css'].includes(ext)
    ? 'no-store'
    : 'public, max-age=3600';
  res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': cacheControl });
  fs.createReadStream(filePath).pipe(res);
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
