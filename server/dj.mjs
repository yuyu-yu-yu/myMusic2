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
const CHAT_LLM_TIMEOUT_MS = 9000;
const PLAYABLE_FALLBACK_SCAN_LIMIT = 12;
const DEFAULT_PREFS = Object.freeze({
  chatMusicBalance: 'friend',
  recommendationFrequency: 'medium',
  voiceMode: 'recommendations',
  moodMode: 'auto',
  note: ''
});
const BALANCE_MIN_USER_MESSAGES = Object.freeze({ friend: 3, balanced: 2, dj: 1 });
const FREQUENCY_MIN_GAP = Object.freeze({ low: 5, medium: 3, high: 2 });
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
  const prefs = normalizeRuntimePrefs(getUserPrefs(db));
  const context = getSessionContext(db, sessionId);
  const conversationState = normalizeConversationState(context.conversationState);
  const recommendationMood = conversationMood || moodFromConversationState(conversationState, prefs, mode);

  // Load conversation history
  const history = loadHistory(db, sessionId);
  const sessionSummary = await updateSessionSummary(db, config, sessionId);
  const longTermMemories = retrieveRelevantMemories(db, {
    text: userMessage || recommendationMood?.reason || '',
    mood: recommendationMood,
    mode,
    limit: LONG_MEMORY_LIMIT,
    maxChars: LONG_MEMORY_MAX_CHARS
  });
  const memoryContext = buildMemoryContext({ sessionSummary, longTermMemories });

  // Build candidates
  const candidates = await buildCandidates(db, sessionId, profile, weather, timeOfDay, hour, config, mode, userMessage, recommendationMood);

  // Single LLM call: chat + pick
  const result = await callDJ({ db, config, netease, sessionId, candidates, profile, weather, timeOfDay, hour, mode, prefs, history, userMessage, conversationMood: recommendationMood, memoryContext });

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
    scheduleMemoryExtraction({ db, config, sessionId, userMessage, assistantText: result.chatText, conversationMood: recommendationMood });
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
  const speech = speechDecisionForRecommendation(prefs);
  const ttsUrl = speech.shouldSpeak
    ? await synthesizeSpeech(config.tts, result.chatText)
    : null;

  return {
    sessionId,
    chatText: result.chatText,
    track: result.track,
    reason: result.reason,
    ttsUrl,
    speech,
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
  const prefs = normalizeRuntimePrefs(getUserPrefs(db));
  const history = loadHistory(db, sessionId);
  const currentTrack = getCurrentTrack(db);
  const context = getSessionContext(db, sessionId);
  const conversationState = normalizeConversationState(context.conversationState);
  const baseMood = analyzeTurnContext({
    history,
    userMessage,
    profile,
    currentTrack,
    mode,
    prefs,
    conversationState
  });
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
    lastSuggestedAtUserCount: conversationState.lastSuggestedAtUserCount ?? context.lastSuggestedAtUserCount,
    noMusicUntilUserCount: conversationState.noMusicUntilUserCount,
    currentTrack,
    mood: baseMood,
    prefs
  });
  const turnAction = decideTurnAction({
    userMessage,
    history,
    baseMood,
    explicitIntent,
    canSuggest,
    currentTrack,
    mode,
    prefs,
    conversationState,
    userMessageCount: userMessageCountAfterThisTurn,
    memoryContext
  });
  const nextConversationState = updateConversationState({
    previous: conversationState,
    analysis: baseMood,
    turnAction,
    userMessage,
    userMessageCount: userMessageCountAfterThisTurn
  });

  if (turnAction.action === TURN_ACTIONS.RECOMMEND_AND_PLAY) {
    const conversationMood = normalizeMoodDecision({
      ...baseMood,
      shouldRecommend: true,
      intent: 'music',
      searchHints: turnAction.searchHints?.length ? turnAction.searchHints : baseMood.searchHints,
      reason: turnAction.reason || baseMood.reason
    });
    setSessionContext(db, sessionId, {
      ...getSessionContext(db, sessionId),
      conversationState: {
        ...nextConversationState,
        lastSuggestedAtUserCount: userMessageCountAfterThisTurn
      },
      lastSuggestedAtUserCount: userMessageCountAfterThisTurn
    });
    const result = await djTurn({ db, config, netease, sessionId, userMessage, conversationMood });
    setSessionContext(db, sessionId, {
      ...getSessionContext(db, sessionId),
      conversationState: {
        ...normalizeConversationState(getSessionContext(db, sessionId).conversationState),
        lastSuggestedAtUserCount: countUserMessages(db, sessionId)
      },
      lastSuggestedAtUserCount: countUserMessages(db, sessionId)
    });
    return { ...result, conversationMood, turnAction, intent: 'explicit' };
  }

  const chatDecision = await generateFriendReply({
    config,
    profile,
    mode,
    prefs,
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
  const finalConversationState = updateConversationState({
    previous: nextConversationState,
    analysis: conversationMood,
    turnAction,
    userMessage,
    userMessageCount: userMessageCountAfterThisTurn
  });

  if (userMessage) saveMessage(db, sessionId, 'user', userMessage);
  saveMessage(db, sessionId, 'assistant', chatDecision.chatText);
  if (userMessage) {
    scheduleMemoryExtraction({ db, config, sessionId, userMessage, assistantText: chatDecision.chatText, conversationMood });
  }
  if (chatDecision.newMode) {
    const newMode = { ...chatDecision.newMode, updatedAt: nowIso() };
    setSessionMode(db, sessionId, newMode);
  }
  setSessionContext(db, sessionId, {
    ...getSessionContext(db, sessionId),
    conversationState: finalConversationState
  });
  const speech = speechDecisionForChat(prefs);
  const ttsUrl = speech.shouldSpeak
    ? await synthesizeSpeech(config.tts, chatDecision.chatText)
    : null;

  return {
    sessionId,
    chatText: chatDecision.chatText,
    track: null,
    reason: '',
    ttsUrl,
    speech,
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

function normalizeRuntimePrefs(raw = {}) {
  const pick = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
  return {
    chatMusicBalance: pick(raw.chatMusicBalance, ['friend', 'balanced', 'dj'], DEFAULT_PREFS.chatMusicBalance),
    recommendationFrequency: pick(raw.recommendationFrequency, ['low', 'medium', 'high'], DEFAULT_PREFS.recommendationFrequency),
    voiceMode: pick(raw.voiceMode, ['off', 'recommendations', 'all'], DEFAULT_PREFS.voiceMode),
    moodMode: pick(raw.moodMode, ['auto', 'comfort', 'focus', 'calm', 'night', 'random'], DEFAULT_PREFS.moodMode),
    note: String(raw.note || '').slice(0, 500)
  };
}

function shouldSynthesizeForRecommendation(prefs = {}) {
  return normalizeRuntimePrefs(prefs).voiceMode !== 'off';
}

function speechDecisionForRecommendation(prefs = {}) {
  const normalized = normalizeRuntimePrefs(prefs);
  return {
    mode: normalized.voiceMode,
    shouldSpeak: shouldSynthesizeForRecommendation(normalized)
  };
}

function speechDecisionForChat(prefs = {}) {
  const normalized = normalizeRuntimePrefs(prefs);
  return {
    mode: normalized.voiceMode,
    shouldSpeak: normalized.voiceMode === 'all'
  };
}

function normalizeConversationState(state = {}) {
  return {
    currentEmotion: typeof state.currentEmotion === 'string' ? state.currentEmotion : 'random',
    energy: typeof state.energy === 'string' ? state.energy : 'medium',
    preferenceHints: Array.isArray(state.preferenceHints) ? state.preferenceHints.slice(0, 12) : [],
    avoidHints: Array.isArray(state.avoidHints) ? state.avoidHints.slice(0, 12) : [],
    recentTopics: Array.isArray(state.recentTopics) ? state.recentTopics.slice(0, 8) : [],
    lastAnalyzedMessageId: Number(state.lastAnalyzedMessageId || 0),
    lastSuggestedAtUserCount: Number(state.lastSuggestedAtUserCount || 0),
    noMusicUntilUserCount: Number(state.noMusicUntilUserCount || 0),
    updatedAt: state.updatedAt || null
  };
}

function updateConversationState({ previous = {}, analysis = {}, turnAction = {}, userMessage = '', userMessageCount = 0 } = {}) {
  const state = normalizeConversationState(previous);
  const preferenceHints = uniqueStrings([
    ...state.preferenceHints,
    ...(analysis.preferenceHints || []),
    ...(analysis.searchHints || [])
  ], 12);
  const avoidHints = uniqueStrings([
    ...state.avoidHints,
    ...(analysis.avoidHints || [])
  ], 12);
  const recentTopics = uniqueStrings([
    ...state.recentTopics,
    ...extractRecentTopics(userMessage)
  ], 8);
  const next = {
    ...state,
    currentEmotion: analysis.mood || state.currentEmotion || 'random',
    energy: analysis.energy || state.energy || 'medium',
    preferenceHints,
    avoidHints,
    recentTopics,
    lastAnalyzedMessageId: userMessageCount,
    updatedAt: nowIso()
  };
  if (turnAction?.reason === 'user explicitly rejected playback or switching') {
    next.noMusicUntilUserCount = Math.max(next.noMusicUntilUserCount, userMessageCount + 3);
  }
  return next;
}

function moodFromConversationState(state = {}, prefs = {}, mode = {}) {
  const normalized = normalizeConversationState(state);
  const normalizedPrefs = normalizeRuntimePrefs(prefs);
  const baseEmotion = normalizedPrefs.moodMode !== 'auto' ? normalizedPrefs.moodMode : normalized.currentEmotion;
  const defaultMoodHints = {
    comfort: ['治愈', '安慰', '温柔', '陪伴'],
    melancholy: ['伤感', '低落', '慢歌'],
    calm: ['放松', '安静', '轻柔'],
    healing: ['治愈', '温暖', '轻柔'],
    focus: ['专注', '低干扰', '工作'],
    energy: ['提神', '节奏', '能量'],
    romantic: ['浪漫', '温柔'],
    nostalgic: ['怀旧', '回忆', '老歌'],
    night: ['深夜', '氛围', '睡前']
  };
  const hints = uniqueStrings([
    ...(mode?.genre ? [mode.genre] : []),
    ...normalized.preferenceHints,
    ...(defaultMoodHints[baseEmotion] || [])
  ], 6);
  if (!hints.length && (!baseEmotion || baseEmotion === 'random')) return null;
  return applyMoodPreferenceOverride(normalizeMoodDecision({
    shouldRecommend: true,
    mood: baseEmotion || 'random',
    energy: normalized.energy || 'medium',
    intent: 'mood',
    searchHints: hints,
    reason: 'recent conversation context'
  }), normalizedPrefs);
}

function uniqueStrings(values, limit = 8) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))].slice(0, limit);
}

function extractRecentTopics(text) {
  const value = String(text || '').trim();
  const topics = [];
  if (/学习|大学|专业|课程|考试|作业|代码|项目|工作|实习/.test(value)) topics.push('学习/工作');
  if (/朋友|家人|恋爱|亲密|吵架|关系|同学/.test(value)) topics.push('关系');
  if (/睡|失眠|累|疲惫|压力|焦虑|难受|开心|期待/.test(value)) topics.push('状态');
  if (/电影|游戏|书|小说|动漫|比赛|旅行/.test(value)) topics.push('生活兴趣');
  return topics;
}

export function hasExplicitMusicIntent(text) {
  const value = String(text || '');
  if (/不想听|先别放|不要切|别切|别换/.test(value)) return false;
  if (/下一首|换一首|换歌|切歌|播放|放一首|来一首|来首|想听|给我.*(歌|音乐)|有没有.*(歌|音乐)|听.*(歌|音乐)|artist|song|music|play|recommend/i.test(value)) return true;
  return /(推荐|来点).*(歌|音乐|曲|国风|古风|电子|摇滚|民谣|爵士|说唱|粤语|日语|英语|中文|安静|治愈|伤感|开心|提神|专注|睡前)|推荐(一首|首|点|些)?$/.test(value);
}

export function normalizeMusicText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s·・.．,，、\-_/\\（）()《》<>[\]【】"'“”‘’!！?？:：;；~～]/g, '');
}

function trackDisplayName(track = {}) {
  const artists = (track.artists || []).filter(Boolean).join('、');
  return artists ? `《${track.name}》 - ${artists}` : `《${track.name || '这首歌'}》`;
}

function trackMentionTerms(track = {}) {
  return [
    track.name,
    ...(track.artists || [])
  ]
    .map(term => normalizeMusicText(term))
    .filter(term => term.length >= 2);
}

export function recommendationTextMentionsDifferentTrack(text, selectedTrack, candidates = []) {
  const normalizedText = normalizeMusicText(text);
  if (!normalizedText || !selectedTrack?.id) return false;
  const selectedTerms = new Set(trackMentionTerms(selectedTrack));
  for (const candidate of candidates || []) {
    const track = candidate?.track || candidate;
    if (!track?.id || String(track.id) === String(selectedTrack.id)) continue;
    for (const term of trackMentionTerms(track)) {
      if (!selectedTerms.has(term) && normalizedText.includes(term)) return true;
    }
  }
  return false;
}

export function ensureRecommendationTextMatchesTrack(text, selectedTrack, candidates = []) {
  if (!selectedTrack?.name) return String(text || '').trim();
  const value = String(text || '').trim();
  const intro = `接下来放 ${trackDisplayName(selectedTrack)}。`;
  if (!value || recommendationTextMentionsDifferentTrack(value, selectedTrack, candidates)) return intro;
  const selectedName = normalizeMusicText(selectedTrack.name);
  if (selectedName && !normalizeMusicText(value).includes(selectedName)) {
    return `${value} ${intro}`;
  }
  return value;
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
  prefs = {},
  conversationState = {},
  userMessageCount = 0,
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
  if (rejectsMusic(text)) {
    return result(TURN_ACTIONS.CHAT_ONLY, 'user explicitly rejected playback or switching', { confidence: 1 });
  }
  if (isModeUpdateRequest(text)) {
    return result(TURN_ACTIONS.CHAT_ONLY, 'user is updating listening mode rather than asking for an immediate song', { confidence: 0.95 });
  }
  if (/暂停|停一下|继续播放|继续放|接着放|resume|pause/i.test(text)) {
    return result(TURN_ACTIONS.CONTINUE_CURRENT_SONG, 'user asked for playback control without a new recommendation', { confidence: 0.95 });
  }
  if (explicitIntent) {
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
    return result(TURN_ACTIONS.RECOMMEND_AND_PLAY, 'stable conversation mood fits a natural song handoff', {
      confidence: 0.72,
      searchHints: baseMood.searchHints || []
    });
  }
  return result(TURN_ACTIONS.CHAT_ONLY, 'default to friendship chat', { confidence: 0.7 });
}

export function canProactivelyRecommend({ userMessageCount = 0, lastSuggestedAtUserCount = 0, noMusicUntilUserCount = 0, currentTrack = null, mood = {}, prefs = {} } = {}) {
  const normalizedPrefs = normalizeRuntimePrefs(prefs);
  if (noMusicUntilUserCount && userMessageCount <= Number(noMusicUntilUserCount)) return false;
  if (!currentTrack) return Boolean(mood?.shouldRecommend);
  const minMessages = BALANCE_MIN_USER_MESSAGES[normalizedPrefs.chatMusicBalance] ?? 3;
  const minGap = FREQUENCY_MIN_GAP[normalizedPrefs.recommendationFrequency] ?? 3;
  if (userMessageCount < minMessages) return false;
  if (lastSuggestedAtUserCount && userMessageCount - Number(lastSuggestedAtUserCount) < minGap) return false;
  return Boolean(mood?.shouldRecommend);
}

export function analyzeTurnContext({ history = [], userMessage = '', profile = {}, currentTrack = null, mode = {}, prefs = {}, conversationState = {} } = {}) {
  const normalizedPrefs = normalizeRuntimePrefs(prefs);
  const mood = applyMoodPreferenceOverride(
    analyzeConversationMood({ history, userMessage, profile, currentTrack, mode }),
    normalizedPrefs
  );
  const preferenceHints = extractPreferenceHints(userMessage);
  const avoidHints = extractAvoidHints(userMessage);
  const explicitMusic = hasExplicitMusicIntent(userMessage);
  const suppressMusic = rejectsMusic(userMessage);
  const modeUpdate = isModeUpdateRequest(userMessage);
  const playbackControl = /暂停|停一下|继续播放|继续放|接着放|resume|pause/i.test(String(userMessage || ''));
  const state = normalizeConversationState(conversationState);

  return normalizeMoodDecision({
    ...mood,
    shouldRecommend: suppressMusic || modeUpdate || playbackControl ? false : (explicitMusic || mood.shouldRecommend),
    intent: explicitMusic ? 'music' : (mood.shouldRecommend ? 'mood' : 'chat'),
    searchHints: uniqueStrings([
      ...(mode?.genre ? [mode.genre] : []),
      ...preferenceHints,
      ...(state.preferenceHints || []),
      ...(mood.searchHints || [])
    ], 6),
    reason: explicitMusic ? 'explicit music request' : mood.reason,
    preferenceHints,
    avoidHints,
    musicIntent: suppressMusic ? 'suppressed'
      : modeUpdate ? 'mode_update'
        : playbackControl ? 'playback_control'
          : explicitMusic ? 'explicit_music'
            : mood.shouldRecommend ? 'mood_signal'
              : 'chat',
    confidence: explicitMusic || suppressMusic ? 1 : (mood.shouldRecommend ? 0.7 : 0.45)
  });
}

export function analyzeConversationMood({ history = [], userMessage = '', profile = {}, currentTrack = null, mode = {} } = {}) {
  const currentText = String(userMessage || '').toLowerCase();
  const historyText = history.slice(-8).map(h => h.content).join(' ').toLowerCase();
  const text = [historyText, currentText].join(' ');
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

  const hasCurrentEmotionSignal = /心情不好|难受|吵架|崩溃|委屈|emo|低落|伤心|难过|烦|睡不着|失眠|深夜|夜里|凌晨|累|疲惫|放松|安静|缓一缓|提神|振作|有劲|运动|跑步|开心|兴奋|想念|怀念|以前|回忆|老歌/.test(currentText);
  const isDirectOrdinaryQuestion = /你喜欢|你觉得|你知道|你会|吗|呢|什么|为什么|怎么|谁|哪/.test(currentText);
  if (isDirectOrdinaryQuestion && !hasCurrentEmotionSignal) {
    if (mode?.genre) result.searchHints = [mode.genre];
    return result;
  }

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

function applyMoodPreferenceOverride(mood, prefs) {
  if (!prefs?.moodMode || prefs.moodMode === 'auto') return mood;
  const moodHints = {
    comfort: ['治愈', '安慰', '温柔', '陪伴'],
    focus: ['专注', '低干扰', '工作', '学习'],
    calm: ['放松', '安静', '轻柔', '慢歌'],
    night: ['深夜', '氛围', '睡前', '安静'],
    random: []
  };
  return {
    ...mood,
    mood: prefs.moodMode,
    searchHints: uniqueStrings([...(moodHints[prefs.moodMode] || []), ...(mood.searchHints || [])], 5),
    reason: mood.reason || `user preference mood mode: ${prefs.moodMode}`
  };
}

function extractPreferenceHints(text) {
  const value = String(text || '');
  const hints = [];
  const patterns = ['国风', '古风', '电子', 'EDM', '摇滚', '民谣', '爵士', '说唱', '粤语', '日语', '英语', '中文', '安静', '治愈', '伤感', '开心', '提神', '专注', '睡前', '陈奕迅', '周杰伦', '林俊杰', '许嵩', '薛之谦'];
  for (const pattern of patterns) {
    if (value.toLowerCase().includes(pattern.toLowerCase())) hints.push(pattern);
  }
  return hints;
}

function extractAvoidHints(text) {
  const value = String(text || '');
  const hints = [];
  const avoidMatch = value.match(/(?:不要|不想听|不喜欢|别放|少放)([^，。？！,.!?]{1,16})/);
  if (avoidMatch?.[1]) hints.push(avoidMatch[1].trim());
  return hints;
}

function rejectsMusic(text) {
  return /不想听|先别放|不要放|别放|先别切|不要切|别切|别换|先聊|陪我聊|不放歌|只是聊/.test(String(text || ''));
}

function isModeUpdateRequest(text) {
  return /恢复正常推荐|取消.*偏好|取消.*模式|恢复正常|后面都听|以后都听|接下来都听/.test(String(text || ''));
}

async function generateFriendReply({ config, profile, mode, prefs = {}, history, userMessage, currentTrack, baseMood, explicitIntent, canSuggest, memoryContext = {}, turnAction = null }) {
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
        '你是灿灿，一个聪明、自然、熟悉感很强的 AI 朋友，同时也是私人电台 DJ。',
        '这一轮是普通聊天回复，不负责选歌。请像网页版大模型聊天一样，先直接回答用户这句话本身。',
        '你可以表达自己的判断、喜好和理由，不要只做情绪复述；用户问“你喜欢 X 吗”，就直接说喜欢/不喜欢/为什么。',
        '不要把所有话题都拉回音乐；只有用户主动聊到音乐、歌手、当前歌曲时，才自然聊音乐。',
        '不要使用固定陪伴模板，不要突然说“我在这里”“我陪你”“不用马上睡着/振作”。这些话只有用户明确痛苦、失眠、崩溃时才可少量使用。',
        '回复长度按内容决定：问候 20-50 字，普通聊天 50-140 字，复杂问题或认真倾诉可以 120-260 字。',
        '如果需要提问，每次最多一个自然的问题；更重要的是先回应用户已经说出的内容。',
        '当前歌曲只用于背景判断；除非用户主动问当前歌曲、歌词、歌名或艺人，不要提及歌名、艺人、歌词或“正在播放”。',
        turnActionInstruction(turnAction),
        '输出 JSON：{"chatText":"按语境长度生成的自然温柔回复","mood":"comfort|melancholy|calm|healing|focus|energy|romantic|nostalgic|night|random","energy":"low|medium|high","intent":"chat|mood","searchHints":["2-6字关键词"],"reason":"简短理由","mode":null或"reset"或偏好名}'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `听众画像：${profile.summary || ''}`,
        `当前模式：${mode?.genre || '无'}`,
        `用户聊天/音乐偏好设置：${JSON.stringify(normalizeRuntimePrefs(prefs))}`,
        normalizeRuntimePrefs(prefs).note ? `用户补充偏好：${normalizeRuntimePrefs(prefs).note}` : '用户补充偏好：无',
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
    const parsed = parseChatDecision(raw);
    const normalized = normalizeMoodDecision(parsed);
    return {
      ...normalized,
      shouldRecommend: false,
      chatText: String(parsed.chatText || fallback().chatText).trim(),
      newMode: parsed.mode === 'reset' ? {} : (parsed.mode && typeof parsed.mode === 'string' ? { genre: parsed.mode, note: '用户指定' } : null)
    };
  } catch {
    const plain = stripCodeFence(String(raw || '')).trim();
    if (plain && plain !== JSON.stringify(fallback())) {
      return {
        ...fallback(),
        chatText: plain.slice(0, 500)
      };
    }
    return fallback();
  }
}

function parseChatDecision(raw) {
  const text = stripCodeFence(String(raw || '')).trim();
  try {
    return JSON.parse(text);
  } catch {}
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) return JSON.parse(objectMatch[0]);
  throw new Error('chat decision is not JSON');
}

function stripCodeFence(value) {
  return String(value || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
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
    reason: input.reason || '',
    preferenceHints: Array.isArray(input.preferenceHints) ? uniqueStrings(input.preferenceHints, 8) : [],
    avoidHints: Array.isArray(input.avoidHints) ? uniqueStrings(input.avoidHints, 8) : [],
    musicIntent: input.musicIntent || input.intent || 'chat',
    confidence: Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : undefined
  };
}

function fallbackFriendChat(userMessage, mood, turnAction = null) {
  const text = String(userMessage || '').trim();
  if (isLightGreeting(userMessage)) {
    return '你好呀，我在。今天想聊点什么？';
  }
  if (/你喜欢.*陶喆|陶喆.*你喜欢/.test(text)) {
    return '喜欢啊。陶喆很厉害，他那种 R&B 的律动、转音和和声都很有辨识度，而且歌里有一种很松弛但很高级的感觉。《普通朋友》《爱很简单》《黑色柳丁》都挺能说明他的风格。';
  }
  if (/你喜欢|你觉得.*怎么样|你觉得|喜欢.*吗/.test(text)) {
    const topic = text
      .replace(/你喜欢|你觉得|怎么样|吗|呀|啊|呢|？|\?/g, '')
      .trim();
    return topic
      ? `我还挺愿意聊 ${topic} 的。要是按我的感觉，我会先看它有没有自己的味道，而不是只看热不热门。你突然问这个，是最近听到/看到它了吗？`
      : '我有自己的偏好呀，不过会看具体是什么。你问的是哪一类，歌手、电影，还是别的东西？';
  }
  if (/好晚|晚了|晚上了|夜深/.test(text)) {
    return '是有点晚了。这个点很适合把节奏放慢一点，不过也不用立刻逼自己睡。你现在是想再聊会儿，还是只是随口感叹一下？';
  }
  if (/你在吗|在吗/.test(text)) {
    return '在呀。你说，我听着。';
  }
  if (/谢谢|谢啦|感谢/.test(text)) {
    return '不客气呀。你跟我说这些就行，不用太客气。';
  }
  if (turnAction?.action === TURN_ACTIONS.ASK_FOLLOWUP) {
    return '听起来这件事确实有点压着你。先不用急着把它整理得很清楚，你可以按想到哪说到哪。';
  }
  if (turnAction?.action === TURN_ACTIONS.SOFT_OFFER_MUSIC) {
    return '我先听你把话说完，不急着切歌。等你真的想用音乐换一下气氛，我再接。';
  }
  if (turnAction?.action === TURN_ACTIONS.CLARIFY_INTENT) {
    return '我有点不确定你是想继续聊，还是想让我切首歌。你直接说就行，不用组织得很正式。';
  }
  if (mood?.mood === 'comfort' && /心情不好|难受|吵架|崩溃|委屈|低落|伤心|难过|烦/.test(text)) {
    return '听起来你现在确实不太舒服。先别急着给自己下结论，慢慢说发生了什么就行。';
  }
  if (mood?.mood === 'night' && /睡不着|失眠|凌晨|夜里/.test(text)) {
    return '睡不着确实烦。先别硬逼自己睡，越逼越清醒；你可以跟我随便说点什么，把脑子里的声音放小一点。';
  }
  if (mood?.mood === 'energy' && /提神|振作|有劲|运动|跑步|开心|兴奋/.test(text)) {
    return '那可以把节奏稍微拉起来一点。别一下子冲太猛，先让自己进入状态就行。';
  }
  return text
    ? `嗯，我懂你的意思。你刚刚说“${text.slice(0, 24)}”，我会先按聊天来接，不会突然切到电台腔。你可以继续说具体一点。`
    : '我在。你想聊什么都可以。';
}

function isLightGreeting(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return false;
  return /^(你好|嗨|hi|hello|哈喽|在吗|灿灿|早|早安|晚上好|下午好|中午好)[呀啊哦～~!！。.\s]*$/.test(value);
}

function turnActionInstruction(turnAction = {}) {
  const action = turnAction?.action || TURN_ACTIONS.CHAT_ONLY;
  if (action === TURN_ACTIONS.ASK_FOLLOWUP) {
    return '当前动作是 ASK_FOLLOWUP。这一轮只聊天，不切歌。像朋友一样回应用户刚说的内容；如果只是问候就轻松一点，如果是倾诉就先接住重点，最后最多给一个自然邀请。';
  }
  if (action === TURN_ACTIONS.SOFT_OFFER_MUSIC) {
    return '当前动作是 SOFT_OFFER_MUSIC。这一轮仍然只聊天，不自动播放。可以很轻地表达“之后想换个气氛我可以帮你接”，但不要抢走当前话题。';
  }
  if (action === TURN_ACTIONS.CLARIFY_INTENT) {
    return '当前动作是 CLARIFY_INTENT。自然确认用户是想继续聊还是想听歌，不要让用户觉得必须立刻做选择。';
  }
  if (action === TURN_ACTIONS.CONTINUE_CURRENT_SONG) {
    return '当前动作是 CONTINUE_CURRENT_SONG。回应播放控制即可，不要另外展开推荐。';
  }
  return '当前动作是 CHAT_ONLY。这一轮只聊天，不切歌。像熟悉的朋友一样直接回应；普通问候要轻，不要突然深情或分析；用户问观点时要给观点。';
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
    '- 这一轮已经由外层决策确认需要接歌，必须从候选曲目里选择一首，不要返回 null',
    '- 如果听众明确点歌或要求换歌，优先满足点歌/风格请求',
    '- 如果是根据对话情绪接歌，先用一句话回应刚才的聊天，再自然引出歌曲',
    '- 不要因为候选曲目里恰好有和听众问题同名的歌就推荐——那是巧合',
    '- pick 必然填数字；只有候选池完全为空时才允许 null',
    '- mode 字段：如果听众明确指定了新偏好（如「后面都听国风」），设为 "国风"；如果听众要求恢复正常，设为 "reset"；否则 null'
  ].join('\n');

  const userPrompt = [
    `候选曲目：\n${poolText}${searchNote}`,
    `对话历史：${history.length ? '\n' + history.map(h => `[${h.role === 'user' ? '听众' : '灿灿'}]: ${h.content}`).join('\n') : '（新对话）'}`,
    userMessage ? `\n听众说：${userMessage}\n（外层已经判断现在适合切到一首歌。请自然回应并选择最合适的候选。）` : '\n（上一首播完了，请自然推荐下一首）'
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

  // This function is only called from the music-action path. If the model
  // forgets to pick, fall back to the top ranked candidate instead of chatting.
  if ((pick < 0 || pick >= tracks.length) && tracks.length) {
    pick = 0;
    reason = reason || '外层决策要求接歌，使用最高分候选';
  }
  if (pick < 0 || pick >= tracks.length) {
    return { chatText, track: null, reason: '', newMode };
  }

  let selectedTrack = tracks[pick] || tracks[0];
  let selectedChanged = false;

  const checked = new Set();
  const maxScan = Math.min(tracks.length, PLAYABLE_FALLBACK_SCAN_LIMIT);
  for (let offset = 0; offset < maxScan; offset++) {
    const index = (pick + offset) % tracks.length;
    const candidateTrack = tracks[index];
    if (!candidateTrack?.id || checked.has(String(candidateTrack.id))) continue;
    checked.add(String(candidateTrack.id));
    const playable = await resolvePlayableTrack(db, netease, candidateTrack, { includeLyric: true });
    if (playable?.playable) {
      selectedTrack = playable;
      selectedChanged = offset > 0;
      break;
    }
  }

  if (!selectedTrack?.playable) {
    return {
      chatText: '这批候选里暂时没有确认可播放的歌，我先不乱播。你点下一首，我重新找一批更稳的。',
      track: null,
      reason: '候选歌曲暂时不可播放',
      newMode
    };
  }

  const finalChatText = selectedChanged
    ? `刚才那首暂时放不了，我换成 ${trackDisplayName(selectedTrack)}。`
    : ensureRecommendationTextMatchesTrack(chatText, selectedTrack, tracks);

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
