// Community API wrapper - uses NeteaseCloudMusicApi module for play URLs
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiPath = resolveCommunityApiFile('main.js');
const require = createRequire('file:///' + apiPath.replace(/\\/g, '/'));
const api = require(apiPath);

let _cookie = null;
let _cookiePath = null;

export function resolveCommunityApiFile(fileName) {
  const candidates = [
    path.join(rootDir, 'node_modules', 'NeteaseCloudMusicApi', fileName),
    path.join(rootDir, 'packaging', 'work', 'payload', 'app', 'npm', 'node_modules', 'NeteaseCloudMusicApi', fileName),
    path.join(rootDir, 'packaging', 'verify', 'app', 'npm', 'node_modules', 'NeteaseCloudMusicApi', fileName),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'NeteaseCloudMusicApi', fileName)
  ];
  const found = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!found) {
    throw new Error(`Cannot find NeteaseCloudMusicApi ${fileName}. Run packaging/build-release.ps1 or install NeteaseCloudMusicApi.`);
  }
  return found;
}

export function loadCookie(rootDir) {
  const cookieFile = resolveCookieFile(rootDir);
  if (existsSync(cookieFile)) {
    _cookie = readFileSync(cookieFile, 'utf8').trim();
    _cookiePath = cookieFile;
    console.log('[community] loaded cookie (' + _cookie.length + ' chars)');
    return true;
  }
  return false;
}

export function getCookie() {
  return _cookie;
}

export function hasCookie() {
  return Boolean(_cookie);
}

export function getCookieStatus() {
  return {
    configured: true,
    hasCookie: Boolean(_cookie),
    cookiePath: _cookiePath || null
  };
}

export function saveCookie(rootDir, cookie) {
  const normalized = normalizeCookie(cookie);
  if (!normalized) throw new Error('NetEase cookie is empty');
  const cookieFile = _cookiePath || resolveCookieFile(rootDir);
  writeFileSync(cookieFile, normalized, 'utf8');
  _cookie = normalized;
  _cookiePath = cookieFile;
  return getCookieStatus();
}

export function clearCookie(rootDir) {
  const cookieFile = _cookiePath || resolveCookieFile(rootDir);
  try {
    if (existsSync(cookieFile)) rmSync(cookieFile, { force: true });
  } catch {
    // Clearing login should not crash the app if the file is already locked.
  }
  _cookie = null;
  _cookiePath = cookieFile;
  return getCookieStatus();
}

function resolveCookieFile(rootDir) {
  return process.env.NETEASE_COOKIE_FILE
    ? path.resolve(process.env.NETEASE_COOKIE_FILE)
    : path.join(rootDir, 'netease_cookie.txt');
}

export async function createCookieQrLogin() {
  const keyResult = await api.login_qr_key({ timestamp: Date.now() });
  const keyBody = keyResult.body || keyResult;
  const keyData = keyBody.data || keyBody;
  const key = keyData.unikey || keyData.uniKey || keyData.qrCodeKey || keyData.key;
  if (!key) throw new Error('NeteaseCloudMusicApi did not return QR key');

  const qrResult = await api.login_qr_create({ key, qrimg: true, timestamp: Date.now() });
  const qrBody = qrResult.body || qrResult;
  const qrData = qrBody.data || qrBody;
  return {
    ok: true,
    data: {
      code: qrBody.code,
      key,
      uniKey: key,
      qrCodeKey: key,
      qrCodeUrl: qrData.qrurl || qrData.qrCodeUrl || '',
      qrurl: qrData.qrurl || qrData.qrCodeUrl || '',
      qrImage: qrData.qrimg || qrData.qrImage || '',
      qrimg: qrData.qrimg || qrData.qrImage || ''
    }
  };
}

export async function checkCookieQrLogin(key, rootDir) {
  const result = await api.login_qr_check({ key: String(key), timestamp: Date.now() });
  const body = result.body || result;
  const code = Number(body.code || body.data?.code || 0);
  const message = body.message || body.msg || body.data?.message || body.data?.msg || '';
  const payload = {
    ok: true,
    data: {
      code,
      message,
      msg: message
    },
    code,
    message,
    loggedIn: false,
    cookieSaved: false,
    hasCookie: hasCookie(),
    loginMessage: qrCookieMessage(code, message)
  };

  if (code !== 803) return payload;

  const cookie = extractCookie(result);
  if (!cookie) {
    return {
      ...payload,
      loginMessage: '授权已确认，但没有拿到网易云登录 cookie，请重新扫码'
    };
  }

  saveCookie(rootDir, cookie);
  let profile;
  try {
    profile = await getCookieUserProfile();
  } catch (error) {
    return {
      ...payload,
      data: {
        ...payload.data,
        loggedIn: false,
        cookieSaved: true,
        hasCookie: true
      },
      cookieSaved: true,
      hasCookie: true,
      loginMessage: `授权已确认，但无法读取网易云账号，请重新扫码：${error.message}`
    };
  }
  return {
    ...payload,
    data: {
      ...payload.data,
      loggedIn: true,
      cookieSaved: true,
      hasCookie: true,
      userId: profile.userId,
      nickname: profile.nickname
    },
    loggedIn: true,
    cookieSaved: true,
    hasCookie: true,
    userId: profile.userId,
    nickname: profile.nickname,
    loginMessage: `登录成功：${profile.nickname || profile.userId}`
  };
}

export async function userAccount() {
  assertCookie();
  const result = await api.user_account({ cookie: _cookie });
  return { data: result.body || result, raw: result };
}

export async function getCookieUserProfile() {
  const response = await userAccount();
  const profile = extractCommunityUserProfile(response);
  if (!profile.userId) throw new Error('NeteaseCloudMusicApi user_account did not return userId');
  return profile;
}

export function extractCommunityUserProfile(result) {
  const data = result?.data || result?.body || result || {};
  const profile = data.profile || data.userProfile || data.user || data.account || data;
  const userId = profile.userId ?? profile.userID ?? profile.id ?? profile.user_id ?? data.userId ?? data.userID ?? data.id;
  const nickname = profile.nickname ?? profile.nickName ?? profile.name ?? profile.userName ?? data.nickname ?? data.nickName ?? data.name ?? '';
  return {
    userId: userId === undefined || userId === null || userId === '' ? '' : String(userId),
    nickname: String(nickname || '').trim()
  };
}

export async function userPlaylists(uid, offset = 0, limit = 1000) {
  assertCookie();
  const result = await api.user_playlist({
    uid: String(uid),
    offset: Number(offset) || 0,
    limit: Number(limit) || 1000,
    cookie: _cookie
  });
  return { data: result.body || result, raw: result };
}

export async function playlistTrackAll(playlistId, offset = 0, limit = 200) {
  assertCookie();
  const result = await api.playlist_track_all({
    id: String(playlistId),
    offset: Number(offset) || 0,
    limit: Number(limit) || 200,
    cookie: _cookie
  });
  return { data: result.body || result, raw: result };
}

export async function recentSongs(offset = 0, limit = 50) {
  assertCookie();
  const result = await api.record_recent_song({
    offset: Number(offset) || 0,
    limit: Number(limit) || 50,
    cookie: _cookie
  });
  return { data: result.body || result, raw: result };
}

export async function getSongUrl(songId, level = 'exhigh') {
  if (!_cookie || !songId) return null;
  const levels = Array.isArray(level) ? level : [level, 'higher', 'standard'];
  const tried = new Set();
  for (const targetLevel of levels) {
    if (!targetLevel || tried.has(targetLevel)) continue;
    tried.add(targetLevel);
    try {
      const result = await api.song_url_v1({
        id: String(songId),
        level: targetLevel,
        cookie: _cookie
      });
      const data = result.body?.data?.[0];
      if (data?.url && data?.code === 200) {
        return { url: data.url, br: data.br, type: data.type, level: targetLevel };
      }
    } catch (e) {
      console.warn('[community] song_url failed:', e.message);
    }
  }
  return null;
}

export async function searchOnline(keyword, limit = 5) {
  if (!_cookie || !keyword) return [];
  try {
    const result = await api.search({
      keywords: String(keyword),
      limit,
      type: 1,
      cookie: _cookie
    });
    const songs = result.body?.result?.songs || [];
    return normalizeSearchSongs(songs);
  } catch (e) {
    console.warn('[community] search with cookie failed:', e.message || e.body?.message || e.body?.msg || e.status);
  }

  try {
    const songs = await searchViaLocalHttp(keyword, limit);
    return normalizeSearchSongs(songs);
  } catch (e) {
    console.warn('[community] search failed:', e.message || e.body?.message || e.body?.msg || e.status);
    return [];
  }
}

async function searchViaLocalHttp(keyword, limit) {
  const url = new URL('/search', process.env.COMMUNITY_API_BASE_URL || 'http://localhost:4000');
  url.searchParams.set('keywords', String(keyword));
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('type', '1');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`community HTTP ${response.status}`);
  const json = await response.json();
  return json.result?.songs || [];
}

function normalizeSearchSongs(songs) {
  return (songs || []).map(s => ({
    id: String(s.id),
    originalId: String(s.id),
    name: s.name,
    artists: (s.ar || s.artists || []).map(a => a.name || a),
    album: (s.al || s.album || {}).name || '',
    coverUrl: (s.al || s.album || {}).picUrl || '',
    durationMs: s.dt || s.duration || 0
  }));
}

export async function getLyric(songId) {
  if (!_cookie || !songId) return null;
  try {
    const result = await api.lyric({
      id: String(songId),
      cookie: _cookie
    });
    return result.body?.lrc?.lyric || result.body?.lyric || null;
  } catch {
    return null;
  }
}

export async function getSongComments(songId, { limit = 40, offset = 0 } = {}) {
  const id = String(songId || '').trim();
  if (!/^\d+$/.test(id)) return [];
  const pageLimit = Math.min(40, Math.max(1, Number(limit) || 40));
  try {
    const result = await api.comment_music({
      id,
      limit: pageLimit,
      offset: Math.max(0, Number(offset) || 0),
      cookie: _cookie || undefined,
      timestamp: Date.now()
    });
    return normalizeSongComments(result, pageLimit);
  } catch (e) {
    console.warn('[community] comment_music failed:', e.message || e.body?.message || e.body?.msg || e.status);
    return [];
  }
}

export function normalizeSongComments(result, limit = 40) {
  const body = result?.body || result?.data || result || {};
  const candidates = [
    ...(Array.isArray(body.hotComments) ? body.hotComments : []),
    ...(Array.isArray(body.comments) ? body.comments : []),
    ...(Array.isArray(body.data?.hotComments) ? body.data.hotComments : []),
    ...(Array.isArray(body.data?.comments) ? body.data.comments : [])
  ];
  const seen = new Set();
  const normalized = [];
  const max = Math.min(40, Math.max(1, Number(limit) || 40));

  for (const item of candidates) {
    const content = normalizeCommentContent(item?.content);
    if (!content) continue;
    const id = item?.commentId ?? item?.commentID ?? item?.id ?? '';
    const key = id ? `id:${id}` : `content:${content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      id: String(id || key),
      content,
      nickname: normalizeCommentNickname(item?.user),
      likedCount: Math.max(0, Number(item?.likedCount ?? item?.likeCount ?? 0) || 0)
    });
    if (normalized.length >= max) break;
  }
  return normalized;
}

function normalizeCommentContent(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length > 96) return '';
  if (/该评论已删除|comment deleted|deleted/i.test(text)) return '';
  return text;
}

function normalizeCommentNickname(user = {}) {
  return String(user?.nickname || user?.nickName || user?.name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

function assertCookie() {
  if (!_cookie) throw new Error('NetEase MUSIC_U cookie is not available');
}

function normalizeCookie(cookie) {
  if (Array.isArray(cookie)) return cookie.map(String).join('; ').trim();
  if (cookie && typeof cookie === 'object') {
    if (typeof cookie.cookie === 'string') return cookie.cookie.trim();
    return Object.entries(cookie)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ')
      .trim();
  }
  return String(cookie || '').trim();
}

function extractCookie(result) {
  const body = result?.body || result || {};
  return normalizeCookie(
    body.cookie ||
    body.data?.cookie ||
    result?.cookie ||
    result?.headers?.['set-cookie'] ||
    result?.headers?.get?.('set-cookie')
  );
}

function qrCookieMessage(code, message) {
  if (code === 801) return '等待扫码';
  if (code === 802) return '已扫码，等待手机确认';
  if (code === 800) return '二维码已过期';
  if (code === 803) return message || '授权已确认';
  return message || `二维码状态：${code || '未知'}`;
}
