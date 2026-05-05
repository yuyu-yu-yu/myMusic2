// Conversational AI DJ — unified chat + track selection
import { generateChatCompletion, getWeatherSummary, synthesizeSpeech } from './ai.mjs';
import { getProfile, resolvePlayableTrack } from './library.mjs';
import {
  listRecentPlays,
  listTracks,
  nowIso,
  saveTrack,
  getSessionMode,
  setSessionMode,
  getFeedbackSummaryMap,
  recordOrMergeUserMemory,
  retrieveRelevantMemories,
  memoryKinds
} from './db.mjs';
import { searchOnline } from './community.mjs';
import { getUserPrefs } from './radio.mjs';
import { getGenreDiscoveryKeywords } from './genre.mjs';

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
const SESSION_SUMMARY_MIN_MESSAGES = 12;
const SESSION_SUMMARY_STEP = 8;
const LONG_MEMORY_LIMIT = 8;
const LONG_MEMORY_MAX_CHARS = 800;
const KNOWN_ARTIST_ALIASES = [
  ['陈奕迅', ['Eason', 'Eason Chan']],
  ['周杰伦', ['Jay Chou', 'Jay']],
  ['林俊杰', ['JJ Lin', 'JJ']],
  ['薛之谦', []],
  ['毛不易', []],
  ['李荣浩', []],
  ['邓紫棋', ['G.E.M.', 'GEM']],
  ['张学友', []],
  ['王菲', []],
  ['孙燕姿', []],
  ['五月天', ['Mayday']],
  ['许嵩', []],
  ['汪苏泷', []],
  ['方大同', []],
  ['陶喆', []],
  ['梁静茹', []],
  ['Taylor Swift', []],
  ['Adele', []],
  ['Billie Eilish', []],
  ['Coldplay', []]
];
const GENERIC_ARTIST_PHRASES = new Set([
  '适合写代码',
  '写代码',
  '安静',
  '伤感',
  '开心',
  '国风',
  '古风',
  '爵士',
  '摇滚',
  '民谣',
  '电子',
  '电音',
  '英文',
  '中文',
  '日语',
  '纯音乐',
  '慢歌',
  '快歌'
].map(normalizeMusicText));

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
  const sessionSummary = await updateSessionSummary(db, config, sessionId);
  const longTermMemories = retrieveRelevantMemories(db, {
    text: userMessage || conversationMood?.reason || '',
    mood: conversationMood,
    mode,
    limit: LONG_MEMORY_LIMIT,
    maxChars: LONG_MEMORY_MAX_CHARS
  });
  const memoryContext = buildMemoryContext({ sessionSummary, longTermMemories });

  // Build candidates
  const candidates = await buildCandidates(db, sessionId, profile, weather, timeOfDay, hour, config, mode, userMessage, conversationMood);

  // Single LLM call: chat + pick
  const result = await callDJ({ db, config, netease, sessionId, candidates, profile, weather, timeOfDay, hour, mode, prefs, history, userMessage, conversationMood, memoryContext });

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
  if (userMessage) {
    scheduleMemoryExtraction({ db, config, sessionId, userMessage, assistantText: result.chatText, conversationMood });
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
  const weather = await getCachedWeather(db, sessionId, config.weather);
  const hour = new Date().getHours();
  const timeOfDay = hour < 6 ? '深夜' : hour < 9 ? '清晨' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 21 ? '傍晚' : '夜晚';
  const prefs = getUserPrefs(db);

  // Mood tags from conversation text (not action decisions)
  const baseMood = analyzeConversationMood({ history, userMessage, profile, currentTrack, mode });

  const sessionSummary = await updateSessionSummary(db, config, sessionId);
  const longTermMemories = retrieveRelevantMemories(db, {
    text: userMessage,
    mood: baseMood,
    mode,
    limit: LONG_MEMORY_LIMIT,
    maxChars: LONG_MEMORY_MAX_CHARS
  });
  const memoryContext = buildMemoryContext({ sessionSummary, longTermMemories });

  // --- Safety valves (gentle guidance, not hard restrictions) ---
  const rejectMusic = /不想听|先别放|不要放|别放|先别切|不要切|别切|别换|先聊|陪我聊|不放歌/.test(userMessage);
  const emotionalDistress = /睡不着|失眠|心情不好|难受|吵架|崩溃|委屈|emo|低落|伤心|难过|烦/.test(userMessage);
  const hasMusicKeyword = /下一首|换一首|换歌|切歌|播放|放一首|来一首|来首|来点|想听|推荐|给我.*(歌|音乐)|有没有.*(歌|音乐)|听.*(歌|音乐)/i.test(userMessage);

  let candidates;
  let safetyNote = '';

  if (!userMessage) {
    // Safety valve 1: empty message = auto-continue
    candidates = await buildCandidates(db, sessionId, profile, weather, timeOfDay, hour, config, mode, '', null);
    safetyNote = '上一首播完了，pick 填数字。';
  } else if (rejectMusic) {
    // Safety valve 2: user explicitly rejects music
    candidates = buildLightPool(db, sessionId);
    safetyNote = '用户不想听歌，pick 填 null。';
  } else if (emotionalDistress && !hasMusicKeyword) {
    // Safety valve 3: emotional distress without music intent
    candidates = buildLightPool(db, sessionId);
    safetyNote = '用户情绪可能不太好，pick 填 null。';
  } else {
    // Default: free conversation — LLM decides when to recommend
    candidates = await buildCandidates(db, sessionId, profile, weather, timeOfDay, hour, config, mode, userMessage, baseMood);
  }

  const conversationMood = normalizeMoodDecision({
    ...baseMood,
    shouldRecommend: !userMessage || hasMusicKeyword || !!baseMood.shouldRecommend,
    intent: hasMusicKeyword ? 'music' : 'chat',
    searchHints: baseMood.searchHints || []
  });

  const result = await callDJ({ db, config, netease, sessionId, candidates, profile, weather, timeOfDay, hour, mode, prefs, history, userMessage, conversationMood, memoryContext, safetyNote });

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
  if (userMessage) {
    scheduleMemoryExtraction({ db, config, sessionId, userMessage, assistantText: result.chatText, conversationMood });
  }

  // Persist mode if changed
  if (result.newMode) {
    const newMode = { ...result.newMode, updatedAt: nowIso() };
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
    weather,
    intent: result.track ? 'music' : 'chat'
  };
}

export async function updateSessionSummary(db, config, sessionId) {
  const context = getSessionContext(db, sessionId);
  const stats = db.prepare('SELECT COUNT(*) AS count, MAX(id) AS latestId FROM messages WHERE session_id = ?')
    .get(sessionId);
  const count = Number(stats?.count || 0);
  const latestId = Number(stats?.latestId || 0);
  const summarizedId = Number(context.sessionSummaryMessageId || 0);
  if (count < SESSION_SUMMARY_MIN_MESSAGES) return context.sessionSummary || '';
  if (summarizedId && latestId - summarizedId < SESSION_SUMMARY_STEP) return context.sessionSummary || '';
  if (!config?.llm?.baseUrl || !config?.llm?.apiKey || !config?.llm?.model) return context.sessionSummary || '';

  const rows = db.prepare(
    'SELECT id, role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 60'
  ).all(sessionId).reverse();
  const raw = await generateChatCompletion(config.llm, [
    {
      role: 'system',
      content: [
        '你是灿灿的会话记忆整理器。',
        '把当前 session 压缩成 200-500 字中文摘要，保留用户最近状态、重要话题、偏好、边界和灿灿已回应过的内容。',
        '不要加入长期音乐画像，不要编造。只输出摘要文本。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        context.sessionSummary ? `已有摘要：${context.sessionSummary}` : '已有摘要：无',
        `最近对话：\n${rows.map(row => `${row.role}: ${row.content}`).join('\n')}`
      ].join('\n')
    }
  ], () => context.sessionSummary || '');

  const summary = String(raw || '').trim().slice(0, 700);
  if (!summary) return context.sessionSummary || '';
  setSessionContext(db, sessionId, {
    ...getSessionContext(db, sessionId),
    sessionSummary: summary,
    sessionSummaryMessageId: latestId,
    sessionSummaryUpdatedAt: nowIso()
  });
  return summary;
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

export function normalizeMusicText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s·・.．,，、\-_/\\（）()《》<>[\]【】"'“”‘’!！?？:：;；~～]/g, '');
}

function buildArtistConstraint(label, aliases = []) {
  const cleanLabel = String(label || '').trim();
  const names = [...new Set([cleanLabel, ...aliases].map(name => String(name || '').trim()).filter(Boolean))];
  const normalizedAliases = [...new Set(names.map(normalizeMusicText).filter(Boolean))];
  if (!cleanLabel || !normalizedAliases.length) return null;
  return { label: cleanLabel, aliases: names, normalizedAliases };
}

function findKnownArtistConstraint(text) {
  const normalizedText = normalizeMusicText(text);
  if (!normalizedText) return null;
  for (const [label, aliases] of KNOWN_ARTIST_ALIASES) {
    const constraint = buildArtistConstraint(label, aliases);
    if (constraint.normalizedAliases.some(alias => alias.length >= 2 && normalizedText.includes(alias))) {
      return constraint;
    }
  }
  return null;
}

function findLibraryArtistConstraint(text, tracks = []) {
  const normalizedText = normalizeMusicText(text);
  if (!normalizedText) return null;
  const artists = new Map();
  for (const track of tracks || []) {
    for (const artist of track?.artists || []) {
      const name = String(artist || '').trim();
      const normalized = normalizeMusicText(name);
      if (normalized.length < 2) continue;
      if (!artists.has(normalized)) artists.set(normalized, name);
    }
  }
  const ordered = [...artists.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [normalized, name] of ordered) {
    if (normalizedText.includes(normalized)) return buildArtistConstraint(name, [normalized]);
  }
  return null;
}

function extractArtistPhrase(text) {
  const value = String(text || '').trim();
  const patterns = [
    /(?:想听|听|播放|放|来点|来几首|推荐)(?:几首|一首|一些|一点|点|首)?([^，。？！,.!?]{2,24}?)(?:的)?(?:歌|歌曲|音乐|作品|专辑)/,
    /(?:后面|接下来|以后|之后)(?:想)?(?:听|放)(?:几首|一首|一些|一点|点|首)?([^，。？！,.!?]{2,24}?)(?:的)?(?:歌|歌曲|音乐|作品|专辑)/
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match?.[1]) continue;
    const phrase = match[1]
      .replace(/^(我|给我|帮我|后面|接下来|以后|之后|都|只|全|几首|一首|一些|一点|点|首|想|听|要|来点|放|播放|推荐)+/g, '')
      .replace(/(的|歌|歌曲|音乐|作品|专辑)+$/g, '')
      .trim();
    const normalized = normalizeMusicText(phrase);
    if (normalized.length >= 2 && normalized.length <= 16 && !GENERIC_ARTIST_PHRASES.has(normalized)) {
      return phrase;
    }
  }
  return '';
}

export function extractRequestedArtistConstraint(text, tracks = [], mode = {}) {
  const direct = findKnownArtistConstraint(text) || findLibraryArtistConstraint(text, tracks);
  if (direct) return direct;

  const phrase = extractArtistPhrase(text);
  if (phrase) {
    const fromPhrase = findKnownArtistConstraint(phrase) || findLibraryArtistConstraint(phrase, tracks);
    if (fromPhrase) return fromPhrase;
  }

  const modeText = String(mode?.genre || '').trim();
  if (!modeText) return null;
  return findKnownArtistConstraint(modeText) || findLibraryArtistConstraint(modeText, tracks);
}

export function trackMatchesArtistConstraint(track, constraint) {
  if (!constraint) return true;
  const artistNames = (track?.artists || []).map(normalizeMusicText).filter(Boolean);
  if (!artistNames.length) return false;
  return artistNames.some(artist =>
    constraint.normalizedAliases.some(alias => artist === alias || artist.includes(alias) || alias.includes(artist))
  );
}

export function filterArtistConstrainedCandidates(candidates, constraint) {
  if (!constraint) return candidates || [];
  return (candidates || []).filter(candidate => trackMatchesArtistConstraint(candidate?.track || candidate, constraint));
}

export function isOngoingArtistRequest(text) {
  return /后面|接下来|以后|之后|后续|几首|多来几首|一会儿|接着|连续|都听|只听/.test(String(text || ''));
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

function buildLightPool(db, sessionId) {
  const played = db.prepare('SELECT track_id FROM plays ORDER BY played_at DESC LIMIT 300').all();
  const playedIds = new Set(played.map(p => p.track_id));
  const allTracks = listTracks(db, 5000);
  const recentFavIds = db.prepare('SELECT id FROM tracks ORDER BY updated_at DESC LIMIT 30').all().map(t => t.id);
  const recentFavIdSet = new Set(recentFavIds);
  const candidates = allTracks
    .filter(t => recentFavIdSet.has(t.id) && !playedIds.has(t.id))
    .map(track => makeCandidate(track, 'library_recent', 'recent library'));
  const feedbackById = getFeedbackSummaryMap(db, candidates.map(c => c.track?.id));
  return rankAndSelectCandidates(candidates, {
    quotas: { library_recent: 30 },
    limit: 30,
    feedbackById,
    artistPenaltyByName: getArtistPenaltyByName(db),
    seed: sessionId
  });
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

function scheduleMemoryExtraction({ db, config, sessionId, userMessage, assistantText, conversationMood }) {
  if (!config?.llm?.baseUrl || !config?.llm?.apiKey || !config?.llm?.model) return;
  void extractAndStoreMemories({ db, config, sessionId, userMessage, assistantText, conversationMood }).catch(() => {});
}

export async function extractAndStoreMemories({ db, config, sessionId, userMessage, assistantText = '', conversationMood = null }) {
  if (!String(userMessage || '').trim()) return [];
  const existing = retrieveRelevantMemories(db, {
    text: userMessage,
    mood: conversationMood,
    limit: 6,
    maxChars: 600
  });
  const raw = await generateChatCompletion(config.llm, [
    {
      role: 'system',
      content: [
        '你是私人电台 DJ 灿灿的长期记忆提炼器。',
        '只提炼值得长期记住、以后能帮助灿灿像朋友一样理解用户的内容。',
        '不要把一次性情绪误判为长期状态；不要记录敏感细节，除非用户明确表达希望被记住。',
        '如果用户纠正了旧印象或表达不希望某种方式，提炼为 boundary。',
        '只输出严格 JSON 数组，不要 Markdown。',
        '每项 schema: {"kind":"emotion_pattern|need|preference|boundary|life_context|music_preference","content":"20-80字中文短句","tags":["2-6个短标签"],"confidence":0-1,"importance":0-1}',
        '如果没有值得记住的内容，输出 []。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        existing.length ? `已有相关记忆：\n${formatMemoryLines(existing)}` : '已有相关记忆：无',
        conversationMood ? `当前情绪判断：${JSON.stringify(conversationMood)}` : '当前情绪判断：无',
        `用户刚说：${userMessage}`,
        `灿灿刚回应：${assistantText}`
      ].join('\n')
    }
  ], () => '[]');

  const parsed = parseJsonArray(raw);
  if (!Array.isArray(parsed)) return [];
  const saved = [];
  for (const item of parsed.slice(0, 5)) {
    try {
      if (!memoryKinds.has(item?.kind)) continue;
      const content = String(item.content || '').trim();
      if (content.length < 8) continue;
      saved.push(recordOrMergeUserMemory(db, {
        kind: item.kind,
        content: content.slice(0, 140),
        tags: Array.isArray(item.tags) ? item.tags : [],
        confidence: item.confidence,
        importance: item.importance,
        sourceSessionId: sessionId
      }));
    } catch {}
  }
  return saved;
}

export function buildMemoryContext({ sessionSummary = '', longTermMemories = [] } = {}) {
  const promptText = longTermMemories.length
    ? `相关长期记忆：\n${formatMemoryLines(longTermMemories, LONG_MEMORY_MAX_CHARS)}`
    : '相关长期记忆：无';
  return {
    sessionSummary: String(sessionSummary || '').trim(),
    longTermMemories,
    promptText
  };
}

function formatMemoryLines(memories, maxChars = LONG_MEMORY_MAX_CHARS) {
  const lines = [];
  let chars = 0;
  for (const memory of memories || []) {
    const line = `- [${memory.kind}] ${memory.content}`;
    if (lines.length && chars + line.length > maxChars) break;
    lines.push(line);
    chars += line.length;
  }
  return lines.join('\n');
}

function parseJsonArray(text) {
  const value = String(text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  const start = value.indexOf('[');
  const end = value.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(value.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

async function callDJ({ db, config, netease, sessionId, candidates, profile, weather, timeOfDay, hour, mode, prefs, history, userMessage, conversationMood = null, memoryContext = {}, safetyNote = '' }) {
  const pool = candidates.slice(0, CANDIDATE_LIMIT);
  const tracks = pool.map(candidate => candidate.track || candidate);
  const extraCount = pool.filter(candidate => candidate.source === 'community_search').length;

  const poolText = pool.length > 0
    ? pool.map((candidate, i) => { const t = candidate.track || candidate; return (
        `${i}. ${t.name} —— ${(t.artists || []).join('、')}${t.album ? ' / ' + t.album : ''}（来源：${candidate.source || 'library'}，分数：${Math.round(candidate.score || 0)}）`
      ); }).join('\n')
    : '（当前无可选曲目，仅聊天模式）';

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
    ? `最近对话情绪：${conversationMood.mood}，能量：${conversationMood.energy}，搜索提示：${(conversationMood.searchHints || []).join('、')}。`
    : '';

  const systemPrompt = [
    '你是灿灿，一个私人电台 DJ。歌曲播完后推荐下一首。聊天中听众点歌就推，你觉得有首歌特别契合时也可以推。',
    '',
    `此刻：${timeOfDay} ${hour}点，${weather}`,
    `听众画像：${profile.summary}`,
    memoryContext.promptText || '',
    memoryContext.sessionSummary ? `本轮会话摘要：${memoryContext.sessionSummary}` : '',
    modeText,
    prefNote,
    genreNote,
    moodNote,
    '',
    '候选池里的歌从 0 开始编号。你觉得合适的就填编号推荐，没有合适的 pick 填 null。',
    '听众提到某个艺人或歌曲时，候选池里已经在线搜索过了，不要说"曲库里没有"。',
    '不要因为候选池里有和话题同名的歌就推荐——那是巧合。',
    '',
    '输出格式：',
    '<CHAT>你的回复</CHAT>',
    '<JSON>{"pick":数字或null,"reason":"选歌理由","mode":null或"流派名"或"reset"}</JSON>',
    '',
    'mode：听众说"后面都听XX"→填偏好名；"恢复正常"→填"reset"；否则 null。',
    safetyNote ? `\n${safetyNote}` : ''
  ].join('\n');

  const userPrompt = [
    `候选曲目：\n${poolText}${searchNote}`,
    `对话历史：${history.length ? '\n' + history.map(h => `[${h.role === 'user' ? '听众' : '灿灿'}]: ${h.content}`).join('\n') : '（新对话）'}`,
    userMessage ? `\n听众说：${userMessage}` : '\n上一首播完了。'
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
  if (pick < 0 || pick >= tracks.length || pool.length === 0) {
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
