// Radio routes — thin wrappers over the conversational DJ engine
import crypto from 'node:crypto';
import { chatTurn, djTurn } from './dj.mjs';
import {
  clearUserMemories,
  deleteUserMemory,
  getTrackById,
  listUserMemories,
  nowIso,
  recordOrMergeUserMemory,
  recordTrackFeedback
} from './db.mjs';

export async function startRadio({ db, config, netease }) {
  const sessionId = crypto.randomUUID();
  const weather = await (await import('./ai.mjs')).getWeatherSummary(config.weather);
  db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?,?,?,?)')
    .run(sessionId, nowIso(), JSON.stringify({ weather, weatherUpdatedAt: nowIso(), startedAt: nowIso() }), '[]');
  return djTurn({ db, config, netease, sessionId, userMessage: null });
}

export async function chatRadio({ db, config, netease, sessionId, message }) {
  return chatTurn({ db, config, netease, sessionId: sessionId || crypto.randomUUID(), message: message || '' });
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

export function submitFeedback({ db, payload }) {
  try {
    const feedback = recordTrackFeedback(db, {
      trackId: payload.trackId || payload.songId,
      eventType: payload.eventType,
      sessionId: payload.sessionId,
      elapsedMs: payload.elapsedMs,
      durationMs: payload.durationMs,
      source: payload.source
    });
    maybeRecordFeedbackMemory(db, {
      trackId: payload.trackId || payload.songId,
      eventType: payload.eventType,
      sessionId: payload.sessionId,
      feedback
    });
    return {
      ok: true,
      feedback
    };
  } catch (error) {
    return { __error: true, ok: false, error: error.message, status: 400 };
  }
}

export function getMemories({ db }) {
  return { ok: true, memories: listUserMemories(db) };
}

export function removeMemory({ db, id }) {
  return deleteUserMemory(db, id);
}

export function removeAllMemories({ db }) {
  return clearUserMemories(db);
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

function maybeRecordFeedbackMemory(db, { trackId, eventType, sessionId, feedback }) {
  const type = String(eventType || '');
  const likes = Number(feedback?.likes || 0);
  const dislikes = Number(feedback?.dislikes || 0);
  const skips = Number(feedback?.skips || 0);
  const completions = Number(feedback?.completions || 0);
  const track = getTrackById(db, trackId);
  const title = track?.name ? `《${track.name}》` : '这类歌曲';
  const artists = track?.artists?.length ? `（${track.artists.join('、')}）` : '';

  try {
    if (type === 'like' && likes >= 3) {
      recordOrMergeUserMemory(db, {
        kind: 'music_preference',
        content: `用户多次喜欢 ${title}${artists}，后续可把相近气质的歌曲作为安全推荐方向。`,
        tags: ['喜欢', track?.name, ...(track?.artists || [])].filter(Boolean),
        confidence: 0.72,
        importance: 0.62,
        sourceSessionId: sessionId
      });
    } else if (type === 'complete' && completions >= 4) {
      recordOrMergeUserMemory(db, {
        kind: 'music_preference',
        content: `用户多次完整听完 ${title}${artists}，这类歌曲可作为较稳妥的陪伴选择。`,
        tags: ['完整听完', track?.name, ...(track?.artists || [])].filter(Boolean),
        confidence: 0.65,
        importance: 0.55,
        sourceSessionId: sessionId
      });
    } else if ((type === 'skip' && skips >= 3) || (type === 'dislike' && dislikes >= 2)) {
      recordOrMergeUserMemory(db, {
        kind: 'music_preference',
        content: `用户多次跳过或不喜欢 ${title}${artists}，后续推荐相近歌曲时要谨慎。`,
        tags: ['跳过', '不喜欢', track?.name, ...(track?.artists || [])].filter(Boolean),
        confidence: 0.7,
        importance: 0.68,
        sourceSessionId: sessionId
      });
    }
  } catch {
    // Feedback must never fail because a memory could not be written.
  }
}
