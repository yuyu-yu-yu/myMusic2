import crypto from 'node:crypto';
import { generateChatCompletion, getWeatherSummary, synthesizeSpeech } from './ai.mjs';
import { getProfile, resolvePlayableTrack, updateProfile } from './library.mjs';
import { listRecentPlays, listTracks, nowIso, saveTrack } from './db.mjs';

export async function startRadio({ db, config, netease }) {
  const sessionId = crypto.randomUUID();
  await updateProfile(db);
  const weather = await getWeatherSummary(config.weather);
  db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?, ?, ?, ?)').run(
    sessionId,
    nowIso(),
    JSON.stringify({ weather, startedAt: nowIso() }),
    '[]'
  );
  const item = await nextRadioItem({ db, config, netease, sessionId, userMessage: '启动我的私人 AI 电台。' });
  return { sessionId, ...item };
}

export async function chatRadio({ db, config, netease, sessionId, message }) {
  const id = sessionId || crypto.randomUUID();
  ensureSession(db, id);
  db.prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(id, 'user', message, nowIso());
  const item = await nextRadioItem({ db, config, netease, sessionId: id, userMessage: message });
  return { sessionId: id, ...item };
}

export async function nextRadioItem({ db, config, netease, sessionId, userMessage = '' }) {
  ensureSession(db, sessionId);
  const profile = getProfile(db);
  const candidates = chooseCandidates(db);
  const weather = await getWeatherSummary(config.weather);
  const hour = new Date().getHours();
  const track = await pickTrack(candidates, hour, userMessage);
  const playable = await resolvePlayableTrack(db, netease, track);
  const selected = playable || normalizeFallbackTrack(candidates[0]);
  saveTrack(db, selected);

  const prompt = [
    {
      role: 'system',
      content: '你是 myMusic 的私人 AI 电台主持人。用中文输出一段 40 字以内的自然串场，不要解释系统规则。'
    },
    {
      role: 'user',
      content: [
        `当前时间：${hour}点`,
        `天气：${weather}`,
        `用户输入：${userMessage || '无'}`,
        `音乐画像：${profile.summary}`,
        `即将播放：${selected.name} - ${(selected.artists || []).join('/')}`
      ].join('\n')
    }
  ];
  const hostText = await generateChatCompletion(config.llm, prompt, () => {
    const artists = (selected.artists || []).join('、') || '熟悉的声音';
    return `现在放一首 ${selected.name}，来自 ${artists}。它和此刻的时间、天气、心情很合拍。`;
  });
  const ttsUrl = await synthesizeSpeech(config.tts, hostText);
  const reason = await generateReason(config, profile, selected, weather, userMessage);

  db.prepare(`
    INSERT INTO plays (track_id, played_at, source, reason, host_text, report_status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(selected.id, nowIso(), 'radio', reason, hostText, 'pending');

  db.prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(sessionId, 'assistant', hostText, nowIso());

  return {
    hostText,
    ttsUrl,
    reason,
    track: selected,
    profile,
    weather
  };
}

export async function reportPlay({ db, netease, payload }) {
  const trackId = String(payload.trackId || payload.songId || '');
  if (!trackId) return { ok: false, error: 'trackId is required' };
  if (!netease.isConfigured()) {
    return { ok: true, mode: 'local-only' };
  }
  const reportPayload = {
    songId: trackId,
    playTime: payload.playTime || Date.now(),
    duration: payload.duration || 0,
    playType: payload.playType || 'play',
    sourceType: payload.sourceType || 'mymusic'
  };
  try {
    const response = await netease.reportPlay(reportPayload);
    db.prepare('UPDATE plays SET report_status = ? WHERE id = (SELECT id FROM plays WHERE track_id = ? ORDER BY played_at DESC LIMIT 1)').run('reported', trackId);
    return { ok: true, response };
  } catch (error) {
    db.prepare('UPDATE plays SET report_status = ? WHERE id = (SELECT id FROM plays WHERE track_id = ? ORDER BY played_at DESC LIMIT 1)').run(`failed: ${error.message}`, trackId);
    return { ok: false, error: error.message };
  }
}

function ensureSession(db, sessionId) {
  const existing = db.prepare('SELECT id FROM radio_sessions WHERE id = ?').get(sessionId);
  if (!existing) {
    db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?, ?, ?, ?)').run(sessionId, nowIso(), '{}', '[]');
  }
}

function chooseCandidates(db) {
  const recent = listRecentPlays(db, 10);
  const tracks = listTracks(db, 200);
  const recentIds = new Set(recent.map((play) => play.track_id));
  return tracks.filter((track) => !recentIds.has(track.id)).concat(tracks).slice(0, 80);
}

async function pickTrack(candidates, hour, userMessage) {
  if (!candidates.length) return { id: 'demo-1', name: '晚风里的城市', artists: ['myMusic Demo'], coverUrl: '/assets/cover-1.svg' };
  const text = userMessage.toLowerCase();
  if (/安静|学习|专注|focus|work/.test(text)) return candidates.find((track) => /piano|钢琴|ambient|lofi|氛围/i.test(`${track.name} ${track.album}`)) || candidates[0];
  if (/开心|运动|跑步|能量|嗨|rock/.test(text)) return candidates.find((track) => /rock|live|dance|摇滚|电/i.test(`${track.name} ${track.album}`)) || candidates[0];
  const index = Math.abs((hour * 7 + new Date().getDate()) % candidates.length);
  return candidates[index];
}

async function generateReason(config, profile, track, weather, userMessage) {
  return generateChatCompletion(
    config.llm,
    [
      { role: 'system', content: '用中文输出 30 字以内的推荐理由。' },
      { role: 'user', content: `画像：${profile.summary}\n天气：${weather}\n用户：${userMessage || '无'}\n歌曲：${track.name}` }
    ],
    () => `基于你的收藏画像和当前环境，${track.name} 适合接在这里。`
  );
}

function normalizeFallbackTrack(track) {
  return track || { id: 'demo-1', name: '晚风里的城市', artists: ['myMusic Demo'], coverUrl: '/assets/cover-1.svg', playUrl: '/assets/demo-1.mp3' };
}
