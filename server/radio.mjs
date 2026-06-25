// Radio routes — thin wrappers over the conversational DJ engine
import crypto from 'node:crypto';
import {
  advanceSessionConstraintsForFeedback,
  applyScheduleContextToSession,
  chatTurn,
  clearActivePlaylistSession,
  concertAudienceTurn,
  concertEncoreTurn,
  concertHostTurn,
  concertJumpTurn,
  concertNextTurn,
  concertReplanTurn,
  concertStartTurn,
  djTurn,
  getRadioDebugStatus,
  playlistJumpTurn,
  playlistNextTurn,
  playlistStartTurn,
  prefetchRadioQueue
} from './dj.mjs';
import {
  clearUserMemories,
  deleteUserMemory,
  getAccountSetting,
  getMoodStats,
  getSetting,
  getTrackById,
  listUserMemories,
  recordOrMergeUserMemory,
  recordTrackFeedback,
  setAccountSetting,
  updateUserMemoryContent
} from './db.mjs';
import { normalizeAccountContext, publicAccountContext, resolveAccountContext } from './account-scope.mjs';

export async function startRadio({ db, config, netease, sessionId, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  const id = sessionId || crypto.randomUUID();
  clearActivePlaylistSession(db, id, account);
  const result = await djTurn({ db, config, netease, sessionId: id, userMessage: null, accountContext: account });
  return attachAccount(result, account);
}

export async function chatRadio({ db, config, netease, sessionId, message, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  const id = sessionId || crypto.randomUUID();
  const result = await chatTurn({ db, config, netease, sessionId: id, message: message || '', accountContext: account });
  if (result?.track) clearActivePlaylistSession(db, id, account);
  return attachAccount(result, account);
}

export async function nextRadioItem({ db, config, netease, sessionId, userMessage, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  const id = sessionId || crypto.randomUUID();
  clearActivePlaylistSession(db, id, account);
  const result = await djTurn({ db, config, netease, sessionId: id, userMessage: userMessage || null, accountContext: account });
  return attachAccount(result, account);
}

export async function startPlaylistRadio({ db, config, netease, sessionId, message, musicCommand, planning, scheduleService, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  const id = sessionId || crypto.randomUUID();
  const scheduleContext = await resolveSchedulePlanningContext({ db, account, planning, scheduleService });
  if (scheduleContext) applyScheduleContextToSession(db, id, scheduleContext, account);
  const result = await playlistStartTurn({
    db,
    config,
    netease,
    sessionId: id,
    userMessage: message || '',
    musicCommand: musicCommand || null,
    planning: planning || null,
    scheduleContext,
    accountContext: account
  });
  return attachAccount(result, account);
}

export async function nextPlaylistRadio({ db, config, netease, sessionId, planning, scheduleService, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  const id = sessionId || crypto.randomUUID();
  const scheduleContext = await resolveSchedulePlanningContext({ db, account, planning, scheduleService });
  if (scheduleContext) applyScheduleContextToSession(db, id, scheduleContext, account);
  const result = await playlistNextTurn({
    db,
    config,
    netease,
    sessionId: id,
    planning: planning || null,
    scheduleContext,
    accountContext: account
  });
  return attachAccount(result, account);
}

export async function jumpPlaylistRadio({ db, config, netease, sessionId, index, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  const result = await playlistJumpTurn({ db, config, netease, sessionId: sessionId || crypto.randomUUID(), index, accountContext: account });
  return attachAccount(result, account);
}

export async function startConcertRadio({ db, config, netease, sessionId, settings, message, musicCommand, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  return attachAccount(await concertStartTurn({
    db,
    config,
    netease,
    sessionId: sessionId || crypto.randomUUID(),
    settings: settings || {},
    userMessage: message || '',
    musicCommand: musicCommand || null,
    accountContext: account
  }), account);
}

export async function nextConcertRadio({ db, config, netease, sessionId, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  return attachAccount(await concertNextTurn({ db, config, netease, sessionId: sessionId || crypto.randomUUID(), accountContext: account }), account);
}

export async function playConcertHost({ db, config, sessionId, eventId, replay, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  return attachAccount(await concertHostTurn({
    db,
    config,
    sessionId: sessionId || crypto.randomUUID(),
    eventId,
    replay: Boolean(replay),
    accountContext: account
  }), account);
}

export async function jumpConcertRadio({ db, config, netease, sessionId, index, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  return attachAccount(await concertJumpTurn({ db, config, netease, sessionId: sessionId || crypto.randomUUID(), index, accountContext: account }), account);
}

export async function replanConcertRadio({ db, config, netease, sessionId, message, musicCommand, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  return attachAccount(await concertReplanTurn({ db, config, netease, sessionId: sessionId || crypto.randomUUID(), message, musicCommand: musicCommand || null, accountContext: account }), account);
}

export async function encoreConcertRadio({ db, config, netease, sessionId, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  return attachAccount(await concertEncoreTurn({ db, config, netease, sessionId: sessionId || crypto.randomUUID(), accountContext: account }), account);
}

export async function getConcertAudience({ db, config, sessionId, trackId, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  return attachAccount(await concertAudienceTurn({ db, config, sessionId: sessionId || crypto.randomUUID(), trackId, accountContext: account }), account);
}

export function prefetchRadio({ db, config, netease, sessionId, force = false, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  return attachAccount(prefetchRadioQueue({ db, config, netease, sessionId: sessionId || crypto.randomUUID(), force, accountContext: account }), account);
}

export function getRadioDebug({ db, sessionId, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  return attachAccount(getRadioDebugStatus(db, sessionId, account), account);
}

export function applyScheduleContext({ db, sessionId, scheduleContext, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  if (!sessionId || !scheduleContext) return { ok: true, changed: false };
  return applyScheduleContextToSession(db, sessionId, scheduleContext, account);
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

export function submitFeedback({ db, payload, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  try {
    const feedback = recordTrackFeedback(db, {
      accountId: account.accountId,
      trackId: payload.trackId || payload.songId,
      eventType: payload.eventType,
      sessionId: payload.sessionId,
      elapsedMs: payload.elapsedMs,
      durationMs: payload.durationMs,
      source: payload.source
    });
    maybeRecordFeedbackMemory(db, {
      accountId: account.accountId,
      trackId: payload.trackId || payload.songId,
      eventType: payload.eventType,
      sessionId: payload.sessionId,
      feedback
    });
    const sessionConstraints = advanceSessionConstraintsForFeedback({
      db,
      sessionId: payload.sessionId,
      trackId: payload.trackId || payload.songId,
      eventType: payload.eventType,
      eventId: payload.constraintEventId,
      accountContext: account
    });
    return {
      ok: true,
      feedback,
      feedbackSummary: getFeedbackSummary(db, account.accountId),
      memories: listUserMemories(db, { accountId: account.accountId, limit: 8 }),
      sessionConstraints,
      account: publicAccountContext(account)
    };
  } catch (error) {
    return { __error: true, ok: false, error: error.message, status: 400 };
  }
}

export function getMemories({ db, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  const memories = listUserMemories(db, { accountId: account.accountId, limit: 200 });
  return {
    ok: true,
    memories,
    updatedAt: memories[0]?.updatedAt || null,
    account: publicAccountContext(account)
  };
}

export function removeMemory({ db, id, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  return attachAccount(deleteUserMemory(db, id, account.accountId), account);
}

export function updateMemory({ db, id, payload, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  const result = updateUserMemoryContent(db, id, payload?.content, account.accountId);
  if (!result.ok) return { __error: true, ...result };
  return attachAccount(result, account);
}

export function removeAllMemories({ db, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  return attachAccount(clearUserMemories(db, account.accountId), account);
}

export function getUserPrefs(db, accountContext = null) {
  const account = getRequestAccount(db, accountContext);
  try {
    const scoped = getAccountSetting(db, account.accountId, 'user_preferences');
    if (account.source === 'guest') return scoped ? JSON.parse(scoped) : {};
    const raw = scoped ?? getSetting(db, 'user_preferences');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function setUserPrefs(db, prefs, accountContext = null) {
  const account = getRequestAccount(db, accountContext);
  setAccountSetting(db, account.accountId, 'user_preferences', JSON.stringify(prefs));
}

export function getPreferences({ db, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  return {
    ok: true,
    preferences: normalizePreferences(getUserPrefs(db, account)),
    feedbackSummary: getFeedbackSummary(db, account.accountId),
    account: publicAccountContext(account)
  };
}

export function getMoodStatsSummary({ db, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  return attachAccount(getMoodStats(db, { accountId: account.accountId, windowDays: 30 }), account);
}

export function updatePreferences({ db, payload, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  const next = normalizePreferences({ ...getUserPrefs(db, account), ...(payload || {}) });
  setUserPrefs(db, next, account);
  return {
    ok: true,
    preferences: next,
    feedbackSummary: getFeedbackSummary(db, account.accountId),
    account: publicAccountContext(account)
  };
}

export function restoreDeviceSnapshot({ db, payload, accountContext }) {
  const account = getRequestAccount(db, accountContext);
  if (account.source !== 'guest') {
    return { __error: true, ok: false, status: 403, error: 'device snapshot restore is only available for demo guests' };
  }

  const snapshot = payload?.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : payload || {};
  const restored = { preferences: false, memories: 0 };

  if (snapshot.preferences && typeof snapshot.preferences === 'object') {
    const next = normalizePreferences({ ...getUserPrefs(db, account), ...snapshot.preferences });
    setUserPrefs(db, next, account);
    restored.preferences = true;
  }

  const existingMemories = listUserMemories(db, { accountId: account.accountId, limit: 1 });
  if (existingMemories.length === 0 && Array.isArray(snapshot.memories)) {
    for (const memory of snapshot.memories.slice(0, 80)) {
      const normalized = normalizeSnapshotMemory(memory);
      if (!normalized) continue;
      try {
        recordOrMergeUserMemory(db, { accountId: account.accountId, ...normalized });
        restored.memories += 1;
      } catch {
        // Ignore malformed individual memories; keep the rest of the snapshot useful.
      }
    }
  }

  return {
    ok: true,
    restored,
    preferences: normalizePreferences(getUserPrefs(db, account)),
    memories: listUserMemories(db, { accountId: account.accountId, limit: 200 }),
    feedbackSummary: getFeedbackSummary(db, account.accountId),
    account: publicAccountContext(account)
  };
}

function normalizeSnapshotMemory(memory = {}) {
  if (!memory || typeof memory !== 'object') return null;
  const content = String(memory.content || '').trim().slice(0, 180);
  if (!content) return null;
  const kind = memoryKindsForSnapshot.has(memory.kind) ? memory.kind : 'preference';
  const tags = Array.isArray(memory.tags)
    ? memory.tags
    : Array.isArray(memory.tagsJson)
      ? memory.tagsJson
      : [];
  return {
    kind,
    content,
    tags: tags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 12),
    confidence: clampSnapshotScore(memory.confidence, 0.5),
    importance: clampSnapshotScore(memory.importance, 0.5),
    sourceSessionId: memory.sourceSessionId || 'device-snapshot'
  };
}

const memoryKindsForSnapshot = new Set([
  'emotion_pattern',
  'need',
  'preference',
  'boundary',
  'life_context',
  'music_preference'
]);

function clampSnapshotScore(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function normalizePreferences(raw = {}) {
  const pick = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
  return {
    chatMusicBalance: pick(raw.chatMusicBalance, ['friend', 'balanced', 'dj'], 'friend'),
    recommendationFrequency: pick(raw.recommendationFrequency, ['low', 'medium', 'high'], 'medium'),
    voiceMode: pick(raw.voiceMode, ['off', 'recommendations', 'all'], 'recommendations'),
    moodMode: pick(raw.moodMode, ['auto', 'comfort', 'focus', 'calm', 'night', 'random'], 'auto'),
    lowDistractionMode: raw.lowDistractionMode === true,
    scheduleAwareEnabled: raw.scheduleAwareEnabled === true,
    note: String(raw.note || '').slice(0, 500)
  };
}

async function resolveSchedulePlanningContext({ db, account, planning, scheduleService }) {
  if (planning?.source !== 'schedule' || !scheduleService) return null;
  const preferences = normalizePreferences(getUserPrefs(db, account));
  if (!preferences.scheduleAwareEnabled) return null;
  try {
    return await scheduleService.getForPlanning({
      accountContext: account,
      refresh: planning.refresh === true
    });
  } catch {
    return null;
  }
}

function getFeedbackSummary(db, accountId) {
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
    WHERE account_id = ? AND created_at >= ?
  `).get(accountId, cutoff);
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
    WHERE e.account_id = ? AND e.created_at >= ?
    GROUP BY e.track_id
    ORDER BY (likes * 3 + completions - dislikes * 2 - skips) DESC,
             updatedAt DESC
    LIMIT 8
  `).all(accountId, cutoff);
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

function maybeRecordFeedbackMemory(db, { accountId, trackId, eventType, sessionId, feedback }) {
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
        accountId,
        kind: 'music_preference',
        content: `用户多次喜欢 ${title}${artists}，后续可把相近气质的歌曲作为安全推荐方向。`,
        tags: ['喜欢', track?.name, ...(track?.artists || [])].filter(Boolean),
        confidence: 0.72,
        importance: 0.62,
        sourceSessionId: sessionId
      });
    } else if (type === 'complete' && completions >= 4) {
      recordOrMergeUserMemory(db, {
        accountId,
        kind: 'music_preference',
        content: `用户多次完整听完 ${title}${artists}，这类歌曲可作为较稳妥的陪伴选择。`,
        tags: ['完整听完', track?.name, ...(track?.artists || [])].filter(Boolean),
        confidence: 0.65,
        importance: 0.55,
        sourceSessionId: sessionId
      });
    } else if ((type === 'skip' && skips >= 3) || (type === 'dislike' && dislikes >= 2)) {
      recordOrMergeUserMemory(db, {
        accountId,
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

function getRequestAccount(db, accountContext) {
  return accountContext ? normalizeAccountContext(accountContext) : resolveAccountContext(db);
}

function attachAccount(result, accountContext) {
  return {
    ...(result || {}),
    account: publicAccountContext(accountContext)
  };
}
