// Conversational AI DJ — unified chat + track selection
import crypto from 'node:crypto';
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
const SESSION_SUMMARY_MIN_MESSAGES = 12;
const SESSION_SUMMARY_STEP = 8;
const LONG_MEMORY_LIMIT = 8;
const LONG_MEMORY_MAX_CHARS = 800;
const CHAT_LLM_TIMEOUT_MS = 2500;
export const TURN_ACTIONS = Object.freeze({
  CHAT_ONLY: 'CHAT_ONLY',
  ASK_FOLLOWUP: 'ASK_FOLLOWUP',
  SOFT_OFFER_MUSIC: 'SOFT_OFFER_MUSIC',
  RECOMMEND_AND_PLAY: 'RECOMMEND_AND_PLAY',
  CONTINUE_CURRENT_SONG: 'CONTINUE_CURRENT_SONG',
  CLARIFY_INTENT: 'CLARIFY_INTENT'
});
const NON_RECOMMEND_ACTIONS = new Set([
  TURN_ACTIONS.CHAT_ONLY,
  TURN_ACTIONS.ASK_FOLLOWUP,
  TURN_ACTIONS.SOFT_OFFER_MUSIC,
  TURN_ACTIONS.CONTINUE_CURRENT_SONG,
  TURN_ACTIONS.CLARIFY_INTENT
]);
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
  const context = getSessionContext(db, sessionId);
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
  const explicitIntent = hasExplicitMusicIntent(userMessage);
  const userMessageCountAfterThisTurn = countUserMessages(db, sessionId) + (userMessage ? 1 : 0);
  const canSuggest = canProactivelyRecommend({
    userMessageCount: userMessageCountAfterThisTurn,
    lastSuggestedAtUserCount: context.lastSuggestedAtUserCount,
    currentTrack,
    mood: baseMood
  });
  const turnAction = decideTurnAction({
    userMessage,
    history,
    baseMood,
    explicitIntent,
    canSuggest,
    currentTrack,
    mode,
    memoryContext
  });
  if (turnAction.action === TURN_ACTIONS.RECOMMEND_AND_PLAY) {
    const conversationMood = normalizeMoodDecision({
      ...baseMood,
      shouldRecommend: true,
      intent: 'music',
      searchHints: turnAction.searchHints?.length ? turnAction.searchHints : baseMood.searchHints,
      reason: turnAction.reason || baseMood.reason
    });
    const result = await djTurn({ db, config, netease, sessionId, userMessage, conversationMood });
    setSessionContext(db, sessionId, {
      ...getSessionContext(db, sessionId),
      lastSuggestedAtUserCount: countUserMessages(db, sessionId)
    });
    return { ...result, conversationMood, turnAction, intent: 'explicit' };
  }

  const chatDecision = await generateChatDecision({
    config,
    profile,
    mode,
    history,
    userMessage,
    currentTrack,
    baseMood,
    explicitIntent,
    canSuggest,
    memoryContext,
    turnAction
  });
  const conversationMood = normalizeMoodDecision({ ...baseMood, ...chatDecision });

  if (userMessage) saveMessage(db, sessionId, 'user', userMessage);
  saveMessage(db, sessionId, 'assistant', chatDecision.chatText);
  if (userMessage) {
    scheduleMemoryExtraction({ db, config, sessionId, userMessage, assistantText: chatDecision.chatText, conversationMood });
  }
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
    turnAction,
    intent: 'chat'
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

function countUserMessages(db, sessionId) {
  return db.prepare('SELECT COUNT(*) AS count FROM messages WHERE session_id = ? AND role = ?')
    .get(sessionId, 'user').count || 0;
}

export function hasExplicitMusicIntent(text) {
  const value = String(text || '');
  if (/不想听|先别放|不要切|别切|别换/.test(value)) return false;
  return /下一首|换一首|换歌|切歌|播放|放一首|来点|想听|推荐|给我.*(歌|音乐)|有没有.*(歌|音乐)|听.*(歌|音乐)|artist|song|music|play|recommend/i.test(value);
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

export function decideTurnAction({
  userMessage = '',
  history = [],
  baseMood = {},
  explicitIntent = false,
  canSuggest = false,
  currentTrack = null,
  mode = {},
  memoryContext = {}
} = {}) {
  const text = String(userMessage || '').trim();
  const lower = text.toLowerCase();
  const memoryText = `${memoryContext.promptText || ''} ${memoryContext.sessionSummary || ''}`.toLowerCase();
  const result = (action, reason, extra = {}) => ({
    action,
    reason,
    confidence: extra.confidence ?? 0.85,
    source: extra.source || 'local_rule',
    searchHints: extra.searchHints || []
  });

  if (!text) {
    return result(TURN_ACTIONS.RECOMMEND_AND_PLAY, 'empty turn means radio continuation', { confidence: 1 });
  }
  if (/不想听|先别放|不要放|别放|先别切|不要切|别切|别换|先聊|陪我聊|不放歌/.test(text)) {
    return result(TURN_ACTIONS.CHAT_ONLY, 'user explicitly rejected playback or switching', { confidence: 1 });
  }
  if (/恢复正常推荐|取消.*偏好|取消.*模式|恢复正常|后面都听|以后都听|接下来都听/.test(text)) {
    return result(TURN_ACTIONS.CHAT_ONLY, 'user is updating listening mode rather than asking for an immediate song', { confidence: 0.95 });
  }
  if (/暂停|停一下|继续播放|继续放|接着放|resume|pause/i.test(text)) {
    return result(TURN_ACTIONS.CONTINUE_CURRENT_SONG, 'user asked for playback control without a new recommendation', { confidence: 0.95 });
  }
  if (/下一首|换一首|换歌|切歌|播放|放一首|来一首|来首|来点|想听|推荐(一首|首|点)?|给我.*(歌|音乐)|有没有.*(歌|音乐)|听.*(歌|音乐)|artist|song|music|play|recommend/i.test(text)) {
    return result(TURN_ACTIONS.RECOMMEND_AND_PLAY, 'user explicitly asked for music', {
      confidence: 1,
      searchHints: extractActionSearchHints(text, mode)
    });
  }
  if (/我是|我是一名|我叫|我在读|我的专业|我专业|我是.*(学生|老师|工程师|程序员|大学生)|我来自|我住在|我今年|我最近|今天发生|今天我|最近我/.test(text)) {
    return result(TURN_ACTIONS.ASK_FOLLOWUP, 'user is self-disclosing or sharing life context', { confidence: 0.95 });
  }
  if (/你觉得|你知道|怎么办|为什么|怎么会|可以聊|想聊|随便聊|跟你说|问你|你会/.test(text)) {
    return result(TURN_ACTIONS.CHAT_ONLY, 'user is chatting or asking a non-music question', { confidence: 0.88 });
  }
  if (/睡不着|失眠|心情不好|难受|吵架|崩溃|委屈|emo|低落|伤心|难过|烦|累|疲惫|写代码.*麻|代码.*麻|有点累/.test(text)) {
    if (/先陪|先聊|不要.*歌|别.*歌|硬切|不喜欢.*切/.test(memoryText)) {
      return result(TURN_ACTIONS.ASK_FOLLOWUP, 'long-term memory says support should come before music', { confidence: 0.92 });
    }
    return result(TURN_ACTIONS.ASK_FOLLOWUP, 'ambiguous emotional disclosure should not auto-play music', { confidence: 0.82 });
  }
  if (baseMood?.shouldRecommend && canSuggest && currentTrack && !/吗|呢|为什么|怎么|是不是/.test(text)) {
    return result(TURN_ACTIONS.SOFT_OFFER_MUSIC, 'mood may fit music but user did not explicitly ask', {
      confidence: 0.62,
      searchHints: baseMood.searchHints || []
    });
  }
  if (explicitIntent) {
    return result(TURN_ACTIONS.RECOMMEND_AND_PLAY, 'explicit intent fallback', { confidence: 0.9, searchHints: extractActionSearchHints(text, mode) });
  }
  return result(TURN_ACTIONS.CHAT_ONLY, 'default to friendship chat', { confidence: 0.7 });
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

async function generateChatDecision({ config, profile, mode, history, userMessage, currentTrack, baseMood, explicitIntent, canSuggest, memoryContext = {}, turnAction = null }) {
  const fallback = () => ({
    chatText: fallbackFriendChat(userMessage, baseMood, turnAction),
    shouldRecommend: false,
    mood: baseMood.mood,
    energy: baseMood.energy,
    intent: 'chat',
    searchHints: baseMood.searchHints,
    reason: baseMood.reason,
    newMode: null
  });
  if (!config?.llm?.baseUrl) return fallback();
  const currentTrackContext = getCurrentTrackPromptContext(userMessage, currentTrack);

  const messages = [
    {
      role: 'system',
      content: [
        '你是私人电台 DJ 灿灿，也像熟悉的朋友。',
        '先自然回应听众，不要每句话都转去推荐音乐。',
        '你的陪伴方式：先接住用户的原话和情绪，再轻轻复述你听见的重点，然后给一点稳定的陪伴感。',
        '不要像心理咨询师一样连续追问、分析原因、要求用户解释自己；少说“最明显的感受是什么”“为什么会这样”。',
        '回复长度要按用户消息强度调节：普通问候/寒暄 20-60 字，日常聊天 60-120 字，明确表达疲惫、难过、矛盾或期待时才用 90-180 字。',
        '普通问候不要过度共情，不要上来就说“你不用说得完整”“我会接住情绪”；先轻松打招呼，给一个自然入口。',
        '如果需要提问，每次最多一个问题，而且要像邀请，不要像审问；用户不回答也没关系。',
        '当前歌曲只用于判断是否已有音乐在播放；除非听众主动问当前歌曲、歌词、歌名或艺人，不要提及歌名、艺人、歌词或“正在播放”。',
        turnActionInstruction(turnAction),
        '输出 JSON：{"chatText":"按语境长度生成的自然温柔回复","mood":"comfort|melancholy|calm|healing|focus|energy|romantic|nostalgic|night|random","energy":"low|medium|high","intent":"chat|mood","searchHints":["2-6字关键词"],"reason":"简短理由","mode":null或"reset"或偏好名}'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `听众画像：${profile.summary || ''}`,
        `当前模式：${mode?.genre || '无'}`,
        `当前歌曲：${currentTrackContext}`,
        memoryContext.promptText || '相关长期记忆：无',
        memoryContext.sessionSummary ? `本轮会话摘要：${memoryContext.sessionSummary}` : '本轮会话摘要：无',
        `当前动作：${turnAction?.action || TURN_ACTIONS.CHAT_ONLY}`,
        `动作理由：${turnAction?.reason || ''}`,
        `启发式情绪：${JSON.stringify(baseMood)}`,
        `允许主动推荐：${canSuggest}`,
        `明确音乐意图：${explicitIntent}`,
        `最近对话：${history.slice(-10).map(h => `${h.role}: ${h.content}`).join('\n')}`,
        `听众刚说：${userMessage}`
      ].join('\n')
    }
  ];

  const raw = await withTimeout(
    generateChatCompletion(config.llm, messages, () => JSON.stringify(fallback())),
    CHAT_LLM_TIMEOUT_MS,
    JSON.stringify(fallback())
  );

  try {
    const parsed = JSON.parse(String(raw).replace(/^```json|```$/g, '').trim());
    const normalized = normalizeMoodDecision(parsed);
    return {
      ...normalized,
      shouldRecommend: false,
      chatText: String(parsed.chatText || fallback().chatText).trim(),
      newMode: parsed.mode === 'reset' ? {} : (parsed.mode && typeof parsed.mode === 'string' ? { genre: parsed.mode, note: '用户指定' } : null)
    };
  } catch {
    return fallback();
  }
}

function getCurrentTrackPromptContext(userMessage, currentTrack) {
  if (!currentTrack?.name) return '无';
  const text = String(userMessage || '');
  if (/当前.*(歌|音乐)|现在.*(放|播|听).*什么|这首歌|歌名|谁唱|歌词|艺人|专辑/.test(text)) {
    return `${currentTrack.name} - ${(currentTrack.artists || []).join('、') || '未知艺人'}`;
  }
  return '有歌正在播放（不要主动提及歌名、艺人、歌词或正在播放）';
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

function fallbackFriendChat(userMessage, mood, turnAction = null) {
  if (isLightGreeting(userMessage)) {
    return '你好呀，我在。今天想先随便聊几句，还是让灿灿陪你开一会儿电台？';
  }
  if (turnAction?.action === TURN_ACTIONS.ASK_FOLLOWUP) {
    return '我听见你在把自己的状态拿出来给我看了，这件事本身就不轻。先不急着分析，也不急着切到音乐；你可以慢慢说，哪怕只说一点点也可以。我会先陪你把这段情绪放稳，等你愿意的时候，再告诉我现在最想被理解的是哪一小块。';
  }
  if (turnAction?.action === TURN_ACTIONS.SOFT_OFFER_MUSIC) {
    return '我先陪你把话说完，不急着用音乐把它盖过去。你刚刚那种感觉我会放在心上，它可能不是一句“开心”或“难过”就能说完的。等你觉得可以了，我再帮你找一首能轻轻接住这个情绪的歌，不催你。';
  }
  if (turnAction?.action === TURN_ACTIONS.CLARIFY_INTENT) {
    return '我有点不确定你现在更想继续聊，还是想让我用一首歌把气氛接过去。没关系，你不用组织得很清楚，直接按现在的感觉说就好。你想说话，我就在这儿听；你想听歌，我也会慢慢帮你切到合适的方向。';
  }
  if (mood?.mood === 'comfort') {
    return '听起来你现在心里有一块地方挺累的，我先不急着劝你变好，也不急着给答案。你可以先把自己放松一点，像把很重的包暂时放到旁边。我在这儿陪你缓一会儿，等你想说的时候，我们再慢慢拆开看。';
  }
  if (mood?.mood === 'night') {
    return '夜里人的感受会被放大一点，很多白天能忍住的东西，到了这个时候就会轻轻冒出来。你不用马上睡着，也不用马上振作；先让呼吸慢一点，我陪你把这一小段时间安静地走过去。';
  }
  if (mood?.mood === 'energy') {
    return '我听出来你想把状态找回来一点，但也不用一下子把自己推得很猛。先把肩膀松一松，给自己一点启动的余地。我们可以一点点把节奏调亮，不需要马上满格，只要比刚才多一点点就很好。';
  }
  return userMessage
    ? '我在听。你不用把话说得很完整，也不用急着把它变成一个明确的问题；有些感受本来就是边说边清楚的。你可以继续往下讲，我会跟着你的节奏听，等真的适合音乐的时候，再轻轻帮你接一首。'
    : '我在呢。现在不用急着开始，也不用想好要聊什么；你可以把这里当成一个安静的小电台。想说今天发生了什么、想发呆一会儿，或者只是想有人在旁边，我都会陪着。';
}

function isLightGreeting(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return false;
  return /^(你好|嗨|hi|hello|哈喽|在吗|灿灿|早|早安|晚上好|下午好|中午好)[呀啊哦～~!！。.\s]*$/.test(value);
}

function turnActionInstruction(turnAction = {}) {
  const action = turnAction?.action || TURN_ACTIONS.CHAT_ONLY;
  if (action === TURN_ACTIONS.ASK_FOLLOWUP) {
    return '当前动作是 ASK_FOLLOWUP。禁止推荐歌曲，禁止说“有首歌适合你”。如果只是问候，轻松回应即可，不要进入深度陪伴。只有用户表达具体经历或情绪时，才先承接原话，轻轻复述你听见的矛盾、疲惫、期待或在意点；不要分析原因，不要连续追问。最后最多给一个可不回答的轻邀请。';
  }
  if (action === TURN_ACTIONS.SOFT_OFFER_MUSIC) {
    return '当前动作是 SOFT_OFFER_MUSIC。禁止自动播放或指定具体歌曲。先陪用户把话说完，再很轻地说如果稍后愿意，可以用一首歌接住情绪；音乐只能作为后续选择，不能抢走当下的对话。';
  }
  if (action === TURN_ACTIONS.CLARIFY_INTENT) {
    return '当前动作是 CLARIFY_INTENT。禁止推荐歌曲。温柔确认用户是想继续聊还是想听歌，不要让用户觉得必须立刻做选择。';
  }
  if (action === TURN_ACTIONS.CONTINUE_CURRENT_SONG) {
    return '当前动作是 CONTINUE_CURRENT_SONG。禁止推荐新歌。回应播放控制，同时保持陪伴感，可以简短说明你会继续在这里听。';
  }
  return '当前动作是 CHAT_ONLY。禁止推荐歌曲，禁止说“有首歌适合你”。像熟悉的朋友一样自然回应；普通问候要轻，不要突然深情或分析；日常聊天先接住，再陪一会儿，少给建议，少下结论。';
}

function extractActionSearchHints(text, mode = {}) {
  const hints = [];
  if (mode?.genre) hints.push(mode.genre);
  const value = String(text || '').replace(/下一首|换一首|换歌|切歌|播放|放一首|来一首|来首|来点|想听|推荐|给我|有没有|听/g, ' ');
  for (const token of value.split(/[，。,.!！?？、\s]+/)) {
    const clean = token.trim();
    if (clean.length >= 2 && clean.length <= 12) hints.push(clean);
  }
  return [...new Set(hints)].slice(0, 5);
}

function withTimeout(promise, ms, fallbackValue) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallbackValue), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
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

async function callDJ({ db, config, netease, sessionId, candidates, profile, weather, timeOfDay, hour, mode, prefs, history, userMessage, conversationMood = null, memoryContext = {} }) {
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
    memoryContext.promptText || '相关长期记忆：无',
    memoryContext.sessionSummary ? `本轮会话摘要：${memoryContext.sessionSummary}` : '本轮会话摘要：无',
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
