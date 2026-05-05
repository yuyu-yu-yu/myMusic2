// Community API wrapper - uses NeteaseCloudMusicApi module for play URLs
import { createRequire } from 'node:module';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const apiPath = process.env.APPDATA + '\\npm\\node_modules\\NeteaseCloudMusicApi\\main.js';
const require = createRequire('file:///' + apiPath.replace(/\\/g, '/'));
const api = require(apiPath);

let _cookie = null;
let _cookiePath = null;

export function loadCookie(rootDir) {
  const cookieFile = path.join(rootDir, 'netease_cookie.txt');
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

export async function getSongUrl(songId, level = 'exhigh') {
  if (!_cookie || !songId) return null;
  try {
    const result = await api.song_url_v1({
      id: String(songId),
      level,
      cookie: _cookie
    });
    const data = result.body?.data?.[0];
    if (data?.url && data?.code === 200) {
      return { url: data.url, br: data.br, type: data.type };
    }
  } catch (e) {
    console.warn('[community] song_url failed:', e.message);
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
    return songs.map(s => ({
      id: String(s.id),
      originalId: String(s.id),
      name: s.name,
      artists: (s.ar || s.artists || []).map(a => a.name || a),
      album: (s.al || s.album || {}).name || '',
      coverUrl: (s.al || s.album || {}).picUrl || '',
      durationMs: s.dt || s.duration || 0
    }));
  } catch (e) {
    console.warn('[community] search failed:', e.message);
    return [];
  }
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

export async function generateQrKey() {
  try {
    const ts = Date.now();
    const res = await fetch(`http://127.0.0.1:4000/login/qr/key?timestamp=${ts}`);
    const json = await res.json();
    if (json?.data?.unikey) {
      return {
        unikey: json.data.unikey,
        qrUrl: `https://music.163.com/login?codekey=${json.data.unikey}`
      };
    }
  } catch (e) {
    console.warn('[community] qr key failed:', e.message);
  }
  return null;
}

export async function checkQrStatus(unikey) {
  try {
    const ts = Date.now();
    const res = await fetch(`http://127.0.0.1:4000/login/qr/check?key=${unikey}&timestamp=${ts}`);
    return await res.json();
  } catch (e) {
    console.warn('[community] qr check failed:', e.message);
    return { code: -1, message: e.message };
  }
}

export function saveCookieFromQr(result) {
  const cookie = result?.cookie;
  if (!cookie || typeof cookie !== 'string') return false;
  const match = cookie.match(/MUSIC_U=([^;]+)/);
  if (!match) return false;
  const musicU = match[1];
  const fullCookie = `MUSIC_U=${musicU}`;
  _cookie = fullCookie;
  if (_cookiePath) {
    try {
      writeFileSync(_cookiePath, fullCookie, 'utf8');
      console.log('[community] cookie saved from QR login');
    } catch {}
  }
  return true;
}
