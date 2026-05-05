import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(rootDir = process.cwd()) {
  const dataDir = path.join(rootDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'mymusic.sqlite'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  // Migration: add mode_json to existing radio_sessions
  try { db.exec("ALTER TABLE radio_sessions ADD COLUMN mode_json TEXT NOT NULL DEFAULT '{}'"); } catch {}
  try { db.exec("ALTER TABLE music_profile ADD COLUMN profile_json TEXT NOT NULL DEFAULT '{}'"); } catch {}
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      artists TEXT NOT NULL DEFAULT '[]',
      album TEXT,
      cover_url TEXT,
      duration_ms INTEGER,
      raw_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      cover_url TEXT,
      raw_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (playlist_id, track_id)
    );

    CREATE TABLE IF NOT EXISTS plays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id TEXT NOT NULL,
      played_at TEXT NOT NULL,
      source TEXT,
      reason TEXT,
      host_text TEXT,
      report_status TEXT
    );

    CREATE TABLE IF NOT EXISTS radio_sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      context_json TEXT NOT NULL DEFAULT '{}',
      queue_json TEXT NOT NULL DEFAULT '[]',
	      mode_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS music_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      summary TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      profile_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS diary_entries (
      date TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      mood_tags TEXT NOT NULL DEFAULT '[]',
      track_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tts_cache (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      provider TEXT,
      audio_path TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS track_feedback_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      session_id TEXT,
      elapsed_ms INTEGER,
      duration_ms INTEGER,
      source TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS track_feedback_summary (
      track_id TEXT PRIMARY KEY,
      likes INTEGER NOT NULL DEFAULT 0,
      dislikes INTEGER NOT NULL DEFAULT 0,
      completions INTEGER NOT NULL DEFAULT 0,
      skips INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0.5,
      importance REAL NOT NULL DEFAULT 0.5,
      evidence_count INTEGER NOT NULL DEFAULT 1,
      source_session_id TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, nowIso());
}

export function getSessionMode(db, sessionId) {
  try {
    const row = db.prepare('SELECT mode_json FROM radio_sessions WHERE id = ?').get(sessionId);
    return row ? JSON.parse(row.mode_json || '{}') : {};
  } catch { return {}; }
}

const feedbackColumns = {
  like: 'likes',
  dislike: 'dislikes',
  complete: 'completions',
  skip: 'skips'
};

export function recordTrackFeedback(db, {
  trackId,
  eventType,
  sessionId = null,
  elapsedMs = null,
  durationMs = null,
  source = null
} = {}) {
  const id = String(trackId || '').trim();
  const type = String(eventType || '').trim();
  const column = feedbackColumns[type];
  if (!id) throw new Error('trackId is required');
  if (!column) throw new Error('eventType must be one of like, dislike, complete, skip');

  const now = nowIso();
  db.prepare(`
    INSERT INTO track_feedback_events (track_id, event_type, session_id, elapsed_ms, duration_ms, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    type,
    sessionId ? String(sessionId) : null,
    elapsedMs === null || elapsedMs === undefined ? null : Math.max(0, Number(elapsedMs) || 0),
    durationMs === null || durationMs === undefined ? null : Math.max(0, Number(durationMs) || 0),
    source ? String(source) : null,
    now
  );

  db.prepare(`
    INSERT INTO track_feedback_summary (track_id, ${column}, updated_at)
    VALUES (?, 1, ?)
    ON CONFLICT(track_id) DO UPDATE SET
      ${column} = ${column} + 1,
      updated_at = excluded.updated_at
  `).run(id, now);

  return getTrackFeedbackSummary(db, id);
}

export function getTrackFeedbackSummary(db, trackId) {
  return db.prepare(`
    SELECT track_id AS trackId, likes, dislikes, completions, skips, updated_at AS updatedAt
    FROM track_feedback_summary
    WHERE track_id = ?
  `).get(String(trackId));
}

export function getFeedbackSummaryMap(db, trackIds) {
  const ids = [...new Set((trackIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT track_id AS trackId, likes, dislikes, completions, skips, updated_at AS updatedAt
    FROM track_feedback_summary
    WHERE track_id IN (${placeholders})
  `).all(...ids);
  return new Map(rows.map((row) => [String(row.trackId), row]));
}

export const memoryKinds = new Set([
  'emotion_pattern',
  'need',
  'preference',
  'boundary',
  'life_context',
  'music_preference'
]);

export function recordOrMergeUserMemory(db, {
  kind,
  content,
  tags = [],
  confidence = 0.5,
  importance = 0.5,
  sourceSessionId = null
} = {}) {
  const normalizedKind = memoryKinds.has(kind) ? kind : null;
  const normalizedContent = String(content || '').trim();
  if (!normalizedKind) throw new Error('invalid memory kind');
  if (!normalizedContent) throw new Error('memory content is required');

  const cleanTags = normalizeTags(tags);
  const now = nowIso();
  const existing = findMergeCandidate(db, normalizedKind, normalizedContent, cleanTags);

  if (existing) {
    const mergedTags = [...new Set([...safeJson(existing.tagsJson, []), ...cleanTags])].slice(0, 12);
    const evidenceCount = Number(existing.evidenceCount || 0) + 1;
    const nextConfidence = clamp01(Math.max(Number(existing.confidence) || 0, Number(confidence) || 0) + 0.05);
    const nextImportance = clamp01(Math.max(Number(existing.importance) || 0, Number(importance) || 0));
    db.prepare(`
      UPDATE user_memories
      SET content = ?, tags_json = ?, confidence = ?, importance = ?,
          evidence_count = ?, last_seen_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      preferMemoryContent(existing.content, normalizedContent),
      JSON.stringify(mergedTags),
      nextConfidence,
      nextImportance,
      evidenceCount,
      now,
      now,
      existing.id
    );
    return getUserMemory(db, existing.id);
  }

  const result = db.prepare(`
    INSERT INTO user_memories (
      kind, content, tags_json, confidence, importance, evidence_count,
      source_session_id, first_seen_at, last_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalizedKind,
    normalizedContent,
    JSON.stringify(cleanTags),
    clamp01(confidence),
    clamp01(importance),
    1,
    sourceSessionId ? String(sourceSessionId) : null,
    now,
    now,
    now
  );
  return getUserMemory(db, result.lastInsertRowid);
}

export function listUserMemories(db, limit = 200) {
  return db.prepare(`
    SELECT id, kind, content, tags_json AS tagsJson, confidence, importance,
           evidence_count AS evidenceCount, source_session_id AS sourceSessionId,
           first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, updated_at AS updatedAt
    FROM user_memories
    ORDER BY importance DESC, confidence DESC, updated_at DESC
    LIMIT ?
  `).all(Math.max(1, Number(limit) || 200)).map(hydrateMemoryRow);
}

export function getUserMemory(db, id) {
  const row = db.prepare(`
    SELECT id, kind, content, tags_json AS tagsJson, confidence, importance,
           evidence_count AS evidenceCount, source_session_id AS sourceSessionId,
           first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, updated_at AS updatedAt
    FROM user_memories
    WHERE id = ?
  `).get(Number(id));
  return row ? hydrateMemoryRow(row) : null;
}

export function deleteUserMemory(db, id) {
  const result = db.prepare('DELETE FROM user_memories WHERE id = ?').run(Number(id));
  return { ok: true, deleted: result.changes || 0 };
}

export function clearUserMemories(db) {
  const result = db.prepare('DELETE FROM user_memories').run();
  return { ok: true, deleted: result.changes || 0 };
}

export function retrieveRelevantMemories(db, {
  text = '',
  mood = null,
  mode = null,
  limit = 8,
  maxChars = 800
} = {}) {
  const memories = listUserMemories(db, 300);
  if (!memories.length) return [];
  const queryTerms = extractMemoryTerms([text, mood?.mood, ...(mood?.searchHints || []), mode?.genre].filter(Boolean).join(' '));
  const scored = memories.map((memory) => ({
    memory,
    score: scoreMemory(memory, queryTerms)
  }));
  const ranked = scored
    .filter(item => queryTerms.length ? item.score > 0.1 : item.score > 0)
    .sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt));

  const selected = [];
  let chars = 0;
  for (const { memory } of ranked) {
    const lineLength = memory.content.length + memory.kind.length + 8;
    if (selected.length >= limit) break;
    if (selected.length && chars + lineLength > maxChars) break;
    selected.push(memory);
    chars += lineLength;
  }
  return selected;
}

export function setSessionMode(db, sessionId, mode) {
  db.prepare('UPDATE radio_sessions SET mode_json = ? WHERE id = ?')
    .run(JSON.stringify(mode || {}), sessionId);
}

function findMergeCandidate(db, kind, content, tags) {
  const rows = db.prepare(`
    SELECT id, kind, content, tags_json AS tagsJson, confidence, importance,
           evidence_count AS evidenceCount
    FROM user_memories
    WHERE kind = ?
    ORDER BY updated_at DESC
    LIMIT 100
  `).all(kind);
  const normalizedContent = normalizeMemoryText(content);
  let best = null;
  let bestScore = 0;
  for (const row of rows) {
    const existingTags = safeJson(row.tagsJson, []);
    const score = memorySimilarity(normalizedContent, normalizeMemoryText(row.content), tags, existingTags);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return bestScore >= 0.62 ? best : null;
}

function memorySimilarity(a, b, tagsA, tagsB) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const contentScore = a.includes(b) || b.includes(a) ? 0.7 : 0;
  const setA = new Set(tagsA.map(tag => tag.toLowerCase()));
  const setB = new Set(tagsB.map(tag => tag.toLowerCase()));
  const overlap = [...setA].filter(tag => setB.has(tag)).length;
  const tagScore = overlap ? overlap / Math.max(setA.size, setB.size, 1) : 0;
  return Math.max(contentScore, tagScore);
}

function scoreMemory(memory, terms) {
  const haystack = `${memory.kind} ${memory.content} ${(memory.tags || []).join(' ')}`.toLowerCase();
  const matched = terms.filter(term => haystack.includes(term.toLowerCase())).length;
  const relevance = terms.length ? matched / terms.length : 0.2;
  const updatedAt = new Date(memory.updatedAt || memory.lastSeenAt || 0).getTime();
  const ageDays = Number.isFinite(updatedAt) ? Math.max(0, (Date.now() - updatedAt) / 86400000) : 365;
  const recency = Math.max(0, 1 - ageDays / 90);
  return relevance * 4 + Number(memory.importance || 0) * 1.5 + Number(memory.confidence || 0) + recency * 0.5;
}

function extractMemoryTerms(text) {
  const value = String(text || '').toLowerCase();
  const words = value.match(/[\u4e00-\u9fff]{2,}|[a-z0-9_-]{3,}/g) || [];
  return [...new Set(words)].slice(0, 20);
}

function hydrateMemoryRow(row) {
  return {
    ...row,
    tags: safeJson(row.tagsJson, []),
    confidence: Number(row.confidence),
    importance: Number(row.importance),
    evidenceCount: Number(row.evidenceCount || 0)
  };
}

function normalizeTags(tags) {
  const values = Array.isArray(tags) ? tags : String(tags || '').split(/[,，、\s]+/);
  return [...new Set(values.map(tag => String(tag || '').trim()).filter(Boolean))].slice(0, 12);
}

function normalizeMemoryText(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, '').replace(/[，。,.!！?？、]/g, '');
}

function preferMemoryContent(existing, incoming) {
  const a = String(existing || '').trim();
  const b = String(incoming || '').trim();
  if (b.length > a.length && b.length <= 120) return b;
  return a;
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, Math.round(number * 100) / 100));
}

export function nowIso() {
  return new Date().toISOString();
}

export function saveTrack(db, track) {
  const normalized = normalizeTrack(track);
  db.prepare(`
    INSERT INTO tracks (id, name, artists, album, cover_url, duration_ms, raw_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      artists = excluded.artists,
      album = excluded.album,
      cover_url = excluded.cover_url,
      duration_ms = excluded.duration_ms,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `).run(
    normalized.id,
    normalized.name,
    JSON.stringify(normalized.artists),
    normalized.album,
    normalized.coverUrl,
    normalized.durationMs,
    JSON.stringify(track || {}),
    nowIso()
  );
  return normalized;
}

export function savePlaylist(db, playlist, kind = 'playlist') {
  const id = String(playlist?.id ?? playlist?.playlistId ?? playlist?.resourceId ?? playlist?.coverId ?? kind);
  const name = String(playlist?.name ?? playlist?.playlistName ?? playlist?.title ?? kind);
  const cover = playlist?.coverImgUrl ?? playlist?.coverUrl ?? playlist?.picUrl ?? playlist?.imageUrl ?? null;
  db.prepare(`
    INSERT INTO playlists (id, name, kind, cover_url, raw_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      kind = excluded.kind,
      cover_url = excluded.cover_url,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `).run(id, name, kind, cover, JSON.stringify(playlist || {}), nowIso());
  return { id, name, kind, coverUrl: cover };
}

export function linkPlaylistTrack(db, playlistId, trackId, position = 0) {
  db.prepare(`
    INSERT INTO playlist_tracks (playlist_id, track_id, position)
    VALUES (?, ?, ?)
    ON CONFLICT(playlist_id, track_id) DO UPDATE SET position = excluded.position
  `).run(String(playlistId), String(trackId), Number(position) || 0);
}

export function normalizeTrack(input) {
  const song = input?.song ?? input?.track ?? input?.resource ?? input ?? {};
  const id = String(song.id ?? song.songId ?? song.trackId ?? song.resourceId ?? input?.songId ?? input?.id ?? `local-${Date.now()}`);
  const originalIdValue = song.originalId ?? song.originalSongId ?? song.realSongId ?? input?.originalId ?? input?.originalSongId ?? input?.realSongId ?? null;
  const originalId = originalIdValue === null || originalIdValue === undefined || originalIdValue === '' ? null : String(originalIdValue);
  const name = String(song.name ?? song.songName ?? song.title ?? input?.name ?? 'Unknown Track');
  const artistItems = song.artists ?? song.ar ?? song.singers ?? song.artistList ?? input?.artists ?? [];
  const artists = Array.isArray(artistItems)
    ? artistItems.map((artist) => artist?.name ?? artist?.artistName ?? artist).filter(Boolean).map(String)
    : [String(artistItems)].filter(Boolean);
  const albumObj = song.album ?? song.al ?? input?.album;
  const album = typeof albumObj === 'string' ? albumObj : albumObj?.name ?? albumObj?.albumName ?? null;
  const coverUrl = song.coverUrl ?? song.picUrl ?? song.coverImgUrl ?? song.al?.picUrl ?? song.album?.picUrl ?? input?.coverUrl ?? null;
  const durationMs = Number(song.duration ?? song.dt ?? song.durationMs ?? input?.durationMs ?? 0) || null;
  return { id, originalId, name, artists, album, coverUrl, durationMs };
}

export function listTracks(db, limit = 100) {
  return db.prepare(`
    SELECT id, name, artists, album, cover_url AS coverUrl, duration_ms AS durationMs, raw_json AS rawJson
    FROM tracks
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit).map(hydrateTrackRow);
}

export function getTrackById(db, id) {
  const row = db.prepare(`
    SELECT id, name, artists, album, cover_url AS coverUrl, duration_ms AS durationMs, raw_json AS rawJson
    FROM tracks
    WHERE id = ?
  `).get(String(id));
  return row ? hydrateTrackRow(row) : null;
}

export function listRecentPlays(db, limit = 30) {
  return db.prepare(`
    SELECT p.*, t.name, t.artists, t.album, t.cover_url AS coverUrl, t.duration_ms AS durationMs, t.raw_json AS rawJson
    FROM plays p
    JOIN tracks t ON t.id = p.track_id
    ORDER BY p.played_at DESC
    LIMIT ?
  `).all(limit).map((row) => {
    const raw = safeJson(row.rawJson, {});
    const rawOriginalId = raw?.originalId ?? raw?.song?.originalId ?? raw?.track?.originalId ?? null;
    const { rawJson, ...play } = row;
    return {
      ...play,
      originalId: rawOriginalId === null || rawOriginalId === undefined || rawOriginalId === '' ? null : String(rawOriginalId),
      artists: safeJson(row.artists, [])
    };
  });
}

function hydrateTrackRow(row) {
  const raw = safeJson(row.rawJson, {});
  const rawOriginalId = raw?.originalId ?? raw?.song?.originalId ?? raw?.track?.originalId ?? null;
  const originalId = row.originalId ?? (rawOriginalId === null || rawOriginalId === undefined || rawOriginalId === '' ? null : String(rawOriginalId));
  const { rawJson, ...track } = row;
  return {
    ...track,
    originalId,
    playbackMode: originalId ? 'ncm-cli' : null,
    playable: Boolean(originalId),
    artists: safeJson(row.artists, [])
  };
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

export function seedDemoLibrary(db) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM tracks').get().count;
  if (count > 0) return;
  const tracks = [
    { id: 'demo-1', name: '晚风里的城市', artists: ['myMusic Demo'], album: 'Local Radio', coverUrl: '/assets/cover-1.svg', durationMs: 210000 },
    { id: 'demo-2', name: '雨天慢速公路', artists: ['myMusic Demo'], album: 'Local Radio', coverUrl: '/assets/cover-2.svg', durationMs: 198000 },
    { id: 'demo-3', name: '凌晨两点的合成器', artists: ['myMusic Demo'], album: 'Local Radio', coverUrl: '/assets/cover-3.svg', durationMs: 224000 }
  ];
  const playlist = savePlaylist(db, { id: 'demo-liked', name: 'Demo 红心歌单', coverUrl: '/assets/cover-1.svg' }, 'star');
  tracks.forEach((track, index) => {
    const saved = saveTrack(db, track);
    linkPlaylistTrack(db, playlist.id, saved.id, index);
  });
}
