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

export function setSessionMode(db, sessionId, mode) {
  db.prepare('UPDATE radio_sessions SET mode_json = ? WHERE id = ?')
    .run(JSON.stringify(mode || {}), sessionId);
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
