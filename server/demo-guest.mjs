import { normalizeAccountContext, resolveAccountContext } from './account-scope.mjs';
import { getAccountSetting, getSetting, normalizeAccountId, nowIso, setAccountSetting } from './db.mjs';

export const DEMO_GUEST_PREFIX = 'demo:guest:';

const COPY_SETTING_KEYS = [
  'user_preferences',
  'profile_excluded_playlist_ids',
  'library_synced_user_id',
  'library_synced_playlist_ids'
];

export function resolveRequestAccountContext(db, config, req) {
  const baseAccount = resolveAccountContext(db);
  if (!config?.demo?.guestMode) return baseAccount;
  const visitorId = getVisitorIdFromRequest(req);
  if (!visitorId) return baseAccount;
  return ensureDemoGuestAccount(db, visitorId, baseAccount);
}

export function getVisitorIdFromRequest(req, body = null) {
  const headerValue = req?.headers?.['x-demo-visitor-id'];
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue || body?.visitorId || '';
  return normalizeVisitorId(raw);
}

export function ensureDemoGuestAccount(db, visitorId, baseAccount = resolveAccountContext(db)) {
  const normalizedVisitorId = normalizeVisitorId(visitorId);
  if (!normalizedVisitorId) return baseAccount;
  const base = normalizeAccountContext(baseAccount);
  const accountId = normalizeAccountId(`${DEMO_GUEST_PREFIX}${normalizedVisitorId}`);
  const existingSeededAt = getAccountSetting(db, accountId, 'demo_guest_seeded_at');
  if (!existingSeededAt) seedDemoGuestAccount(db, accountId, base);
  setAccountSetting(db, accountId, 'demo_guest_last_seen', nowIso());
  return normalizeAccountContext({
    accountId,
    provider: 'demo',
    providerUserId: base.providerUserId || '',
    source: 'guest',
    nickname: base.nickname ? `${base.nickname} · Demo` : 'Demo Guest',
    isAuthenticated: false
  });
}

export function cleanupDemoGuest(db, visitorId) {
  const normalizedVisitorId = normalizeVisitorId(visitorId);
  if (!normalizedVisitorId) return { ok: false, deleted: 0 };
  return deleteGuestAccountData(db, `${DEMO_GUEST_PREFIX}${normalizedVisitorId}`);
}

export function cleanupExpiredDemoGuests(db, ttlHours = 24) {
  const cutoff = new Date(Date.now() - Math.max(1, Number(ttlHours) || 24) * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT account_id AS accountId
    FROM account_settings
    WHERE key = 'demo_guest_last_seen'
      AND account_id LIKE ?
      AND value < ?
  `).all(`${DEMO_GUEST_PREFIX}%`, cutoff);
  let deleted = 0;
  for (const row of rows) {
    deleted += deleteGuestAccountData(db, row.accountId).deleted;
  }
  return { ok: true, deleted, accounts: rows.length };
}

function seedDemoGuestAccount(db, accountId, base) {
  for (const key of COPY_SETTING_KEYS) {
    const value = getAccountSetting(db, base.accountId, key) ?? getSetting(db, key);
    if (value !== null && value !== undefined) setAccountSetting(db, accountId, key, value);
  }
  if (!getAccountSetting(db, accountId, 'library_synced_user_id') && base.providerUserId) {
    setAccountSetting(db, accountId, 'library_synced_user_id', base.providerUserId);
  }
  cloneMusicProfile(db, accountId, base.accountId);
  setAccountSetting(db, accountId, 'demo_guest_base_account_id', base.accountId);
  setAccountSetting(db, accountId, 'demo_guest_seeded_at', nowIso());
}

function cloneMusicProfile(db, accountId, baseAccountId) {
  const row = db.prepare(`
    SELECT summary, tags_json AS tagsJson, profile_json AS profileJson, updated_at AS updatedAt
    FROM account_music_profiles
    WHERE account_id = ?
  `).get(baseAccountId) || db.prepare(`
    SELECT summary, tags_json AS tagsJson, profile_json AS profileJson, updated_at AS updatedAt
    FROM music_profile
    WHERE id = 1
  `).get();
  if (!row) return;
  db.prepare(`
    INSERT INTO account_music_profiles (account_id, summary, tags_json, profile_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET
      summary = excluded.summary,
      tags_json = excluded.tags_json,
      profile_json = excluded.profile_json,
      updated_at = excluded.updated_at
  `).run(accountId, row.summary, row.tagsJson || '[]', row.profileJson || '{}', row.updatedAt || nowIso());
}

function deleteGuestAccountData(db, accountId) {
  const normalizedAccountId = normalizeAccountId(accountId);
  if (!normalizedAccountId.startsWith(DEMO_GUEST_PREFIX)) return { ok: false, deleted: 0 };
  const tables = [
    'messages',
    'radio_sessions',
    'plays',
    'mood_events',
    'track_feedback_events',
    'track_feedback_summary',
    'user_memories',
    'account_settings',
    'account_music_profiles',
    'diary_entries',
    'diary_signal_feedback'
  ];
  let deleted = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of tables) {
      const result = db.prepare(`DELETE FROM ${table} WHERE account_id = ?`).run(normalizedAccountId);
      deleted += result.changes || 0;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { ok: true, deleted };
}

function normalizeVisitorId(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,80}$/.test(text)) return '';
  return text;
}
