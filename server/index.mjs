import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getConfig, loadEnv, publicConfigStatus } from './config.mjs';
import { openDatabase, seedDemoLibrary, getSetting, setSetting } from './db.mjs';
import { NeteaseClient } from './netease.mjs';
import { getLibrary, getProfile, syncLibrary, updateProfile } from './library.mjs';
import { chatRadio, getMemories, getPreferences, nextRadioItem, removeAllMemories, removeMemory, reportPlay, startRadio, submitFeedback, updatePreferences } from './radio.mjs';
import { generateDiary, getDiary, listDiaries, today } from './diary.mjs';
import { createNcmPlayer } from './player.mjs';
import { loadCookie } from './community.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(rootDir);
const config = getConfig();
const db = openDatabase(rootDir);
const netease = new NeteaseClient(config.netease);
const player = createNcmPlayer({ db });
netease.onTokenChange = (accessToken, refreshToken) => {
  setSetting(db, 'netease_access_token', accessToken);
  if (refreshToken) setSetting(db, 'netease_refresh_token', refreshToken);
};
const savedAccessToken = getSetting(db, 'netease_access_token');
const savedRefreshToken = getSetting(db, 'netease_refresh_token');
if (savedAccessToken) {
  netease.setTokens(savedAccessToken, savedRefreshToken || '');
  console.log('[netease] loaded saved token');
}
loadCookie(rootDir);
seedDemoLibrary(db);
await updateProfile(db, config.llm);

const publicDir = path.join(rootDir, 'public');
const cacheDir = path.join(rootDir, 'cache', 'tts');

const routes = {
  'GET /api/health': async () => ({ ok: true, config: tokenStatus(publicConfigStatus(config)) }),
  'GET /api/config/status': async () => tokenStatus(publicConfigStatus(config)),
  'POST /api/auth/netease/qrcode': async () => netease.qrcode(),
  'POST /api/auth/netease/qrcode/check': async (req) => {
    const body = await readJson(req);
    const key = body.key || body.qrCodeKey;
    if (!key) return jsonError('qrCodeKey is required', 400);
    const result = await netease.qrcodeStatus(key);
    tryNeteaseLogin(db, netease, result);
    return result;
  },
  'GET /api/auth/netease/token-status': async () => ({
    configured: netease.isConfigured(),
    hasToken: netease.hasToken()
  }),
  'POST /api/auth/netease/refresh': async () => {
    const ok = await tryRefreshToken(db, netease);
    return { ok, token: netease.hasToken() };
  },
  'POST /api/library/sync': async () => syncLibrary(db, netease),
  'GET /api/library': async () => getLibrary(db),
  'GET /api/library/profile': async () => getProfile(db),
  'POST /api/radio/start': async (req) => {
    const body = await readJson(req);
    return startRadio({ db, config, netease, sessionId: body.sessionId });
  },
  'POST /api/radio/chat': async (req) => {
    const body = await readJson(req);
    return chatRadio({ db, config, netease, sessionId: body.sessionId, message: body.message || '' });
  },
  'POST /api/radio/next': async (req) => {
    const body = await readJson(req);
    return nextRadioItem({ db, config, netease, sessionId: body.sessionId || crypto.randomUUID(), userMessage: body.message || '' });
  },
  'POST /api/play/report': async (req) => {
    const body = await readJson(req);
    return reportPlay({ db, netease, payload: body });
  },
  'POST /api/feedback': async (req) => {
    const body = await readJson(req);
    return submitFeedback({ db, payload: body });
  },
  'GET /api/memories': async () => getMemories({ db }),
  'DELETE /api/memories': async () => removeAllMemories({ db }),
  'GET /api/preferences': async () => getPreferences({ db }),
  'PUT /api/preferences': async (req) => {
    const body = await readJson(req);
    return updatePreferences({ db, payload: body });
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
  'GET /api/diary': async () => listDiaries(db),
  'GET /api/diary/today': async () => getDiary(db, today()) || generateDiary(db, config, today()),
  'POST /api/diary/generate': async (req) => {
    const body = await readJson(req);
    return generateDiary(db, config, body.date || today());
  }
};

function tokenStatus(status) {
  return { ...status, neteaseToken: netease.hasToken() };
}

function tryNeteaseLogin(db, netease, result) {
  const data = result?.data || result;
  const token = data?.accessToken;
  if (!token || typeof token !== 'object') return false;
  const accessToken = token.accessToken;
  const refreshToken = token.refreshToken;
  if (!accessToken || accessToken === 'null') return false;
  netease.setTokens(accessToken, refreshToken || '');
  setSetting(db, 'netease_access_token', accessToken);
  if (refreshToken) setSetting(db, 'netease_refresh_token', refreshToken);
  console.log('[netease] token saved from QR login');
  return true;
}

async function tryRefreshToken(db, netease) {
  const refreshToken = getSetting(db, 'netease_refresh_token');
  if (!refreshToken) return false;
  try {
    const result = await netease.refreshToken(refreshToken);
    const data = result?.data || result;
    const token = data?.accessToken;
    if (!token || typeof token !== 'object') return false;
    const newAccessToken = token.accessToken;
    const newRefreshToken = token.refreshToken || refreshToken;
    if (!newAccessToken || newAccessToken === 'null') return false;
    netease.setTokens(newAccessToken, newRefreshToken);
    setSetting(db, 'netease_access_token', newAccessToken);
    if (newRefreshToken !== refreshToken) setSetting(db, 'netease_refresh_token', newRefreshToken);
    console.log('[netease] token refreshed');
    return true;
  } catch (error) {
    console.warn('[netease] token refresh failed:', error.message);
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/tts/')) return serveTts(req, res);
    const pathname = new URL(req.url, 'http://local').pathname;
    if (req.method === 'DELETE' && /^\/api\/memories\/\d+$/.test(pathname)) {
      return sendJson(res, removeMemory({ db, id: pathname.split('/').pop() }));
    }
    const key = `${req.method} ${pathname}`;
    if (routes[key]) {
      const result = await routes[key](req, res);
      if (result?.__error) return sendJson(res, result, result.status);
      return sendJson(res, result);
    }
    if (req.url.startsWith('/api/diary/') && req.method === 'GET') {
      const date = decodeURIComponent(req.url.split('/').pop());
      return sendJson(res, getDiary(db, date) || await generateDiary(db, config, date));
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
    '.mp3': 'audio/mpeg'
  };
  res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
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
