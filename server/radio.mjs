// Radio routes — thin wrappers over the conversational DJ engine
import crypto from 'node:crypto';
import { djTurn } from './dj.mjs';
import { nowIso } from './db.mjs';

export async function startRadio({ db, config, netease }) {
  const sessionId = crypto.randomUUID();
  const weather = await (await import('./ai.mjs')).getWeatherSummary(config.weather);
  db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?,?,?,?)')
    .run(sessionId, nowIso(), JSON.stringify({ weather, startedAt: nowIso() }), '[]');
  return djTurn({ db, config, netease, sessionId, userMessage: null });
}

export async function chatRadio({ db, config, netease, sessionId, message }) {
  return djTurn({ db, config, netease, sessionId: sessionId || crypto.randomUUID(), userMessage: message || '' });
}

export async function nextRadioItem({ db, config, netease, sessionId, userMessage }) {
  return djTurn({ db, config, netease, sessionId: sessionId || crypto.randomUUID(), userMessage: userMessage || null });
}

export async function reportPlay({ db, netease, payload }) {
  const trackId = String(payload.trackId || payload.songId || '');
  if (!trackId) return { ok: false, error: 'trackId is required' };
  if (!netease.isConfigured()) return { ok: true, mode: 'local-only' };
  try {
    await netease.reportPlay({ songId: trackId, playTime: payload.playTime || Date.now(), duration: payload.duration || 0, playType: payload.playType || 'play', sourceType: payload.sourceType || 'mymusic' });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export function getUserPrefs(db) {
  try {
    const raw = db.prepare('SELECT value FROM settings WHERE key = ?').get('user_preferences');
    return raw ? JSON.parse(raw.value) : {};
  } catch { return {}; }
}

export function setUserPrefs(db, prefs) {
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
    .run('user_preferences', JSON.stringify(prefs), nowIso());
}
