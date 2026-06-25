import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_ACCOUNT_ID = 'local:default';

export function openDatabase(rootDir = process.cwd()) {
  const dataDir = path.join(rootDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'mymusic.sqlite'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  migrateAccountScope(db);
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
      account_id TEXT NOT NULL DEFAULT 'local:default',
      track_id TEXT NOT NULL,
      played_at TEXT NOT NULL,
      source TEXT,
      reason TEXT,
      host_text TEXT,
      report_status TEXT
    );

    CREATE TABLE IF NOT EXISTS radio_sessions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL DEFAULT 'local:default',
      created_at TEXT NOT NULL,
      context_json TEXT NOT NULL DEFAULT '{}',
      queue_json TEXT NOT NULL DEFAULT '[]',
	      mode_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL DEFAULT 'local:default',
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
      account_id TEXT NOT NULL DEFAULT 'local:default',
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      mood_tags TEXT NOT NULL DEFAULT '[]',
      track_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, date)
    );

    CREATE TABLE IF NOT EXISTS diary_signal_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL DEFAULT 'local:default',
      date TEXT NOT NULL,
      signal_id TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL
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
      account_id TEXT NOT NULL DEFAULT 'local:default',
      track_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      session_id TEXT,
      elapsed_ms INTEGER,
      duration_ms INTEGER,
      source TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS track_feedback_summary (
      account_id TEXT NOT NULL DEFAULT 'local:default',
      track_id TEXT NOT NULL,
      likes INTEGER NOT NULL DEFAULT 0,
      dislikes INTEGER NOT NULL DEFAULT 0,
      completions INTEGER NOT NULL DEFAULT 0,
      skips INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, track_id)
    );

    CREATE TABLE IF NOT EXISTS user_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL DEFAULT 'local:default',
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

    CREATE TABLE IF NOT EXISTS mood_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL DEFAULT 'local:default',
      session_id TEXT,
      mood TEXT NOT NULL,
      energy TEXT NOT NULL DEFAULT 'medium',
      music_intent TEXT NOT NULL DEFAULT 'chat',
      source TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_settings (
      account_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, key)
    );

    CREATE TABLE IF NOT EXISTS account_music_profiles (
      account_id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      profile_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedule_contexts (
      account_id TEXT PRIMARY KEY,
      context_json TEXT NOT NULL DEFAULT '{}',
      fingerprint TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function migrateAccountScope(db) {
  const bootstrapAccountId = getBootstrapAccountId(db);
  try { db.exec("ALTER TABLE radio_sessions ADD COLUMN mode_json TEXT NOT NULL DEFAULT '{}'"); } catch {}
  try { db.exec("ALTER TABLE music_profile ADD COLUMN profile_json TEXT NOT NULL DEFAULT '{}'"); } catch {}

  addAccountIdColumn(db, 'user_memories', bootstrapAccountId);
  addAccountIdColumn(db, 'radio_sessions', bootstrapAccountId);
  addAccountIdColumn(db, 'messages', bootstrapAccountId);
  addAccountIdColumn(db, 'plays', bootstrapAccountId);
  addAccountIdColumn(db, 'track_feedback_events', bootstrapAccountId);
  addAccountIdColumn(db, 'mood_events', bootstrapAccountId);
  migrateFeedbackSummaryTable(db, bootstrapAccountId);
  migrateDiaryEntriesTable(db, bootstrapAccountId);
  seedAccountScopedSettings(db, bootstrapAccountId);
  seedAccountMusicProfile(db, bootstrapAccountId);

  try { db.exec('CREATE INDEX IF NOT EXISTS idx_user_memories_account_updated ON user_memories(account_id, updated_at DESC)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_messages_account_session ON messages(account_id, session_id, id)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_plays_account_played ON plays(account_id, played_at DESC)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_feedback_events_account_created ON track_feedback_events(account_id, created_at DESC)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_mood_events_account_created ON mood_events(account_id, created_at DESC)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_diary_feedback_account_created ON diary_signal_feedback(account_id, created_at DESC)'); } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_schedule_contexts_expires ON schedule_contexts(expires_at)'); } catch {}
}

function addAccountIdColumn(db, table, accountId) {
  if (!tableExists(db, table) || columnExists(db, table, 'account_id')) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN account_id TEXT NOT NULL DEFAULT '${DEFAULT_ACCOUNT_ID}'`);
  db.prepare(`UPDATE ${table} SET account_id = ? WHERE account_id = ? OR account_id IS NULL OR account_id = ''`)
    .run(normalizeAccountId(accountId), DEFAULT_ACCOUNT_ID);
}

function migrateFeedbackSummaryTable(db, accountId) {
  if (!tableExists(db, 'track_feedback_summary')) return;
  const columns = tableColumns(db, 'track_feedback_summary');
  const hasAccountId = columns.some(column => column.name === 'account_id');
  const trackPkOnly = columns.some(column => column.name === 'track_id' && Number(column.pk) === 1)
    && !columns.some(column => column.name === 'account_id' && Number(column.pk) > 0);
  if (hasAccountId && !trackPkOnly) return;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS track_feedback_summary_new (
        account_id TEXT NOT NULL,
        track_id TEXT NOT NULL,
        likes INTEGER NOT NULL DEFAULT 0,
        dislikes INTEGER NOT NULL DEFAULT 0,
        completions INTEGER NOT NULL DEFAULT 0,
        skips INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, track_id)
      )
    `);
    const sql = hasAccountId
      ? `INSERT OR REPLACE INTO track_feedback_summary_new (account_id, track_id, likes, dislikes, completions, skips, updated_at)
         SELECT COALESCE(NULLIF(account_id, ''), ?), track_id, likes, dislikes, completions, skips, updated_at
         FROM track_feedback_summary`
      : `INSERT OR REPLACE INTO track_feedback_summary_new (account_id, track_id, likes, dislikes, completions, skips, updated_at)
         SELECT ?, track_id, likes, dislikes, completions, skips, updated_at
         FROM track_feedback_summary`;
    db.prepare(sql).run(normalizeAccountId(accountId));
    db.exec('DROP TABLE track_feedback_summary');
    db.exec('ALTER TABLE track_feedback_summary_new RENAME TO track_feedback_summary');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function migrateDiaryEntriesTable(db, accountId) {
  if (!tableExists(db, 'diary_entries')) return;
  const columns = tableColumns(db, 'diary_entries');
  const hasAccountId = columns.some(column => column.name === 'account_id');
  const datePkOnly = columns.some(column => column.name === 'date' && Number(column.pk) === 1)
    && !columns.some(column => column.name === 'account_id' && Number(column.pk) > 0);
  if (hasAccountId && !datePkOnly) return;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS diary_entries_new (
        account_id TEXT NOT NULL,
        date TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        mood_tags TEXT NOT NULL DEFAULT '[]',
        track_ids TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, date)
      )
    `);
    const sql = hasAccountId
      ? `INSERT OR REPLACE INTO diary_entries_new (account_id, date, title, content, mood_tags, track_ids, created_at, updated_at)
         SELECT COALESCE(NULLIF(account_id, ''), ?), date, title, content, mood_tags, track_ids, created_at, updated_at
         FROM diary_entries`
      : `INSERT OR REPLACE INTO diary_entries_new (account_id, date, title, content, mood_tags, track_ids, created_at, updated_at)
         SELECT ?, date, title, content, mood_tags, track_ids, created_at, updated_at
         FROM diary_entries`;
    db.prepare(sql).run(normalizeAccountId(accountId));
    db.exec('DROP TABLE diary_entries');
    db.exec('ALTER TABLE diary_entries_new RENAME TO diary_entries');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function seedAccountScopedSettings(db, accountId) {
  if (!tableExists(db, 'settings') || !tableExists(db, 'account_settings')) return;
  const scopedKeys = [
    'user_preferences',
    'profile_excluded_playlist_ids',
    'library_synced_user_id',
    'library_synced_playlist_ids'
  ];
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO account_settings (account_id, key, value, updated_at)
    SELECT ?, key, value, updated_at FROM settings WHERE key = ?
  `);
  for (const key of scopedKeys) stmt.run(normalizeAccountId(accountId), key);
}

function seedAccountMusicProfile(db, accountId) {
  if (!tableExists(db, 'music_profile') || !tableExists(db, 'account_music_profiles')) return;
  const row = db.prepare('SELECT summary, tags_json AS tagsJson, profile_json AS profileJson, updated_at AS updatedAt FROM music_profile WHERE id = 1').get();
  if (!row) return;
  db.prepare(`
    INSERT OR IGNORE INTO account_music_profiles (account_id, summary, tags_json, profile_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(normalizeAccountId(accountId), row.summary, row.tagsJson || '[]', row.profileJson || '{}', row.updatedAt || nowIso());
}

function getBootstrapAccountId(db) {
  const loginSource = getSettingSafe(db, 'netease_login_source');
  const cookieUserId = getSettingSafe(db, 'netease_cookie_user_id');
  const openapiUserId = getSettingSafe(db, 'netease_user_id');
  if (loginSource === 'cookie' && cookieUserId) return `netease:cookie:${cookieUserId}`;
  if (loginSource === 'openapi' && openapiUserId) return `netease:openapi:${openapiUserId}`;
  if (cookieUserId) return `netease:cookie:${cookieUserId}`;
  if (openapiUserId) return `netease:openapi:${openapiUserId}`;
  return DEFAULT_ACCOUNT_ID;
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function columnExists(db, table, column) {
  return tableColumns(db, table).some(item => item.name === column);
}

function tableColumns(db, table) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all();
  } catch {
    return [];
  }
}

function getSettingSafe(db, key) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : '';
  } catch {
    return '';
  }
}

export function normalizeAccountId(accountId) {
  const value = String(accountId || '').trim();
  return value || DEFAULT_ACCOUNT_ID;
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

export function getAccountSetting(db, accountId, key) {
  const row = db.prepare('SELECT value FROM account_settings WHERE account_id = ? AND key = ?')
    .get(normalizeAccountId(accountId), String(key));
  return row ? row.value : null;
}

export function setAccountSetting(db, accountId, key, value) {
  db.prepare(`
    INSERT INTO account_settings (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(normalizeAccountId(accountId), String(key), String(value ?? ''), nowIso());
}

export function deleteAccountSettings(db, accountId, keys = []) {
  const cleanKeys = (Array.isArray(keys) ? keys : [keys]).map(key => String(key || '').trim()).filter(Boolean);
  if (!cleanKeys.length) return { ok: true, deleted: 0 };
  const placeholders = cleanKeys.map(() => '?').join(',');
  const result = db.prepare(`
    DELETE FROM account_settings
    WHERE account_id = ? AND key IN (${placeholders})
  `).run(normalizeAccountId(accountId), ...cleanKeys);
  return { ok: true, deleted: result.changes || 0 };
}

export function getScheduleContext(db, accountId = DEFAULT_ACCOUNT_ID) {
  const row = db.prepare(`
    SELECT context_json AS contextJson, fingerprint, version,
           fetched_at AS fetchedAt, expires_at AS expiresAt, updated_at AS updatedAt
    FROM schedule_contexts
    WHERE account_id = ?
  `).get(normalizeAccountId(accountId));
  if (!row) return null;
  return {
    context: safeJson(row.contextJson, {}),
    fingerprint: row.fingerprint || '',
    version: Number(row.version || 0),
    fetchedAt: row.fetchedAt || null,
    expiresAt: row.expiresAt || null,
    updatedAt: row.updatedAt || null
  };
}

export function saveScheduleContext(db, {
  accountId = DEFAULT_ACCOUNT_ID,
  context = {},
  fingerprint = '',
  version = 0,
  fetchedAt = nowIso(),
  expiresAt = nowIso()
} = {}) {
  const updatedAt = nowIso();
  db.prepare(`
    INSERT INTO schedule_contexts (
      account_id, context_json, fingerprint, version, fetched_at, expires_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET
      context_json = excluded.context_json,
      fingerprint = excluded.fingerprint,
      version = excluded.version,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run(
    normalizeAccountId(accountId),
    JSON.stringify(context || {}),
    String(fingerprint || '').slice(0, 64),
    Math.max(0, Number(version || 0)),
    String(fetchedAt || updatedAt),
    String(expiresAt || updatedAt),
    updatedAt
  );
  return getScheduleContext(db, accountId);
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
  accountId = DEFAULT_ACCOUNT_ID,
  trackId,
  eventType,
  sessionId = null,
  elapsedMs = null,
  durationMs = null,
  source = null,
  createdAt = nowIso()
} = {}) {
  const id = String(trackId || '').trim();
  const type = String(eventType || '').trim();
  const column = feedbackColumns[type];
  const scopedAccountId = normalizeAccountId(accountId);
  if (!id) throw new Error('trackId is required');
  if (!column) throw new Error('eventType must be one of like, dislike, complete, skip');

  const now = normalizeIsoTimestamp(createdAt) || nowIso();
  db.prepare(`
    INSERT INTO track_feedback_events (account_id, track_id, event_type, session_id, elapsed_ms, duration_ms, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    scopedAccountId,
    id,
    type,
    sessionId ? String(sessionId) : null,
    elapsedMs === null || elapsedMs === undefined ? null : Math.max(0, Number(elapsedMs) || 0),
    durationMs === null || durationMs === undefined ? null : Math.max(0, Number(durationMs) || 0),
    source ? String(source) : null,
    now
  );

  db.prepare(`
    INSERT INTO track_feedback_summary (account_id, track_id, ${column}, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(account_id, track_id) DO UPDATE SET
      ${column} = ${column} + 1,
      updated_at = excluded.updated_at
  `).run(scopedAccountId, id, now);

  return getTrackFeedbackSummary(db, id, scopedAccountId);
}

function normalizeIsoTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return '';
  return date.toISOString();
}

export function getTrackFeedbackSummary(db, trackId, accountId = DEFAULT_ACCOUNT_ID) {
  return db.prepare(`
    SELECT account_id AS accountId, track_id AS trackId, likes, dislikes, completions, skips, updated_at AS updatedAt
    FROM track_feedback_summary
    WHERE account_id = ? AND track_id = ?
  `).get(normalizeAccountId(accountId), String(trackId));
}

export function getFeedbackSummaryMap(db, trackIds, accountId = DEFAULT_ACCOUNT_ID) {
  const ids = [...new Set((trackIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT account_id AS accountId, track_id AS trackId, likes, dislikes, completions, skips, updated_at AS updatedAt
    FROM track_feedback_summary
    WHERE account_id = ? AND track_id IN (${placeholders})
  `).all(normalizeAccountId(accountId), ...ids);
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
  accountId = DEFAULT_ACCOUNT_ID,
  kind,
  content,
  tags = [],
  confidence = 0.5,
  importance = 0.5,
  sourceSessionId = null
} = {}) {
  const normalizedKind = memoryKinds.has(kind) ? kind : null;
  const normalizedContent = String(content || '').trim();
  const scopedAccountId = normalizeAccountId(accountId);
  if (!normalizedKind) throw new Error('invalid memory kind');
  if (!normalizedContent) throw new Error('memory content is required');

  const cleanTags = normalizeTags(tags);
  const now = nowIso();
  const existing = findMergeCandidate(db, scopedAccountId, normalizedKind, normalizedContent, cleanTags);

  if (existing) {
    const mergedTags = [...new Set([...safeJson(existing.tagsJson, []), ...cleanTags])].slice(0, 12);
    const evidenceCount = Number(existing.evidenceCount || 0) + 1;
    const nextConfidence = clamp01(Math.max(Number(existing.confidence) || 0, Number(confidence) || 0) + 0.05);
    const nextImportance = clamp01(Math.max(Number(existing.importance) || 0, Number(importance) || 0));
    db.prepare(`
      UPDATE user_memories
      SET content = ?, tags_json = ?, confidence = ?, importance = ?,
          evidence_count = ?, last_seen_at = ?, updated_at = ?
      WHERE id = ? AND account_id = ?
    `).run(
      preferMemoryContent(existing.content, normalizedContent),
      JSON.stringify(mergedTags),
      nextConfidence,
      nextImportance,
      evidenceCount,
      now,
      now,
      existing.id,
      scopedAccountId
    );
    return getUserMemory(db, existing.id, scopedAccountId);
  }

  const result = db.prepare(`
    INSERT INTO user_memories (
      account_id, kind, content, tags_json, confidence, importance, evidence_count,
      source_session_id, first_seen_at, last_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    scopedAccountId,
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
  return getUserMemory(db, result.lastInsertRowid, scopedAccountId);
}

export function listUserMemories(db, options = 200) {
  const { accountId, limit } = normalizeMemoryListOptions(options);
  return db.prepare(`
    SELECT id, account_id AS accountId, kind, content, tags_json AS tagsJson, confidence, importance,
           evidence_count AS evidenceCount, source_session_id AS sourceSessionId,
           first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, updated_at AS updatedAt
    FROM user_memories
    WHERE account_id = ?
    ORDER BY updated_at DESC, importance DESC, confidence DESC
    LIMIT ?
  `).all(normalizeAccountId(accountId), Math.max(1, Number(limit) || 200)).map(hydrateMemoryRow);
}

export function getUserMemory(db, id, accountId = DEFAULT_ACCOUNT_ID) {
  const row = db.prepare(`
    SELECT id, account_id AS accountId, kind, content, tags_json AS tagsJson, confidence, importance,
           evidence_count AS evidenceCount, source_session_id AS sourceSessionId,
           first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, updated_at AS updatedAt
    FROM user_memories
    WHERE id = ? AND account_id = ?
  `).get(Number(id), normalizeAccountId(accountId));
  return row ? hydrateMemoryRow(row) : null;
}

export function deleteUserMemory(db, id, accountId = DEFAULT_ACCOUNT_ID) {
  const result = db.prepare('DELETE FROM user_memories WHERE id = ? AND account_id = ?')
    .run(Number(id), normalizeAccountId(accountId));
  return { ok: true, deleted: result.changes || 0 };
}

export function updateUserMemoryContent(db, id, content, accountId = DEFAULT_ACCOUNT_ID) {
  const normalizedContent = String(content || '').trim().slice(0, 180);
  const scopedAccountId = normalizeAccountId(accountId);
  if (!normalizedContent) {
    return { ok: false, status: 400, error: 'memory content is required' };
  }
  const result = db.prepare(`
    UPDATE user_memories
    SET content = ?, updated_at = ?
    WHERE id = ? AND account_id = ?
  `).run(normalizedContent, nowIso(), Number(id), scopedAccountId);
  if (!result.changes) {
    return { ok: false, status: 404, error: 'memory not found' };
  }
  return { ok: true, memory: getUserMemory(db, id, scopedAccountId) };
}

export function clearUserMemories(db, accountId = DEFAULT_ACCOUNT_ID) {
  const result = db.prepare('DELETE FROM user_memories WHERE account_id = ?').run(normalizeAccountId(accountId));
  return { ok: true, deleted: result.changes || 0 };
}

const moodLabels = {
  focus: '专注',
  comfort: '疲惫/陪伴',
  melancholy: '疲惫/陪伴',
  healing: '疲惫/陪伴',
  calm: '放松',
  energy: '开心/提神',
  night: '深夜',
  random: '随机探索',
  romantic: '放松',
  nostalgic: '随机探索'
};

const moodBuckets = [
  { id: 'focus', label: '专注', moods: ['focus'] },
  { id: 'comfort', label: '疲惫/陪伴', moods: ['comfort', 'melancholy', 'healing'] },
  { id: 'calm', label: '放松', moods: ['calm', 'romantic'] },
  { id: 'energy', label: '开心/提神', moods: ['energy'] },
  { id: 'night', label: '深夜', moods: ['night'] },
  { id: 'random', label: '随机探索', moods: ['random', 'nostalgic'] }
];

export function recordMoodEvent(db, {
  accountId = DEFAULT_ACCOUNT_ID,
  sessionId = null,
  mood = 'random',
  energy = 'medium',
  musicIntent = 'chat',
  source = null,
  createdAt = nowIso()
} = {}) {
  const normalizedMood = Object.hasOwn(moodLabels, mood) ? mood : 'random';
  const normalizedEnergy = ['low', 'medium', 'high'].includes(energy) ? energy : 'medium';
  db.prepare(`
    INSERT INTO mood_events (account_id, session_id, mood, energy, music_intent, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalizeAccountId(accountId),
    sessionId ? String(sessionId) : null,
    normalizedMood,
    normalizedEnergy,
    String(musicIntent || 'chat').slice(0, 40),
    source ? String(source).slice(0, 40) : null,
    createdAt
  );
  return { ok: true };
}

export function getMoodStats(db, { accountId = DEFAULT_ACCOUNT_ID, windowDays = 30 } = {}) {
  const days = Math.max(1, Math.min(90, Number(windowDays) || 30));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT mood,
           COUNT(*) AS count,
           MAX(created_at) AS updatedAt
    FROM mood_events
    WHERE account_id = ? AND created_at >= ?
    GROUP BY mood
  `).all(normalizeAccountId(accountId), cutoff);
  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const latest = rows.reduce((value, row) => {
    const updatedAt = row.updatedAt || '';
    return updatedAt > value ? updatedAt : value;
  }, '');
  const buckets = moodBuckets.map((bucket) => {
    const matching = rows.filter(item => bucket.moods.includes(item.mood));
    const count = matching.reduce((sum, row) => sum + Number(row.count || 0), 0);
    const updatedAt = matching.reduce((value, row) => {
      const rowUpdatedAt = row.updatedAt || '';
      return rowUpdatedAt > value ? rowUpdatedAt : value;
    }, '');
    return {
      id: bucket.id,
      label: bucket.label,
      count,
      ratio: total ? Math.round((count / total) * 1000) / 1000 : 0,
      updatedAt: updatedAt || null
    };
  });
  return {
    ok: true,
    windowDays: days,
    total,
    updatedAt: latest || null,
    buckets
  };
}

export function retrieveRelevantMemories(db, {
  accountId = DEFAULT_ACCOUNT_ID,
  text = '',
  mood = null,
  mode = null,
  limit = 8,
  maxChars = 800
} = {}) {
  const memories = listUserMemories(db, { accountId, limit: 300 });
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

function findMergeCandidate(db, accountId, kind, content, tags) {
  const rows = db.prepare(`
    SELECT id, kind, content, tags_json AS tagsJson, confidence, importance,
           evidence_count AS evidenceCount
    FROM user_memories
    WHERE account_id = ? AND kind = ?
    ORDER BY updated_at DESC
    LIMIT 100
  `).all(normalizeAccountId(accountId), kind);
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

function normalizeMemoryListOptions(options) {
  if (options && typeof options === 'object' && !Array.isArray(options)) {
    return {
      accountId: options.accountId || DEFAULT_ACCOUNT_ID,
      limit: options.limit ?? 200
    };
  }
  return {
    accountId: DEFAULT_ACCOUNT_ID,
    limit: options
  };
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
  const rawTrackCount = playlist?.trackCount ?? playlist?.songCount ?? playlist?.count ?? playlist?.resourceCount ?? playlist?.musicCount ?? playlist?.size ?? null;
  const trackCount = Number.isFinite(Number(rawTrackCount)) ? Math.max(0, Math.floor(Number(rawTrackCount))) : null;
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
  return { id, name, kind, coverUrl: cover, trackCount };
}

export function linkPlaylistTrack(db, playlistId, trackId, position = 0) {
  db.prepare(`
    INSERT INTO playlist_tracks (playlist_id, track_id, position)
    VALUES (?, ?, ?)
    ON CONFLICT(playlist_id, track_id) DO UPDATE SET position = excluded.position
  `).run(String(playlistId), String(trackId), Number(position) || 0);
}

export function replacePlaylistTracks(db, playlistId, trackIds = []) {
  const id = String(playlistId || '').trim();
  if (!id) throw new Error('playlistId is required');
  const normalizedIds = [...new Set((trackIds || [])
    .map((trackId) => String(trackId || '').trim())
    .filter(Boolean))];
  const deleteStmt = db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?');
  const insertStmt = db.prepare(`
    INSERT INTO playlist_tracks (playlist_id, track_id, position)
    VALUES (?, ?, ?)
    ON CONFLICT(playlist_id, track_id) DO UPDATE SET position = excluded.position
  `);

  db.exec('BEGIN IMMEDIATE');
  try {
    deleteStmt.run(id);
    normalizedIds.forEach((trackId, index) => {
      insertStmt.run(id, trackId, index);
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function clearPlaylistLibrary(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM playlist_tracks').run();
    db.prepare('DELETE FROM playlists').run();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
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

export function listRecentPlays(db, limit = 30, accountId = DEFAULT_ACCOUNT_ID) {
  return db.prepare(`
    SELECT p.*, t.name, t.artists, t.album, t.cover_url AS coverUrl, t.duration_ms AS durationMs, t.raw_json AS rawJson
    FROM plays p
    JOIN tracks t ON t.id = p.track_id
    WHERE p.account_id = ?
    ORDER BY p.played_at DESC
    LIMIT ?
  `).all(normalizeAccountId(accountId), limit).map((row) => {
    const raw = safeJson(row.rawJson, {});
    const rawOriginalId = raw?.originalId ?? raw?.song?.originalId ?? raw?.track?.originalId ?? null;
    const { rawJson, ...play } = row;
    return {
      ...play,
      originalId: rawOriginalId === null || rawOriginalId === undefined || rawOriginalId === '' ? null : String(rawOriginalId),
      semanticTags: raw?.semanticTags || null,
      language: raw?.language || raw?.semanticTags?.language || '',
      genreFamily: raw?.genreFamily || raw?.semanticTags?.genreFamily || '',
      energyBand: raw?.energyBand || raw?.semanticTags?.energyBand || '',
      tagEvidence: raw?.tagEvidence || raw?.semanticTags?.tagEvidence || [],
      artists: safeJson(row.artists, [])
    };
  });
}

function hydrateTrackRow(row) {
  const raw = safeJson(row.rawJson, {});
  const rawOriginalId = raw?.originalId ?? raw?.song?.originalId ?? raw?.track?.originalId ?? null;
  const originalId = row.originalId ?? (rawOriginalId === null || rawOriginalId === undefined || rawOriginalId === '' ? null : String(rawOriginalId));
  const playUrl = typeof raw?.playUrl === 'string' && raw.playUrl ? raw.playUrl : null;
  const { rawJson, ...track } = row;
  return {
    ...track,
    originalId,
    playbackMode: originalId ? 'ncm-cli' : null,
    playable: Boolean(originalId),
    playUrl,
    semanticTags: raw?.semanticTags || null,
    language: raw?.language || raw?.semanticTags?.language || '',
    genreFamily: raw?.genreFamily || raw?.semanticTags?.genreFamily || '',
    energyBand: raw?.energyBand || raw?.semanticTags?.energyBand || '',
    tagEvidence: raw?.tagEvidence || raw?.semanticTags?.tagEvidence || [],
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
  const count = db.prepare("SELECT COUNT(*) AS count FROM playlist_tracks WHERE playlist_id = 'demo-liked'").get().count;
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
