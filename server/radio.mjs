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

export async function startRadio({ db, config, netease, sessionId }) {
  return djTurn({ db, config, netease, sessionId: sessionId || crypto.randomUUID(), userMessage: null });
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
      feedback,
      feedbackSummary: getFeedbackSummary(db),
      memories: listUserMemories(db, 8)
    };
  } catch (error) {
    return { __error: true, ok: false, error: error.message, status: 400 };
  }
}

export function getMemories({ db }) {
  const memories = listUserMemories(db);
  return {
    ok: true,
    memories,
    updatedAt: memories[0]?.updatedAt || null
  };
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

export function getPreferences({ db }) {
  return {
    ok: true,
    preferences: normalizePreferences(getUserPrefs(db)),
    feedbackSummary: getFeedbackSummary(db)
  };
}

export function updatePreferences({ db, payload }) {
  const next = normalizePreferences({ ...getUserPrefs(db), ...(payload || {}) });
  setUserPrefs(db, next);
  return {
    ok: true,
    preferences: next,
    feedbackSummary: getFeedbackSummary(db)
  };
}

function normalizePreferences(raw = {}) {
  const pick = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
  return {
    chatMusicBalance: pick(raw.chatMusicBalance, ['friend', 'balanced', 'dj'], 'friend'),
    recommendationFrequency: pick(raw.recommendationFrequency, ['low', 'medium', 'high'], 'medium'),
    voiceMode: pick(raw.voiceMode, ['off', 'recommendations', 'all'], 'recommendations'),
    moodMode: pick(raw.moodMode, ['auto', 'comfort', 'focus', 'calm', 'night', 'random'], 'auto'),
    note: String(raw.note || '').slice(0, 500)
  };
}

function getFeedbackSummary(db) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN event_type = 'like' THEN 1 ELSE 0 END), 0) AS likes,
      COALESCE(SUM(CASE WHEN event_type = 'dislike' THEN 1 ELSE 0 END), 0) AS dislikes,
      COALESCE(SUM(CASE WHEN event_type = 'complete' THEN 1 ELSE 0 END), 0) AS completions,
      COALESCE(SUM(CASE WHEN event_type = 'skip' THEN 1 ELSE 0 END), 0) AS skips,
      COUNT(*) AS events,
      MAX(created_at) AS updatedAt
    FROM track_feedback_events
    WHERE created_at >= ?
  `).get(cutoff);
  const topRows = db.prepare(`
    SELECT e.track_id AS trackId,
           COALESCE(SUM(CASE WHEN e.event_type = 'like' THEN 1 ELSE 0 END), 0) AS likes,
           COALESCE(SUM(CASE WHEN e.event_type = 'dislike' THEN 1 ELSE 0 END), 0) AS dislikes,
           COALESCE(SUM(CASE WHEN e.event_type = 'complete' THEN 1 ELSE 0 END), 0) AS completions,
           COALESCE(SUM(CASE WHEN e.event_type = 'skip' THEN 1 ELSE 0 END), 0) AS skips,
           MAX(e.created_at) AS updatedAt,
           t.name, t.artists, t.cover_url AS coverUrl
    FROM track_feedback_events e
    LEFT JOIN tracks t ON t.id = e.track_id
    WHERE e.created_at >= ?
    GROUP BY e.track_id
    ORDER BY (likes * 3 + completions - dislikes * 2 - skips) DESC,
             updatedAt DESC
    LIMIT 8
  `).all(cutoff);
  return {
    totals: {
      likes: Number(totals?.likes || 0),
      dislikes: Number(totals?.dislikes || 0),
      completions: Number(totals?.completions || 0),
      skips: Number(totals?.skips || 0),
      events: Number(totals?.events || 0),
      updatedAt: totals?.updatedAt || null
    },
    windowDays: 30,
    tracks: topRows.map((row) => ({
      ...row,
      artists: safeJson(row.artists, [])
    }))
  };
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
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
