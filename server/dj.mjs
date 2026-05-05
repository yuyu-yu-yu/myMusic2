// Conversational AI DJ — unified chat + track selection
import crypto from 'node:crypto';
import { generateChatCompletion, getWeatherSummary, synthesizeSpeech } from './ai.mjs';
import { getProfile, resolvePlayableTrack } from './library.mjs';
import { listRecentPlays, listTracks, nowIso, saveTrack, getSessionMode, setSessionMode, getFeedbackSummaryMap } from './db.mjs';
import { searchOnline } from './community.mjs';
import { getUserPrefs } from './radio.mjs';
import { getGenreDiscoveryKeywords, searchGenres } from './genre.mjs';

const CANDIDATE_LIMIT = 60;
const AUTO_QUOTAS = { library_recent: 18, library_deep: 22, ai_discovery: 20 };
const SEARCH_QUOTAS = { community_search: 24, ai_discovery: 12, library_recent: 12, library_deep: 12 };
const SOURCE_BASE_SCORES = {
  community_search: 70,
  ai_discovery: 45,
  library_recent: 42,
  library_deep: 35
};
const MOODS = new Set(['comfort', 'melancholy', 'calm', 'healing', 'focus', 'energy', 'romantic', 'nostalgic', 'night', 'random']);
const WEATHER_CACHE_MS = 10 * 60 * 1000;

export async function djTurn({ db, config, netease, sessionId, userMessage, conversationMood = null }) {
  ensureSession(db, sessionId);
  const profile = getProfile(db);
  const weather = await getCachedWeather(db, sessionId, config.weather);
  const hour = new Date().getHours();
  const timeOfDay = hour < 6 ? '深夜' : hour < 9 ? '清晨' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 21 ? '傍晚' : '夜晚';
  const mode = getSessionMode(db, sessionId);
  const prefs = getUserPrefs(db);

  // Load conversation history
  const history = loadHistory(db, sessionId);

  // Build candidates
  const candidates = await buildCandidates(db, sessionId, profile, weather, timeOfDay, hour, config, mode, userMessage, conversationMood);

  // Single LLM call: chat + pick
  const result = await callDJ({ db, config, netease, sessionId, candidates, profile, weather, timeOfDay, hour, mode, prefs, history, userMessage, conversationMood });

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
    sessionId,
    chatText: result.chatText,
    track: result.track,
    reason: result.reason,
    ttsUrl,
    mode: result.newMode || mode,
    profile,
    weather
  };
}

export async function chatTurn({ db, config, netease, sessionId, message }) {
  ensureSession(db, sessionId);
  const userMessage = String(message || '').trim();
  const profile = getProfile(db);
  const mode = getSessionMode(db, sessionId);
  const history = loadHistory(db, sessionId);
  const currentTrack = getCurrentTrack(db);
  const context = getSessionContext(db, sessionId);
  const baseMood = analyzeConversationMood({ history, userMessage, profile, currentTrack, mode });
  const explicitIntent = hasExplicitMusicIntent(userMessage);
  const userMessageCountAfterThisTurn = countUserMessages(db, sessionId) + (userMessage ? 1 : 0);
  const canSuggest = canProactivelyRecommend({
    userMessageCount: userMessageCountAfterThisTurn,
    lastSuggestedAtUserCount: context.lastSuggestedAtUserCount,
    currentTrack,
    mood: baseMood
  });
  const chatDecision = await generateChatDecision({
    config,
    profile,
    mode,
    history,
    userMessage,
    currentTrack,
    baseMood,
    explicitIntent,
    canSuggest
  });
  const conversationMood = normalizeMoodDecision({ ...baseMood, ...chatDecision });
  const shouldRecommend = explicitIntent || (canSuggest && conversationMood.shouldRecommend);

  if (shouldRecommend) {
    const result = await djTurn({ db, config, netease, sessionId, userMessage, conversationMood });
    setSessionContext(db, sessionId, {
      ...getSessionContext(db, sessionId),
      lastSuggestedAtUserCount: countUserMessages(db, sessionId)
    });
    return { ...result, conversationMood, intent: explicitIntent ? 'explicit' : 'proactive' };
  }

  if (userMessage) saveMessage(db, sessionId, 'user', userMessage);
  saveMessage(db, sessionId, 'assistant', chatDecision.chatText);
  if (chatDecision.newMode) {
    const newMode = { ...chatDecision.newMode, updatedAt: nowIso() };
    setSessionMode(db, sessionId, newMode);
  }

  return {
    sessionId,
    chatText: chatDecision.chatText,
    track: null,
    reason: '',
    ttsUrl: null,
    mode: chatDecision.newMode || mode,
    profile,
    weather: getSessionContext(db, sessionId).weather || '',
    conversationMood,
    intent: 'chat'
  };
}

function loadHistory(db, sessionId) {
  const rows = db.prepare(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 20'
  ).all(sessionId);
  return rows.reverse().map(r => ({ role: r.role, content: r.content }));
}

function saveMessage(db, sessionId, role, content) {
  db.prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?,?,?,?)')
    .run(sessionId, role, content, nowIso());
}

function getSessionContext(db, sessionId) {
  try {
    const row = db.prepare('SELECT context_json AS contextJson FROM radio_sessions WHERE id = ?').get(sessionId);
    return row ? JSON.parse(row.contextJson || '{}') : {};
  } catch {
    return {};
  }
}

function setSessionContext(db, sessionId, context) {
  db.prepare('UPDATE radio_sessions SET context_json = ? WHERE id = ?')
    .run(JSON.stringify(context || {}), sessionId);
}

async function getCachedWeather(db, sessionId, weatherConfig) {
  const context = getSessionContext(db, sessionId);
  const cachedAt = context.weatherUpdatedAt ? new Date(context.weatherUpdatedAt).getTime() : 0;
  if (context.weather && Date.now() - cachedAt < WEATHER_CACHE_MS) return context.weather;
  const weather = await getWeatherSummary(weatherConfig);
  setSessionContext(db, sessionId, { ...context, weather, weatherUpdatedAt: nowIso() });
  return weather;
}

function getCurrentTrack(db) {
  try {
    return listRecentPlays(db, 1)[0] || null;
  } catch {
    return null;
  }
}

function countUserMessages(db, sessionId) {
  return db.prepare('SELECT COUNT(*) AS count FROM messages WHERE session_id = ? AND role = ?')
    .get(sessionId, 'user').count || 0;
}

export function hasExplicitMusicIntent(text) {
  const value = String(text || '');
  if (/不想听|先别放|不要切|别切|别换/.test(value)) return false;
  return /下一首|换一首|换歌|切歌|播放|放一首|来点|想听|推荐|给我.*(歌|音乐)|有没有.*(歌|音乐)|听.*(歌|音乐)|artist|song|music|play|recommend/i.test(value);
}

export function canProactivelyRecommend({ userMessageCount = 0, lastSuggestedAtUserCount = 0, currentTrack = null, mood = {} } = {}) {
  if (!currentTrack) return Boolean(mood?.shouldRecommend);
  if (userMessageCount < 3) return false;
  if (lastSuggestedAtUserCount && userMessageCount - Number(lastSuggestedAtUserCount) < 3) return false;
  return Boolean(mood?.shouldRecommend);
}

export function analyzeConversationMood({ history = [], userMessage = '', profile = {}, currentTrack = null, mode = {} } = {}) {
  const text = [...history.slice(-12).map(h => h.content), userMessage].join(' ').toLowerCase();
  const result = {
    shouldRecommend: false,
    mood: 'random',
    energy: 'medium',
    intent: 'chat',
    searchHints: [],
    reason: ''
  };

  const setMood = (mood, energy, hints, reason) => {
    result.shouldRecommend = true;
    result.mood = mood;
    result.energy = energy;
    result.searchHints = hints;
    result.reason = reason;
  };

  if (/心情不好|难受|吵架|崩溃|委屈|emo|低落|伤心|难过|烦/.test(text)) {
    setMood('comfort', 'low', ['治愈', '安慰', '温柔', '陪伴'], 'user needs comfort');
  } else if (/睡不着|失眠|深夜|夜里|凌晨/.test(text)) {
    setMood('night', 'low', ['深夜', '安静', '氛围', '睡前'], 'night conversation');
  } else if (/累|疲惫|放松|安静|缓一缓/.test(text)) {
    setMood('calm', 'low', ['放松', '安静', '轻柔', '慢歌'], 'user wants calm');
  } else if (/提神|振作|有劲|运动|跑步|开心|兴奋/.test(text)) {
    setMood('energy', 'high', ['提神', '电子', '节奏', '能量'], 'user wants energy');
  } else if (/想念|怀念|以前|回忆|老歌/.test(text)) {
    setMood('nostalgic', 'medium', ['怀旧', '回忆', '老歌', '温暖'], 'nostalgic tone');
  }

  if (mode?.genre) {
    result.searchHints = [...new Set([mode.genre, ...result.searchHints])];
  }
  return result;
}

async function generateChatDecision({ config, profile, mode, history, userMessage, currentTrack, baseMood, explicitIntent, canSuggest }) {
  const fallback = () => ({
    chatText: fallbackFriendChat(userMessage, baseMood),
    shouldRecommend: explicitIntent || (canSuggest && baseMood.shouldRecommend),
    mood: baseMood.mood,
    energy: baseMood.energy,
    intent: explicitIntent ? 'music' : 'chat',
    searchHints: baseMood.searchHints,
    reason: baseMood.reason,
    newMode: null
  });
  if (!config?.llm?.baseUrl) return fallback();

  const raw = await generateChatCompletion(config.llm, [
    {
      role: 'system',
      content: [
        '你是私人电台 DJ 灿灿，也像熟悉的朋友。',
        '先自然回应听众，不要每句话都转去推荐音乐。',
        '只有明确音乐请求，或情绪稳定到适合接一首歌时，才 shouldRecommend=true。',
        '输出 JSON：{"chatText":"40-120字自然回复","shouldRecommend":boolean,"mood":"comfort|melancholy|calm|healing|focus|energy|romantic|nostalgic|night|random","energy":"low|medium|high","intent":"chat|music|mood","searchHints":["2-6字关键词"],"reason":"简短理由","mode":null或"reset"或偏好名}'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `听众画像：${profile.summary || ''}`,
        `当前模式：${mode?.genre || '无'}`,
        `当前歌曲：${currentTrack?.name || '无'}`,
        `启发式情绪：${JSON.stringify(baseMood)}`,
        `允许主动推荐：${canSuggest}`,
        `明确音乐意图：${explicitIntent}`,
        `最近对话：${history.slice(-10).map(h => `${h.role}: ${h.content}`).join('\n')}`,
        `听众刚说：${userMessage}`
      ].join('\n')
    }
  ], () => JSON.stringify(fallback()));

  try {
    const parsed = JSON.parse(String(raw).replace(/^```json|```$/g, '').trim());
    const normalized = normalizeMoodDecision(parsed);
    return {
      ...normalized,
      chatText: String(parsed.chatText || fallback().chatText).trim(),
      newMode: parsed.mode === 'reset' ? {} : (parsed.mode && typeof parsed.mode === 'string' ? { genre: parsed.mode, note: '用户指定' } : null)
    };
  } catch {
    return fallback();
  }
}

function normalizeMoodDecision(input = {}) {
  const mood = MOODS.has(input.mood) ? input.mood : 'random';
  const hints = Array.isArray(input.searchHints) ? input.searchHints : [];
  return {
    shouldRecommend: Boolean(input.shouldRecommend),
    mood,
    energy: ['low', 'medium', 'high'].includes(input.energy) ? input.energy : 'medium',
    intent: input.intent || 'chat',
    searchHints: [...new Set(hints.map(h => String(h).trim()).filter(Boolean))].slice(0, 5),
    reason: input.reason || ''
  };
}

function fallbackFriendChat(userMessage, mood) {
  if (mood?.mood === 'comfort') return '听起来你现在挺不好受的。先别急着把自己讲清楚，我在这儿陪你缓一缓；要是你愿意，也可以慢慢跟我说发生了什么。';
  if (mood?.mood === 'night') return '夜里人的情绪会被放大一点。你不用马上睡着，先把呼吸放慢，我陪你把这一会儿安静地过过去。';
  if (mood?.mood === 'energy') return '我听出来你想把状态拉起来一点。先把肩膀松一下，我们一点点把节奏找回来。';
  return userMessage ? '我听着呢。你可以继续说，不用急着转到音乐；我会跟着你的状态，觉得合适的时候再接一首歌。' : '我在。想聊什么都可以。';
}

export async function buildCandidates(db, sessionId, profile, weather, timeOfDay, hour, config, mode, userMessage = '', conversationMood = null) {
  const played = db.prepare(
    'SELECT track_id FROM plays ORDER BY played_at DESC LIMIT 300'
  ).all();
  const playedIds = new Set(played.map(p => p.track_id));
  const allTracks = listTracks(db, 5000);

  const recentFavIds = db.prepare('SELECT id FROM tracks ORDER BY updated_at DESC LIMIT 100').all().map(t => t.id);
  const recentFavIdSet = new Set(recentFavIds);
  const recentFavs = allTracks
    .filter(t => recentFavIdSet.has(t.id) && !playedIds.has(t.id))
    .map(track => makeCandidate(track, 'library_recent', 'recent library'));

  const otherFavs = allTracks
    .filter(t => !recentFavIdSet.has(t.id) && !playedIds.has(t.id))
    .map(track => makeCandidate(track, 'library_deep', 'deep library'));

  const [discovery, searchCandidates] = await Promise.all([
    discover(profile, weather, timeOfDay, hour, playedIds, config, mode, conversationMood),
    buildSearchCandidates(db, userMessage, config, playedIds, conversationMood)
  ]);
  const discoveryCandidates = discovery.map(track => makeCandidate(track, 'ai_discovery', 'profile discovery'));

  const rawCandidates = [...searchCandidates, ...discoveryCandidates, ...recentFavs, ...otherFavs];
  const feedbackById = getFeedbackSummaryMap(db, rawCandidates.map(c => c.track?.id));
  return rankAndSelectCandidates(rawCandidates, {
    quotas: userMessage?.trim() || conversationMood?.searchHints?.length ? SEARCH_QUOTAS : AUTO_QUOTAS,
    limit: CANDIDATE_LIMIT,
    feedbackById,
    artistPenaltyByName: getArtistPenaltyByName(db),
    profile,
    mode,
    userMessage,
    conversationMood,
    seed: sessionId
  });
}

async function buildSearchCandidates(db, userMessage, config, playedIds, conversationMood = null) {
  const terms = conversationMood?.searchHints?.length
    ? conversationMood.searchHints
    : (userMessage?.trim() ? await generateSearchTerms(userMessage, config) : []);
  if (!terms.length) return [];
  const candidates = [];
  const seen = new Set();
  await Promise.all([...new Set(terms)].map(async (term) => {
    try {
      const searchResults = await searchOnline(term, 15);
      for (const s of searchResults) {
        if (seen.has(s.id) || playedIds.has(String(s.id))) continue;
        seen.add(s.id);
        saveTrack(db, s);
        candidates.push(makeCandidate(s, 'community_search', term));
      }
    } catch {}
  }));
  return candidates;
}

function makeCandidate(track, source, sourceReason = '') {
  return {
    track,
    source,
    sourceReason,
    score: 0,
    scoreParts: {},
    sources: [source]
  };
}

export function rankAndSelectCandidates(candidates, {
  quotas = AUTO_QUOTAS,
  limit = CANDIDATE_LIMIT,
  feedbackById = new Map(),
  artistPenaltyByName = new Map(),
  profile = {},
  mode = {},
  userMessage = '',
  conversationMood = null,
  seed = ''
} = {}) {
  const merged = new Map();

  for (const candidate of candidates || []) {
    const track = candidate?.track || candidate;
    if (!track?.id) continue;
    const source = candidate.source || 'library_deep';
    const scored = {
      ...candidate,
      track,
      source,
      sourceReason: candidate.sourceReason || '',
      sources: [...new Set([...(candidate.sources || []), source])]
    };
    const { score, scoreParts } = scoreCandidate(scored, {
      feedback: feedbackById.get(String(track.id)),
      artistPenaltyByName,
      profile,
      mode,
      userMessage,
      conversationMood,
      seed
    });
    scored.score = score;
    scored.scoreParts = scoreParts;

    const existing = merged.get(String(track.id));
    if (!existing || scored.score > existing.score) {
      if (existing) scored.sources = [...new Set([...(existing.sources || []), ...(scored.sources || [])])];
      merged.set(String(track.id), scored);
    } else if (existing) {
      existing.sources = [...new Set([...(existing.sources || []), ...(scored.sources || [])])];
    }
  }

  const ranked = [...merged.values()].sort(compareCandidates);
  const selected = [];
  const selectedIds = new Set();

  for (const [source, count] of Object.entries(quotas)) {
    for (const candidate of ranked) {
      if (selected.length >= limit) break;
      if (selected.filter(c => c.source === source).length >= count) break;
      if (candidate.source !== source || selectedIds.has(candidate.track.id)) continue;
      selected.push(candidate);
      selectedIds.add(candidate.track.id);
    }
  }

  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (selectedIds.has(candidate.track.id)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.track.id);
  }

  return selected.slice(0, limit);
}

function scoreCandidate(candidate, { feedback, artistPenaltyByName, profile, mode, userMessage, conversationMood, seed }) {
  const track = candidate.track || {};
  const scoreParts = {
    base: SOURCE_BASE_SCORES[candidate.source] ?? 30,
    feedback: 0,
    artistCooldown: 0,
    profile: 0,
    intent: 0,
    variety: stableVariety(track.id, seed)
  };

  if (feedback) {
    scoreParts.feedback += Math.min((Number(feedback.likes) || 0) * 30, 90);
    scoreParts.feedback -= Math.min((Number(feedback.dislikes) || 0) * 60, 180);
    scoreParts.feedback += Math.min((Number(feedback.completions) || 0) * 4, 20);
    scoreParts.feedback -= Math.min((Number(feedback.skips) || 0) * 8, 30);
  }

  for (const artist of track.artists || []) {
    const penalty = artistPenaltyByName.get(String(artist).toLowerCase()) || 0;
    scoreParts.artistCooldown = Math.min(scoreParts.artistCooldown, penalty);
  }

  const modeText = String(mode?.genre || '').trim().toLowerCase();
  const userText = String(userMessage || '').trim().toLowerCase();
  const trackText = `${track.name || ''} ${(track.artists || []).join(' ')} ${track.album || ''} ${candidate.sourceReason || ''}`.toLowerCase();
  scoreParts.profile += scoreStructuredProfile(track, trackText, profile);
  if (candidate.source === 'community_search' && userText) scoreParts.intent += 20;
  if (candidate.source === 'ai_discovery' && (modeText || userText)) scoreParts.intent += 10;
  if (modeText && trackText.includes(modeText)) scoreParts.intent += 10;
  if (conversationMood?.searchHints?.length) {
    const hintText = conversationMood.searchHints.join(' ').toLowerCase();
    if (candidate.source === 'community_search') scoreParts.intent += 18;
    if (candidate.source === 'ai_discovery') scoreParts.intent += 12;
    if (conversationMood.searchHints.some(hint => trackText.includes(String(hint).toLowerCase()))) scoreParts.intent += 14;
    if (hintText && trackText.includes(String(conversationMood.mood || '').toLowerCase())) scoreParts.intent += 6;
  }

  const score = Object.values(scoreParts).reduce((sum, value) => sum + value, 0);
  return { score, scoreParts };
}

function scoreStructuredProfile(track, trackText, profile = {}) {
  const structured = profile?.structured || {};
  if (!structured || !Object.keys(structured).length) return 0;

  let score = 0;
  const artistNames = new Set((track.artists || []).map(artist => String(artist).trim().toLowerCase()).filter(Boolean));
  for (const item of structured.artists || []) {
    const name = String(item?.name || '').trim().toLowerCase();
    if (!name) continue;
    if (artistNames.has(name)) score += 24 * weightOf(item);
    else if (trackText.includes(name)) score += 10 * weightOf(item);
  }

  const album = String(track.album || '').trim().toLowerCase();
  for (const item of structured.albums || []) {
    const name = String(item?.name || '').trim().toLowerCase();
    if (!name) continue;
    if (album && album === name) score += 12 * weightOf(item);
    else if (name.length >= 3 && trackText.includes(name)) score += 5 * weightOf(item);
  }

  const weakLists = [
    [structured.genres, 8],
    [structured.moods, 7],
    [structured.scenes, 7],
    [structured.languages, 5],
    [structured.eras, 4],
    [structured.energy, 5],
    [structured.discoveryDirections, 9]
  ];
  for (const [items, base] of weakLists) {
    for (const item of items || []) {
      const name = String(item?.name || '').trim().toLowerCase();
      if (name && trackText.includes(name)) score += base * weightOf(item);
    }
  }

  for (const item of structured.avoidSignals || []) {
    const name = String(item?.name || '').trim().toLowerCase();
    if (name && trackText.includes(name)) score -= 45 * weightOf(item);
  }

  return score;
}

function weightOf(item) {
  const weight = Number(item?.weight);
  if (!Number.isFinite(weight)) return 0.4;
  return Math.max(0, Math.min(1, weight));
}

function compareCandidates(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const aName = `${a.track?.name || ''}${a.track?.id || ''}`;
  const bName = `${b.track?.name || ''}${b.track?.id || ''}`;
  return aName.localeCompare(bName);
}

function stableVariety(id, seed) {
  const text = `${seed || 'mymusic'}:${id || ''}`;
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 400) / 100;
}

function getArtistPenaltyByName(db) {
  const recent = listRecentPlays(db, 50);
  const penalties = new Map();
  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;

  for (const play of recent.slice(0, 10)) {
    for (const artist of play.artists || []) {
      const key = String(artist).toLowerCase();
      penalties.set(key, Math.min(penalties.get(key) || 0, -20));
    }
  }

  for (const play of recent) {
    const playedAt = new Date(play.played_at).getTime();
    if (!Number.isFinite(playedAt) || playedAt < threeHoursAgo) continue;
    for (const artist of play.artists || []) {
      const key = String(artist).toLowerCase();
      penalties.set(key, Math.min(penalties.get(key) || 0, -25));
    }
  }

  return penalties;
}

function getStructuredDiscoveryKeywords(profile = {}, limit = 6) {
  const structured = profile?.structured || {};
  const groups = [
    structured.discoveryDirections,
    structured.genres,
    structured.moods,
    structured.scenes,
    structured.languages
  ];
  const keywords = [];
  for (const group of groups) {
    for (const item of group || []) {
      const name = String(item?.name || item || '').trim();
      if (!name) continue;
      keywords.push(name);
      if (keywords.length >= limit) return [...new Set(keywords)].slice(0, limit);
    }
  }
  return [...new Set(keywords)].slice(0, limit);
}

async function discover(profile, weather, timeOfDay, hour, playedIds, config, mode, conversationMood = null) {
  const results = []; const seen = new Set();

  // Collect all search keywords from 3 sources (no more LLM generation)
  const keywords = [
    ...(conversationMood?.searchHints || []),
    ...getStructuredDiscoveryKeywords(profile, 6),
    ...getGenreDiscoveryKeywords(profile.summary, 6)
  ];

  // Deduplicate
  const unique = [...new Set(keywords.map(k => String(k).trim()).filter(Boolean))];

  // Parallel search across ALL keywords
  await Promise.all(unique.map(async (kw) => {
    try {
      const songs = await searchOnline(kw, 12);
      for (const s of songs) {
        if (!seen.has(s.id) && !playedIds.has(s.id)) { seen.add(s.id); results.push(s); }
      }
    } catch {}
  }));

  return results;
}

async function callDJ({ db, config, netease, sessionId, candidates, profile, weather, timeOfDay, hour, mode, prefs, history, userMessage, conversationMood = null }) {
  const pool = candidates.slice(0, CANDIDATE_LIMIT);
  const tracks = pool.map(candidate => candidate.track || candidate);
  const extraCount = pool.filter(candidate => candidate.source === 'community_search').length;
  const poolText = pool.map((candidate, i) => { const t = candidate.track || candidate; return (
    `${i}. ${t.name} —— ${(t.artists || []).join('、')}${t.album ? ' / ' + t.album : ''}（来源：${candidate.source || 'library'}，分数：${Math.round(candidate.score || 0)}）`
  ); }).join('\n');
  const searchNote = extraCount > 0
    ? `\n（候选 0-${extraCount - 1} 是针对"${userMessage?.slice(0, 20)}"的在线搜索结果，优先从这里选。结合你对每首歌的了解判断流派——例如牵丝戏是古风、Geisha是电子世界融合不是国风、半壶纱是中国风民谣）`
    : '';

  const modeText = mode?.genre
    ? `当前模式：${mode.genre}（${mode.note || '用户指定'}）。请严格只推荐此类型的歌曲。`
    : '无特殊模式，自由推荐。';
  const prefNote = prefs?.note ? `用户偏好：${prefs.note}` : '';
  const genreHints = getGenreDiscoveryKeywords(profile.summary, 10);
  const genreNote = genreHints.length ? `听众可能喜欢的音乐风格：${genreHints.join('、')}` : '';
  const moodNote = conversationMood?.mood && conversationMood.mood !== 'random'
    ? `最近对话情绪：${conversationMood.mood}，能量：${conversationMood.energy}，搜索提示：${(conversationMood.searchHints || []).join('、')}。推荐要贴合这段对话的情绪。`
    : '';

  const systemPrompt = [
    '你是灿灿，私人电台 DJ。你的风格：温暖、真诚，像深夜电台的老朋友。',
    '你会和听众自然聊天，在对话中自然引出音乐推荐，不生硬转折。',
    '',
    `此刻：${timeOfDay} ${hour}点，${weather}`,
    `听众画像：${profile.summary}`,
    modeText,
    prefNote,
    genreNote,
    moodNote,
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
  if (pick < 0 || pick >= tracks.length) {
    return { chatText, track: null, reason: '', newMode };
  }

  let selectedTrack = tracks[pick] || tracks[0];
  let finalChatText = chatText;

  const playable = await resolvePlayableTrack(db, netease, selectedTrack, { includeLyric: true });
  if (!playable?.playable) {
    let found = false;
    for (let offset = 1; offset <= 5; offset++) {
      const nextTrack = tracks[(pick + offset) % tracks.length];
      if (nextTrack === selectedTrack) continue;
      const nextPlayable = await resolvePlayableTrack(db, netease, nextTrack, { includeLyric: true });
      if (nextPlayable?.playable) {
        selectedTrack = nextPlayable;
        finalChatText = `来听一首 ${selectedTrack.name} 吧，${(selectedTrack.artists || []).join('、')}的。`;
        found = true;
        break;
      }
    }
    if (!found) selectedTrack = playable || tracks[0];
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
