// Conversational AI DJ — unified chat + track selection
import crypto from 'node:crypto';
import { generateChatCompletion, getWeatherSummary, synthesizeSpeech } from './ai.mjs';
import { getProfile, resolvePlayableTrack } from './library.mjs';
import { listRecentPlays, listTracks, nowIso, saveTrack, getSessionMode, setSessionMode } from './db.mjs';
import { searchOnline } from './community.mjs';
import { getUserPrefs } from './radio.mjs';
import { getGenreDiscoveryKeywords, searchGenres } from './genre.mjs';

export async function djTurn({ db, config, netease, sessionId, userMessage }) {
  ensureSession(db, sessionId);
  const profile = getProfile(db);
  const weather = await getWeatherSummary(config.weather);
  const hour = new Date().getHours();
  const timeOfDay = hour < 6 ? '深夜' : hour < 9 ? '清晨' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 21 ? '傍晚' : '夜晚';
  const mode = getSessionMode(db, sessionId);
  const prefs = getUserPrefs(db);

  // Load conversation history
  const history = loadHistory(db, sessionId);

  // Build candidates
  const candidates = await buildCandidates(db, sessionId, profile, weather, timeOfDay, hour, config, mode);

  // Single LLM call: chat + pick
  const result = await callDJ({ db, config, netease, sessionId, candidates, profile, weather, timeOfDay, hour, mode, prefs, history, userMessage });

  // Save to DB
  if (userMessage) {
    db.prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?,?,?,?)')
      .run(sessionId, 'user', userMessage, nowIso());
  }
  db.prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?,?,?,?)')
    .run(sessionId, 'assistant', result.chatText, nowIso());
  if (result.track) {
    db.prepare('INSERT INTO plays (track_id, played_at, source, reason, host_text, report_status) VALUES (?,?,?,?,?,?)')
      .run(result.track.id, nowIso(), 'radio', result.reason, result.chatText, 'pending');
    saveTrack(db, result.track);
  }

  // Persist mode if changed
  if (result.newMode) {
    const newMode = result.newMode;
    newMode.updatedAt = nowIso();
    setSessionMode(db, sessionId, newMode);
    mode.genre = newMode.genre;
    mode.note = newMode.note;
  }

  // TTS
  const ttsUrl = await synthesizeSpeech(config.tts, result.chatText);

  return {
    chatText: result.chatText,
    track: result.track,
    reason: result.reason,
    ttsUrl,
    mode: result.newMode || mode,
    profile,
    weather
  };
}

function loadHistory(db, sessionId) {
  const rows = db.prepare(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 20'
  ).all(sessionId);
  return rows.reverse().map(r => ({ role: r.role, content: r.content }));
}

async function buildCandidates(db, sessionId, profile, weather, timeOfDay, hour, config, mode) {
  const played = db.prepare(
    'SELECT track_id FROM plays WHERE track_id IN (SELECT track_id FROM plays ORDER BY played_at DESC LIMIT 300)'
  ).all();
  const playedIds = new Set(played.map(p => p.track_id));
  const allTracks = listTracks(db, 5000);

  // 20%: Recent 100
  const recentFavIds = db.prepare('SELECT id FROM tracks ORDER BY updated_at DESC LIMIT 100').all().map(t => t.id);
  const recentFavs = allTracks.filter(t => recentFavIds.includes(t.id) && !playedIds.has(t.id));

  // 40%: Other library
  const otherFavs = allTracks.filter(t => !recentFavIds.includes(t.id) && !playedIds.has(t.id));

  // 40%: Discovery
  const discovery = recentFavs.length ? await discover(profile, weather, timeOfDay, hour, playedIds, config, mode) : [];

  const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);
  return [...shuffle(recentFavs).slice(0, 24), ...shuffle(otherFavs).slice(0, 48), ...shuffle(discovery).slice(0, 48)].slice(0, 120);
}

async function discover(profile, weather, timeOfDay, hour, playedIds, config, mode) {
  const results = []; const seen = new Set();

  // 1. Genre-based discovery from RateYourMusic database
  const genreKeywords = getGenreDiscoveryKeywords(profile.summary, 6);
  for (const kw of genreKeywords) {
    try {
      const songs = await searchOnline(kw, 12);
      for (const s of songs) {
        if (!seen.has(s.id) && !playedIds.has(s.id)) { seen.add(s.id); results.push(s); }
      }
    } catch {}
  }

  // 2. LLM-generated discovery keywords (mood/scene/context)
  if (config?.llm?.baseUrl) {
    const modeHint = mode?.genre ? `（当前偏好模式：${mode.genre}）` : '';
    const kwPrompt = [
      { role: 'system', content: `根据画像和氛围，生成 3 个搜索词用于发现新歌（不是流派名，是情绪/场景/语种等）。${modeHint}每个词 2-6 字，逗号分隔，只输出关键词。` },
      { role: 'user', content: `画像：${profile.summary}\n氛围：${timeOfDay} ${hour}点，${weather}\n关键词：` }
    ];
    const kwText = await generateChatCompletion(config.llm, kwPrompt, () => null) || '';
    const moodKeywords = kwText.split(/[,，、\n]/).map(s => s.trim()).filter(Boolean).slice(0, 3);

    for (const kw of moodKeywords) {
      try {
        const songs = await searchOnline(kw, 12);
        for (const s of songs) {
          if (!seen.has(s.id) && !playedIds.has(s.id)) { seen.add(s.id); results.push(s); }
        }
      } catch {}
    }
  }

  return results;
}

async function callDJ({ db, config, netease, sessionId, candidates, profile, weather, timeOfDay, hour, mode, prefs, history, userMessage }) {
  // If user mentions a specific artist/song/genre, search online
  let extraCandidates = [];
  if (userMessage?.trim()) {
    // Let DeepSeek decide the optimal search terms
    const searchTerms = await generateSearchTerms(userMessage, config);

    const seen = new Set();
    for (const term of [...new Set(searchTerms)]) {
      try {
        const searchResults = await searchOnline(term, 15);
        for (const s of searchResults) {
          if (!seen.has(s.id)) { seen.add(s.id); extraCandidates.push(s); saveTrack(db, s); }
        }
      } catch {}
    }
  }

  const pool = [...extraCandidates, ...candidates].slice(0, 60);
  const extraCount = Math.min(extraCandidates.length, pool.length);
  const poolText = pool.map((t, i) =>
    `${i}. ${t.name} —— ${(t.artists || []).join('、')}${t.album ? ' / ' + t.album : ''}`
  ).join('\n');
  const searchNote = extraCount > 0
    ? `\n（候选 0-${extraCount - 1} 是针对"${userMessage?.slice(0, 20)}"的在线搜索结果，优先从这里选。结合你对每首歌的了解判断流派——例如牵丝戏是古风、Geisha是电子世界融合不是国风、半壶纱是中国风民谣）`
    : '';

  const modeText = mode?.genre
    ? `当前模式：${mode.genre}（${mode.note || '用户指定'}）。请严格只推荐此类型的歌曲。`
    : '无特殊模式，自由推荐。';
  const prefNote = prefs?.note ? `用户偏好：${prefs.note}` : '';
  const genreHints = getGenreDiscoveryKeywords(profile.summary, 10);
  const genreNote = genreHints.length ? `听众可能喜欢的音乐风格：${genreHints.join('、')}` : '';

  const systemPrompt = [
    '你是灿灿，私人电台 DJ。你的风格：温暖、真诚，像深夜电台的老朋友。',
    '你会和听众自然聊天，在对话中自然引出音乐推荐，不生硬转折。',
    '',
    `此刻：${timeOfDay} ${hour}点，${weather}`,
    `听众画像：${profile.summary}`,
    modeText,
    prefNote,
    genreNote,
    '',
    '规则：',
    '- 先回应听众的话题（如果有），再自然引出推荐',
    '- 如果听众没说话，主动根据氛围推荐',
    '- 严格遵守当前模式，不要推荐模式外的歌曲',
    '- 如果听众提到某个艺人或歌曲，我已经在线搜索过并放入了候选列表，不要说"曲库里没有"',
    '- 如果听众要的风格（如国风、爵士、摇滚）在候选池里没有找到合适的，诚实说"我搜了一下，曲库里这类歌不多"，然后推荐风格相近的替代',,
    '- 聊天文本 40-120 字，自然、温暖',
    '- 输出格式：<CHAT>聊天文本</CHAT> 然后 <JSON>{"pick":数字或null,"reason":"理由","mode":null}</JSON>',
    '- 音乐常识：国风=中国风/古风（不是日本风），民谣=folk，说唱=rap/hip-hop，电音=electronic/EDM',
    '- 像真正的电台 DJ 朋友一样，自然地聊天',
    '- 大部分时候只聊天不切歌，让当前歌曲继续播',
    '- 如果听众明确点歌或要求换歌，立即推新歌',
    '- 如果聊天聊到某个情绪或话题，你感觉有首歌特别契合，可以自然地说"说到这个，有首歌..."然后推歌——但要有分寸，不要每句话都推',
    '- 不要因为候选曲目里恰好有和听众问题同名的歌就推荐——那是巧合',
    '- 歌曲结束自动续播时，pick 必然填数字',
    '- mode 字段：如果听众明确指定了新偏好（如「后面都听国风」），设为 "国风"；如果听众要求恢复正常，设为 "reset"；否则 null'
  ].join('\n');

  const userPrompt = [
    `候选曲目：\n${poolText}${searchNote}`,
    `对话历史：${history.length ? '\n' + history.map(h => `[${h.role === 'user' ? '听众' : '灿灿'}]: ${h.content}`).join('\n') : '（新对话）'}`,
    userMessage ? `\n听众说：${userMessage}\n（当前歌曲播放中。你可以聊天，也可以在感觉对的时候自然推歌——像朋友聊天时说到"诶有首很适合的"。不要强行推，不要因为候选池里有同名的歌就推。）` : '\n（上一首播完了，请自然推荐下一首）'
  ].join('\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const raw = await generateChatCompletion(config.llm, messages, () => `<CHAT>${fallbackChat(timeOfDay, weather, profile)}</CHAT><JSON>{"pick":0,"reason":"根据氛围推荐","mode":null}</JSON>`);

  const chatMatch = raw.match(/<CHAT>([\s\S]*?)<\/CHAT>/);
  const jsonMatch = raw.match(/<JSON>([\s\S]*?)<\/JSON>/);
  const chatText = chatMatch ? chatMatch[1].trim() : raw.split('<JSON>')[0]?.replace(/<CHAT>|<\/CHAT>/g, '').trim() || fallbackChat(timeOfDay, weather, profile);

  let pick = -1, reason = '', newMode = null;
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      pick = parsed.pick === null || parsed.pick === undefined ? -1 : Math.min(Number(parsed.pick), pool.length - 1);
      reason = parsed.reason || '';
      if (parsed.mode === 'reset') {
        newMode = {};
      } else if (parsed.mode && typeof parsed.mode === 'string') {
        newMode = { genre: parsed.mode, note: '用户指定' };
      }
    } catch { pick = -1; }
  }

  // No song this turn — just chat
  if (pick < 0 || pick >= pool.length) {
    return { chatText, track: null, reason: '', newMode };
  }

  let selectedTrack = pool[pick] || pool[0];
  let finalChatText = chatText;

  const playable = await resolvePlayableTrack(db, netease, selectedTrack);
  if (!playable?.playable) {
    let found = false;
    for (let offset = 1; offset <= 5; offset++) {
      const nextTrack = pool[(pick + offset) % pool.length];
      if (nextTrack === selectedTrack) continue;
      const nextPlayable = await resolvePlayableTrack(db, netease, nextTrack);
      if (nextPlayable?.playable) {
        selectedTrack = nextPlayable;
        finalChatText = `来听一首 ${selectedTrack.name} 吧，${(selectedTrack.artists || []).join('、')}的。`;
        found = true;
        break;
      }
    }
    if (!found) selectedTrack = playable || pool[0];
  } else {
    selectedTrack = playable;
  }

  return { chatText: finalChatText, track: selectedTrack, reason: reason || '根据你的口味推荐', newMode };
}



async function generateSearchTerms(userMessage, config) {
  if (!config?.llm?.baseUrl) return [userMessage.trim()];
  const text = await generateChatCompletion(config.llm, [
    { role: 'system', content: '你是音乐搜索专家。把用户的话转化成3-5个搜索关键词。理解用户真实意图：比如"古风DJ"意思是古风风格的电子混音/remix，搜"古风 DJ""古风 remix""古风 电子"。只输出关键词，逗号分隔，不要解释。' },
    { role: 'user', content: `用户说：${userMessage}\n搜索关键词：` }
  ], () => userMessage.trim());
  const terms = (text || '').split(/[,，、\n]/).map(s => s.trim()).filter(Boolean);
  return [userMessage.trim(), ...terms].slice(0, 6);
}
function fallbackChat(timeOfDay, weather, profile) {
  const greetings = {
    '深夜': '夜深了，星星都睡了，我还在。来，听首歌吧。',
    '清晨': '早安。新的一天，从一首好歌开始。',
    '上午': '上午好，工作学习也要有好音乐陪着。',
    '中午': '午休时间，放松一下。',
    '下午': '下午好，困了吗？来首提神的。',
    '傍晚': '天快黑了，窗外的风景怎么样？',
    '夜晚': '晚上好。今天过得怎么样？来首歌放松一下。'
  };
  return greetings[timeOfDay] || '你好呀，我是灿灿。来，听首歌吧。';
}

function ensureSession(db, sessionId) {
  const existing = db.prepare('SELECT id FROM radio_sessions WHERE id = ?').get(sessionId);
  if (!existing) {
    db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?,?,?,?)')
      .run(sessionId, nowIso(), '{}', '[]');
  }
}
