import crypto from 'node:crypto';
import { generateChatCompletion, getWeatherSummary, synthesizeSpeech } from './ai.mjs';
import { getProfile, resolvePlayableTrack, updateProfile } from './library.mjs';
import { listRecentPlays, listTracks, nowIso, saveTrack } from './db.mjs';
import { searchOnline } from './community.mjs';

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
  let track = await pickTrack(candidates, hour, userMessage, config, db);
  let selected = await resolvePlayableTrack(db, netease, track);
  // Auto-skip unplayable tracks (VIP / no resource)
  for (const fallback of [track, ...candidates].slice(1, 10)) {
    if (selected && selected.playable) break;
    if (!fallback || fallback === track) continue;
    track = fallback;
    selected = await resolvePlayableTrack(db, netease, fallback);
  }
  if (!selected || !selected.playable) selected = normalizeFallbackTrack(candidates[0]);
  saveTrack(db, selected);

  // Was the user's request matched to the selected track?
  const userWanted = userMessage?.trim();
  const selectedName = (selected.name || '').toLowerCase();
  const selectedArtists = (selected.artists || []).join(' ').toLowerCase();
  const matched = userWanted && (
    selectedName.includes(userWanted.toLowerCase()) ||
    selectedArtists.includes(userWanted.toLowerCase())
  );

  const prompt = [
    {
      role: 'system',
      content: '你是 myMusic 的私人 AI 电台主持人。用中文输出一段 40 字以内的自然串场，只介绍即将播放的歌曲。如果用户点的歌没找到，不需要解释或道歉，自然地介绍当前这首就好。'
    },
    {
      role: 'user',
      content: [
        `当前时间：${hour}点`,
        `天气：${weather}`,
        `用户想听：${matched ? userWanted : '随机推荐'}`,
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
  const tracks = listTracks(db, 500);
  const recentIds = new Set(recent.map((play) => play.track_id));
  return tracks.filter((track) => !recentIds.has(track.id)).concat(tracks).slice(0, 120);
}

async function searchLibrary(db, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const tracks = listTracks(db, 500);
  const local = tracks.filter((track) => {
    const name = (track.name || '').toLowerCase();
    const artists = (track.artists || []).join(' ').toLowerCase();
    const album = (track.album || '').toLowerCase();
    return name.includes(q) || artists.includes(q) || album.includes(q);
  }).slice(0, 15);

  // If no local match, try online search via community API
  if (local.length === 0) {
    const online = await searchOnline(q, 5);
    if (online.length) {
      online.forEach(t => saveTrack(db, t));
      return online;
    }
  }
  return local;
}

async function pickTrack(candidates, hour, userMessage, config, db) {
  if (!candidates.length) return { id: 'demo-1', name: '晚风里的城市', artists: ['myMusic Demo'], coverUrl: '/assets/cover-1.svg' };
  const text = userMessage.toLowerCase();

  // User has a specific request
  if (userMessage && userMessage.trim() && !/^(启动|开始|电台|radio|hi|hello|你好|试试|测试)/.test(text)) {
    // Search library for direct matches and put them at front
    const searched = await searchLibrary(db, userMessage);
    const pool = [...searched, ...candidates].slice(0, 40);
    const llmPick = await pickTrackWithLLM(pool, userMessage, config);
    if (llmPick) return llmPick;
  }

  // Simple mood matching fallback
  if (/安静|学习|专注|focus|work/.test(text)) return candidates.find((track) => /piano|钢琴|ambient|lofi|氛围/i.test(`${track.name} ${track.album}`)) || candidates[0];
  if (/开心|运动|跑步|能量|嗨|rock/.test(text)) return candidates.find((track) => /rock|live|dance|摇滚|电/i.test(`${track.name} ${track.album}`)) || candidates[0];

  const index = Math.abs((hour * 7 + new Date().getDate()) % candidates.length);
  return candidates[index];
}

async function pickTrackWithLLM(candidates, userMessage, config) {
  if (!config?.llm?.baseUrl) return null;

  const pool = candidates.slice(0, 40).map((track, i) =>
    `${i}. ${track.name} - ${(track.artists || []).join('/')} [${track.album || '未知专辑'}]`
  ).join('\n');

  const prompt = [
    { role: 'system', content: '你是音乐推荐助手。用户说了想听什么，你从候选列表中选一个最匹配的。只输出数字序号，不要解释。' },
    { role: 'user', content: `用户说：${userMessage}\n\n候选歌曲：\n${pool}\n\n最匹配的序号：` }
  ];

  const response = await generateChatCompletion(config.llm, prompt, () => null);
  if (!response) return null;

  const match = response.match(/\d+/);
  if (!match) return null;
  const index = parseInt(match[0], 10);
  return candidates[index] || null;
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
