import { nowIso } from './db.mjs';
import { normalizeAccountContext, resolveAccountContext } from './account-scope.mjs';
import { getDiaryOverview } from './music-recap.mjs';

export async function generateDiary(db, config, date = today(), accountContext = null) {
  const account = getDiaryAccountContext(db, accountContext);
  const timeZone = config?.app?.timeZone || config?.weather?.timeZone || 'Asia/Shanghai';
  const overview = getDiaryOverview(db, {
    accountContext: account,
    days: 7,
    date,
    localDate: todayInTimeZone(timeZone),
    timeZone
  });
  const detail = overview.detail;
  const title = `${date} 音乐回顾`;
  const content = buildDeterministicContent(detail);
  const moodTags = detail.signals.filter(signal => signal.effective).map(signal => signal.label).slice(0, 4);
  const trackIds = detail.tracks.map(track => track.id).filter(Boolean);
  const now = nowIso();
  db.prepare(`
    INSERT INTO diary_entries (account_id, date, title, content, mood_tags, track_ids, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, date) DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      mood_tags = excluded.mood_tags,
      track_ids = excluded.track_ids,
      updated_at = excluded.updated_at
  `).run(account.accountId, date, title, content, JSON.stringify(moodTags), JSON.stringify(trackIds), now, now);
  return getDiary(db, date, account);
}

export function getDiary(db, date = today(), accountContext = null) {
  const account = getDiaryAccountContext(db, accountContext);
  const row = db.prepare('SELECT * FROM diary_entries WHERE account_id = ? AND date = ?').get(account.accountId, date);
  if (!row) return null;
  return {
    date: row.date,
    title: row.title,
    content: row.content,
    moodTags: safeJsonArray(row.mood_tags),
    trackIds: safeJsonArray(row.track_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listDiaries(db, accountContext = null) {
  const account = getDiaryAccountContext(db, accountContext);
  return db.prepare(`
    SELECT date, title, content, mood_tags AS moodTags, updated_at AS updatedAt
    FROM diary_entries
    WHERE account_id = ?
    ORDER BY date DESC
    LIMIT 30
  `).all(account.accountId).map(row => ({ ...row, moodTags: safeJsonArray(row.moodTags) }));
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

function buildDeterministicContent(detail = {}) {
  if (!detail.hasActivity) return '暂无有效记录。';
  const metrics = detail.metrics || {};
  const parts = [
    `播放 ${Number(metrics.plays || 0)} 首`,
    `完整播放 ${Number(metrics.completed || 0)} 次`,
    `跳过 ${Number(metrics.skipped || 0)} 次`,
    `喜欢 ${Number(metrics.liked || 0)} 次`
  ];
  if (detail.dominantPeriod?.label) parts.push(`主要收听时段为${detail.dominantPeriod.label}`);
  return `${parts.join('，')}。`;
}

function todayInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).reduce((result, item) => ({ ...result, [item.type]: item.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getDiaryAccountContext(db, accountContext = null) {
  return accountContext ? normalizeAccountContext(accountContext) : resolveAccountContext(db);
}
