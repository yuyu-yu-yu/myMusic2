import { generateChatCompletion } from './ai.mjs';
import { listRecentPlays, nowIso } from './db.mjs';
import { getProfile } from './library.mjs';
import { normalizeAccountContext, resolveAccountContext } from './account-scope.mjs';

export async function generateDiary(db, config, date = today(), accountContext = null) {
  const account = getDiaryAccountContext(db, accountContext);
  const start = `${date}T00:00:00.000Z`;
  const end = `${date}T23:59:59.999Z`;
  const plays = db.prepare(`
    SELECT p.*, t.name, t.artists, t.album
    FROM plays p
    JOIN tracks t ON t.id = p.track_id
    WHERE p.account_id = ? AND p.played_at BETWEEN ? AND ?
    ORDER BY p.played_at ASC
  `).all(account.accountId, start, end).map((row) => ({ ...row, artists: JSON.parse(row.artists || '[]') }));
  const fallbackPlays = plays.length ? plays : listRecentPlays(db, 8, account.accountId);
  const profile = getProfile(db, account);
  const trackNames = fallbackPlays.map((play) => `${play.name} - ${(play.artists || []).join('/')}`).join('；');
  const content = await generateChatCompletion(
    config.llm,
    [
      { role: 'system', content: '你是私人音乐博客作者。用中文写一段 180 字以内的音乐日记，口吻自然克制。' },
      { role: 'user', content: `日期：${date}\n音乐画像：${profile.summary}\n播放记录：${trackNames || '暂无'}\n请总结今天的音乐情绪。` }
    ],
    () => fallbackDiary(date, fallbackPlays, profile)
  );
  const moodTags = inferMoodTags(content, fallbackPlays);
  const title = `${date} 的音乐日记`;
  const ids = fallbackPlays.map((play) => play.track_id || play.id).filter(Boolean);
  db.prepare(`
    INSERT INTO diary_entries (account_id, date, title, content, mood_tags, track_ids, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, date) DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      mood_tags = excluded.mood_tags,
      track_ids = excluded.track_ids,
      updated_at = excluded.updated_at
  `).run(account.accountId, date, title, content, JSON.stringify(moodTags), JSON.stringify(ids), nowIso(), nowIso());
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
    moodTags: JSON.parse(row.mood_tags || '[]'),
    trackIds: JSON.parse(row.track_ids || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listDiaries(db, accountContext = null) {
  const account = getDiaryAccountContext(db, accountContext);
  return db.prepare('SELECT date, title, content, mood_tags AS moodTags, updated_at AS updatedAt FROM diary_entries WHERE account_id = ? ORDER BY date DESC LIMIT 30')
    .all(account.accountId)
    .map((row) => ({ ...row, moodTags: JSON.parse(row.moodTags || '[]') }));
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

function fallbackDiary(date, plays, profile) {
  const first = plays[0]?.name || '还没有正式播放的歌';
  return `${date}，myMusic 根据你的音乐画像整理了一次私人播放。今天的入口是《${first}》。${profile.summary} 接下来可以继续让电台根据天气、时间和你的对话慢慢修正推荐。`;
}

function inferMoodTags(content, plays) {
  const text = `${content} ${plays.map((play) => play.name).join(' ')}`;
  const tags = [];
  if (/夜|晚|静|慢|雨/.test(text)) tags.push('安静');
  if (/能量|热|跑|快|摇滚/.test(text)) tags.push('有能量');
  if (/专注|工作|学习/.test(text)) tags.push('专注');
  if (!tags.length) tags.push('私人电台');
  return tags.slice(0, 4);
}

function getDiaryAccountContext(db, accountContext = null) {
  return accountContext ? normalizeAccountContext(accountContext) : resolveAccountContext(db);
}
