// Conversational AI DJ — unified chat + track selection
import crypto from 'node:crypto';
import { generateChatCompletion, getWeatherSummary, synthesizeSpeech } from './ai.mjs';
import { extractRecords, getProfile, listProfileFallbackTracks, resolvePlayableTrack } from './library.mjs';
import {
  listRecentPlays,
  listTracks,
  nowIso,
  saveTrack,
  normalizeTrack,
  getFeedbackSummaryMap,
  getSessionMode,
  setSessionMode,
  getAccountSetting,
  setAccountSetting,
  recordMoodEvent,
  recordOrMergeUserMemory,
  retrieveRelevantMemories,
  memoryKinds
} from './db.mjs';
import { searchOnline } from './community.mjs';
import { getUserPrefs } from './radio.mjs';
import { normalizeAccountContext } from './account-scope.mjs';
import { buildCanCanBackgroundPrompt, buildCanCanPersonaPrompt } from './cancan-persona.mjs';

const CANDIDATE_LIMIT = 60;
const AUTO_QUOTAS = { library_recent: 18, library_deep: 22, ai_discovery: 20 };
const SEARCH_QUOTAS = { community_search: 24, ai_discovery: 12, library_recent: 12, library_deep: 12 };
const STYLE_SEARCH_QUOTAS = { style_search: 36, ai_discovery: 12, library_recent: 6, library_deep: 6 };
const LOCAL_CANDIDATE_LIMIT = 120;
const HYBRID_PROMPT_CANDIDATE_LIMIT = 24;
const LOCAL_AUTO_QUOTAS = { library_recent: 18, library_deep: 42 };
const LOCAL_SEARCH_QUOTAS = { library_recent: 20, library_deep: 40 };
const HYBRID_DISCOVERY_QUOTAS = { ai_discovery: 30, library_recent: 15, library_deep: 15 };
const HYBRID_DISCOVERY_WINDOW = 6;
const HYBRID_DISCOVERY_DEFAULT_RATIO = 0.5;
const HYBRID_DISCOVERY_DEFAULT_TIMEOUT_MS = 1200;
const HYBRID_DISCOVERY_DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
const STYLE_SEARCH_DEFAULT_TIMEOUT_MS = 1500;
const STYLE_SEARCH_DEFAULT_LIMIT = 30;
const PROMPT_ARTIST_DEFAULT_LIMIT = 5;
const ARTIST_DENSITY_DEFAULT_WINDOW = 8;
const ARTIST_DENSITY_DEFAULT_MAX = 3;
const RECENT_ARTIST_COOLDOWN_PENALTY = -36;
const HOT_ARTIST_COOLDOWN_PENALTY = -42;
const SOURCE_BASE_SCORES = {
  style_search: 82,
  community_search: 70,
  ai_discovery: 45,
  library_recent: 42,
  library_deep: 35
};
const MOODS = new Set(['comfort', 'melancholy', 'calm', 'healing', 'focus', 'energy', 'romantic', 'nostalgic', 'night', 'random']);
const WEATHER_CACHE_MS = 10 * 60 * 1000;
const DEFAULT_APP_TIME_ZONE = 'Asia/Shanghai';
const SESSION_SUMMARY_MIN_MESSAGES = 12;
const SESSION_SUMMARY_STEP = 8;
const LONG_MEMORY_LIMIT = 8;
const LONG_MEMORY_MAX_CHARS = 800;
const CHAT_LLM_TIMEOUT_MS = 9000;
const INTENT_LLM_TIMEOUT_MS = 4000;
const INTENT_FALLBACK_SENTINEL = '__INTENT_CLASSIFIER_FALLBACK__';
const DEFAULT_PREFS = Object.freeze({
  chatMusicBalance: 'friend',
  recommendationFrequency: 'medium',
  voiceMode: 'recommendations',
  moodMode: 'auto',
  lowDistractionMode: false,
  note: ''
});
const DAILY_MUSIC_RECAP_SPOKEN_DATE_KEY = 'daily_music_recap_spoken_date';
const RECOMMENDATION_TRACE_SOURCES = Object.freeze({
  recent_completion_direction: {
    id: 'recent_completion_direction',
    label: '你最近完整听完的方向',
    correctionKey: 'recent_completion'
  },
  similar_artist: {
    id: 'similar_artist',
    label: '相似艺人发现',
    correctionKey: 'similar_artist'
  },
  lyric_mood_match: {
    id: 'lyric_mood_match',
    label: '歌词情绪相近',
    correctionKey: 'lyric_mood'
  },
  long_absent_favorite: {
    id: 'long_absent_favorite',
    label: '你很久没听但以前喜欢',
    correctionKey: 'long_absent'
  },
  new_release_radar: {
    id: 'new_release_radar',
    label: '新发行雷达',
    correctionKey: 'new_release'
  }
});
const RADIO_QUEUE_LIMIT = 2;
const PLAYLIST_SIZE = 5;
const PLAYLIST_PLAN_LIMIT = 10;
const RADIO_QUEUE_DIAGNOSTIC_LIMIT = 4;
const RADIO_QUEUE_DIAGNOSTIC_TTL_MS = 10 * 60 * 1000;
const QUEUE_ITEM_STATUSES = new Set(['pending', 'ready', 'failed', 'stale']);
const QUEUE_RECONCILE_ACTIONS = Object.freeze({
  USE_AS_IS: 'use_as_is',
  FINALIZE_PLAYBACK: 'finalize_playback',
  REPLACE_TRACK: 'replace_track'
});
const RADIO_QUEUE_POLICIES = Object.freeze({
  REFRESH_TAIL: 'refresh_tail',
  HARD_PREEMPT: 'hard_preempt',
  SOFT_PREEMPT: 'soft_preempt',
  CLEAR: 'clear'
});
const VOCAL_POLICIES = Object.freeze({
  INSTRUMENTAL_ONLY: 'instrumental_only'
});
const radioQueueJobs = new Set();
const discoveryCandidateCache = new Map();
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

export async function djTurn({ db, config, netease, sessionId, userMessage, conversationMood = null, useQueue = true, accountContext = null }) {
  const account = normalizeAccountContext(accountContext);
  sessionId = ensureSession(db, sessionId, account);
  const normalizedUserMessage = String(userMessage || '').trim();

  if (useQueue && !normalizedUserMessage) {
    const queued = consumeReadyRadioQueue(db, sessionId, { recordHit: false, accountContext: account });
    if (queued?.track) {
      const reconciled = await reconcileQueuedItemBeforeCommit({
        db,
        config,
        sessionId,
        item: queued,
        fallbackConversationMood: conversationMood,
        accountContext: account
      });
      if (reconciled.action === QUEUE_RECONCILE_ACTIONS.REPLACE_TRACK) {
        appendStaleQueueDiagnostic(db, sessionId, queued, reconciled.reason || 'context_recommendation_shift');
        updateQueueMetrics(db, sessionId, {
          queueContextDiscardCount: 1,
          syncFallbackCount: 1,
          lastMissReason: 'queue_context_replaced',
          lastQueueReconcileReason: reconciled.reason || 'context_recommendation_shift'
        });
        const latestMusicContext = normalizeMusicContext(getSessionContext(db, sessionId).musicContext || {});
        const payload = await buildRadioRecommendation({
          db,
          config,
          netease,
          sessionId,
          userMessage: null,
          conversationMood: moodFromMusicContext(latestMusicContext),
          accountContext: account
        });
        const response = await commitRadioRecommendation({
          db,
          config,
          sessionId,
          payload,
          userMessage: null,
          conversationMood: payload.conversationMood || moodFromMusicContext(latestMusicContext),
          source: 'sync',
          accountContext: account
        });
        scheduleRadioQueueFill({ db, config, netease, sessionId, reason: 'after_context_replace', accountContext: account });
        return { ...response, queueHit: false, queueReconciled: reconciled.action };
      }
      const queuePayload = reconciled.payload || queued;
      updateQueueMetrics(db, sessionId, {
        queueHitCount: 1,
        lastQueueHitAt: nowIso(),
        lastMissReason: null,
        lastQueueReconcileReason: reconciled.reason || reconciled.action
      });
      const response = await commitRadioRecommendation({
        db,
        config,
        sessionId,
        payload: queuePayload,
        userMessage: null,
        conversationMood: queuePayload.conversationMood || queuePayload.contextSnapshot || conversationMood,
        source: 'queue',
        accountContext: account
      });
      scheduleRadioQueueFill({ db, config, netease, sessionId, reason: 'after_consume', accountContext: account });
      return { ...response, queueHit: true, queueReconciled: reconciled.action };
    }
    updateQueueMetrics(db, sessionId, { queueMissCount: 1, lastMissReason: 'no_ready_queue_item' });
  }

  const payload = await buildRadioRecommendation({
    db,
    config,
    netease,
    sessionId,
    userMessage: normalizedUserMessage || null,
    conversationMood,
    accountContext: account
  });
  const response = await commitRadioRecommendation({
    db,
    config,
    sessionId,
    payload,
    userMessage: normalizedUserMessage || null,
    conversationMood: payload.conversationMood || conversationMood,
    source: 'sync',
    accountContext: account
  });
  if (useQueue) {
    scheduleRadioQueueFill({ db, config, netease, sessionId, reason: 'after_sync', accountContext: account });
  }
  if (useQueue && !normalizedUserMessage) {
    updateQueueMetrics(db, sessionId, { syncFallbackCount: 1 });
  }
  return { ...response, queueHit: false };
}

export async function playlistStartTurn({ db, config, netease, sessionId, userMessage = null, accountContext = null }) {
  const account = normalizeAccountContext(accountContext);
  sessionId = ensureSession(db, sessionId, account);
  const normalizedUserMessage = String(userMessage || '').trim();
  clearRadioQueue(db, sessionId);
  const built = await buildPlaylistRecommendation({
    db,
    config,
    netease,
    sessionId,
    userMessage: normalizedUserMessage || null,
    accountContext: account
  });
  if (!built.playlist) return built.response;
  return commitPlaylistPlayback({
    db,
    config,
    sessionId,
    playlist: built.playlist,
    index: 0,
    hostPolicy: 'playlist_intro',
    userMessage: normalizedUserMessage || null,
    accountContext: account
  });
}

export async function playlistNextTurn({ db, config, netease, sessionId, accountContext = null }) {
  const account = normalizeAccountContext(accountContext);
  sessionId = ensureSession(db, sessionId, account);
  const context = getSessionContext(db, sessionId);
  const current = normalizeActivePlaylist(context.activePlaylist);
  if (!current || current.currentIndex >= PLAYLIST_SIZE - 1) {
    if (current) {
      setSessionContext(db, sessionId, {
        ...context,
        activePlaylist: markPlaylistItemStatus(current, current.currentIndex, 'played')
      });
    }
    return playlistStartTurn({ db, config, netease, sessionId, accountContext: account });
  }
  const playlist = movePlaylistToIndex(current, current.currentIndex + 1, { previousStatus: 'played' });
  return commitPlaylistPlayback({
    db,
    config,
    sessionId,
    playlist,
    index: playlist.currentIndex,
    hostPolicy: 'none',
    accountContext: account
  });
}

export async function playlistJumpTurn({ db, config, netease, sessionId, index, accountContext = null }) {
  const account = normalizeAccountContext(accountContext);
  sessionId = ensureSession(db, sessionId, account);
  const context = getSessionContext(db, sessionId);
  const current = normalizeActivePlaylist(context.activePlaylist);
  const targetIndex = Number(index);
  if (!current) {
    return { __error: true, ok: false, status: 400, error: 'No active playlist.' };
  }
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= current.items.length) {
    return { __error: true, ok: false, status: 400, error: 'Invalid playlist index.' };
  }
  const target = current.items[targetIndex];
  if (!target?.track?.id || target.status !== 'pending') {
    return { __error: true, ok: false, status: 400, error: 'Playlist item is not jumpable.' };
  }
  const playlist = movePlaylistToIndex(current, targetIndex, { previousStatus: 'skipped' });
  return commitPlaylistPlayback({
    db,
    config,
    sessionId,
    playlist,
    index: playlist.currentIndex,
    hostPolicy: 'none',
    accountContext: account
  });
}

export function clearActivePlaylistSession(db, sessionId, accountContext = null) {
  const account = normalizeAccountContext(accountContext);
  const id = ensureSession(db, sessionId, account);
  updateSessionContext(db, id, (context) => {
    const { activePlaylist, ...rest } = context;
    return rest;
  });
  return { ok: true, sessionId: id };
}

async function buildRadioRecommendation({
  db,
  config,
  netease,
  sessionId,
  userMessage,
  conversationMood = null,
  extraAvoidTracks = [],
  accountContext = null,
  deferHostAndSpeech = false
}) {
  const account = normalizeAccountContext(accountContext);
  sessionId = ensureSession(db, sessionId, account);
  const profile = getProfile(db, account);
  const environmentContext = await getEnvironmentContext({ db, sessionId, config });
  const { hour, timeOfDay, weather } = environmentContext;
  const mode = getSessionMode(db, sessionId);
  const prefs = normalizeRuntimePrefs(getUserPrefs(db, account));
  const context = getSessionContext(db, sessionId);
  const sessionConstraints = getSessionConstraintsFromContext(context);
  const conversationState = normalizeConversationState(context.conversationState);
  const effectiveMusicContext = getEffectiveMusicContextForRecommendation(context, { userMessage });
  const contextMood = context.musicContext ? moodFromMusicContext(effectiveMusicContext) : null;
  const recommendationMood = mergeSessionConstraintsIntoMood(
    conversationMood || contextMood || moodFromConversationState(conversationState, prefs, mode),
    sessionConstraints
  );
  const hostContext = buildRadioHostContext(db, sessionId, context, userMessage, account);
  const openingRecap = consumeOpeningMusicRecapForHost({
    db,
    accountContext: account,
    context,
    environmentContext,
    enabled: !userMessage
  });
  if (openingRecap) hostContext.openingRecap = openingRecap;

  const history = loadHistory(db, sessionId, account);
  const sessionSummary = await updateSessionSummary(db, config, sessionId, account);
  const longTermMemories = retrieveRelevantMemories(db, {
    accountId: account.accountId,
    text: userMessage || recommendationMood?.reason || '',
    mood: recommendationMood,
    mode,
    limit: LONG_MEMORY_LIMIT,
    maxChars: LONG_MEMORY_MAX_CHARS
  });
  const memoryContext = buildMemoryContext({ sessionSummary, longTermMemories });

  const result = await callDJ({
    db,
    config,
    netease,
    sessionId,
    profile,
    weather,
    timeOfDay,
    hour,
    mode,
    prefs,
    history,
    userMessage,
    conversationMood: recommendationMood,
    memoryContext,
    hostContext,
    environmentContext,
    avoidTracks: extraAvoidTracks,
    sessionConstraints,
    accountContext: account,
    deferHostText: deferHostAndSpeech
  });

  const speech = speechDecisionForRecommendation(prefs);
  const tts = deferHostAndSpeech
    ? { url: null, status: 'deferred', ms: 0, error: null }
    : speech.shouldSpeak
    ? await synthesizeSpeechWithDiagnostics(config.tts, result.chatText)
    : { url: null, status: 'disabled', ms: 0, error: null };
  if (!deferHostAndSpeech) {
    if (tts.status === 'failed') updateQueueMetrics(db, sessionId, { ttsFailedCount: 1 });
    setRadioDebugInfo(db, sessionId, { lastTtsDiagnostics: sanitizeTtsDiagnostics(tts) });
  }
  const musicContext = effectiveMusicContext;

  return {
    id: `ready-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: 'ready',
    createdAt: nowIso(),
    contextVersion: musicContext.version,
    contextSnapshot: musicContext,
    chatText: deferHostAndSpeech ? '' : result.chatText,
    track: result.track,
    reason: result.reason,
    explanation: result.explanation,
    noveltyBucket: result.noveltyBucket || null,
    discoverySource: result.discoverySource || null,
    recommendationSource: normalizeRecommendationSource(result.recommendationSource),
    ttsUrl: tts.url,
    ttsStatus: tts.status,
    ttsMs: tts.ms,
    ttsError: tts.error,
    speech,
    mode: result.newMode || mode,
    profile,
    weather,
    weatherRadio: environmentContext.weatherRadio || null,
    musicRecap: hostContext.openingRecap || null,
    environmentContext,
    newMode: result.newMode || null,
    conversationMood: recommendationMood,
    accountContext: account,
    hostDeferred: deferHostAndSpeech
  };
}

async function buildPlaylistRecommendation({ db, config, netease, sessionId, userMessage = null, accountContext = null }) {
  const account = normalizeAccountContext(accountContext);
  sessionId = ensureSession(db, sessionId, account);
  const normalizedUserMessage = String(userMessage || '').trim();
  const profile = getProfile(db, account);
  const environmentContext = await getEnvironmentContext({ db, sessionId, config });
  const { hour, timeOfDay, weather } = environmentContext;
  const mode = getSessionMode(db, sessionId);
  const prefs = normalizeRuntimePrefs(getUserPrefs(db, account));
  const context = getSessionContext(db, sessionId);
  const sessionConstraints = getSessionConstraintsFromContext(context);
  const conversationState = normalizeConversationState(context.conversationState);
  const effectiveMusicContext = getEffectiveMusicContextForRecommendation(context, { userMessage: normalizedUserMessage || null });
  const contextMood = context.musicContext ? moodFromMusicContext(effectiveMusicContext) : null;
  const conversationMood = mergeSessionConstraintsIntoMood(
    contextMood || moodFromConversationState(conversationState, prefs, mode),
    sessionConstraints
  );
  const hostContext = buildRadioHostContext(db, sessionId, context, normalizedUserMessage || null, account);
  const history = loadHistory(db, sessionId, account);
  const sessionSummary = await updateSessionSummary(db, config, sessionId, account);
  const longTermMemories = retrieveRelevantMemories(db, {
    accountId: account.accountId,
    text: normalizedUserMessage || conversationMood?.reason || '',
    mood: conversationMood,
    mode,
    limit: LONG_MEMORY_LIMIT,
    maxChars: LONG_MEMORY_MAX_CHARS
  });
  const memoryContext = buildMemoryContext({ sessionSummary, longTermMemories });
  const request = getMusicRequestConstraints(db, normalizedUserMessage || null, mode, sessionConstraints);
  if (!request.vocalPolicy && conversationMood?.vocalPolicy) {
    request.vocalPolicy = normalizeVocalPolicy(conversationMood.vocalPolicy);
  }
  const playedHistory = getPlayedTrackHistory(db, sessionId, 80, account);
  const playedIds = new Set(playedHistory.map(track => String(track.id || '')).filter(Boolean));
  const playedSignatures = buildPlayedSignatureSet(playedHistory);
  const selected = [];
  const diagnostics = [];
  const failedPicks = [];

  const plans = [
    await generatePlaylistPlan({
      config,
      profile,
      weather,
      timeOfDay,
      hour,
      mode,
      prefs,
      history,
      conversationMood,
      memoryContext,
      userMessage: normalizedUserMessage || null,
      request,
      playedHistory,
      hostContext,
      environmentContext,
      failedPicks
    })
  ];

  for (let attempt = 0; attempt < 2 && selected.length < PLAYLIST_SIZE; attempt += 1) {
    const plan = plans[attempt] || await generatePlaylistPlan({
      config,
      profile,
      weather,
      timeOfDay,
      hour,
      mode,
      prefs,
      history,
      conversationMood,
      memoryContext,
      userMessage: normalizedUserMessage || null,
      request,
      playedHistory: [...playedHistory, ...selected.map(item => item.track)],
      hostContext,
      environmentContext,
      failedPicks
    });
    if (!plans[attempt]) plans[attempt] = plan;
    setRadioDebugInfo(db, sessionId, { lastPlaylistPlan: sanitizePlaylistPlan(plan, attempt) });
    for (const pick of uniquePlaylistPicks(plan.picks)) {
      if (selected.length >= PLAYLIST_SIZE) break;
      const resolved = await resolveSongPlanTrack({
        db,
        config,
        netease,
        sessionId,
        plan: { picks: [pick], hostDraft: plan.hostDraft, mode: null },
        playedIds,
        playedSignatures,
        request
      });
      diagnostics.push(...(resolved.diagnostics || []));
      if (!resolved.track) {
        failedPicks.push(...(resolved.failedPicks || [pick]));
        continue;
      }
      addPlaylistSelection(selected, resolved.track, resolved.pick || pick, playedIds, playedSignatures);
    }
  }

  if (selected.length < PLAYLIST_SIZE) {
    const fallback = await fillPlaylistFromProfile({
      db,
      config,
      netease,
      profile,
      conversationMood,
      request,
      selected,
      playedIds,
      playedSignatures,
      accountContext: account
    });
    diagnostics.push(...fallback.diagnostics);
  }

  setRadioDebugInfo(db, sessionId, { lastPlaylistSearchDiagnostics: diagnostics.slice(0, 12) });
  if (selected.length < PLAYLIST_SIZE) {
    const chatText = '这次没凑齐稳定可播的 5 首，我先不硬播。';
    return {
      playlist: null,
      response: {
        sessionId,
        chatText,
        track: null,
        reason: 'playlist_not_enough_playable_tracks',
        playlistMode: true,
        hostPolicy: 'none',
        playlist: null,
        ttsUrl: null,
        ttsStatus: 'disabled',
        speech: { shouldSpeak: false, mode: 'off' },
        profile,
        weather
      }
    };
  }

  const title = buildPlaylistTitle({ timeOfDay, conversationMood });
  const summary = buildPlaylistSummary({ selected, conversationMood, weather, timeOfDay });
  const playlist = normalizeActivePlaylist({
    id: `playlist-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    summary,
    createdAt: nowIso(),
    contextVersion: effectiveMusicContext.version,
    contextSnapshot: effectiveMusicContext,
    currentIndex: 0,
    items: selected.slice(0, PLAYLIST_SIZE).map((item, index) => ({
      index,
      track: item.track,
      reason: item.reason,
      status: index === 0 ? 'current' : 'pending'
    })),
    conversationMood,
    weather,
    environmentContext,
    profile
  });
  playlist.hostText = await generatePlaylistIntroText({
    config,
    playlist,
    profile,
    prefs,
    history,
    timeOfDay,
    hour,
    weather,
    conversationMood,
    memoryContext,
    hostContext,
    environmentContext
  });
  return { playlist, response: null };
}

function addPlaylistSelection(selected, track, pick, playedIds, playedSignatures) {
  const key = playedSongKey(track?.name);
  if (!track?.id || !key || playedSignatures.has(key)) return false;
  selected.push({
    track,
    reason: pick?.reason || '符合当前状态、音乐画像和上下文',
    pick
  });
  playedIds.add(String(track.id));
  playedSignatures.add(key);
  return true;
}

async function fillPlaylistFromProfile({ db, config, netease, profile, conversationMood, request, selected, playedIds, playedSignatures, accountContext }) {
  const diagnostics = [{
    pick: { name: 'playlist_profile_fallback', artists: [], reason: 'profile_fallback' },
    queries: ['current account profile playlists'],
    hits: [],
    fallbackSource: 'playlist_profile'
  }];
  const fallbackTracks = listProfileFallbackTracks(db, 260, accountContext)
    .filter(track => !shouldSkipFallbackTrack(track, { playedIds, playedSignatures, request }))
    .filter(track => !trackViolatesSessionConstraints(track, request.sessionConstraints))
    .filter(track => !trackViolatesVocalPolicy(track, request))
    .map((track, index) => ({ track, score: scoreFallbackTrack(track, { profile, conversationMood }) - index * 0.01 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 48);

  for (const item of fallbackTracks) {
    if (selected.length >= PLAYLIST_SIZE) break;
    const hit = {
      track: sanitizeTrackForDebug(item.track),
      score: Math.round(item.score * 100) / 100,
      accepted: true,
      filterReason: null,
      playable: null
    };
    diagnostics[0].hits.push(hit);
    const playable = await resolvePlayableTrack(db, netease, item.track, playableResolveOptions(config, { includeLyric: false }));
    hit.playable = Boolean(playable?.playable);
    if (!playable?.playable) {
      hit.accepted = false;
      hit.filterReason = 'not_playable';
      continue;
    }
    const withLyric = await resolvePlayableTrack(db, netease, playable, playableResolveOptions(config, { includeLyric: true }));
    const selectedTrack = withLyric?.playable ? withLyric : playable;
    addPlaylistSelection(selected, selectedTrack, {
      name: selectedTrack.name,
      artists: selectedTrack.artists || [],
      reason: item.track.playlistName ? `来自你的《${item.track.playlistName}》歌单画像` : '来自你的音乐画像'
    }, playedIds, playedSignatures);
  }
  return { diagnostics: [trimSearchDiagnostic(diagnostics[0])] };
}

async function commitPlaylistPlayback({ db, config, sessionId, playlist, index = 0, hostPolicy = 'none', userMessage = null, accountContext = null }) {
  const account = normalizeAccountContext(accountContext);
  sessionId = ensureSession(db, sessionId, account);
  const normalized = normalizeActivePlaylist({
    ...playlist,
    currentIndex: index
  });
  const item = normalized.items[index];
  if (!item?.track?.id) {
    return { __error: true, ok: false, status: 500, error: 'Playlist item missing track.' };
  }
  const context = getSessionContext(db, sessionId);
  const nextPlaylist = movePlaylistToIndex(normalized, index, { previousStatus: null });
  saveTrack(db, item.track);
  db.prepare('INSERT INTO plays (account_id, track_id, played_at, source, reason, host_text, report_status) VALUES (?,?,?,?,?,?,?)')
    .run(account.accountId, item.track.id, nowIso(), 'playlist', item.reason || normalized.summary || '', hostPolicy === 'playlist_intro' ? normalized.hostText || '' : '', 'pending');
  setSessionContext(db, sessionId, {
    ...context,
    activePlaylist: nextPlaylist,
    radioIntroDone: true,
    radioIntroAt: context.radioIntroAt || nowIso(),
    radioTurnCount: Number(context.radioTurnCount || 0) + 1,
    radioPlayedSongs: mergePlayedSongContext(context.radioPlayedSongs, item.track)
  });
  const prefs = normalizeRuntimePrefs(getUserPrefs(db, account));
  const speech = hostPolicy === 'playlist_intro'
    ? speechDecisionForRecommendation(prefs)
    : { shouldSpeak: false, mode: 'off' };
  let tts = { url: null, status: hostPolicy === 'playlist_intro' ? 'disabled' : 'disabled', ms: 0, error: null };
  const chatText = hostPolicy === 'playlist_intro' ? String(nextPlaylist.hostText || '').trim() : '';
  if (hostPolicy === 'playlist_intro') {
    if (userMessage) saveMessage(db, sessionId, 'user', userMessage, account);
    if (chatText) saveMessage(db, sessionId, 'assistant', chatText, account);
  }
  if (hostPolicy === 'playlist_intro' && speech.shouldSpeak && chatText) {
    tts = await synthesizeSpeechWithDiagnostics(config.tts, chatText);
    if (tts.status === 'failed') updateQueueMetrics(db, sessionId, { ttsFailedCount: 1 });
    setRadioDebugInfo(db, sessionId, { lastTtsDiagnostics: sanitizeTtsDiagnostics(tts) });
  }
  return {
    sessionId,
    chatText,
    track: item.track,
    reason: item.reason || nextPlaylist.summary || '',
    explanation: buildPlaylistItemExplanation(nextPlaylist, item, hostPolicy),
    ttsUrl: tts.url,
    ttsStatus: tts.status,
    ttsMs: tts.ms,
    ttsError: tts.error,
    speech,
    mode: getSessionMode(db, sessionId),
    profile: nextPlaylist.profile || getProfile(db, account),
    weather: nextPlaylist.weather || context.weather || '',
    playlistMode: true,
    hostPolicy,
    playlist: playlistForClient(nextPlaylist)
  };
}

async function generatePlaylistPlan({ config, profile, weather, timeOfDay, hour, mode, prefs, history, conversationMood, memoryContext, userMessage = null, request, playedHistory = [], hostContext = {}, environmentContext = {}, failedPicks = [] }) {
  const fallbackPlan = { title: '', summary: '', picks: [], hostDraft: '', mode: null };
  if (!config?.llm?.baseUrl || !config?.llm?.apiKey || !config?.llm?.model) return fallbackPlan;
  const modeText = mode?.genre
    ? `当前模式：${mode.genre}（${mode.note || '用户指定'}）`
    : '当前模式：无特殊模式';
  const failedText = failedPicks.length
    ? `上一批未命中可播放源，请避开：${failedPicks.map(pick => `${pick.name}${pick.artists?.length ? ' - ' + pick.artists.join('/') : ''}`).join('；')}`
    : '暂无失败候选。';
  const playedText = formatPlayedSongExclusions(playedHistory, request);
  const vocalPolicyText = formatVocalPolicyForPrompt(request);
  const profilePrompt = formatProfileSummaryForPrompt(profile);
  const weatherRadioPrompt = formatWeatherRadioForPrompt(environmentContext.weatherRadio);
  const musicRecapPrompt = formatOpeningMusicRecapForPrompt(hostContext.openingRecap);
  const raw = await generateChatCompletion(config.llm, [
    {
      role: 'system',
      content: [
        '你是灿灿校园电台的歌单策划。请一次设计一张 5 首歌的真实可搜索歌单，但为了后续校验，需要给出 8-10 首候选。',
        buildCanCanBackgroundPrompt('一键推荐歌单'),
        '必须结合当前时间、天气或场景、听众音乐画像、长期记忆、最近对话和禁听约束。',
        '候选必须是真实存在、主要音乐平台容易搜到的具体歌曲；每首必须有明确歌名和主要艺人。',
        '整体要像一张有顺序感的校园电台歌单，不要五首完全同质，也不要跨度过大。',
        '不要推荐已经播放过的同名歌曲；若有禁听歌手或歌名，必须避开。',
        vocalPolicyText,
        'queries 只写短搜索词，优先“歌名 艺人”和“艺人 歌名”。',
        'hostDraft 是整张歌单的开场导播方向，只描述整体氛围，不逐首长篇介绍。',
        '只输出严格 JSON，不要 Markdown。',
        'JSON 格式：{"title":"歌单名","summary":"一句话歌单氛围","picks":[{"name":"歌名","artists":["艺人"],"reason":"一句话理由","queries":["歌名 艺人","艺人 歌名"]}],"hostDraft":"50-110字整张歌单开场导播词"}'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `APP_TIME_CONTEXT：${formatEnvironmentContext(environmentContext)}`,
        weatherRadioPrompt,
        musicRecapPrompt,
        `此刻：${timeOfDay} ${hour}点，${weather}`,
        `听众画像：${profilePrompt}`,
        `偏好设置：${JSON.stringify(normalizeRuntimePrefs(prefs))}`,
        modeText,
        userMessage ? `SCENE_REQUEST: ${userMessage}` : 'SCENE_REQUEST: none',
        conversationMood ? `对话情绪：${JSON.stringify(conversationMood)}` : '对话情绪：无',
        vocalPolicyText,
        formatSessionConstraintsForPrompt(request?.sessionConstraints),
        formatRecentHostPlays(hostContext.recentPlays),
        playedText,
        memoryContext?.promptText || '相关长期记忆：无',
        memoryContext?.sessionSummary ? `本轮会话摘要：${memoryContext.sessionSummary}` : '本轮会话摘要：无',
        `最近对话：${history.length ? '\n' + history.map(h => `[${h.role === 'user' ? '听众' : '灿灿'}]: ${h.content}`).join('\n') : '（新对话）'}`,
        failedText
      ].join('\n')
    }
  ], () => JSON.stringify(fallbackPlan));
  return parsePlaylistPlanResponse(raw, fallbackPlan);
}

function parsePlaylistPlanResponse(raw, fallbackPlan = { title: '', summary: '', picks: [], hostDraft: '', mode: null }) {
  const text = stripCodeFence(String(raw || '')).trim();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try { parsed = JSON.parse(objectMatch[0]); } catch {}
    }
  }
  if (!parsed) return fallbackPlan;
  const rawPicks = Array.isArray(parsed) ? parsed : (parsed.picks || parsed.songs || parsed.recommendations || []);
  return {
    title: String(parsed.title || parsed.name || '').trim().slice(0, 40),
    summary: String(parsed.summary || parsed.reason || '').trim().slice(0, 120),
    picks: rawPicks.map(normalizeSongPick).filter(pick => pick.name && pick.artists.length).slice(0, PLAYLIST_PLAN_LIMIT),
    hostDraft: String(parsed.hostDraft || parsed.hostText || parsed.chatText || '').trim(),
    mode: parsed.mode ?? null
  };
}

function uniquePlaylistPicks(picks = []) {
  const seen = new Set();
  const unique = [];
  for (const pick of picks) {
    const key = `${playedSongKey(pick?.name)}:${normalizeArtistList(pick?.artists || []).join('|').toLowerCase()}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(pick);
  }
  return unique;
}

function sanitizePlaylistPlan(plan = {}, attempt = 0) {
  return {
    attempt,
    title: String(plan.title || '').slice(0, 40),
    summary: String(plan.summary || '').slice(0, 120),
    picks: (plan.picks || []).map(sanitizeSongPick).slice(0, PLAYLIST_PLAN_LIMIT),
    hostDraft: String(plan.hostDraft || '').slice(0, 180),
    updatedAt: nowIso()
  };
}

function normalizeActivePlaylist(raw = null) {
  if (!raw || typeof raw !== 'object') return null;
  const items = Array.isArray(raw.items)
    ? raw.items.map((item, index) => ({
        index: Number.isInteger(Number(item?.index)) ? Number(item.index) : index,
        track: item?.track || null,
        reason: String(item?.reason || '').trim(),
        status: ['pending', 'current', 'played', 'skipped'].includes(item?.status) ? item.status : 'pending'
      })).filter(item => item.track?.id)
    : [];
  if (!items.length) return null;
  const currentIndexRaw = Number(raw.currentIndex || 0);
  const currentIndex = Math.min(Math.max(Number.isInteger(currentIndexRaw) ? currentIndexRaw : 0, 0), items.length - 1);
  return {
    id: String(raw.id || `playlist-${Date.now()}`),
    title: String(raw.title || '灿灿推荐歌单').slice(0, 40),
    summary: String(raw.summary || '').slice(0, 180),
    createdAt: raw.createdAt || nowIso(),
    contextVersion: Number(raw.contextVersion || raw.contextSnapshot?.version || 0),
    contextSnapshot: normalizeMusicContext(raw.contextSnapshot || {}),
    currentIndex,
    items: items.map((item, index) => ({
      ...item,
      index,
      status: index === currentIndex ? 'current' : item.status
    })),
    hostText: String(raw.hostText || '').trim(),
    conversationMood: raw.conversationMood ? normalizeMoodDecision(raw.conversationMood) : null,
    weather: raw.weather || '',
    environmentContext: raw.environmentContext || {},
    profile: raw.profile || null
  };
}

function markPlaylistItemStatus(playlist, index, status) {
  const normalized = normalizeActivePlaylist(playlist);
  if (!normalized) return null;
  return {
    ...normalized,
    items: normalized.items.map((item) => item.index === index ? { ...item, status } : item)
  };
}

function movePlaylistToIndex(playlist, index, { previousStatus = 'played' } = {}) {
  const normalized = normalizeActivePlaylist(playlist);
  if (!normalized) return null;
  const targetIndex = Math.min(Math.max(Number(index) || 0, 0), normalized.items.length - 1);
  const previousIndex = normalized.currentIndex;
  return {
    ...normalized,
    currentIndex: targetIndex,
    items: normalized.items.map((item) => {
      if (item.index === targetIndex) return { ...item, status: 'current' };
      if (previousStatus && item.index === previousIndex && item.status === 'current') return { ...item, status: previousStatus };
      return item.status === 'current' ? { ...item, status: item.index < targetIndex ? 'played' : 'pending' } : item;
    })
  };
}

function playlistForClient(playlist) {
  const normalized = normalizeActivePlaylist(playlist);
  if (!normalized) return null;
  return {
    id: normalized.id,
    title: normalized.title,
    summary: normalized.summary,
    currentIndex: normalized.currentIndex,
    items: normalized.items.map((item) => ({
      index: item.index,
      track: item.track,
      reason: item.reason,
      status: item.status
    }))
  };
}

function buildPlaylistTitle({ timeOfDay, conversationMood } = {}) {
  const mood = String(conversationMood?.mood || conversationMood?.energy || '').trim();
  if (mood) return `灿灿的${mood}五首`;
  return `${timeOfDay || '此刻'}校园五首`;
}

function buildPlaylistSummary({ selected = [], conversationMood, weather, timeOfDay } = {}) {
  const names = selected.slice(0, 3).map(item => `《${item.track.name}》`).join('、');
  const mood = conversationMood?.reason || conversationMood?.mood || '';
  return [timeOfDay, weather, mood, names ? `从${names}开始` : ''].filter(Boolean).join(' · ').slice(0, 160);
}

async function generatePlaylistIntroText({ config, playlist, profile, prefs, history, timeOfDay, hour, weather, conversationMood, memoryContext, hostContext, environmentContext }) {
  const fallback = playlist.hostText || `我给你整理了一张 5 首歌的小歌单，会顺着现在的状态慢慢播放。`;
  if (!config?.llm?.baseUrl || !config?.llm?.apiKey || !config?.llm?.model) return fallback;
  const songList = playlist.items.map(item => `${item.index + 1}. ${item.track.name} - ${(item.track.artists || []).join('/')}${item.reason ? `：${item.reason}` : ''}`).join('\n');
  const profilePrompt = formatProfileSummaryForPrompt(profile);
  const raw = await generateChatCompletion(config.llm, [
    {
      role: 'system',
      content: [
        '你是灿灿校园电台的 AI DJ。请为一张已经确认可播放的 5 首歌歌单写一段开场导播词。',
        buildCanCanBackgroundPrompt('歌单开场导播'),
        '只写整张歌单的整体氛围和使用场景，不要逐首详细介绍，不要说后面每首还会继续导播。',
        '语气自然、亲近、像电台开场，长度 50-110 字。',
        '只输出纯文本。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `APP_TIME_CONTEXT：${formatEnvironmentContext(environmentContext)}`,
        `此刻：${timeOfDay} ${hour}点，${weather}`,
        `听众画像：${profilePrompt}`,
        `偏好设置：${JSON.stringify(normalizeRuntimePrefs(prefs))}`,
        conversationMood ? `对话情绪：${JSON.stringify(conversationMood)}` : '对话情绪：无',
        memoryContext?.promptText || '相关长期记忆：无',
        formatRecentHostPlays(hostContext.recentPlays),
        `歌单名：${playlist.title}`,
        `歌单摘要：${playlist.summary}`,
        `五首歌：\n${songList}`,
        `最近对话：${history.length ? '\n' + history.slice(-8).map(h => `[${h.role === 'user' ? '听众' : '灿灿'}]: ${h.content}`).join('\n') : '（新对话）'}`
      ].join('\n')
    }
  ], () => fallback);
  return sanitizeSpokenChatText(String(raw || fallback)).slice(0, 180) || fallback;
}

function buildPlaylistItemExplanation(playlist, item, hostPolicy) {
  return normalizeRecommendationExplanation({
    summary: hostPolicy === 'playlist_intro'
      ? `歌单开场：${playlist.summary || item.reason || '5 首连续推荐'}`
      : `歌单第 ${item.index + 1} 首：${item.reason || playlist.summary || '延续当前歌单氛围'}`,
    factors: [
      { type: 'playlist', text: playlist.title || '歌单模式' },
      item.reason ? { type: 'reason', text: item.reason } : null
    ].filter(Boolean),
    source: 'playlist'
  });
}

async function commitRadioRecommendation({ db, config, sessionId, payload, userMessage = null, conversationMood = null, source = 'sync', accountContext = null }) {
  const account = normalizeAccountContext(accountContext || payload?.accountContext);
  sessionId = ensureSession(db, sessionId, account);
  const chatText = String(payload?.chatText || '').trim();
  const track = payload?.track || null;
  const reason = payload?.reason || '';
  const noveltyBucket = normalizeNoveltyBucket(payload?.noveltyBucket || track?.noveltyBucket);
  const discoverySource = payload?.discoverySource || track?.discoverySource || null;
  const recommendationSource = normalizeRecommendationSource(payload?.recommendationSource) || (track ? buildRecommendationSource({
    selectedPick: { reason },
    selectedTrack: track,
    noveltyBucket,
    discoverySource,
    userMessage,
    conversationMood,
    hostContext: { openingRecap: payload?.musicRecap || null }
  }) : null);
  let explanation = normalizeRecommendationExplanation(payload?.explanation);
  const alreadyHasRecommendationSource = explanation?.factors?.some((factor) =>
    factor?.type === 'trace_source' ||
    (factor?.label === '来自' && factor?.value === recommendationSource?.label)
  );
  if (recommendationSource && explanation && !alreadyHasRecommendationSource) {
    explanation = normalizeRecommendationExplanation({
      ...explanation,
      factors: [
        { type: 'trace_source', label: '来自', value: recommendationSource.label },
        ...(explanation.factors || [])
      ],
      source: explanation.source
    });
  }
  if (source === 'queue' && explanation) {
    explanation = normalizeRecommendationExplanation({
      ...explanation,
      summary: `预取歌曲命中 + ${explanation.summary}`,
      source: explanation.source
    });
  }

  if (userMessage) saveMessage(db, sessionId, 'user', userMessage, account);
  saveMessage(db, sessionId, 'assistant', chatText, account);

  if (track) {
    const playSource = noveltyBucket === 'discovery'
      ? 'radio_discovery'
      : noveltyBucket === 'familiar'
        ? 'radio_familiar'
        : 'radio';
    const sourceTag = recommendationSource?.id ? `[source:${recommendationSource.id}]` : '';
    const playReason = [noveltyBucket ? `[novelty:${noveltyBucket}]` : '', sourceTag, reason].filter(Boolean).join(' ').trim();
    db.prepare('INSERT INTO plays (account_id, track_id, played_at, source, reason, host_text, report_status) VALUES (?,?,?,?,?,?,?)')
      .run(account.accountId, track.id, nowIso(), playSource, playReason, chatText, 'pending');
    saveTrack(db, track);
    const latestContext = getSessionContext(db, sessionId);
    const payloadMusicContext = normalizeMusicContext(payload?.contextSnapshot || {});
    const hasBoundUserContext = Boolean(payloadMusicContext.lastUserMessage && payloadMusicContext.version);
    const lastBoundMusicContextVersion = hasBoundUserContext
      ? Math.max(Number(latestContext.lastBoundMusicContextVersion || 0), Number(payloadMusicContext.version || 0))
      : Number(latestContext.lastBoundMusicContextVersion || 0);
    setSessionContext(db, sessionId, {
      ...latestContext,
      radioIntroDone: true,
      radioIntroAt: latestContext.radioIntroAt || nowIso(),
      radioTurnCount: Number(latestContext.radioTurnCount || 0) + 1,
      radioPlayedSongs: mergePlayedSongContext(latestContext.radioPlayedSongs, {
        ...track,
        noveltyBucket,
        discoverySource,
        recommendationSource
      }),
      lastBoundMusicContextVersion
    });
  }

  if (userMessage) {
    scheduleMemoryExtraction({ db, config, sessionId, userMessage, assistantText: chatText, conversationMood, accountContext: account });
  }
  rememberMoodEvent({ db, sessionId, conversationMood, accountContext: account, source: track ? 'recommendation' : 'chat' });

  let mode = payload?.mode || getSessionMode(db, sessionId);
  if (payload?.newMode) {
    const newMode = { ...payload.newMode, updatedAt: nowIso() };
    setSessionMode(db, sessionId, newMode);
    mode = newMode;
  }

  const prefs = normalizeRuntimePrefs(getUserPrefs(db, account));
  const speech = speechDecisionForRecommendation(prefs);
  let ttsUrl = payload?.ttsUrl || null;
  let ttsStatus = payload?.ttsStatus || (ttsUrl ? 'ready' : null);
  let ttsMs = Number(payload?.ttsMs || 0);
  let ttsError = payload?.ttsError || null;
  if (!speech.shouldSpeak) ttsUrl = null;
  else if (!ttsUrl && chatText && payload?.ttsStatus !== 'failed') {
    const tts = await synthesizeSpeechWithDiagnostics(config.tts, chatText);
    ttsUrl = tts.url;
    ttsStatus = tts.status;
    ttsMs = tts.ms;
    ttsError = tts.error;
    if (tts.status === 'failed') updateQueueMetrics(db, sessionId, { ttsFailedCount: 1 });
    setRadioDebugInfo(db, sessionId, { lastTtsDiagnostics: sanitizeTtsDiagnostics(tts) });
  }

  return {
    sessionId,
    chatText,
    track,
    reason,
    explanation,
    recommendationSource,
    reasonSource: recommendationSource,
    ttsUrl,
    ttsStatus,
    ttsMs,
    ttsError,
    speech,
    mode,
    profile: payload?.profile || getProfile(db, account),
    weather: payload?.weather || getSessionContext(db, sessionId).weather || '',
    weatherRadio: payload?.weatherRadio || payload?.environmentContext?.weatherRadio || null,
    musicRecap: payload?.musicRecap || null,
    environmentContext: payload?.environmentContext || null,
    queueSource: source
  };
}

export async function chatTurn({ db, config, netease, sessionId, message, accountContext = null }) {
  const account = normalizeAccountContext(accountContext);
  sessionId = ensureSession(db, sessionId, account);
  const userMessage = String(message || '').trim();
  const profile = getProfile(db, account);
  const mode = getSessionMode(db, sessionId);
  const prefs = normalizeRuntimePrefs(getUserPrefs(db, account));
  const history = loadHistory(db, sessionId, account);
  const currentTrack = getCurrentTrack(db, account);
  const context = getSessionContext(db, sessionId);
  const conversationState = normalizeConversationState(context.conversationState);
  const environmentContext = await getEnvironmentContext({ db, sessionId, config });
  const constraintUpdate = parseSessionConstraintUpdate(userMessage);
  const previousSessionConstraints = getSessionConstraintsFromContext(context);
  const sessionConstraints = applySessionConstraintUpdate(previousSessionConstraints, constraintUpdate);
  const constraintsChanged = !sessionConstraintsEqual(previousSessionConstraints, sessionConstraints);
  let baseMood = analyzeTurnContext({
    history,
    userMessage,
    profile,
    currentTrack,
    mode,
    prefs,
    conversationState,
    environmentContext
  });
  baseMood = mergeSessionConstraintsIntoMood(baseMood, sessionConstraints);
  const sessionSummary = await updateSessionSummary(db, config, sessionId, account);
  const longTermMemories = retrieveRelevantMemories(db, {
    accountId: account.accountId,
    text: userMessage,
    mood: baseMood,
    mode,
    limit: LONG_MEMORY_LIMIT,
    maxChars: LONG_MEMORY_MAX_CHARS
  });
  const memoryContext = buildMemoryContext({ sessionSummary, longTermMemories });
  const explicitIntent = hasExplicitMusicIntent(userMessage);
  const userMessageCountAfterThisTurn = countUserMessages(db, sessionId, account) + (userMessage ? 1 : 0);
  const canSuggest = canProactivelyRecommend({
    userMessageCount: userMessageCountAfterThisTurn,
    lastSuggestedAtUserCount: conversationState.lastSuggestedAtUserCount ?? context.lastSuggestedAtUserCount,
    noMusicUntilUserCount: conversationState.noMusicUntilUserCount,
    currentTrack,
    mood: baseMood,
    prefs
  });
  const hardAction = decideHardRuleTurnAction({ userMessage, mode });
  const intentDecision = hardAction
    ? { turnAction: hardAction, intentSource: 'rule', skipFriendLlm: false }
    : await resolveTurnActionWithIntentModel({
      config,
      userMessage,
      history,
      baseMood,
      explicitIntent,
      canSuggest,
      currentTrack,
      profile,
      mode,
      prefs,
      conversationState,
      userMessageCount: userMessageCountAfterThisTurn,
      memoryContext,
      environmentContext
    });
  const turnAction = intentDecision.turnAction;
  const intentSource = intentDecision.intentSource;
  const nextConversationState = updateConversationState({
    previous: conversationState,
    analysis: baseMood,
    turnAction,
    userMessage,
    userMessageCount: userMessageCountAfterThisTurn
  });

  if (turnAction.action === TURN_ACTIONS.RECOMMEND_AND_PLAY) {
    const conversationMood = mergeSessionConstraintsIntoMood(normalizeMoodDecision({
      ...baseMood,
      shouldRecommend: true,
      mood: turnAction.mood || baseMood.mood,
      energy: turnAction.energy || baseMood.energy,
      intent: 'music',
      musicIntent: turnAction.musicIntent || baseMood.musicIntent || 'music',
      searchHints: turnAction.searchHints?.length
        ? uniqueStrings([...(turnAction.searchHints || []), ...(baseMood.searchHints || [])], 6)
        : baseMood.searchHints,
      reason: turnAction.reason || baseMood.reason,
      styleConstraint: turnAction.styleConstraint || baseMood.styleConstraint || null,
      styleSearchQueries: uniqueStrings([
        ...(turnAction.styleSearchQueries || []),
        ...(baseMood.styleSearchQueries || [])
      ], 8)
    }), sessionConstraints);
    const musicContext = nextMusicContext(getSessionContext(db, sessionId).musicContext, conversationMood, userMessage);
    let queuePolicy = decideQueuePolicy({
      analysis: musicContext,
      turnAction,
      currentQueueItem: firstReadyQueueItem(getSessionQueue(db, sessionId))
    });
    if (constraintsChanged) queuePolicy = { action: RADIO_QUEUE_POLICIES.HARD_PREEMPT, reason: 'session constraints changed' };
    const shouldQueueInsteadOfImmediate = Boolean(
      currentTrack?.id &&
      userMessage &&
      queuePolicy.action === RADIO_QUEUE_POLICIES.HARD_PREEMPT &&
      !isImmediateNextRequest(userMessage) &&
      !isDirectMusicRequest(userMessage)
    );

    if (shouldQueueInsteadOfImmediate) {
      const chatText = buildQueuePreemptReply({ userMessage, conversationMood, queuePolicy });
      if (userMessage) saveMessage(db, sessionId, 'user', userMessage, account);
      saveMessage(db, sessionId, 'assistant', chatText, account);
      if (userMessage) {
        scheduleMemoryExtraction({ db, config, sessionId, userMessage, assistantText: chatText, conversationMood, accountContext: account });
      }
      rememberMoodEvent({ db, sessionId, conversationMood, accountContext: account, source: 'queued_chat' });
      setSessionContext(db, sessionId, {
        ...getSessionContext(db, sessionId),
        conversationState: nextConversationState,
        musicContext,
        sessionConstraints
      });
      applyQueuePolicyToSession({ db, config, netease, sessionId, queuePolicy, musicContext, currentTrack, accountContext: account });
      const speech = speechDecisionForChat(prefs);
      const ttsUrl = speech.shouldSpeak ? await synthesizeSpeech(config.tts, chatText) : null;
      return {
        sessionId,
        chatText,
        track: null,
        reason: '',
        ttsUrl,
        speech,
        mode,
        profile,
        weather: environmentContext.weather || getSessionContext(db, sessionId).weather || '',
        environmentContext,
        conversationMood,
        turnAction,
        queuePolicy,
        intent: explicitIntent ? 'explicit' : 'mood',
        intentSource
      };
    }

    clearRadioQueue(db, sessionId);
    setSessionContext(db, sessionId, {
      ...getSessionContext(db, sessionId),
      conversationState: {
        ...nextConversationState,
        lastSuggestedAtUserCount: userMessageCountAfterThisTurn
      },
      lastSuggestedAtUserCount: userMessageCountAfterThisTurn,
      musicContext,
      sessionConstraints
    });
    const result = await djTurn({ db, config, netease, sessionId, userMessage, conversationMood, useQueue: false, accountContext: account });
    setSessionContext(db, sessionId, {
      ...getSessionContext(db, sessionId),
      conversationState: {
        ...normalizeConversationState(getSessionContext(db, sessionId).conversationState),
        lastSuggestedAtUserCount: countUserMessages(db, sessionId, account)
      },
      lastSuggestedAtUserCount: countUserMessages(db, sessionId, account),
      musicContext: normalizeMusicContext({
        ...getSessionContext(db, sessionId).musicContext,
        version: musicContext.version,
        updatedAt: nowIso()
      }),
      sessionConstraints
    });
    return { ...result, conversationMood, turnAction, queuePolicy, intent: explicitIntent ? 'explicit' : 'mood', intentSource };
  }

  const rawChatDecision = await generateFriendReply({
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
    turnAction,
    skipLlm: Boolean(intentDecision.skipFriendLlm),
    environmentContext
  });
  const chatDecision = {
    ...rawChatDecision,
    chatText: sanitizeNoTrackChatText({
      text: rawChatDecision.chatText,
      userMessage,
      baseMood,
      turnAction
    })
  };
  const conversationMood = mergeSessionConstraintsIntoMood(normalizeMoodDecision({ ...baseMood, ...chatDecision }), sessionConstraints);
  const finalConversationState = updateConversationState({
    previous: nextConversationState,
    analysis: conversationMood,
    turnAction,
    userMessage,
    userMessageCount: userMessageCountAfterThisTurn
  });
  const musicContext = nextMusicContext(getSessionContext(db, sessionId).musicContext, conversationMood, userMessage);
  let queuePolicy = decideQueuePolicy({
    analysis: musicContext,
    turnAction,
    currentQueueItem: firstReadyQueueItem(getSessionQueue(db, sessionId))
  });
  if (constraintsChanged) queuePolicy = { action: RADIO_QUEUE_POLICIES.HARD_PREEMPT, reason: 'session constraints changed' };

  if (userMessage) saveMessage(db, sessionId, 'user', userMessage, account);
  saveMessage(db, sessionId, 'assistant', chatDecision.chatText, account);
  if (userMessage) {
    scheduleMemoryExtraction({ db, config, sessionId, userMessage, assistantText: chatDecision.chatText, conversationMood, accountContext: account });
  }
  rememberMoodEvent({ db, sessionId, conversationMood, accountContext: account, source: 'chat' });
  const newModeDecision = chatDecision.newMode ?? turnAction.newMode ?? null;
  if (newModeDecision) {
    const newMode = { ...newModeDecision, updatedAt: nowIso() };
    setSessionMode(db, sessionId, newMode);
  }
  setSessionContext(db, sessionId, {
    ...getSessionContext(db, sessionId),
    conversationState: finalConversationState,
    musicContext,
    sessionConstraints
  });
  applyQueuePolicyToSession({ db, config, netease, sessionId, queuePolicy, musicContext, currentTrack, accountContext: account });
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
    mode: newModeDecision || mode,
    profile,
    weather: environmentContext.weather || getSessionContext(db, sessionId).weather || '',
    environmentContext,
    conversationMood,
    turnAction,
    queuePolicy,
    intent: 'chat',
    intentSource
  };
}

export async function updateSessionSummary(db, config, sessionId, accountContext = null) {
  const account = normalizeAccountContext(accountContext);
  const context = getSessionContext(db, sessionId);
  const stats = db.prepare('SELECT COUNT(*) AS count, MAX(id) AS latestId FROM messages WHERE account_id = ? AND session_id = ?')
    .get(account.accountId, sessionId);
  const count = Number(stats?.count || 0);
  const latestId = Number(stats?.latestId || 0);
  const summarizedId = Number(context.sessionSummaryMessageId || 0);
  if (count < SESSION_SUMMARY_MIN_MESSAGES) return context.sessionSummary || '';
  if (summarizedId && latestId - summarizedId < SESSION_SUMMARY_STEP) return context.sessionSummary || '';
  if (!config?.llm?.baseUrl || !config?.llm?.apiKey || !config?.llm?.model) return context.sessionSummary || '';

  const rows = db.prepare(
    'SELECT id, role, content FROM messages WHERE account_id = ? AND session_id = ? ORDER BY id DESC LIMIT 60'
  ).all(account.accountId, sessionId).reverse();
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

function loadHistory(db, sessionId, accountContext = null) {
  const account = normalizeAccountContext(accountContext);
  const rows = db.prepare(
    'SELECT role, content FROM messages WHERE account_id = ? AND session_id = ? ORDER BY id DESC LIMIT 20'
  ).all(account.accountId, sessionId);
  return rows.reverse().map(r => ({ role: r.role, content: r.content }));
}

function saveMessage(db, sessionId, role, content, accountContext = null) {
  const account = normalizeAccountContext(accountContext);
  db.prepare('INSERT INTO messages (account_id, session_id, role, content, created_at) VALUES (?,?,?,?,?)')
    .run(account.accountId, sessionId, role, content, nowIso());
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

function updateSessionContext(db, sessionId, updater) {
  const current = getSessionContext(db, sessionId);
  const next = typeof updater === 'function' ? updater(current) : { ...current, ...(updater || {}) };
  setSessionContext(db, sessionId, next);
  return next;
}

function getSessionQueue(db, sessionId) {
  try {
    const row = db.prepare('SELECT queue_json AS queueJson FROM radio_sessions WHERE id = ?').get(sessionId);
    return normalizeRadioQueue(JSON.parse(row?.queueJson || '[]'));
  } catch {
    return [];
  }
}

function setSessionQueue(db, sessionId, queue) {
  db.prepare('UPDATE radio_sessions SET queue_json = ? WHERE id = ?')
    .run(JSON.stringify(pruneRadioQueue(normalizeRadioQueue(queue))), sessionId);
}

export function normalizeRadioQueue(queue = []) {
  if (!Array.isArray(queue)) return [];
  const normalized = [];
  const seenReadySongs = new Set();
  for (const item of queue) {
    const status = QUEUE_ITEM_STATUSES.has(item?.status) ? item.status : 'ready';
    const track = status === 'pending' ? null : (item?.track || null);
    if (status === 'ready' && !track?.id) continue;
    const key = status === 'ready' ? playedSongKey(track?.name) : '';
    if (key && seenReadySongs.has(key)) continue;
    if (key) seenReadySongs.add(key);
    normalized.push({
      id: String(item?.id || `${status}-${Date.now()}-${Math.random().toString(16).slice(2)}`),
      status,
      createdAt: item?.createdAt || nowIso(),
      updatedAt: item?.updatedAt || item?.createdAt || nowIso(),
      contextVersion: Number(item?.contextVersion || item?.contextSnapshot?.version || 0),
      contextSnapshot: normalizeMusicContext(item?.contextSnapshot || {}),
      policy: item?.policy || RADIO_QUEUE_POLICIES.REFRESH_TAIL,
      preemptReason: item?.preemptReason || null,
      reason: item?.reason || '',
      chatText: String(item?.chatText || '').trim(),
      hostDeferred: Boolean(item?.hostDeferred),
      track,
      ttsUrl: item?.ttsUrl || null,
      ttsStatus: item?.ttsStatus || (item?.ttsUrl ? 'ready' : null),
      ttsMs: Number(item?.ttsMs || 0),
      ttsError: item?.ttsError || null,
      speech: item?.speech || null,
      mode: item?.mode || null,
      profile: item?.profile || null,
      weather: item?.weather || '',
      weatherRadio: item?.weatherRadio || null,
      musicRecap: item?.musicRecap || null,
      newMode: item?.newMode || null,
      conversationMood: item?.conversationMood ? normalizeMoodDecision(item.conversationMood) : null,
      explanation: normalizeRecommendationExplanation(item?.explanation),
      noveltyBucket: normalizeNoveltyBucket(item?.noveltyBucket),
      discoverySource: item?.discoverySource || null,
      recommendationSource: normalizeRecommendationSource(item?.recommendationSource),
      failedStage: item?.failedStage || null,
      error: item?.error ? String(item.error).slice(0, 240) : null,
      staleReason: item?.staleReason || null
    });
  }
  return normalized;
}

function pruneRadioQueue(queue = []) {
  const now = Date.now();
  const active = [];
  const diagnostics = [];
  for (const item of normalizeRadioQueue(queue)) {
    if (item.status === 'ready' || item.status === 'pending') {
      if (active.length < RADIO_QUEUE_LIMIT) active.push(item);
      continue;
    }
    const updatedAt = new Date(item.updatedAt || item.createdAt || 0).getTime();
    if (!updatedAt || now - updatedAt <= RADIO_QUEUE_DIAGNOSTIC_TTL_MS) diagnostics.push(item);
  }
  return [...active, ...diagnostics.slice(0, RADIO_QUEUE_DIAGNOSTIC_LIMIT)];
}

function normalizeQueueMetrics(metrics = {}) {
  return {
    queueHitCount: Number(metrics.queueHitCount || 0),
    queueMissCount: Number(metrics.queueMissCount || 0),
    syncFallbackCount: Number(metrics.syncFallbackCount || 0),
    hardPreemptCount: Number(metrics.hardPreemptCount || 0),
    softPreemptCount: Number(metrics.softPreemptCount || 0),
    queueFinalizeCount: Number(metrics.queueFinalizeCount || 0),
    queueHostRefreshCount: Number(metrics.queueHostRefreshCount || 0),
    queueContextDiscardCount: Number(metrics.queueContextDiscardCount || 0),
    ttsFailedCount: Number(metrics.ttsFailedCount || 0),
    lastQueueHitAt: metrics.lastQueueHitAt || null,
    lastMissReason: metrics.lastMissReason || null,
    lastQueueReconcileReason: metrics.lastQueueReconcileReason || null
  };
}

function updateQueueMetrics(db, sessionId, patch = {}) {
  if (!sessionId) return normalizeQueueMetrics();
  let nextMetrics = null;
  updateSessionContext(db, sessionId, (context) => {
    const current = normalizeQueueMetrics(context.queueMetrics || {});
    nextMetrics = normalizeQueueMetrics({
      ...current,
      queueHitCount: current.queueHitCount + Number(patch.queueHitCount || 0),
      queueMissCount: current.queueMissCount + Number(patch.queueMissCount || 0),
      syncFallbackCount: current.syncFallbackCount + Number(patch.syncFallbackCount || 0),
      hardPreemptCount: current.hardPreemptCount + Number(patch.hardPreemptCount || 0),
      softPreemptCount: current.softPreemptCount + Number(patch.softPreemptCount || 0),
      queueFinalizeCount: current.queueFinalizeCount + Number(patch.queueFinalizeCount || 0),
      queueHostRefreshCount: current.queueHostRefreshCount + Number(patch.queueHostRefreshCount || 0),
      queueContextDiscardCount: current.queueContextDiscardCount + Number(patch.queueContextDiscardCount || 0),
      ttsFailedCount: current.ttsFailedCount + Number(patch.ttsFailedCount || 0),
      lastQueueHitAt: patch.lastQueueHitAt ?? current.lastQueueHitAt,
      lastMissReason: patch.lastMissReason ?? current.lastMissReason,
      lastQueueReconcileReason: patch.lastQueueReconcileReason ?? current.lastQueueReconcileReason
    });
    return { ...context, queueMetrics: nextMetrics };
  });
  return nextMetrics;
}

function setRadioDebugInfo(db, sessionId, patch = {}) {
  if (!sessionId) return;
  updateSessionContext(db, sessionId, (context) => ({
    ...context,
    radioDebug: {
      ...(context.radioDebug || {}),
      ...patch,
      updatedAt: nowIso()
    }
  }));
}

export function consumeReadyRadioQueue(db, sessionId, options = {}) {
  const recordHit = options?.recordHit !== false;
  const account = normalizeAccountContext(options?.accountContext);
  const queue = getSessionQueue(db, sessionId);
  const context = getSessionContext(db, sessionId);
  const musicContext = normalizeMusicContext(context.musicContext || {});
  const sessionConstraints = getSessionConstraintsFromContext(context);
  const playedHistory = getPlayedTrackHistory(db, sessionId, 80, account);
  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    if (item.status !== 'ready' || !item.track?.id) continue;
    if (trackViolatesSessionConstraints(item.track, sessionConstraints)) {
      queue[index] = {
        ...item,
        status: 'stale',
        updatedAt: nowIso(),
        staleReason: 'session_constraint'
      };
      updateQueueMetrics(db, sessionId, {
        queueMissCount: 1,
        queueContextDiscardCount: 1,
        lastMissReason: 'session_constraint',
        lastQueueReconcileReason: 'session_constraint'
      });
      continue;
    }
    if (trackMatchesPlayedSongName(item.track, playedHistory)) {
      queue[index] = {
        ...item,
        status: 'stale',
        updatedAt: nowIso(),
        staleReason: 'played_song_name'
      };
      updateQueueMetrics(db, sessionId, {
        queueMissCount: 1,
        queueContextDiscardCount: 1,
        lastMissReason: 'played_song_name',
        lastQueueReconcileReason: 'played_song_name'
      });
      continue;
    }
    const contextMismatch = !queueItemMatchesMusicContext(item, musicContext);
    const staleByContext = (item.contextVersion < musicContext.version && contextMismatch) ||
      (musicContext.vocalPolicy === VOCAL_POLICIES.INSTRUMENTAL_ONLY && contextMismatch);
    if (staleByContext) {
      queue[index] = {
        ...item,
        status: 'stale',
        updatedAt: nowIso(),
        staleReason: 'context_mismatch'
      };
      updateQueueMetrics(db, sessionId, {
        queueMissCount: 1,
        queueContextDiscardCount: 1,
        lastMissReason: 'stale_queue_head',
        lastQueueReconcileReason: 'context_mismatch'
      });
      continue;
    }
    queue.splice(index, 1);
    setSessionQueue(db, sessionId, queue);
    if (recordHit) {
      updateQueueMetrics(db, sessionId, { queueHitCount: 1, lastQueueHitAt: nowIso(), lastMissReason: null });
    }
    return item;
  }
  setSessionQueue(db, sessionId, queue);
  return null;
}

async function reconcileQueuedItemBeforeCommit({
  db,
  config,
  sessionId,
  item,
  fallbackConversationMood = null,
  accountContext = null
} = {}) {
  const context = getSessionContext(db, sessionId);
  const musicContext = normalizeMusicContext(context.musicContext || {});
  const reason = queueReconcileReason(item, musicContext);
  if (!item?.track?.id) {
    return { action: QUEUE_RECONCILE_ACTIONS.USE_AS_IS, payload: item, reason: 'no_track' };
  }
  if (reason === QUEUE_RECONCILE_ACTIONS.REPLACE_TRACK) {
    return { action: QUEUE_RECONCILE_ACTIONS.REPLACE_TRACK, payload: item, reason: 'context_recommendation_shift' };
  }
  const artistDensityResult = getArtistDensityResult(item.track, {
    playedHistory: getPlayedTrackHistory(db, sessionId, 80, accountContext),
    request: {},
    config
  });
  if (!artistDensityResult.accepted) {
    setRadioDebugInfo(db, sessionId, {
      lastQueueReconcile: {
        action: QUEUE_RECONCILE_ACTIONS.REPLACE_TRACK,
        reason: 'artist_density',
        artistDensityResult,
        track: { id: item.track?.id, name: item.track?.name, artists: item.track?.artists || [] },
        contextVersion: musicContext.version,
        updatedAt: nowIso()
      }
    });
    return { action: QUEUE_RECONCILE_ACTIONS.REPLACE_TRACK, payload: item, reason: 'artist_density' };
  }
  try {
    const finalized = await finalizeQueuedTrackForPlayback({
      db,
      config,
      sessionId,
      item,
      musicContext,
      context,
      fallbackConversationMood,
      accountContext
    });
    updateQueueMetrics(db, sessionId, {
      queueFinalizeCount: 1,
      lastQueueReconcileReason: 'queued_song_finalized_for_playback'
    });
    setRadioDebugInfo(db, sessionId, {
      lastQueueReconcile: {
        action: QUEUE_RECONCILE_ACTIONS.FINALIZE_PLAYBACK,
        reason: 'queued_song_finalized_for_playback',
        track: { id: finalized.track?.id, name: finalized.track?.name, artists: finalized.track?.artists || [] },
        contextVersion: musicContext.version,
        updatedAt: nowIso()
      }
    });
    return {
      action: QUEUE_RECONCILE_ACTIONS.FINALIZE_PLAYBACK,
      payload: finalized,
      reason: 'queued_song_finalized_for_playback'
    };
  } catch (error) {
    const fallbackPayload = await buildFallbackFinalizedQueuedItem({
      db,
      config,
      sessionId,
      item,
      musicContext,
      context,
      fallbackConversationMood,
      accountContext
    });
    setRadioDebugInfo(db, sessionId, {
      lastQueueReconcile: {
        action: QUEUE_RECONCILE_ACTIONS.FINALIZE_PLAYBACK,
        reason: 'queued_finalize_fallback',
        error: String(error?.message || error).slice(0, 240),
        contextVersion: musicContext.version,
        updatedAt: nowIso()
      }
    });
    updateQueueMetrics(db, sessionId, {
      queueFinalizeCount: 1,
      lastQueueReconcileReason: 'queued_finalize_fallback'
    });
    return { action: QUEUE_RECONCILE_ACTIONS.FINALIZE_PLAYBACK, payload: fallbackPayload, reason: 'queued_finalize_fallback' };
  }
}

function queueReconcileReason(item = {}, musicContext = {}) {
  const target = normalizeMusicContext(musicContext || {});
  if (target.musicIntent === 'explicit_music') return QUEUE_RECONCILE_ACTIONS.REPLACE_TRACK;
  if (!queueItemMatchesMusicContext(item, target)) return QUEUE_RECONCILE_ACTIONS.REPLACE_TRACK;
  return '';
}

async function finalizeQueuedTrackForPlayback({
  db,
  config,
  sessionId,
  item,
  musicContext,
  context,
  fallbackConversationMood = null,
  accountContext = null
} = {}) {
  const account = normalizeAccountContext(accountContext);
  const profile = getProfile(db, account);
  const environmentContext = await getEnvironmentContext({ db, sessionId, config });
  const { hour, timeOfDay, weather } = environmentContext;
  const mode = getSessionMode(db, sessionId);
  const prefs = normalizeRuntimePrefs(getUserPrefs(db, account));
  const history = loadHistory(db, sessionId, account);
  const hostMusicContext = getEffectiveMusicContextForHost(context, musicContext);
  const conversationMood = moodFromMusicContext(hostMusicContext) || fallbackConversationMood;
  const latestUserMessage = String(hostMusicContext.lastUserMessage || '').trim();
  const hostContext = buildRadioHostContext(db, sessionId, context, latestUserMessage, account);
  const openingRecap = consumeOpeningMusicRecapForHost({
    db,
    accountContext: account,
    context,
    environmentContext,
    enabled: !latestUserMessage
  });
  if (openingRecap) hostContext.openingRecap = openingRecap;
  const sessionSummary = await updateSessionSummary(db, config, sessionId, account);
  const longTermMemories = retrieveRelevantMemories(db, {
    accountId: account.accountId,
    text: latestUserMessage || hostMusicContext.reason || '',
    mood: conversationMood,
    mode,
    limit: LONG_MEMORY_LIMIT,
    maxChars: LONG_MEMORY_MAX_CHARS
  });
  const memoryContext = buildMemoryContext({ sessionSummary, longTermMemories });
  const selectedPick = queuedItemToSongPick(item, hostMusicContext);
  const plan = {
    picks: [selectedPick],
    hostDraft: '',
    mode: null
  };
  const chatText = await generateFinalHostText({
    config,
    plan,
    selectedPick,
    selectedTrack: item.track,
    profile,
    prefs,
    history,
    timeOfDay,
    hour,
    weather,
    conversationMood,
    userMessage: latestUserMessage,
    memoryContext,
    hostContext,
    environmentContext
  });
  const speech = speechDecisionForRecommendation(prefs);
  const tts = speech.shouldSpeak
    ? await synthesizeSpeechWithDiagnostics(config.tts, chatText)
    : { url: null, status: 'disabled', ms: 0, error: null };
  if (tts.status === 'failed') updateQueueMetrics(db, sessionId, { ttsFailedCount: 1 });
  setRadioDebugInfo(db, sessionId, { lastTtsDiagnostics: sanitizeTtsDiagnostics(tts) });
  return {
    ...item,
    updatedAt: nowIso(),
    contextVersion: hostMusicContext.version,
    contextSnapshot: hostMusicContext,
    chatText,
    reason: item.reason || selectedPick.reason,
    explanation: addQueueFinalizeExplanation(item.explanation, hostMusicContext),
    recommendationSource: normalizeRecommendationSource(item.recommendationSource) || buildRecommendationSource({
      selectedPick,
      selectedTrack: item.track,
      noveltyBucket: item.noveltyBucket,
      discoverySource: item.discoverySource,
      userMessage: latestUserMessage,
      conversationMood,
      hostContext
    }),
    ttsUrl: tts.url,
    ttsStatus: tts.status,
    ttsMs: tts.ms,
    ttsError: tts.error,
    speech,
    profile,
    weather,
    weatherRadio: environmentContext.weatherRadio || item.weatherRadio || null,
    musicRecap: hostContext.openingRecap || item.musicRecap || null,
    environmentContext,
    conversationMood,
    accountContext: account
  };
}

async function buildFallbackFinalizedQueuedItem({
  db,
  config,
  sessionId,
  item,
  musicContext,
  context = {},
  fallbackConversationMood = null,
  accountContext = null
} = {}) {
  const account = normalizeAccountContext(accountContext);
  const prefs = normalizeRuntimePrefs(getUserPrefs(db, account));
  const hostMusicContext = getEffectiveMusicContextForHost(context, musicContext);
  const conversationMood = moodFromMusicContext(hostMusicContext) || fallbackConversationMood;
  const latestUserMessage = String(hostMusicContext.lastUserMessage || '').trim();
  let environmentContext = {};
  try {
    environmentContext = await getEnvironmentContext({ db, sessionId, config });
  } catch {
    environmentContext = {};
  }
  const hostContext = buildRadioHostContext(db, sessionId, context, latestUserMessage, account);
  const openingRecap = consumeOpeningMusicRecapForHost({
    db,
    accountContext: account,
    context,
    environmentContext,
    enabled: !latestUserMessage
  });
  if (openingRecap) hostContext.openingRecap = openingRecap;
  const chatText = applyOpeningMusicRecapToHostText(buildConfirmedTrackHostFallback({
    selectedTrack: item.track,
    timeOfDay: environmentContext.timeOfDay || '',
    weather: environmentContext.weather || '',
    conversationMood,
    userMessage: latestUserMessage,
    hostContext
  }), hostContext.openingRecap);
  const speech = speechDecisionForRecommendation(prefs);
  const tts = speech.shouldSpeak
    ? await synthesizeSpeechWithDiagnostics(config.tts, chatText)
    : { url: null, status: 'disabled', ms: 0, error: null };
  if (tts.status === 'failed') updateQueueMetrics(db, sessionId, { ttsFailedCount: 1 });
  setRadioDebugInfo(db, sessionId, { lastTtsDiagnostics: sanitizeTtsDiagnostics(tts) });
  return {
    ...item,
    updatedAt: nowIso(),
    contextVersion: hostMusicContext.version,
    contextSnapshot: hostMusicContext,
    chatText,
    ttsUrl: tts.url,
    ttsStatus: tts.status,
    ttsMs: tts.ms,
    ttsError: tts.error,
    speech,
    weather: environmentContext.weather || item.weather || '',
    weatherRadio: environmentContext.weatherRadio || item.weatherRadio || null,
    musicRecap: hostContext.openingRecap || item.musicRecap || null,
    recommendationSource: normalizeRecommendationSource(item.recommendationSource) || buildRecommendationSource({
      selectedPick: queuedItemToSongPick(item, hostMusicContext),
      selectedTrack: item.track,
      noveltyBucket: item.noveltyBucket,
      discoverySource: item.discoverySource,
      userMessage: latestUserMessage,
      conversationMood,
      hostContext
    }),
    environmentContext,
    conversationMood,
    explanation: addQueueFinalizeExplanation(item.explanation, hostMusicContext),
    accountContext: account
  };
}

function queuedItemToSongPick(item = {}, musicContext = {}) {
  const track = item.track || {};
  const artists = Array.isArray(track.artists) ? track.artists : [];
  const hadQueuedUserMessage = Boolean(normalizeMusicContext(item.contextSnapshot || {}).lastUserMessage);
  const shouldAvoidOldUserBinding = hadQueuedUserMessage && !normalizeMusicContext(musicContext || {}).lastUserMessage;
  const reason = String(shouldAvoidOldUserBinding
    ? '延续当前电台氛围，换一个不打扰的声音方向'
    : (item.reason || item.explanation?.summary || musicContext.reason || '根据最新聊天状态继续衔接')).trim();
  return {
    name: track.name || '',
    artists,
    reason,
    hostLine: '',
    queries: artists.length ? [`${track.name || ''} ${artists.join(' ')}`.trim()] : [track.name || ''].filter(Boolean)
  };
}

function addQueueFinalizeExplanation(explanation = null, musicContext = {}) {
  const base = normalizeRecommendationExplanation(explanation) || { summary: '', factors: [], source: 'fallback' };
  const lastMessage = String(musicContext.lastUserMessage || '').trim();
  if (!lastMessage) return base;
  const text = `歌曲来自预取队列，导播词根据最新聊天生成：${lastMessage.slice(0, 34)}`;
  return normalizeRecommendationExplanation({
    ...base,
    summary: base.summary ? `预取歌曲命中，导播词已按最新聊天生成 + ${base.summary}` : text,
    factors: [{ type: 'chat', text }, ...(base.factors || [])],
    source: base.source
  });
}

function appendStaleQueueDiagnostic(db, sessionId, item = {}, staleReason = 'context_recommendation_shift') {
  if (!item?.track?.id) return;
  const stale = normalizeRadioQueue([{
    ...item,
    status: 'stale',
    updatedAt: nowIso(),
    staleReason
  }])[0];
  if (!stale) return;
  setSessionQueue(db, sessionId, [...getSessionQueue(db, sessionId), stale]);
  setRadioDebugInfo(db, sessionId, {
    lastQueueReconcile: {
      action: QUEUE_RECONCILE_ACTIONS.REPLACE_TRACK,
      reason: staleReason,
      track: { id: item.track.id, name: item.track.name, artists: item.track.artists || [] },
      updatedAt: nowIso()
    }
  });
}

function clearRadioQueue(db, sessionId) {
  setSessionQueue(db, sessionId, []);
}

function firstReadyQueueItem(queue = []) {
  return normalizeRadioQueue(queue).find(item => item.status === 'ready' && item.track?.id) || null;
}

function queueTracksForAvoidance(queue = []) {
  return normalizeRadioQueue(queue)
    .filter(item => item.status === 'ready' && item.track?.id)
    .map(item => item.track);
}

export function getRadioQueueStatus(db, sessionId) {
  const queue = getSessionQueue(db, sessionId);
  return {
    queue,
    queueSize: queue.length,
    readyCount: queue.filter(item => item.status === 'ready').length,
    pendingCount: queue.filter(item => item.status === 'pending').length,
    failedCount: queue.filter(item => item.status === 'failed').length,
    staleCount: queue.filter(item => item.status === 'stale').length,
    queueMetrics: normalizeQueueMetrics(getSessionContext(db, sessionId).queueMetrics || {})
  };
}

export function prefetchRadioQueue({ db, config, netease, sessionId, force = false, accountContext = null } = {}) {
  const account = normalizeAccountContext(accountContext);
  sessionId = ensureSession(db, sessionId, account);
  const context = getSessionContext(db, sessionId);
  if (!context.musicContext) {
    setSessionContext(db, sessionId, {
      ...context,
      musicContext: normalizeMusicContext({})
    });
  }
  scheduleRadioQueueFill({ db, config, netease, sessionId, reason: 'warmup', force, accountContext: account });
  const status = getRadioQueueStatus(db, sessionId);
  return {
    ok: true,
    sessionId,
    queued: status.readyCount,
    pending: status.pendingCount,
    queueSize: status.queueSize
  };
}

export function getRadioDebugStatus(db, sessionId, accountContext = null) {
  const account = normalizeAccountContext(accountContext);
  const id = String(sessionId || '').trim();
  if (!id) {
    return { __error: true, ok: false, status: 400, error: 'sessionId is required' };
  }
  const row = db.prepare('SELECT context_json AS contextJson, queue_json AS queueJson FROM radio_sessions WHERE id = ? AND account_id = ?').get(id, account.accountId);
  if (!row) {
    return { __error: true, ok: false, status: 404, error: 'radio session not found' };
  }
  const context = safeJsonObject(row.contextJson);
  const queue = normalizeRadioQueue(safeJsonArray(row.queueJson));
  const debug = context.radioDebug || {};
  return {
    ok: true,
    sessionId: id,
    sessionConstraints: normalizeSessionConstraints(context.sessionConstraints || {}),
    musicContext: normalizeMusicContext(context.musicContext || {}),
    conversationState: normalizeConversationState(context.conversationState || {}),
    queue: queue.map(sanitizeQueueItemForDebug),
    queueMetrics: normalizeQueueMetrics(context.queueMetrics || {}),
    recentPlayedSongs: getPlayedTrackHistory(db, id, 20, account).map(sanitizeTrackForDebug),
    recentFeedback: getRecentSessionFeedback(db, id, 10, account),
    lastCandidatePool: debug.lastCandidatePool || null,
    lastSongPlan: debug.lastSongPlan || null,
    lastSearchDiagnostics: Array.isArray(debug.lastSearchDiagnostics) ? debug.lastSearchDiagnostics.slice(0, 6) : [],
    lastQueueReconcile: debug.lastQueueReconcile || null,
    lastRecommendationFailure: debug.lastRecommendationFailure || null,
    lastTtsDiagnostics: debug.lastTtsDiagnostics || null,
    updatedAt: debug.updatedAt || null
  };
}

function sanitizeQueueItemForDebug(item = {}) {
  return {
    id: item.id,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    contextVersion: item.contextVersion,
    contextSnapshot: item.contextSnapshot,
    policy: item.policy,
    preemptReason: item.preemptReason,
    reason: item.reason,
    hostDeferred: Boolean(item.hostDeferred),
    track: item.track ? sanitizeTrackForDebug(item.track) : null,
    explanation: normalizeRecommendationExplanation(item.explanation),
    noveltyBucket: item.noveltyBucket || null,
    discoverySource: item.discoverySource || null,
    ttsStatus: item.ttsStatus,
    ttsMs: item.ttsMs,
    ttsError: item.ttsError,
    failedStage: item.failedStage,
    error: item.error,
    staleReason: item.staleReason
  };
}

function scheduleRadioQueueFill({ db, config, netease, sessionId, reason = 'fill', preemptReason = null, preempt = false, force = false, contextSnapshot = null, accountContext = null } = {}) {
  if (!sessionId) return false;
  const account = normalizeAccountContext(accountContext);
  sessionId = ensureSession(db, sessionId, account);
  const context = getSessionContext(db, sessionId);
  const musicContext = contextSnapshot
    ? normalizeMusicContext(contextSnapshot)
    : getEffectiveMusicContextForRecommendation(context);
  if (musicContext.musicIntent === 'suppressed') return false;

  let queue = getSessionQueue(db, sessionId);
  const activeCount = queue.filter(item => item.status === 'ready' || item.status === 'pending').length;
  if (!force && activeCount >= RADIO_QUEUE_LIMIT) return false;
  if (!preempt && queue.some(item => item.status === 'pending')) return false;

  const pendingId = `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const pending = {
    id: pendingId,
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    contextVersion: musicContext.version,
    contextSnapshot: musicContext,
    policy: preempt ? RADIO_QUEUE_POLICIES.HARD_PREEMPT : RADIO_QUEUE_POLICIES.REFRESH_TAIL,
    preemptReason,
    reason
  };

  if (preempt) {
    const compatibleTail = queue
      .filter(item => item.status === 'ready')
      .filter(item => queueItemMatchesMusicContext(item, musicContext));
    queue = [pending, ...compatibleTail, ...queue.filter(item => item.status === 'failed' || item.status === 'stale')];
  } else {
    const active = queue.filter(item => item.status === 'ready' || item.status === 'pending');
    const diagnostics = queue.filter(item => item.status === 'failed' || item.status === 'stale');
    queue = [...active, pending, ...diagnostics];
  }
  setSessionQueue(db, sessionId, queue);

  radioQueueJobs.add(pendingId);
  void (async () => {
    try {
      const currentContext = normalizeMusicContext(getSessionContext(db, sessionId).musicContext || {});
      if (!preempt && currentContext.version !== musicContext.version) {
        markQueueItemStale(db, sessionId, pendingId, 'context_changed_while_pending');
        scheduleRadioQueueFill({ db, config, netease, sessionId, reason: 'refresh_after_context_change', accountContext: account });
        return;
      }
      const currentQueue = getSessionQueue(db, sessionId);
      const avoidTracks = queueTracksForAvoidance(currentQueue.filter(item => item.id !== pendingId));
      const payload = await buildRadioRecommendation({
        db,
        config,
        netease,
        sessionId,
        userMessage: null,
        conversationMood: moodFromMusicContext(musicContext),
        extraAvoidTracks: avoidTracks,
        accountContext: account,
        deferHostAndSpeech: true
      });
      const readyItem = normalizeRadioQueue([{
        ...payload,
        id: pendingId,
        status: 'ready',
        updatedAt: nowIso(),
        contextVersion: musicContext.version,
        contextSnapshot: musicContext,
        policy: pending.policy,
        preemptReason: pending.preemptReason,
        reason
      }])[0];
      replacePendingQueueItem(db, sessionId, pendingId, readyItem, account, config);
    } catch (error) {
      console.warn('[radio queue prefetch failed]', error?.message || error);
      markPendingQueueItemFailed(db, sessionId, pendingId, {
        failedStage: 'prefetch',
        error: error?.message || String(error)
      });
    } finally {
      radioQueueJobs.delete(pendingId);
    }
  })();
  return true;
}

function markPendingQueueItemFailed(db, sessionId, pendingId, { failedStage = 'prefetch', error = '' } = {}) {
  const queue = getSessionQueue(db, sessionId).map(item => {
    if (item.id !== pendingId) return item;
    return {
      ...item,
      status: 'failed',
      updatedAt: nowIso(),
      failedStage,
      error: String(error || '').slice(0, 240)
    };
  });
  setSessionQueue(db, sessionId, queue);
}

function removePendingQueueItem(db, sessionId, pendingId) {
  setSessionQueue(db, sessionId, getSessionQueue(db, sessionId).filter(item => item.id !== pendingId));
}

function markQueueItemStale(db, sessionId, itemId, staleReason = 'stale') {
  const queue = getSessionQueue(db, sessionId).map(item => {
    if (item.id !== itemId) return item;
    return {
      ...item,
      status: 'stale',
      updatedAt: nowIso(),
      staleReason
    };
  });
  setSessionQueue(db, sessionId, queue);
}

function replacePendingQueueItem(db, sessionId, pendingId, readyItem, accountContext = null, config = {}) {
  const account = normalizeAccountContext(accountContext);
  const queue = getSessionQueue(db, sessionId);
  const pendingInQueue = queue.some(item => item.id === pendingId && item.status === 'pending');
  if (!pendingInQueue) return;
  if (!readyItem?.track?.id) {
    markPendingQueueItemFailed(db, sessionId, pendingId, {
      failedStage: 'recommendation',
      error: 'no playable track confirmed'
    });
    return;
  }
  if (trackMatchesPlayedSongName(readyItem.track, getPlayedTrackHistory(db, sessionId, 80, account))) {
    markPendingQueueItemFailed(db, sessionId, pendingId, {
      failedStage: 'dedupe',
      error: 'prefetched track was already played'
    });
    return;
  }
  if (trackViolatesSessionConstraints(readyItem.track, getSessionConstraintsFromContext(getSessionContext(db, sessionId)))) {
    markPendingQueueItemFailed(db, sessionId, pendingId, {
      failedStage: 'session_constraint',
      error: 'prefetched track violates current session constraints'
    });
    return;
  }
  const artistDensityResult = getArtistDensityResult(readyItem.track, {
    playedHistory: getPlayedTrackHistory(db, sessionId, 80, account),
    request: {},
    config
  });
  if (!artistDensityResult.accepted) {
    markPendingQueueItemFailed(db, sessionId, pendingId, {
      failedStage: 'artist_density',
      error: 'prefetched track violates artist density'
    });
    return;
  }
  const currentContext = normalizeMusicContext(getSessionContext(db, sessionId).musicContext || {});
  const contextMismatch = !queueItemMatchesMusicContext(readyItem, currentContext);
  if ((readyItem.contextVersion < currentContext.version && contextMismatch) ||
      (currentContext.vocalPolicy === VOCAL_POLICIES.INSTRUMENTAL_ONLY && contextMismatch)) {
    markQueueItemStale(db, sessionId, pendingId, 'context_changed_before_ready');
    return;
  }
  const readyKey = playedSongKey(readyItem.track.name);
  const isPreempt = readyItem.policy === RADIO_QUEUE_POLICIES.HARD_PREEMPT ||
    readyItem.policy === RADIO_QUEUE_POLICIES.SOFT_PREEMPT;
  const keepNonDuplicate = (item) => {
    if (item.id === pendingId) return false;
    if (item.status !== 'ready') return true;
    return !readyKey || playedSongKey(item.track?.name) !== readyKey;
  };
  let next;
  if (isPreempt) {
    next = [readyItem, ...queue.filter(keepNonDuplicate)];
  } else {
    let inserted = false;
    next = [];
    for (const item of queue) {
      if (item.id === pendingId) {
        next.push(readyItem);
        inserted = true;
        continue;
      }
      if (keepNonDuplicate(item)) next.push(item);
    }
    if (!inserted) next.push(readyItem);
  }
  setSessionQueue(db, sessionId, next);
}

async function getCachedWeather(db, sessionId, weatherConfig) {
  const context = getSessionContext(db, sessionId);
  const cachedAt = context.weatherUpdatedAt ? new Date(context.weatherUpdatedAt).getTime() : 0;
  if (context.weather && Date.now() - cachedAt < WEATHER_CACHE_MS) return context.weather;
  const weather = await getWeatherSummary(weatherConfig);
  setSessionContext(db, sessionId, { ...context, weather, weatherUpdatedAt: nowIso() });
  return weather;
}

async function getEnvironmentContext({ db, sessionId, config, date = new Date() } = {}) {
  const timeZone = resolveAppTimeZone(config);
  const timeContext = getTimeContext(date, timeZone);
  let weather = '';
  let weatherUpdatedAt = '';
  if (db && sessionId && config?.weather?.city) {
    const resolvedWeather = await getCachedWeather(db, sessionId, {
      ...(config?.weather || {}),
      timeZone
    });
    weather = isWeatherSummaryUnavailable(resolvedWeather) ? '' : resolvedWeather;
    weatherUpdatedAt = getSessionContext(db, sessionId).weatherUpdatedAt || '';
  }
  const weatherRadio = buildWeatherRadioContext({
    weather,
    timeOfDay: timeContext.timeOfDay,
    hour: timeContext.hour
  });
  return {
    ...timeContext,
    timeZone,
    weather,
    weatherUpdatedAt,
    weatherRadio
  };
}

function resolveAppTimeZone(config = {}) {
  return config?.app?.timeZone || config?.weather?.timeZone || process.env.APP_TIME_ZONE || DEFAULT_APP_TIME_ZONE;
}

export function getTimeContext(date = new Date(), timeZone = DEFAULT_APP_TIME_ZONE) {
  const parts = getZonedDateTimeParts(date, timeZone);
  const hour = Number(parts.hour);
  const timeOfDay = hour < 6 ? '深夜' : hour < 9 ? '清晨' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 21 ? '傍晚' : '夜晚';
  return {
    hour,
    timeOfDay,
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localTime: `${parts.hour}:${parts.minute}`,
    timeZone
  };
}

function getZonedDateTimeParts(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: parts.hour === '24' ? '00' : parts.hour,
      minute: parts.minute
    };
  } catch {
    const fallback = new Date(date);
    const pad = value => String(value).padStart(2, '0');
    return {
      year: String(fallback.getFullYear()),
      month: pad(fallback.getMonth() + 1),
      day: pad(fallback.getDate()),
      hour: pad(fallback.getHours()),
      minute: pad(fallback.getMinutes())
    };
  }
}

export function formatEnvironmentContext(environmentContext = {}) {
  const parts = [
    `localDate=${environmentContext.localDate || ''}`,
    `localTime=${environmentContext.localTime || ''}`,
    `timeOfDay=${environmentContext.timeOfDay || ''}`,
    `hour=${environmentContext.hour ?? ''}`,
    `timeZone=${environmentContext.timeZone || DEFAULT_APP_TIME_ZONE}`
  ];
  if (environmentContext.weather) parts.push(`weather=${environmentContext.weather}`);
  if (environmentContext.weatherUpdatedAt) parts.push(`weatherUpdatedAt=${environmentContext.weatherUpdatedAt}`);
  if (environmentContext.weatherRadio?.id) parts.push(`weatherRadio=${environmentContext.weatherRadio.id}:${environmentContext.weatherRadio.label}`);
  return parts.filter(Boolean).join('; ');
}

export function buildWeatherRadioContext({ weather = '', timeOfDay = '', hour = null } = {}) {
  const text = normalizeMusicText(`${weather} ${timeOfDay}`);
  if (!text) return null;
  const numericHour = Number.isFinite(Number(hour)) ? Number(hour) : null;
  const isMorning = numericHour === null ? /上午|清晨|早/.test(`${weather} ${timeOfDay}`) : numericHour >= 6 && numericHour < 12;
  const isAfternoon = numericHour === null ? /下午|中午/.test(`${weather} ${timeOfDay}`) : numericHour >= 12 && numericHour < 18;
  const isEvening = numericHour === null ? /傍晚|晚上|夜/.test(`${weather} ${timeOfDay}`) : numericHour >= 17 && numericHour < 22;
  const isNight = numericHour === null ? /夜|深夜|晚上/.test(`${weather} ${timeOfDay}`) : numericHour >= 21 || numericHour < 6;
  const hasRain = /雨|降水|淋|rain|shower|drizzle/.test(text);
  const hasThunder = /雷|thunder|storm/.test(text);
  const hasMuggy = /闷|湿|潮|热|高温|体感|humidity|humid|muggy|hot/.test(text);
  const hasWind = /风|降温|冷|凉|大风|wind|cool|cold/.test(text);
  const hasClear = /晴|sunny|clear/.test(text);

  if ((hasThunder || (hasRain && /雷|storm/.test(text))) && isNight) {
    return weatherRadioScene('thunderstorm_night');
  }
  if (hasRain && isMorning) return weatherRadioScene('rain_morning');
  if (hasMuggy && isAfternoon) return weatherRadioScene('muggy_afternoon');
  if (hasWind) return weatherRadioScene('windy_cooling');
  if (hasClear && isEvening) return weatherRadioScene('clear_evening');
  if (hasThunder) return weatherRadioScene('thunderstorm_night');
  return null;
}

function weatherRadioScene(id) {
  const scenes = {
    rain_morning: {
      id,
      label: '雨天上午',
      description: '低噪、温暖、节奏慢慢起来',
      searchHints: ['低噪', '温暖', '慢慢起势'],
      hostLine: '外面在下雨，我不直接给你丧歌，先放一首有点湿润但不压心情的。'
    },
    muggy_afternoon: {
      id,
      label: '闷热下午',
      description: '清爽、轻电子、少厚重人声',
      searchHints: ['清爽', '轻电子', '少厚重人声'],
      hostLine: '下午有点闷，我会把声音选得清爽一点，不让人声压得太满。'
    },
    windy_cooling: {
      id,
      label: '大风/降温',
      description: '厚一点、包裹感、怀旧',
      searchHints: ['包裹感', '怀旧', '厚一点'],
      hostLine: '外面风凉一点，我把声音放厚一些，像给耳朵披一层外套。'
    },
    clear_evening: {
      id,
      label: '晴天傍晚',
      description: '明亮、松弛、city pop/流行',
      searchHints: ['明亮', '松弛', 'city pop'],
      hostLine: '傍晚天气亮一点，先让节奏松开，像路灯刚亮起来。'
    },
    thunderstorm_night: {
      id,
      label: '雷雨夜',
      description: '暗色、电影感、低频氛围',
      searchHints: ['暗色', '电影感', '低频氛围'],
      hostLine: '雷雨夜不一定要更难过，我给你找一点暗色但稳住心跳的声音。'
    }
  };
  return scenes[id] || null;
}

function consumeOpeningMusicRecapForHost({ db, accountContext = null, context = {}, environmentContext = {}, enabled = true } = {}) {
  if (!enabled || !db || context?.radioIntroDone) return null;
  const account = normalizeAccountContext(accountContext);
  const localDate = environmentContext.localDate || getTimeContext(new Date(), environmentContext.timeZone || DEFAULT_APP_TIME_ZONE).localDate;
  if (!localDate) return null;
  if (getAccountSetting(db, account.accountId, DAILY_MUSIC_RECAP_SPOKEN_DATE_KEY) === localDate) return null;
  const recap = buildDailyMusicRecap(db, {
    accountContext: account,
    localDate,
    timeZone: environmentContext.timeZone || DEFAULT_APP_TIME_ZONE
  });
  if (!recap) return null;
  setAccountSetting(db, account.accountId, DAILY_MUSIC_RECAP_SPOKEN_DATE_KEY, localDate);
  return recap;
}

export function buildDailyMusicRecap(db, { accountContext = null, localDate = '', timeZone = DEFAULT_APP_TIME_ZONE } = {}) {
  const account = normalizeAccountContext(accountContext);
  const todayLocalDate = localDate || getTimeContext(new Date(), timeZone).localDate;
  const targetDate = shiftLocalDate(todayLocalDate, -1);
  if (!targetDate) return null;
  const activity = getListeningActivityForLocalDates(db, {
    accountId: account.accountId,
    dates: [targetDate, shiftLocalDate(todayLocalDate, -2), shiftLocalDate(todayLocalDate, -3)].filter(Boolean),
    timeZone
  });
  const target = activity.byDate.get(targetDate) || emptyListeningActivity(targetDate);
  if (!target.plays.length && !target.feedback.length && !target.moods.length) return null;

  const signals = [];
  const lowEnergyCount = target.moods.filter(event => event.energy === 'low' || ['comfort', 'calm', 'night', 'melancholy', 'healing'].includes(event.mood)).length;
  const highEnergyCount = target.moods.filter(event => event.energy === 'high' || event.mood === 'energy').length;
  if (lowEnergyCount >= 2 && lowEnergyCount >= highEnergyCount) {
    signals.push({
      id: 'low_energy_day',
      text: '昨天你听歌偏低能量',
      evidence: `${lowEnergyCount} 条低能量/安静情绪记录`
    });
  }

  const afternoonSlowSkips = target.feedback.filter(event =>
    event.eventType === 'skip' &&
    localHourFromIso(event.createdAt, timeZone) >= 12 &&
    localHourFromIso(event.createdAt, timeZone) < 18 &&
    trackLooksSlow(event)
  );
  if (afternoonSlowSkips.length) {
    signals.push({
      id: 'afternoon_skipped_slow',
      text: '昨天下午开始跳过慢歌',
      evidence: `${afternoonSlowSkips.length} 次下午慢歌跳过`
    });
  }

  const eveningElectronic = [
    ...target.plays.filter(play => localHourFromIso(play.playedAt, timeZone) >= 18 && trackLooksElectronic(play)),
    ...target.feedback.filter(event => ['like', 'complete'].includes(event.eventType) && localHourFromIso(event.createdAt, timeZone) >= 18 && trackLooksElectronic(event))
  ];
  if (eveningElectronic.length) {
    signals.push({
      id: 'evening_electronic_rhythm',
      text: '昨天晚上更喜欢电子/节奏感',
      evidence: `${eveningElectronic.length} 条夜间电子或节奏信号`
    });
  }

  const energizedDates = [...activity.byDate.values()].filter(day => dayHasEnergyLiftSignal(day)).map(day => day.date);
  if (new Set(energizedDates).size >= 2) {
    signals.push({
      id: 'three_day_energy_lift',
      text: '最近三天你在用音乐提神',
      evidence: `${new Set(energizedDates).size} 天出现提神/高能量信号`
    });
  }

  if (!signals.length && target.plays.length) {
    signals.push({
      id: 'yesterday_listened',
      text: `昨天你让电台陪你听了 ${target.plays.length} 首歌`,
      evidence: `${target.plays.length} 条播放记录`
    });
  }

  const recommendationHint = buildDailyRecapRecommendationHint(signals);
  return {
    date: targetDate,
    currentDate: todayLocalDate,
    signals: signals.slice(0, 4),
    openingLine: buildDailyRecapOpeningLine(signals),
    recommendationHint,
    trackCount: target.plays.length,
    feedbackCount: target.feedback.length,
    generatedAt: nowIso()
  };
}

function getListeningActivityForLocalDates(db, { accountId, dates = [], timeZone = DEFAULT_APP_TIME_ZONE } = {}) {
  const cleanDates = new Set(dates.filter(Boolean));
  const byDate = new Map([...cleanDates].map(date => [date, emptyListeningActivity(date)]));
  if (!cleanDates.size) return { byDate };
  const earliestDate = [...cleanDates].sort()[0];
  const cutoff = `${shiftLocalDate(earliestDate, -1) || earliestDate}T00:00:00.000Z`;
  try {
    db.prepare(`
      SELECT p.track_id AS trackId,
             p.played_at AS playedAt,
             p.source,
             p.reason,
             p.host_text AS hostText,
             t.name,
             t.artists,
             t.album
      FROM plays p
      JOIN tracks t ON t.id = p.track_id
      WHERE p.account_id = ? AND p.played_at >= ?
      ORDER BY p.played_at DESC
      LIMIT 240
    `).all(accountId, cutoff).forEach(row => {
      const date = localDateFromIso(row.playedAt, timeZone);
      if (!cleanDates.has(date)) return;
      byDate.get(date).plays.push({
        ...row,
        artists: safeJsonArray(row.artists)
      });
    });
  } catch {}
  try {
    db.prepare(`
      SELECT e.track_id AS trackId,
             e.event_type AS eventType,
             e.created_at AS createdAt,
             t.name,
             t.artists,
             t.album
      FROM track_feedback_events e
      LEFT JOIN tracks t ON t.id = e.track_id
      WHERE e.account_id = ? AND e.created_at >= ?
      ORDER BY e.created_at DESC
      LIMIT 240
    `).all(accountId, cutoff).forEach(row => {
      const date = localDateFromIso(row.createdAt, timeZone);
      if (!cleanDates.has(date)) return;
      byDate.get(date).feedback.push({
        ...row,
        artists: safeJsonArray(row.artists)
      });
    });
  } catch {}
  try {
    db.prepare(`
      SELECT mood, energy, music_intent AS musicIntent, source, created_at AS createdAt
      FROM mood_events
      WHERE account_id = ? AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT 240
    `).all(accountId, cutoff).forEach(row => {
      const date = localDateFromIso(row.createdAt, timeZone);
      if (!cleanDates.has(date)) return;
      byDate.get(date).moods.push(row);
    });
  } catch {}
  return { byDate };
}

function emptyListeningActivity(date) {
  return { date, plays: [], feedback: [], moods: [] };
}

function buildDailyRecapOpeningLine(signals = []) {
  const texts = signals.map(signal => signal.text).filter(Boolean).slice(0, 2);
  if (!texts.length) return '';
  return `昨天我看了下电台记录：${texts.join('；')}。`;
}

function buildDailyRecapRecommendationHint(signals = []) {
  const ids = new Set(signals.map(signal => signal.id));
  if (ids.has('evening_electronic_rhythm') || ids.has('three_day_energy_lift')) {
    return '这几天你晚上都不太想听太慢的，我今天也先避开。';
  }
  if (ids.has('afternoon_skipped_slow')) return '昨天你下午开始跳过慢歌，我今天会避开太拖的开头。';
  if (ids.has('low_energy_day')) return '昨天整体能量偏低，我今天先从不压心情的歌开始。';
  return signals[0]?.text ? `${signals[0].text}，今天我会把这个方向当作轻参考。` : '';
}

function formatWeatherRadioForPrompt(weatherRadio = null) {
  if (!weatherRadio?.id) return 'WEATHER_RADIO: none';
  return [
    `WEATHER_RADIO: ${weatherRadio.id}`,
    `label=${weatherRadio.label}`,
    `mood=${weatherRadio.description}`,
    weatherRadio.hostLine ? `hostLine=${weatherRadio.hostLine}` : '',
    weatherRadio.searchHints?.length ? `searchHints=${weatherRadio.searchHints.join(' / ')}` : ''
  ].filter(Boolean).join('; ');
}

function formatOpeningMusicRecapForPrompt(recap = null) {
  if (!recap?.signals?.length) return 'MUSIC_RECAP: none';
  return [
    `MUSIC_RECAP: ${recap.date}`,
    recap.openingLine ? `openingLine=${recap.openingLine}` : '',
    recap.recommendationHint ? `recommendationHint=${recap.recommendationHint}` : '',
    `signals=${recap.signals.map(signal => signal.text).join(' / ')}`
  ].filter(Boolean).join('; ');
}

function applyOpeningMusicRecapToHostText(text = '', recap = null) {
  const base = String(text || '').trim();
  const line = String(recap?.openingLine || '').trim();
  if (!line) return base;
  if (base.includes(line) || /昨天|这几天/.test(base.slice(0, 60))) return base;
  return `${line}${base ? ' ' + base : ''}`.slice(0, 220);
}

function trackLooksSlow(item = {}) {
  const text = normalizeMusicText(`${item.name || ''} ${item.album || ''} ${item.reason || ''} ${(item.artists || []).join(' ')}`);
  return /慢|安静|舒缓|轻|钢琴|民谣|抒情|睡|夜|calm|slow|piano|acoustic|ballad/.test(text);
}

function trackLooksElectronic(item = {}) {
  const text = normalizeMusicText(`${item.name || ''} ${item.album || ''} ${item.reason || ''} ${(item.artists || []).join(' ')}`);
  return /电子|电音|节奏|律动|合成器|轻电子|dj|edm|beat|electro|electronic|synth|citypop|city pop/.test(text);
}

function dayHasEnergyLiftSignal(day = {}) {
  if ((day.moods || []).some(event => event.energy === 'high' || event.mood === 'energy' || /focus|提神|energy/.test(String(event.musicIntent || event.source || '')))) {
    return true;
  }
  return [...(day.plays || []), ...(day.feedback || [])].some(item => {
    const text = normalizeMusicText(`${item.name || ''} ${item.album || ''} ${item.reason || ''}`);
    return /提神|专注|运动|健身|跑步|节奏|电子|energy|focus|workout|beat/.test(text);
  });
}

function localDateFromIso(value, timeZone = DEFAULT_APP_TIME_ZONE) {
  if (!value) return '';
  return getTimeContext(new Date(value), timeZone).localDate;
}

function localHourFromIso(value, timeZone = DEFAULT_APP_TIME_ZONE) {
  if (!value) return -1;
  return getTimeContext(new Date(value), timeZone).hour;
}

function shiftLocalDate(localDate = '', days = 0) {
  const match = String(localDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)));
  return date.toISOString().slice(0, 10);
}

function isNightTimeOfDay(timeOfDay = '') {
  return timeOfDay === '深夜' || timeOfDay === '夜晚';
}

function hasCurrentNightSignal(text = '') {
  return /睡不着|失眠|凌晨|夜里|深夜|半夜|好晚|晚了|晚上了|夜深/i.test(String(text || ''));
}

function getCurrentTrack(db, accountContext = null) {
  const account = normalizeAccountContext(accountContext);
  try {
    return listRecentPlays(db, 1, account.accountId)[0] || null;
  } catch {
    return null;
  }
}

function countUserMessages(db, sessionId, accountContext = null) {
  const account = normalizeAccountContext(accountContext);
  return db.prepare('SELECT COUNT(*) AS count FROM messages WHERE account_id = ? AND session_id = ? AND role = ?')
    .get(account.accountId, sessionId, 'user').count || 0;
}

function normalizeRuntimePrefs(raw = {}) {
  const pick = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
  return {
    chatMusicBalance: pick(raw.chatMusicBalance, ['friend', 'balanced', 'dj'], DEFAULT_PREFS.chatMusicBalance),
    recommendationFrequency: pick(raw.recommendationFrequency, ['low', 'medium', 'high'], DEFAULT_PREFS.recommendationFrequency),
    voiceMode: pick(raw.voiceMode, ['off', 'recommendations', 'all'], DEFAULT_PREFS.voiceMode),
    moodMode: pick(raw.moodMode, ['auto', 'comfort', 'focus', 'calm', 'night', 'random'], DEFAULT_PREFS.moodMode),
    lowDistractionMode: raw.lowDistractionMode === true,
    note: String(raw.note || '').slice(0, 500)
  };
}

function shouldSynthesizeForRecommendation(prefs = {}) {
  const normalized = normalizeRuntimePrefs(prefs);
  return !normalized.lowDistractionMode && normalized.voiceMode !== 'off';
}

function speechDecisionForRecommendation(prefs = {}) {
  const normalized = normalizeRuntimePrefs(prefs);
  return {
    mode: normalized.lowDistractionMode ? 'off' : normalized.voiceMode,
    shouldSpeak: shouldSynthesizeForRecommendation(normalized)
  };
}

function speechDecisionForChat(prefs = {}) {
  const normalized = normalizeRuntimePrefs(prefs);
  return {
    mode: normalized.lowDistractionMode ? 'off' : normalized.voiceMode,
    shouldSpeak: !normalized.lowDistractionMode && normalized.voiceMode === 'all'
  };
}

async function synthesizeSpeechWithDiagnostics(ttsConfig, text) {
  const started = Date.now();
  try {
    const url = await synthesizeSpeech(ttsConfig, text);
    const ms = Date.now() - started;
    return {
      url,
      status: url ? 'ready' : 'failed',
      ms,
      error: url ? null : 'tts returned no audio'
    };
  } catch (error) {
    return {
      url: null,
      status: 'failed',
      ms: Date.now() - started,
      error: String(error?.message || error).slice(0, 240)
    };
  }
}

function sanitizeTtsDiagnostics(tts = {}) {
  return {
    status: tts.status || (tts.url ? 'ready' : 'unknown'),
    ms: Number(tts.ms || 0),
    hasUrl: Boolean(tts.url),
    error: tts.error || null,
    updatedAt: nowIso()
  };
}

function normalizeRecommendationExplanation(explanation = null) {
  if (!explanation || typeof explanation !== 'object') return null;
  const seenFactors = new Set();
  const factors = Array.isArray(explanation.factors)
    ? explanation.factors
      .map((factor) => {
        const label = String(factor?.label || '').trim().slice(0, 16);
        const value = String(factor?.value || factor?.text || '').trim().slice(0, 80);
        const text = String(factor?.text || (label && value ? `${label}：${value}` : value)).trim().slice(0, 80);
        if (!value || isInternalRecommendationExplanationText(value) || isInternalRecommendationExplanationText(text)) return null;
        const dedupeKey = `${label}\u0000${value}`;
        if (seenFactors.has(dedupeKey)) return null;
        seenFactors.add(dedupeKey);
        return {
          type: String(factor?.type || 'fallback').trim(),
          text,
          ...(label ? { label, value } : {})
        };
      })
      .filter(Boolean)
      .slice(0, 6)
    : [];
  const rawSummary = String(explanation.summary || factors.map(factor => factor.text).join(' + ')).trim();
  const summary = isInternalRecommendationExplanationText(rawSummary) ? '' : rawSummary.slice(0, 180);
  if (!summary && !factors.length) return null;
  return {
    summary,
    factors,
    source: explanation.source === 'llm_pick' ? 'llm_pick' : 'fallback'
  };
}

function normalizeRecommendationSource(source = null) {
  if (!source) return null;
  const id = typeof source === 'string' ? source : source.id;
  const base = RECOMMENDATION_TRACE_SOURCES[id];
  if (!base) return null;
  return {
    ...base,
    reason: String(source.reason || '').trim().slice(0, 120),
    evidence: Array.isArray(source.evidence) ? source.evidence.map(item => String(item || '').trim()).filter(Boolean).slice(0, 4) : [],
    correctionKey: source.correctionKey || base.correctionKey
  };
}

function buildRecommendationSource({
  selectedPick = {},
  selectedTrack = {},
  noveltyBucket = null,
  discoverySource = null,
  userMessage = '',
  conversationMood = null,
  hostContext = {}
} = {}) {
  const pickText = normalizeMusicText(`${selectedPick.reason || ''} ${selectedPick.hostLine || ''}`);
  const trackText = normalizeMusicText(`${selectedTrack.name || ''} ${selectedTrack.album || ''} ${(selectedTrack.artists || []).join(' ')}`);
  const sourceText = normalizeMusicText(discoverySource || '');
  const messageText = normalizeMusicText(userMessage || '');
  if (/new|release|daily|radar|新歌|新发行/.test(sourceText)) {
    return sourceWithEvidence('new_release_radar', discoverySource);
  }
  if (/similar|more|artist|相似/.test(sourceText)) {
    return sourceWithEvidence('similar_artist', discoverySource);
  }
  if (noveltyBucket === 'discovery') {
    return sourceWithEvidence('similar_artist', discoverySource || 'discovery');
  }
  if (/歌词|情绪|心情|氛围|mood|lyric|melancholy|comfort|calm/.test(`${pickText} ${messageText}`) || conversationMood?.searchHints?.length) {
    return sourceWithEvidence('lyric_mood_match', conversationMood?.searchHints?.join(' / ') || selectedPick.reason);
  }
  if (/librarydeep|deep|很久|旧歌|怀旧|long/.test(sourceText) || /怀旧|以前|很久/.test(`${pickText} ${trackText}`)) {
    return sourceWithEvidence('long_absent_favorite', discoverySource || selectedPick.reason);
  }
  if ((hostContext.recentFeedback || []).some(event => event?.eventType === 'complete' || event?.eventType === 'like')) {
    return sourceWithEvidence('recent_completion_direction', 'recent_feedback');
  }
  return sourceWithEvidence('recent_completion_direction', selectedPick.reason || 'radio_context');
}

function sourceWithEvidence(id, evidence = '') {
  const base = normalizeRecommendationSource(id);
  if (!base) return null;
  const text = String(evidence || '').trim();
  return text ? { ...base, evidence: [text.slice(0, 80)] } : base;
}

export function buildRecommendationExplanation({
  selectedPick = {},
  selectedTrack = {},
  userMessage = '',
  conversationMood = null,
  timeOfDay = '',
  weather = '',
  profile = {},
  hostContext = {},
  environmentContext = {},
  recommendationSource = null,
  source = 'fallback'
} = {}) {
  const factors = [];
  const add = (type, text, extra = {}) => {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value) return;
    if (factors.some(factor => factor.type === type && factor.text === value)) return;
    factors.push({ type, text: value.slice(0, 80), ...extra });
  };
  const addLabeled = (type, label, value) => {
    const cleanLabel = String(label || '').trim();
    const cleanValue = String(value || '').replace(/\s+/g, ' ').trim();
    if (!cleanLabel || !cleanValue) return;
    add(type, `${cleanLabel}：${cleanValue}`, { label: cleanLabel, value: cleanValue.slice(0, 80) });
  };

  const traceSource = normalizeRecommendationSource(recommendationSource || selectedPick?.recommendationSource || selectedTrack?.recommendationSource);
  if (traceSource) addLabeled('trace_source', '来自', traceSource.label);

  if (String(userMessage || '').trim()) {
    add(hasExplicitMusicIntent(userMessage) ? 'explicit_request' : 'chat', `你刚刚说：${String(userMessage).trim().slice(0, 34)}`);
  }
  const pickReason = sanitizeRecommendationReasonForExplanation(selectedPick?.reason, { profile });
  if (pickReason) add('chat', pickReason);
  if (conversationMood?.searchHints?.length) add('chat', `当前氛围：${conversationMood.searchHints.slice(0, 3).join(' / ')}`);
  if (timeOfDay) add('time', `现在是${timeOfDay}`);
  const weatherHint = shortWeatherHint(weather);
  if (weatherHint) add('weather', weatherHint);
  const weatherRadio = environmentContext.weatherRadio || buildWeatherRadioContext({ weather, timeOfDay, hour: environmentContext.hour });
  if (weatherRadio?.label) addLabeled('weather_radio', '天气电台', `${weatherRadio.label}：${weatherRadio.description}`);
  if (hostContext.openingRecap?.recommendationHint) addLabeled('music_recap', '回顾', hostContext.openingRecap.recommendationHint);
  const profileHint = shortProfileHint(profile);
  if (profileHint) add('profile', profileHint);
  const feedbackHint = shortFeedbackHint(hostContext.recentFeedback);
  if (feedbackHint) add('feedback', feedbackHint);

  if (!factors.length && selectedTrack?.name) add('fallback', `已确认《${selectedTrack.name}》可播放`);
  return normalizeRecommendationExplanation({
    factors,
    source: source === 'llm_pick' ? 'llm_pick' : 'fallback'
  });
}

function sanitizeRecommendationReasonForExplanation(reason = '', { profile = {} } = {}) {
  const text = String(reason || '').replace(/\s+/g, ' ').trim();
  if (reasonOverusesConcreteProfileArtist(text, profile)) return '';
  return isInternalRecommendationExplanationText(text) ? '' : text;
}

function reasonOverusesConcreteProfileArtist(text = '', profile = {}) {
  const value = String(text || '').trim();
  if (!value || !/(喜欢|常听|画像|偏好|经常听|长期听)/.test(value)) return false;
  const artists = profile?.structured?.artists || [];
  return artists.some(item => {
    const name = String(item?.name || '').trim();
    return name.length >= 2 && value.includes(name);
  });
}

function isInternalRecommendationExplanationText(text = '') {
  const value = String(text || '').trim();
  if (!value) return false;
  return /LLM|profile_fallback|same_artist_fallback|fallback|playable source|stable playback/i.test(value) ||
    /没有确认到|未确认到|稳定播放源|可播放源|兜底|原来想找|更稳的一首|改用当前账号/.test(value);
}

function shortWeatherHint(weather = '') {
  const text = String(weather || '').replace(/\s+/g, ' ').trim();
  if (!text || isWeatherSummaryUnavailable(text)) return '';
  return text
    .replace(/。.*$/g, '')
    .replace(/，.*?天气/g, '，天气')
    .slice(0, 44);
}

function isWeatherSummaryUnavailable(weather = '') {
  return /天气获取失败|fetch failed|未配置天气|weather.*(?:failed|error)/i.test(String(weather || ''));
}

function shortProfileHint(profile = {}) {
  const structured = profile?.structured || {};
  const moods = Array.isArray(structured.moods) ? structured.moods.map(item => item?.name).filter(Boolean).slice(0, 2) : [];
  const genres = Array.isArray(structured.genres) ? structured.genres.map(item => item?.name).filter(Boolean).slice(0, 2) : [];
  const scenes = Array.isArray(structured.scenes) ? structured.scenes.map(item => item?.name).filter(Boolean).slice(0, 2) : [];
  const parts = [...genres, ...moods, ...scenes].filter(Boolean).slice(0, 3);
  if (parts.length) return `你的画像偏好：${parts.join(' / ')}`;
  const summary = formatProfileSummaryForPrompt(profile);
  return summary && summary !== '无' && summary !== 'No objective profile available.'
    ? `你的画像偏好：${summary.slice(0, 34)}`
    : '';
}

export function formatProfileSummaryForPrompt(profile = {}) {
  const structured = profile?.structured || {};
  const llmSummary = sanitizeObjectiveProfileText(structured.llmProfile?.summary, structured);
  if (llmSummary) return llmSummary.slice(0, 420);
  return buildObjectiveProfilePromptText(structured) || 'No objective profile available.';
}

function buildObjectiveProfilePromptText(structured = {}) {
  const groups = [
    ['genres', structured.genres],
    ['moods', structured.moods],
    ['scenes', structured.scenes],
    ['languages', structured.languages],
    ['energy', structured.energy],
    ['eras', structured.eras],
    ['discovery', structured.discoveryDirections],
    ['avoid', structured.avoidSignals]
  ]
    .map(([label, values]) => {
      const names = (Array.isArray(values) ? values : [])
        .map(item => String(item?.name || item || '').trim())
        .filter(Boolean)
        .slice(0, label === 'discovery' ? 5 : 4);
      return names.length ? `${label}: ${names.join(' / ')}` : '';
    })
    .filter(Boolean);
  return groups.length ? `Objective listening profile. ${groups.join('; ')}.`.slice(0, 420) : '';
}

function sanitizeObjectiveProfileText(text = '', structured = {}) {
  let value = String(text || '').replace(/《[^》]{1,80}》/g, '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  const concreteTerms = [
    ...(structured.artists || []).map(item => item?.name),
    ...(structured.albums || []).map(item => item?.name)
  ].map(term => String(term || '').trim()).filter(Boolean);
  for (const term of concreteTerms) {
    if (term.length < 2) continue;
    value = value.replace(new RegExp(escapeRegExp(term), 'gi'), '');
  }
  return value
    .replace(/[、，,;；]{2,}/g, '、')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[、，,;；\s]+|[、，,;；\s]+$/g, '')
    .trim();
}

function shortFeedbackHint(events = []) {
  const items = (events || []).filter(event => event?.eventType).slice(0, 3);
  if (!items.length) return '';
  const labels = { like: '喜欢', dislike: '不喜欢', skip: '跳过', complete: '完整播放' };
  return `最近反馈：${items.map(event => labels[event.eventType] || event.eventType).join(' / ')}`;
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
  if (isImmediateNextRequest(value)) return true;
  if (isDirectMusicRequest(value)) return true;
  if (/先别放|不要放|别放|不想听歌|不想听音乐|先别切|不要切|别切|别换/.test(value)) return false;
  if (isExplicitReplayRequest(value)) return true;
  if (/^(?:我想|想|要|我要|给我|帮我)?(?:听|放|播放|播)(?!说|说话|你说|我说|着|起来|过)(?:一下|一首|首)?[\s\S]{2,40}(?:的[\s\S]{1,30})?$/.test(value.trim())) return true;
  if (/下一首|换一首|换歌|切歌|播放|放一首|来一首|来首|想听|给我.*(歌|音乐)|有没有.*(歌|音乐)|听.*(歌|音乐)|artist|song|music|play|recommend/i.test(value)) return true;
  return /(推荐|来点).*(歌|音乐|曲|国风|古风|电子|摇滚|民谣|爵士|说唱|粤语|日语|英语|中文|安静|治愈|伤感|开心|提神|专注|睡前)|推荐(一首|首|点|些)?$/.test(value);
}

export function isDirectMusicRequest(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (isDeferredOrNegatedMusicRequest(value)) return false;
  if (/听过.{0,30}(吗|么|\?|？)$/.test(value)) return false;
  if (/(你觉得|你喜欢|你会|你知道).{0,20}(歌|音乐|歌手|曲风|风格|推荐)/.test(value)) return false;

  const directAction = /(?:放|播放|播|放点|放一点|来点|来首|来一首|想听|想听点|推荐|给我|帮我|安排|整点|整一首)/;
  if (!directAction.test(value)) return false;

  const blockedObject = /(意见|想法|看法|故事|解释|回答|建议|说话|说说|聊聊|聊天)/;
  const musicTarget = /(歌|音乐|曲|BGM|bgm|DJ|dj|歌手|风格|场景|曲风|歌单|国风|古风|电子|摇滚|民谣|爵士|说唱|粤语|日语|英语|中文|安静|治愈|伤感|开心|提神|专注|睡前|健身|健身房|写代码|短视频|逆袭|鼓点|纯音乐|ost|OST|lofi|Lo-fi|hiphop|jazz|rock|pop|music|song|playlist|artist)/;
  if (musicTarget.test(value)) return true;
  if (/(?:想听|听|放|播放|播)(?!说|说话|你说|我说|着|起来|过)(?:一下|一首|首|点|一点)?[^，。！？!?]{2,40}/.test(value) && !blockedObject.test(value)) return true;
  return false;
}

function isDeferredOrNegatedMusicRequest(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/不想听(?:歌|音乐)|不放歌|只是聊/.test(value)) return true;
  if (/(?:先别|不要|别|不用|不必|暂时别|先不).{0,8}(?:放|播|播放|听|推荐|切歌|换歌|换一首|下一首|跳过|来点|来首|歌|音乐|BGM|bgm)/.test(value)) return true;
  if (/(?:后面|之后|以后|稍后|待会|一会儿|下一首|下首|下一轮|后续).{0,14}(?:再|可以|帮我|给我|来|放|播|播放|听|推荐|安排|整点)?(?:放|播|播放|听|推荐|来点|来首|歌|音乐|BGM|bgm|国风|曲风|风格)/.test(value)) return true;
  if (/(?:放|播|播放|听|推荐|来点|来首).{0,24}(?:后面|之后|以后|稍后|待会|下一首再|下首再)/.test(value)) return true;
  if (/(?:先聊|先陪|聊聊天|先别硬切|不急着切歌)/.test(value) && /(?:放|播|播放|听|推荐|来点|来首|歌|音乐|BGM|bgm)/.test(value)) return true;
  return false;
}

export function isExplicitReplayRequest(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  return /(?:再|重新|还想再|想再).{0,8}(?:听|放|播放|播).{0,6}(?:一遍|一次|一回|一下|这首|这歌)|(?:重听|重播|重复播放|循环播放|再来一遍|再来一次)/.test(value);
}

export function normalizeMusicText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s·・.．,，、\-_/\\（）()《》<>[\]【】"'“”‘’!！?？:：;；~～]/g, '');
}

function normalizeVocalPolicy(value = '') {
  return value === VOCAL_POLICIES.INSTRUMENTAL_ONLY ? VOCAL_POLICIES.INSTRUMENTAL_ONLY : '';
}

function detectVocalPolicyUpdate(text = '') {
  const value = String(text || '').trim();
  if (!value) return null;
  if (/(?:\u6062\u590d\u6b63\u5e38|\u6b63\u5e38\u63a8\u8350|\u4e0d\u7528\u7eaf\u97f3\u4e50|\u53ef\u4ee5\u6709\u4eba\u58f0|\u6709\u4eba\u58f0|\u6709\u6b4c\u8bcd)/i.test(value)) {
    return '';
  }
  if (/(?:\u7eaf\u97f3\u4e50|\u4f34\u594f|\u65e0\u4eba\u58f0|\u6ca1\u6709\u4eba\u58f0|\u4e0d\u8981\u4eba\u58f0|\u65e0\u6b4c\u8bcd|\u6ca1\u6709\u6b4c\u8bcd|\u4e0d\u8981\u6b4c\u8bcd|instrumental|no\s+vocal|no\s+lyrics)/i.test(value)) {
    return VOCAL_POLICIES.INSTRUMENTAL_ONLY;
  }
  return null;
}

function requestRequiresInstrumental(request = {}) {
  return normalizeVocalPolicy(request?.vocalPolicy) === VOCAL_POLICIES.INSTRUMENTAL_ONLY;
}

function hasInstrumentalEvidence(...values) {
  const text = values.map(value => {
    if (!value) return '';
    if (Array.isArray(value)) return value.join(' ');
    if (typeof value === 'object') {
      return [
        value.name,
        value.title,
        value.song,
        value.album,
        value.reason,
        value.hostLine,
        value.playlistName,
        ...(Array.isArray(value.artists) ? value.artists : []),
        ...(Array.isArray(value.queries) ? value.queries : [])
      ].filter(Boolean).join(' ');
    }
    return String(value);
  }).join(' ');
  return /(?:\u7eaf\u97f3\u4e50|\u4f34\u594f|\u8f7b\u97f3\u4e50|\u5668\u4e50|\u65e0\u4eba\u58f0|\u65e0\u6b4c\u8bcd|\u94a2\u7434|\u53e4\u5178|\u914d\u4e50|\u7535\u5f71\u539f\u58f0|\u539f\u58f0|instrumental|piano|ambient|soundtrack|ost|bgm|lofi)/i.test(text);
}

function songPickViolatesVocalPolicy(pick = {}, request = {}) {
  return requestRequiresInstrumental(request) && !hasInstrumentalEvidence(pick);
}

function trackViolatesVocalPolicy(track = {}, request = {}, pick = null) {
  return requestRequiresInstrumental(request) && !hasInstrumentalEvidence(track, pick);
}

function trackDisplayName(track = {}) {
  const artists = (track.artists || []).filter(Boolean).join('、');
  return artists ? `《${track.name}》 - ${artists}` : `《${track.name || '这首歌'}》`;
}

function finishSentence(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  return /[。.!！?？]$/.test(value) ? value : `${value}。`;
}

function trackHandoffText(track = {}, options = {}) {
  const display = trackDisplayName(track);
  if (options.playableFallback) {
    return `我确认了一下可播放源，最后接到 ${display}。`;
  }
  return `我接到 ${display}。`;
}

function minimalRecommendationFallback(track = {}) {
  return `接下来放 ${trackDisplayName(track)}。`;
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
  const originalText = String(text || '');
  const normalizedText = normalizeMusicText(originalText);
  if (!normalizedText || !selectedTrack?.id) return false;
  const selectedTerms = new Set(trackMentionTerms(selectedTrack));
  for (const candidate of candidates || []) {
    const track = candidate?.track || candidate;
    if (!track?.id || String(track.id) === String(selectedTrack.id)) continue;
    for (const term of trackMentionTerms(track)) {
      if (!selectedTerms.has(term) && hasExplicitMusicMention(originalText, normalizedText, term)) return true;
    }
  }
  return false;
}

function hasExplicitMusicMention(originalText, normalizedText, normalizedTerm) {
  if (!normalizedTerm || !normalizedText.includes(normalizedTerm)) return false;

  const bracketMatches = String(originalText || '').match(/《[^》]{1,80}》/g) || [];
  if (bracketMatches.some(match => normalizeMusicText(match).includes(normalizedTerm))) {
    return true;
  }

  const musicBefore = ['听', '放', '播', '接', '切', '换', '推荐', '点', '唱', '选', '挑', '来首', '来一首'];
  const musicAfter = ['这首', '这版', '这歌', '歌曲', '歌', '曲', '单曲', '版本', '艺人', '唱的', '唱'];
  let from = 0;
  while (from < normalizedText.length) {
    const index = normalizedText.indexOf(normalizedTerm, from);
    if (index < 0) break;
    const before = normalizedText.slice(Math.max(0, index - 10), index);
    const after = normalizedText.slice(index + normalizedTerm.length, index + normalizedTerm.length + 10);
    if (musicBefore.some(marker => before.includes(normalizeMusicText(marker)))) return true;
    if (musicAfter.some(marker => after.includes(normalizeMusicText(marker)))) return true;
    from = index + Math.max(1, normalizedTerm.length);
  }
  return false;
}

export function ensureRecommendationTextMatchesTrack(text, selectedTrack, candidates = [], options = {}) {
  if (!selectedTrack?.name) return String(text || '').trim();
  const value = String(text || '').trim();
  if (!value) return minimalRecommendationFallback(selectedTrack);
  const selectedName = normalizeMusicText(selectedTrack.name);
  if (recommendationTextMentionsDifferentTrack(value, selectedTrack, candidates)) {
    return `${stripExplicitDifferentTrackMentions(value, selectedTrack, candidates)}${trackHandoffText(selectedTrack, options)}`.trim();
  }
  if (selectedName && !normalizeMusicText(value).includes(selectedName)) {
    return `${finishSentence(value)}${trackHandoffText(selectedTrack, options)}`;
  }
  return value;
}

function stripExplicitDifferentTrackMentions(text, selectedTrack, candidates = []) {
  const value = finishSentence(text);
  if (!value) return '';
  const selectedTerms = new Set(trackMentionTerms(selectedTrack));
  const differentNames = [];
  const differentArtists = [];
  for (const candidate of candidates || []) {
    const track = candidate?.track || candidate;
    if (!track?.id || String(track.id) === String(selectedTrack?.id)) continue;
    const names = [track.name].filter(Boolean);
    const artists = (track.artists || []).filter(Boolean);
    for (const name of names) {
      const normalized = normalizeMusicText(name);
      if (normalized && !selectedTerms.has(normalized)) differentNames.push(String(name));
      const simplified = String(name).replace(/[（(].*?[）)]/g, '').trim();
      if (simplified && simplified !== name) {
        const normalizedSimplified = normalizeMusicText(simplified);
        if (normalizedSimplified && !selectedTerms.has(normalizedSimplified)) differentNames.push(simplified);
      }
    }
    for (const artist of artists) {
      const normalized = normalizeMusicText(artist);
      if (normalized && !selectedTerms.has(normalized)) differentArtists.push(String(artist));
    }
  }
  let cleaned = value;
  for (const name of [...new Set(differentNames)].sort((a, b) => b.length - a.length)) {
    cleaned = cleaned.replaceAll(`《${name}》`, '这首歌').replaceAll(name, '这首歌');
  }
  for (const artist of [...new Set(differentArtists)].sort((a, b) => b.length - a.length)) {
    cleaned = cleaned.replaceAll(artist, '这位歌手');
  }
  cleaned = cleaned
    .replace(/这首歌\s*-\s*这位歌手/g, '这首歌')
    .replace(/我(?:给你)?(?:放|播|接|换|挑|选)\s*这首歌[，,。]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || normalizeMusicText(cleaned) === normalizeMusicText(value)) return '';
  return finishSentence(cleaned);
}

export function parseDjModelResponse(raw, fallbackText = '') {
  const text = stripCodeFence(String(raw || '')).trim();
  const chatMatch = text.match(/<CHAT>([\s\S]*?)<\/CHAT>/i);
  const jsonMatch = text.match(/<JSON>([\s\S]*?)<\/JSON>/i);
  let chatText = chatMatch ? chatMatch[1].trim() : '';
  let parsed = null;
  let objectMatch = null;

  if (jsonMatch) {
    try { parsed = JSON.parse(jsonMatch[1].trim()); } catch {}
  }
  if (!parsed) {
    objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try { parsed = JSON.parse(objectMatch[0]); } catch {}
    }
  }
  if (!chatText && parsed) {
    chatText = String(
      parsed.chatText ||
      parsed.chat_text ||
      parsed.chat ||
      parsed.hostText ||
      parsed.host_text ||
      parsed.djText ||
      parsed.reply ||
      parsed.message ||
      parsed.content ||
      parsed.text ||
      ''
    ).trim();
  }
  if (!chatText && parsed && objectMatch && objectMatch.index > 0) {
    chatText = text
      .slice(0, objectMatch.index)
      .replace(/<CHAT>|<\/CHAT>/gi, '')
      .trim();
  }
  if (!chatText && jsonMatch) {
    chatText = text.slice(0, jsonMatch.index).replace(/<CHAT>|<\/CHAT>/gi, '').trim();
  }
  if (!chatText && !parsed) {
    chatText = text.replace(/<CHAT>|<\/CHAT>/gi, '').trim();
  }

  return {
    chatText: chatText || fallbackText,
    pick: parsed?.pick,
    reason: parsed?.reason || '',
    mode: parsed?.mode ?? null
  };
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

function getMusicRequestConstraints(db, userMessage = '', mode = {}, sessionConstraints = {}) {
  const text = String(userMessage || '').trim();
  const tracks = safeListTracks(db);
  const artistConstraint = extractRequestedArtistConstraint(text, tracks, mode);
  const songTitle = extractRequestedSongTitle(text, artistConstraint);
  const messageVocalPolicy = detectVocalPolicyUpdate(text);
  const styleConstraint = inferStyleConstraintFromText(text, mode);
  return {
    text,
    artistConstraint,
    songTitle,
    vocalPolicy: messageVocalPolicy || '',
    sessionConstraints: normalizeSessionConstraints(sessionConstraints),
    styleConstraint,
    styleSearchQueries: styleConstraint?.searchQueries || [],
    allowRequestedSongReplay: Boolean(songTitle),
    allowPlayedSongReplay: Boolean(songTitle && isExplicitReplayRequest(text))
  };
}

function normalizeParsedStyleConstraint(input = {}, extraQueries = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const rawGroups = input.requiredGroups || input.hardGroups || input.requiredAnyGroups || [];
  const requiredGroups = Array.isArray(rawGroups)
    ? rawGroups.map(group => normalizeStyleTermGroup(group)).filter(group => group.length)
    : [];
  const softTerms = uniqueStrings([
    ...(Array.isArray(input.softTerms) ? input.softTerms : []),
    ...(Array.isArray(input.preferredTerms) ? input.preferredTerms : [])
  ].map(sanitizeStyleTerm), 12);
  const negativeTerms = uniqueStrings([
    ...(Array.isArray(input.negativeTerms) ? input.negativeTerms : [])
  ].map(sanitizeStyleTerm), 10);
  const searchQueries = normalizeStyleSearchQueries([
    ...(Array.isArray(input.searchQueries) ? input.searchQueries : []),
    ...extraQueries
  ]);
  if (!requiredGroups.length && !softTerms.length && !searchQueries.length) return null;
  return {
    strict: Boolean(input.strict) && requiredGroups.length > 0,
    requiredGroups,
    softTerms,
    negativeTerms,
    searchQueries
  };
}

function normalizeStyleTermGroup(group) {
  const values = Array.isArray(group) ? group : [group];
  return uniqueStrings(values.map(sanitizeStyleTerm).filter(Boolean), 10);
}

function sanitizeStyleTerm(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 24) return '';
  return text;
}

function normalizeStyleSearchQueries(values = []) {
  return uniqueStrings((values || [])
    .map(value => String(value || '')
      .replace(/[鈥溾€?']/g, '')
      .replace(/[銆傦紒锛??锛?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(value => value && value.length <= 48 && normalizeMusicText(value).length >= 2), 6);
}

function inferStyleConstraintFromText(text = '', mode = {}) {
  const value = `${String(text || '')} ${String(mode?.genre || '')}`.trim();
  if (!value) return null;
  const hasChineseStyle = /(?:\u56fd\u98ce|\u53e4\u98ce|\u4e2d\u56fd\u98ce|\u6c11\u4e50|\u620f\u8154|\u53e4\u7b5d|\u7435\u7436|\u7b1b|\u7bab)/i.test(value);
  const hasElectronicBgm = /(?:\bDJ\b|\bdj\b|remix|\u6df7\u97f3|\u7535\u97f3|\u7535\u5b50|BGM|bgm|\u914d\u4e50|\u9f13\u70b9|\u821e\u66f2|\u71c3\u5411)/i.test(value);
  const hasUseCase = /(?:\u77ed\u89c6\u9891|\u89c6\u9891|\u526a\u8f91|\u9006\u88ad|\u7edd\u5883|\u70ed\u8840|\u71c3|\u529b\u91cf|\u6218\u6597|\u723d\u6587)/i.test(value);
  if (!hasChineseStyle && !hasElectronicBgm && !hasUseCase) return null;

  const requiredGroups = [];
  if (hasChineseStyle) {
    requiredGroups.push([
      '\u56fd\u98ce',
      '\u53e4\u98ce',
      '\u4e2d\u56fd\u98ce',
      '\u6c11\u4e50',
      '\u620f\u8154',
      '\u53e4\u7b5d',
      '\u7435\u7436',
      '\u7b1b',
      '\u7bab'
    ]);
  }
  if (hasElectronicBgm) {
    requiredGroups.push([
      'DJ',
      'dj',
      'remix',
      'Remix',
      '\u6df7\u97f3',
      '\u7535\u97f3',
      '\u7535\u5b50',
      'BGM',
      'bgm',
      '\u914d\u4e50',
      '\u9f13\u70b9'
    ]);
  }

  const softTerms = [];
  const softCandidates = [
    ['\u9006\u88ad', /(?:\u9006\u88ad|\u7edd\u5883)/],
    ['\u71c3', /(?:\u71c3|\u71c3\u5411|\u70ed\u8840)/],
    ['\u529b\u91cf', /(?:\u529b\u91cf|\u6709\u529b)/],
    ['\u77ed\u89c6\u9891', /(?:\u77ed\u89c6\u9891|\u89c6\u9891|\u526a\u8f91)/],
    ['BGM', /(?:BGM|bgm|\u914d\u4e50)/i]
  ];
  for (const [term, pattern] of softCandidates) {
    if (pattern.test(value)) softTerms.push(term);
  }

  const searchQueries = [];
  if (hasChineseStyle && hasElectronicBgm) {
    searchQueries.push('\u56fd\u98ce DJ \u9006\u88ad BGM');
    searchQueries.push('\u53e4\u98ce \u7535\u97f3 \u71c3\u5411 BGM');
    searchQueries.push('\u4e2d\u56fd\u98ce remix \u77ed\u89c6\u9891 BGM');
  } else if (hasChineseStyle) {
    searchQueries.push('\u56fd\u98ce \u71c3\u5411 BGM');
    searchQueries.push('\u53e4\u98ce \u70ed\u8840 \u914d\u4e50');
  } else if (hasElectronicBgm || hasUseCase) {
    searchQueries.push('\u9006\u88ad \u71c3\u5411 BGM');
    searchQueries.push('\u77ed\u89c6\u9891 \u70ed\u8840 DJ');
  }

  if (!requiredGroups.length) return null;
  return {
    strict: true,
    requiredGroups,
    softTerms: uniqueStrings(softTerms, 8),
    negativeTerms: [
      '\u666e\u901a\u6292\u60c5',
      '\u6000\u65e7\u6162\u6b4c',
      '\u53ea\u9760\u60c5\u7eea\u76f8\u4f3c'
    ],
    searchQueries: normalizeStyleSearchQueries(searchQueries)
  };
}

function normalizeStyleConstraint(input = {}, { text = '', mode = {}, searchQueries = [] } = {}) {
  const parsed = normalizeParsedStyleConstraint(input, searchQueries);
  const inferred = inferStyleConstraintFromText(text, mode);
  return mergeStyleConstraints(parsed, inferred);
}

function mergeStyleConstraints(...constraints) {
  const valid = constraints.filter(Boolean);
  if (!valid.length) return null;
  const requiredGroups = [];
  const seenGroups = new Set();
  const addGroup = (group) => {
    const normalized = normalizeStyleTermGroup(group);
    if (!normalized.length) return;
    const key = normalized.map(term => normalizeMusicText(term)).sort().join('|');
    if (seenGroups.has(key)) return;
    seenGroups.add(key);
    requiredGroups.push(normalized);
  };
  for (const constraint of valid) {
    for (const group of constraint.requiredGroups || []) addGroup(group);
  }
  const softTerms = uniqueStrings(valid.flatMap(constraint => constraint.softTerms || []).map(sanitizeStyleTerm), 12);
  const negativeTerms = uniqueStrings(valid.flatMap(constraint => constraint.negativeTerms || []).map(sanitizeStyleTerm), 10);
  const searchQueries = normalizeStyleSearchQueries(valid.flatMap(constraint => constraint.searchQueries || []));
  if (!requiredGroups.length && !softTerms.length && !searchQueries.length) return null;
  return {
    strict: valid.some(constraint => constraint.strict) && requiredGroups.length > 0,
    requiredGroups,
    softTerms,
    negativeTerms,
    searchQueries
  };
}

function getStyleSearchConfig(config = {}) {
  const recommendation = config?.recommendation || {};
  const rawTimeout = Number(recommendation.styleSearchTimeoutMs ?? process.env.RECOMMENDATION_STYLE_SEARCH_TIMEOUT_MS);
  const rawLimit = Number(recommendation.styleSearchLimit ?? process.env.RECOMMENDATION_STYLE_SEARCH_LIMIT);
  return {
    timeoutMs: Math.max(1, Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : STYLE_SEARCH_DEFAULT_TIMEOUT_MS),
    limit: Math.max(0, Number.isFinite(rawLimit) ? rawLimit : STYLE_SEARCH_DEFAULT_LIMIT),
    strictStyle: recommendation.strictStyle ?? (process.env.RECOMMENDATION_STRICT_STYLE === undefined ? true : ['1', 'true', 'yes', 'on'].includes(String(process.env.RECOMMENDATION_STRICT_STYLE || '').trim().toLowerCase()))
  };
}

function styleConstraintIsActive(styleConstraint = null, config = {}) {
  if (!styleConstraint?.strict || !styleConstraint.requiredGroups?.length) return false;
  return getStyleSearchConfig(config).strictStyle !== false;
}

function styleConstraintEvidenceText(track = {}) {
  return [
    track?.name,
    track?.album,
    track?.albumName,
    ...(Array.isArray(track?.artists) ? track.artists : [])
  ].filter(Boolean).join(' ');
}

function styleTermMatchesText(term, text) {
  const wanted = normalizeMusicText(term);
  const haystack = normalizeMusicText(text);
  return wanted.length >= 1 && haystack.includes(wanted);
}

function getStyleConstraintResult(track = {}, styleConstraint = null, config = {}) {
  if (!styleConstraintIsActive(styleConstraint, config)) {
    return { active: false, accepted: true, matchedTerms: [], missingGroups: [] };
  }
  const text = styleConstraintEvidenceText(track);
  const matchedTerms = [];
  const missingGroups = [];
  for (const group of styleConstraint.requiredGroups || []) {
    const matched = (group || []).filter(term => styleTermMatchesText(term, text));
    if (matched.length) matchedTerms.push(...matched);
    else missingGroups.push(group);
  }
  return {
    active: true,
    accepted: missingGroups.length === 0,
    matchedTerms: uniqueStrings(matchedTerms, 12),
    missingGroups: missingGroups.map(group => uniqueStrings(group, 8))
  };
}

export function trackMatchesStyleConstraint(track = {}, styleConstraint = null, config = {}) {
  return getStyleConstraintResult(track, styleConstraint, config).accepted;
}

export function trackViolatesStyleConstraint(track = {}, styleConstraint = null, config = {}) {
  return !trackMatchesStyleConstraint(track, styleConstraint, config);
}

function sanitizeStyleConstraintForDebug(styleConstraint = null) {
  if (!styleConstraint) return null;
  return {
    strict: Boolean(styleConstraint.strict),
    requiredGroups: (styleConstraint.requiredGroups || []).map(group => uniqueStrings(group, 8)).slice(0, 6),
    softTerms: uniqueStrings(styleConstraint.softTerms || [], 12),
    negativeTerms: uniqueStrings(styleConstraint.negativeTerms || [], 10),
    searchQueries: normalizeStyleSearchQueries(styleConstraint.searchQueries || [])
  };
}

function formatStyleConstraintForPrompt(styleConstraint = null) {
  if (!styleConstraintIsActive(styleConstraint)) return '';
  return [
    'STRICT_STYLE_CONSTRAINT:',
    `requiredGroups=${JSON.stringify(styleConstraint.requiredGroups || [])}`,
    `softTerms=${JSON.stringify(styleConstraint.softTerms || [])}`,
    `negativeTerms=${JSON.stringify(styleConstraint.negativeTerms || [])}`,
    `searchQueries=${JSON.stringify(styleConstraint.searchQueries || [])}`,
    'When strict style is active, do not replace it with mood similarity. A normal ballad that only feels emotional is not a valid substitute.'
  ].join('\n');
}

function safeListTracks(db) {
  if (!db) return [];
  try {
    return listTracks(db, 5000);
  } catch {
    return [];
  }
}

export function extractRequestedSongTitle(text, artistConstraint = null) {
  const value = String(text || '').trim();
  const quoted = value.match(/《([^》]{1,40})》/);
  if (quoted?.[1]) return cleanRequestedSongTitle(quoted[1], artistConstraint);
  if (isSceneRecommendationRequest(value)) return '';

  if (artistConstraint?.aliases?.length) {
    for (const alias of artistConstraint.aliases) {
      const escaped = escapeRegExp(alias);
      const match = value.match(new RegExp(`${escaped}(?:的|唱的)?([^，。？！,.!?]{2,28})`));
      const title = cleanRequestedSongTitle(match?.[1] || '', artistConstraint);
      if (title) return title;
    }
  }

  const patterns = [
    /(?:想听|听|播放|放|播|来一首|来首|推荐)(?:一下|一首|首)?([^，。？！,.!?]{2,32})/,
    /(?:有没有)([^，。？！,.!?]{2,32})(?:这首歌|这歌|歌|歌曲)/
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    const title = cleanRequestedSongTitle(match?.[1] || '', artistConstraint);
    if (title) return title;
  }
  return '';
}

function isSceneRecommendationRequest(value = '') {
  const text = String(value || '').trim();
  if (!text) return false;
  return /(?:推荐|放|来|听|找).{0,10}适合[^，。？！,.!?]{1,18}(?:的)?(?:歌|音乐|曲子|歌曲|BGM|bgm)/.test(text) ||
    /(?:正在|在|到了|位于|准备在).{0,18}(?:教室|自习室|健身房|宿舍|图书馆|办公室|课堂|学习|工作|通勤|路上|睡前|夜里).{0,18}(?:推荐|放|来|听|找)/.test(text);
}

function cleanRequestedSongTitle(value, artistConstraint = null) {
  let text = String(value || '')
    .replace(/^(我想|想|还想|要|我要|给我|帮我|重新|再|重听|再听|再放|再播|听|放|播放|播|来一首|来首|再来|推荐|一下|一遍|一次|一回|一首|首|点|一点|一些|几首)+/g, '')
    .replace(/(这首歌|这歌|歌|歌曲|音乐|作品|专辑)+$/g, '')
    .replace(/^的+|的+$/g, '')
    .trim();
  for (const alias of artistConstraint?.aliases || []) {
    text = text.replace(new RegExp(escapeRegExp(alias), 'gi'), '').replace(/^的+|的+$/g, '').trim();
  }
  const normalized = normalizeMusicText(text);
  if (normalized.length < 2 || normalized.length > 24) return '';
  if (GENERIC_ARTIST_PHRASES.has(normalized)) return '';
  if (/^适合/.test(text) && /(?:教室|自习室|健身房|宿舍|图书馆|办公室|课堂|学习|工作|通勤|路上|睡前|夜里|场景)/.test(text)) return '';
  if (/^(他的|她的|他们的|她们的|它的|那首|一首|几首|一些|一点|歌|歌曲|音乐|作品|专辑)$/.test(text)) return '';
  return text;
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

function trackMatchesSongTitle(track, songTitle) {
  const wanted = normalizeMusicText(songTitle);
  const actual = normalizeMusicText(track?.name || '');
  if (!wanted || !actual) return false;
  return actual === wanted || actual.includes(wanted) || wanted.includes(actual);
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const explicitMusic = ['explicit_music', 'explicit_song', 'artist', 'genre', 'music'].includes(mood?.musicIntent || mood?.intent);
  if (!currentTrack) {
    return Boolean(mood?.shouldRecommend) && (!normalizedPrefs.lowDistractionMode || explicitMusic || Number(mood?.confidence || 0) >= 0.75);
  }
  const minMessages = BALANCE_MIN_USER_MESSAGES[normalizedPrefs.chatMusicBalance] ?? 3;
  const minGap = FREQUENCY_MIN_GAP[normalizedPrefs.recommendationFrequency] ?? 3;
  const lowDistractionGap = normalizedPrefs.lowDistractionMode ? 2 : 0;
  if (userMessageCount < minMessages + lowDistractionGap) return false;
  if (lastSuggestedAtUserCount && userMessageCount - Number(lastSuggestedAtUserCount) < minGap + lowDistractionGap) return false;
  return Boolean(mood?.shouldRecommend);
}

export function decideHardRuleTurnAction({ userMessage = '', mode = {} } = {}) {
  const text = String(userMessage || '').trim();
  const result = (action, reason, extra = {}) => ({
    action,
    reason,
    confidence: extra.confidence ?? 1,
    source: 'hard_rule',
    searchHints: extra.searchHints || [],
    newMode: extra.newMode ?? null
  });

  if (!text) return result(TURN_ACTIONS.RECOMMEND_AND_PLAY, 'empty turn means radio continuation');
  if (isModeUpdateRequest(text)) {
    return result(TURN_ACTIONS.CHAT_ONLY, 'user is updating listening mode rather than asking for an immediate song', {
      newMode: modeUpdateFromText(text)
    });
  }
  if (isPlaybackControlRequest(text)) {
    return result(TURN_ACTIONS.CONTINUE_CURRENT_SONG, 'user asked for playback control without a new recommendation');
  }
  if (isImmediateNextRequest(text)) {
    return result(TURN_ACTIONS.RECOMMEND_AND_PLAY, 'user explicitly asked to switch songs', {
      searchHints: extractActionSearchHints(text, mode)
    });
  }
  if (isDirectMusicRequest(text)) {
    return result(TURN_ACTIONS.RECOMMEND_AND_PLAY, 'user directly requested music from chat', {
      searchHints: extractActionSearchHints(text, mode)
    });
  }
  if (rejectsMusic(text)) return result(TURN_ACTIONS.CHAT_ONLY, 'user explicitly rejected playback or switching');
  return null;
}

async function resolveTurnActionWithIntentModel({
  config,
  userMessage,
  history,
  baseMood,
  explicitIntent,
  canSuggest,
  currentTrack,
  profile,
  mode,
  prefs,
  conversationState,
  userMessageCount,
  memoryContext,
  environmentContext
}) {
  const fallbackAction = () => decideTurnAction({
    userMessage,
    history,
    baseMood,
    explicitIntent,
    canSuggest,
    currentTrack,
    mode,
    prefs,
    conversationState,
    userMessageCount,
    memoryContext,
    environmentContext
  });

  const classified = await classifyTurnIntent({
    config,
    userMessage,
    history,
    currentTrack,
    profile,
    mode,
    prefs,
    baseMood,
    memoryContext,
    canSuggest,
    explicitIntent,
    environmentContext
  });

  if (classified.accepted) {
    if (classified.action === TURN_ACTIONS.RECOMMEND_AND_PLAY && !explicitIntent && !canSuggest) {
      return { turnAction: fallbackAction(), intentSource: 'fallback', skipFriendLlm: false };
    }
    return { turnAction: classified, intentSource: 'llm', skipFriendLlm: false };
  }

  return {
    turnAction: fallbackAction(),
    intentSource: 'fallback',
    skipFriendLlm: Boolean(classified.skipFriendLlm)
  };
}

export async function classifyTurnIntent({
  config,
  userMessage = '',
  history = [],
  currentTrack = null,
  profile = {},
  mode = {},
  prefs = {},
  baseMood = {},
  memoryContext = {},
  canSuggest = false,
  explicitIntent = false,
  environmentContext = {}
} = {}) {
  if (!config?.llm?.baseUrl || !config?.llm?.apiKey || !config?.llm?.model) {
    return { accepted: false, source: 'fallback', reason: 'LLM is not configured', skipFriendLlm: false };
  }

  const profilePrompt = formatProfileSummaryForPrompt(profile);
  const messages = [
    {
      role: 'system',
      content: [
        '你是 AI 电台灿灿的轻量意图路由器，只判断这一轮该聊天还是该切歌，不负责写聊天回复，也不负责选歌。',
        '必须只输出 JSON，不要 Markdown，不要解释。',
        'action 只能是：chat_only、ask_followup、recommend_and_play、continue_current_song。',
        '普通聊天、问观点、问歌手喜好、问知识，不要切歌；明确点歌、换歌、要求某风格/歌手/歌曲，才 recommend_and_play。',
        '带有“放/来点/想听/推荐/给我”这类播放动作，并且目标是歌、音乐、BGM、歌手、风格、场景或曲风时，必须 recommend_and_play。',
        '用户情绪表达但没有明确要音乐时，通常 ask_followup；只有上下文显示适合自然接歌且允许主动推荐时，才 recommend_and_play。',
        '如果只是“你喜欢陈奕迅吗/你觉得这首歌如何”，这是聊天，不是点歌。',
        '输出字段：{"action":"...","confidence":0-1,"mood":"comfort|melancholy|calm|healing|focus|energy|romantic|nostalgic|night|random","energy":"low|medium|high","musicIntent":"none|explicit_song|artist|genre|mood|skip|playback_control","searchHints":["关键词"],"reason":"简短中文理由"}'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `听众刚说：${userMessage}`,
        `最近对话：${history.slice(-8).map(h => `${h.role}: ${h.content}`).join('\n') || '无'}`,
        `当前歌曲：${getCurrentTrackPromptContext(userMessage, currentTrack)}`,
        `听众画像：${profilePrompt}`,
        `当前模式：${mode?.genre || '无'}`,
        `偏好设置：${JSON.stringify(normalizeRuntimePrefs(prefs))}`,
        `长期记忆：${memoryContext.promptText || '无'}`,
        `会话摘要：${memoryContext.sessionSummary || '无'}`,
        `APP_TIME_CONTEXT：${formatEnvironmentContext(environmentContext)}`,
        '时间天气只是事实锚点，不要从历史对话把当前时段误判成晚上；如果用户当前没有明确说夜晚/睡不着，就以 APP_TIME_CONTEXT 为准。',
        `启发式情绪：${JSON.stringify(baseMood)}`,
        `本地显式音乐意图：${explicitIntent}`,
        `允许主动推荐：${canSuggest}`
      ].join('\n')
    }
  ];
  messages[0].content += '\nFor explicit style/use requests, also output styleConstraint and searchQueries. styleConstraint format: {"strict":true,"requiredGroups":[["termA","termB"],["termC"]],"softTerms":["term"],"negativeTerms":["term"],"searchQueries":["short music query"]}. Example: guofeng DJ ni xi BGM => requiredGroups [["国风","古风","中国风"],["DJ","remix","电音","BGM"]], softTerms ["逆袭","燃","力量","短视频"]. For ordinary emotional chat, strict must be false or omitted.';

  const raw = await withTimeout(
    generateChatCompletion(config.llm, messages, () => INTENT_FALLBACK_SENTINEL),
    INTENT_LLM_TIMEOUT_MS,
    INTENT_FALLBACK_SENTINEL
  );

  if (raw === INTENT_FALLBACK_SENTINEL) {
    return { accepted: false, source: 'fallback', reason: 'intent classifier unavailable or timed out', skipFriendLlm: false };
  }

  try {
    const parsed = parseIntentDecision(raw);
    const action = normalizeIntentAction(parsed.action);
    const confidence = Number(parsed.confidence);
    if (!action || !Number.isFinite(confidence) || confidence < 0.55) {
      return {
        accepted: false,
        source: 'fallback',
        reason: 'intent classifier returned low confidence or invalid action',
        candidate: parsed,
        skipFriendLlm: false
      };
    }
    const styleConstraint = normalizeStyleConstraint(parsed.styleConstraint, {
      text: userMessage,
      mode,
      searchQueries: [
        ...(Array.isArray(parsed.searchQueries) ? parsed.searchQueries : []),
        ...((parsed.styleConstraint && Array.isArray(parsed.styleConstraint.searchQueries)) ? parsed.styleConstraint.searchQueries : [])
      ]
    });
    const normalizedMood = normalizeMoodDecision({
      mood: parsed.mood,
      energy: parsed.energy,
      intent: action === TURN_ACTIONS.RECOMMEND_AND_PLAY ? 'music' : 'chat',
      musicIntent: parsed.musicIntent || 'none',
      searchHints: Array.isArray(parsed.searchHints) ? parsed.searchHints : [],
      reason: parsed.reason,
      confidence,
      styleConstraint: action === TURN_ACTIONS.RECOMMEND_AND_PLAY ? styleConstraint : null,
      styleSearchQueries: action === TURN_ACTIONS.RECOMMEND_AND_PLAY ? (styleConstraint?.searchQueries || []) : []
    });
    return {
      ...normalizedMood,
      accepted: true,
      action,
      confidence,
      source: 'llm',
      reason: parsed.reason || 'LLM intent classifier',
      searchHints: normalizedMood.searchHints,
      musicIntent: parsed.musicIntent || normalizedMood.musicIntent || 'none',
      styleConstraint: normalizedMood.styleConstraint,
      styleSearchQueries: normalizedMood.styleSearchQueries
    };
  } catch (error) {
    return {
      accepted: false,
      source: 'fallback',
      reason: `intent classifier JSON parse failed: ${error.message}`,
      skipFriendLlm: false
    };
  }
}

function parseIntentDecision(raw) {
  const text = stripCodeFence(String(raw || '')).trim();
  try {
    return JSON.parse(text);
  } catch {}
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) return JSON.parse(objectMatch[0]);
  throw new Error('intent decision is not JSON');
}

function normalizeIntentAction(action) {
  const value = String(action || '').trim().toLowerCase();
  const map = {
    chat_only: TURN_ACTIONS.CHAT_ONLY,
    chat: TURN_ACTIONS.CHAT_ONLY,
    ask_followup: TURN_ACTIONS.ASK_FOLLOWUP,
    followup: TURN_ACTIONS.ASK_FOLLOWUP,
    soft_offer_music: TURN_ACTIONS.SOFT_OFFER_MUSIC,
    recommend_and_play: TURN_ACTIONS.RECOMMEND_AND_PLAY,
    recommend_now: TURN_ACTIONS.RECOMMEND_AND_PLAY,
    play_music: TURN_ACTIONS.RECOMMEND_AND_PLAY,
    continue_current_song: TURN_ACTIONS.CONTINUE_CURRENT_SONG,
    playback_control: TURN_ACTIONS.CONTINUE_CURRENT_SONG
  };
  return map[value] || null;
}

function isImmediateNextRequest(text) {
  const value = String(text || '');
  if (/(?:先别|不要|别|不用|不必).{0,4}(?:切歌|换歌|换一首|下一首|跳过)/.test(value)) return false;
  if (isExplicitReplayRequest(value)) return true;
  return /下一首|换一首|换歌|切歌|跳过|skip|不想听(?:这首|这歌|这个版本|这版|它|当前|这一个)|这(?:首|歌|个版本|版).{0,8}不想听|换(?:他|她|它|这个歌手|这位歌手)?(?:的)?(?:另一首|别的|其他)/i.test(value);
}

function isPlaybackControlRequest(text) {
  return /暂停|停一下|继续播放|继续放|接着放|resume|pause/i.test(String(text || ''));
}

function modeUpdateFromText(text) {
  const value = String(text || '').trim();
  if (/恢复正常推荐|取消.*偏好|取消.*模式|恢复正常/.test(value)) return {};
  const match = value.match(/(?:后面|以后|接下来)(?:都|只)?听([^，。？！,.!?]{1,16})/);
  const genre = match?.[1]?.trim();
  return genre ? { genre, note: '用户指定' } : null;
}

export function analyzeTurnContext({ history = [], userMessage = '', profile = {}, currentTrack = null, mode = {}, prefs = {}, conversationState = {}, environmentContext = {} } = {}) {
  const normalizedPrefs = normalizeRuntimePrefs(prefs);
  let mood = applyMoodPreferenceOverride(
    analyzeConversationMood({ history, userMessage, profile, currentTrack, mode }),
    normalizedPrefs
  );
  if (mood.mood === 'night' && normalizedPrefs.moodMode !== 'night' && !hasCurrentNightSignal(userMessage) && !isNightTimeOfDay(environmentContext.timeOfDay)) {
    mood = {
      shouldRecommend: false,
      mood: 'random',
      energy: 'medium',
      intent: 'chat',
      searchHints: [],
      reason: 'ignored stale night signal from history'
    };
  }
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
  const normalizedPrefs = normalizeRuntimePrefs(prefs);
  const baseMood = !normalizedPrefs.moodMode || normalizedPrefs.moodMode === 'auto'
    ? mood
    : applyExplicitMoodMode(mood, normalizedPrefs);
  if (!normalizedPrefs.lowDistractionMode) return baseMood;
  const explicitMusic = ['explicit_music', 'explicit_song', 'artist', 'genre', 'music'].includes(baseMood.musicIntent || baseMood.intent);
  return {
    ...baseMood,
    mood: explicitMusic ? baseMood.mood : (baseMood.mood === 'night' ? 'night' : 'focus'),
    energy: explicitMusic ? baseMood.energy : 'low',
    searchHints: uniqueStrings(['低干扰', '安静', '专注', '轻柔', ...(baseMood.searchHints || [])], 5),
    reason: baseMood.reason || 'low distraction mode'
  };
}

function applyExplicitMoodMode(mood, prefs) {
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
  return extractSessionAvoidTerms(text);
}

export function parseSessionConstraintUpdate(text) {
  const value = String(text || '').trim();
  if (!value) return { type: 'none', avoidTerms: [], reset: false, changed: false };
  if (/(恢复正常推荐|取消.*(?:限制|禁听|不听|不要|别放|少放)|后面都听|以后都听|接下来都听)/.test(value)) {
    return { type: 'reset', avoidTerms: [], reset: true, changed: true };
  }
  const avoidTerms = extractSessionAvoidTerms(value);
  return avoidTerms.length
    ? { type: 'avoid', avoidTerms, reset: false, changed: true }
    : { type: 'none', avoidTerms: [], reset: false, changed: false };
}

export function normalizeSessionConstraints(input = {}) {
  const avoidTerms = uniqueStrings([
    ...(input.avoidTerms || []),
    ...(input.avoidArtists || []),
    ...(input.avoidSongs || [])
  ].map(cleanSessionConstraintTerm).filter(isUsefulSessionConstraintTerm), 12);
  return {
    avoidTerms,
    updatedAt: input.updatedAt || null
  };
}

export function applySessionConstraintUpdate(previous = {}, update = {}) {
  const current = normalizeSessionConstraints(previous);
  if (update.reset) return { avoidTerms: [], updatedAt: nowIso() };
  const nextTerms = uniqueStrings([
    ...current.avoidTerms,
    ...(update.avoidTerms || [])
  ].map(cleanSessionConstraintTerm).filter(isUsefulSessionConstraintTerm), 12);
  return {
    avoidTerms: nextTerms,
    updatedAt: nextTerms.join('|') === current.avoidTerms.join('|') ? current.updatedAt : nowIso()
  };
}

function sessionConstraintsEqual(a = {}, b = {}) {
  return normalizeSessionConstraints(a).avoidTerms.join('|') === normalizeSessionConstraints(b).avoidTerms.join('|');
}

function mergeSessionConstraintsIntoMood(mood = {}, sessionConstraints = {}) {
  const baseMood = mood && typeof mood === 'object' ? mood : {};
  const constraints = normalizeSessionConstraints(sessionConstraints);
  if (!constraints.avoidTerms.length) return normalizeMoodDecision(baseMood);
  const normalized = normalizeMoodDecision(baseMood);
  return normalizeMoodDecision({
    ...normalized,
    avoidHints: uniqueStrings([...(normalized.avoidHints || []), ...constraints.avoidTerms], 12)
  });
}

function extractSessionAvoidTerms(text) {
  const value = String(text || '');
  const terms = [];
  const pattern = /(?:后面|以后|接下来|之后|下面|本场|这场)?(?:都)?(?:不要再听|别再放|不要听|不再听|不听|不要|别放|少放|不想听|不喜欢)([^，。？！,.!?]{1,48})/g;
  let match = null;
  while ((match = pattern.exec(value))) {
    terms.push(...splitSessionConstraintTerms(match[1]));
  }
  return uniqueStrings(terms.map(cleanSessionConstraintTerm).filter(isUsefulSessionConstraintTerm), 12);
}

function splitSessionConstraintTerms(value) {
  return String(value || '')
    .replace(/(?:的)?(?:这个歌手|这位歌手|歌曲|歌手|作品|音乐|艺人|这类|这种|这些|歌)$/g, '')
    .split(/(?:和|跟|与|及|还有|以及|、|，|,|\/|&|\+|\s+)/)
    .map(cleanSessionConstraintTerm)
    .filter(Boolean);
}

function cleanSessionConstraintTerm(value) {
  return String(value || '')
    .replace(/[《》"'“”‘’]/g, '')
    .replace(/^(后面|以后|接下来|之后|下面|本场|这场|都|再|给我|帮我|请|不听|不要|别放|少放|不想听|不喜欢)+/g, '')
    .replace(/(?:的)?(?:这个歌手|这位歌手|歌曲|歌手|作品|音乐|艺人|这类|这种|这些|歌|了|吧|啦|哈)+$/g, '')
    .trim();
}

function isUsefulSessionConstraintTerm(value) {
  const normalized = normalizeMusicText(value);
  if (normalized.length < 2 || normalized.length > 24) return false;
  return !/^(这首|这歌|这个|这个版本|这版|当前|当前这首|现在这首|这一首|它|他|她|音乐|歌曲|歌)$/.test(value);
}

function getSessionConstraintsFromContext(context = {}) {
  return normalizeSessionConstraints(context.sessionConstraints || {});
}

function formatSessionConstraintsForPrompt(sessionConstraints = {}) {
  const constraints = normalizeSessionConstraints(sessionConstraints);
  return constraints.avoidTerms.length
    ? `本场禁听：${constraints.avoidTerms.join('、')}。这些歌手或歌名都不能推荐，也不能作为兜底歌曲。`
    : '本场禁听：无。';
}

function formatVocalPolicyForPrompt(request = {}) {
  if (!requestRequiresInstrumental(request)) return '人声约束：无';
  return '人声约束：只能推荐纯音乐/伴奏/无人声/无歌词作品。这是硬约束；候选 reason 或 queries 应明确写出“纯音乐、伴奏、无人声、钢琴、器乐、OST、BGM、instrumental”等证据；找不到时不要用普通人声歌曲兜底。';
}

export function trackViolatesSessionConstraints(track = {}, sessionConstraints = {}) {
  const terms = normalizeSessionConstraints(sessionConstraints).avoidTerms
    .map(normalizeMusicText)
    .filter(term => term.length >= 2);
  if (!terms.length) return false;
  const searchable = [
    track?.name,
    stripSongVersion(track?.name),
    ...(Array.isArray(track?.artists) ? track.artists : []),
    track?.album
  ].map(normalizeMusicText).filter(Boolean).join(' ');
  return terms.some(term => searchable.includes(term));
}

function songPickViolatesSessionConstraints(pick = {}, sessionConstraints = {}) {
  return trackViolatesSessionConstraints({
    name: pick?.name,
    artists: normalizeArtistList(pick?.artists || [])
  }, sessionConstraints);
}

function rejectsMusic(text) {
  const value = String(text || '');
  if (isImmediateNextRequest(value)) return false;
  return /不想听(?:歌|音乐)|先别放|不要放|别放|先别切|不要切|别切|别换|先聊|陪我聊|不放歌|只是聊/.test(value);
}

function isModeUpdateRequest(text) {
  return /恢复正常推荐|取消.*偏好|取消.*模式|恢复正常|后面都听|以后都听|接下来都听/.test(String(text || ''));
}

async function generateFriendReply({ config, profile, mode, prefs = {}, history, userMessage, currentTrack, baseMood, explicitIntent, canSuggest, memoryContext = {}, turnAction = null, skipLlm = false, environmentContext = {} }) {
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
  const profilePrompt = formatProfileSummaryForPrompt(profile);

  const messages = [
    {
      role: 'system',
      content: [
        '你是灿灿，一个聪明、自然、熟悉感很强的 AI 朋友，同时也是私人电台 DJ。',
        buildCanCanPersonaPrompt(userMessage),
        '这一轮是普通聊天回复，不负责选歌。请像网页版大模型聊天一样，先直接回答用户这句话本身。',
        'chatText 只能写灿灿直接对听众说出口的话，用第一人称“我”自然回复；不要写小说旁白、舞台指示、动作描写、表情描写、心理活动或音效。',
        '禁止输出类似“灿灿轻轻笑了”“她顿了顿”“声音里带着”“耳机里传来”“像她在认真消化”这样的第三人称描写；也不要用括号、星号或“灿灿：”标注动作。',
        '你可以表达自己的判断、喜好和理由，不要只做情绪复述；用户问“你喜欢 X 吗”，就直接说喜欢/不喜欢/为什么。',
        '不要把所有话题都拉回音乐；只有用户主动聊到音乐、歌手、当前歌曲时，才自然聊音乐。',
        '不要使用固定陪伴模板，不要突然说“我在这里”“我陪你”“不用马上睡着/振作”。这些话只有用户明确痛苦、失眠、崩溃时才可少量使用。',
        '回复长度按内容决定：问候 20-50 字，普通聊天 50-140 字，复杂问题或认真倾诉可以 120-260 字。',
        '如果需要提问，每次最多一个自然的问题；更重要的是先回应用户已经说出的内容。',
        '当前歌曲只用于背景判断；除非用户主动问当前歌曲、歌词、歌名或艺人，不要提及歌名、艺人、歌词或“正在播放”。',
        '当当前动作是 CHAT_ONLY 或 ASK_FOLLOWUP 时，本轮不会返回 track；不要主动输出具体歌名、艺人名、歌词，也不要说“让某首歌陪你”。可以说“把声音放轻一点”“让氛围慢下来”，但不要点名歌曲。',
        '时间天气只是事实背景，不是每句都要说。普通聊天不要主动用时间天气开头；只有用户主动问，或和当前话题自然相关时才轻描淡写提一下。',
        '如果提到当前时间、上午下午或天气，必须严格以 APP_TIME_CONTEXT 为准；不要根据历史对话把当前时段改成晚上，也不要编造未来天气。',
        turnActionInstruction(turnAction),
        '输出 JSON：{"chatText":"按语境长度生成的自然温柔回复","mood":"comfort|melancholy|calm|healing|focus|energy|romantic|nostalgic|night|random","energy":"low|medium|high","intent":"chat|mood","searchHints":["2-6字关键词"],"reason":"简短理由","mode":null或"reset"或偏好名}'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `听众画像：${profilePrompt}`,
        `当前模式：${mode?.genre || '无'}`,
        `用户聊天/音乐偏好设置：${JSON.stringify(normalizeRuntimePrefs(prefs))}`,
        normalizeRuntimePrefs(prefs).note ? `用户补充偏好：${normalizeRuntimePrefs(prefs).note}` : '用户补充偏好：无',
        `当前歌曲：${currentTrackContext}`,
        memoryContext.promptText || '相关长期记忆：无',
        memoryContext.sessionSummary ? `本轮会话摘要：${memoryContext.sessionSummary}` : '本轮会话摘要：无',
        `APP_TIME_CONTEXT：${formatEnvironmentContext(environmentContext)}`,
        `当前动作：${turnAction?.action || TURN_ACTIONS.CHAT_ONLY}`,
        `动作理由：${turnAction?.reason || ''}`,
        `启发式情绪：${JSON.stringify(baseMood)}`,
        `允许主动推荐：${canSuggest}`,
        `明确音乐意图：${explicitIntent}`,
        `最近对话：${history.slice(-10).map(h => `${h.role}: ${h.role === 'assistant' ? sanitizeSpokenChatText(h.content, '') : h.content}`).join('\n')}`,
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
      chatText: sanitizeSpokenChatText(parsed.chatText, fallback().chatText),
      newMode: parsed.mode === 'reset' ? {} : (parsed.mode && typeof parsed.mode === 'string' ? { genre: parsed.mode, note: '用户指定' } : null)
    };
  } catch {
    const plain = stripCodeFence(String(raw || '')).trim();
    if (plain && plain !== JSON.stringify(fallback())) {
      return {
        ...fallback(),
        chatText: sanitizeSpokenChatText(plain.slice(0, 500), fallback().chatText)
      };
    }
    return fallback();
  }
}

export function sanitizeSpokenChatText(value, fallbackText = '') {
  const original = stripCodeFence(String(value || '')).trim();
  const fallback = String(fallbackText || '').trim();
  if (!original) return fallback;

  let text = original
    .replace(/^\s*灿灿\s*[：:]\s*/gm, '')
    .trim();

  const hasRoleplayNarration = /灿灿(?:听完|轻轻|没有立刻|沉默|笑|眨|顿|低|抬|看|开口)|耳机里|电流声|声音里|语气里|表情|眼神|内心|心里|像她在认真|她(?:轻轻|顿了顿|听完|没有立刻|沉默|笑了一下|开口)/.test(text);
  if (!hasRoleplayNarration) return text;

  const quotedSegments = [];
  const quotePattern = /[“"]([^“”"\n]{2,500})[”"]/g;
  for (const match of text.matchAll(quotePattern)) {
    const segment = String(match[1] || '').trim();
    if (segment) quotedSegments.push(segment);
  }
  const quotedText = quotedSegments.join('\n').trim();
  if (quotedText.length >= 20 && quotedSegments.length >= 2) {
    return quotedText || fallback;
  }

  const narrationLinePatterns = [
    /^灿灿(?:听完|轻轻|没有立刻|先是|沉默|愣|笑|眨|点|低|抬|看|把|像|在|顿|开口|小声|温柔地|认真地|歪|托|翻|读|望|摘|戴|调整|坐|靠)/,
    /^(?:然后|接着|过了一会儿|这时)?她(?:轻轻|听完|没有立刻|先是|沉默|愣|笑|眨|点|低|抬|看|把|像|在|顿|开口|小声|温柔地|认真地|歪|托|翻|读|望|摘|戴|调整|坐|靠)/,
    /^(?:耳机|屏幕|蓝紫色|霓虹|电流声|背景|空气).*(?:传来|响|闪|亮|浮|晃|铺开)/,
    /^(?:声音|语气|表情|眼神|内心|心里).*(?:带着|有|像|变得|泛起|写着)/,
    /^(?:然后|接着|过了一会儿|这时).*?(?:声音|语气|表情|眼神|笑|顿|说).*[：:]?$/,
    /^[（(].*(?:笑|停顿|沉默|眨眼|内心|心理|旁白).*[）)]$/,
    /^\*.*(?:笑|停顿|沉默|眨眼|内心|心理|旁白).*\*$/
  ];

  const spokenLines = text
    .split(/\n+/)
    .map(line => line.trim().replace(/^\*+|\*+$/g, '').trim())
    .filter(Boolean)
    .filter(line => !narrationLinePatterns.some(pattern => pattern.test(line)))
    .map(line => line.replace(/^["“]+/, '').replace(/["”]+$/, '').trim())
    .filter(Boolean);

  return spokenLines.join('\n').trim() || fallback;
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

function sanitizeNoTrackChatText({ text = '', userMessage = '', baseMood = {}, turnAction = null } = {}) {
  const value = sanitizeSpokenChatText(text, fallbackFriendChat(userMessage, baseMood, turnAction));
  if (!value || canMentionSpecificSongInChat(userMessage)) return value;
  if (!/《[^》]{1,48}》/.test(value)) return value;
  return fallbackNoNamedSongChat(userMessage, baseMood, turnAction);
}

function canMentionSpecificSongInChat(userMessage = '') {
  const text = String(userMessage || '');
  return /当前.*(歌|音乐)|现在.*(放|播|听).*什么|这首歌|这歌|歌名|谁唱|歌词|艺人|专辑|什么歌|哪首歌/.test(text);
}

function fallbackNoNamedSongChat(userMessage = '', mood = {}, turnAction = null) {
  const text = String(userMessage || '').trim();
  if (/睡觉|准备睡|睡了|晚安|困|犯困|眼睛睁不开/.test(text)) {
    return '好，那就把节奏放轻一点。你不用急着跟我说话，慢慢把眼睛闭上，先让自己松下来。晚安。';
  }
  return fallbackFriendChat(userMessage, mood, turnAction);
}

function normalizeMoodDecision(input = {}) {
  const mood = MOODS.has(input.mood) ? input.mood : 'random';
  const hints = Array.isArray(input.searchHints) ? input.searchHints : [];
  const styleConstraint = normalizeStyleConstraint(input.styleConstraint, {
    searchQueries: input.styleSearchQueries || input.searchQueries || []
  });
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
    vocalPolicy: normalizeVocalPolicy(input.vocalPolicy),
    styleConstraint,
    styleSearchQueries: styleConstraint?.searchQueries || [],
    confidence: Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : undefined
  };
}

export function normalizeMusicContext(input = {}) {
  const mood = normalizeMoodDecision(input);
  return {
    version: Number.isFinite(Number(input.version)) ? Number(input.version) : 0,
    mood: mood.mood,
    energy: mood.energy,
    searchHints: uniqueStrings(mood.searchHints || [], 8),
    preferenceHints: uniqueStrings(input.preferenceHints || mood.preferenceHints || [], 8),
    avoidHints: uniqueStrings(input.avoidHints || mood.avoidHints || [], 8),
    musicIntent: input.musicIntent || mood.musicIntent || 'chat',
    vocalPolicy: normalizeVocalPolicy(input.vocalPolicy || mood.vocalPolicy),
    styleConstraint: mood.styleConstraint || normalizeStyleConstraint(input.styleConstraint, { searchQueries: input.styleSearchQueries || [] }),
    styleSearchQueries: uniqueStrings(input.styleSearchQueries || mood.styleSearchQueries || mood.styleConstraint?.searchQueries || [], 8),
    confidence: Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : (mood.confidence ?? 0.45),
    reason: input.reason || mood.reason || '',
    lastUserMessage: String(input.lastUserMessage || '').slice(0, 180),
    updatedAt: input.updatedAt || nowIso()
  };
}

function nextMusicContext(previous = {}, analysis = {}, userMessage = '') {
  const normalizedPrevious = normalizeMusicContext(previous);
  const normalizedAnalysis = normalizeMoodDecision(analysis);
  const messageVocalPolicy = detectVocalPolicyUpdate(userMessage);
  return normalizeMusicContext({
    ...normalizedPrevious,
    ...normalizedAnalysis,
    version: normalizedPrevious.version + 1,
    searchHints: uniqueStrings([
      ...(normalizedAnalysis.searchHints || []),
      ...(normalizedPrevious.searchHints || [])
    ], 8),
    preferenceHints: uniqueStrings([
      ...(normalizedAnalysis.preferenceHints || []),
      ...(normalizedPrevious.preferenceHints || [])
    ], 8),
    avoidHints: uniqueStrings([
      ...(normalizedAnalysis.avoidHints || []),
      ...(normalizedPrevious.avoidHints || [])
    ], 8),
    musicIntent: normalizedAnalysis.musicIntent || normalizedPrevious.musicIntent || 'chat',
    vocalPolicy: messageVocalPolicy !== null
      ? messageVocalPolicy
      : (normalizedAnalysis.vocalPolicy || normalizedPrevious.vocalPolicy || ''),
    styleConstraint: normalizedAnalysis.styleConstraint || normalizedPrevious.styleConstraint || null,
    styleSearchQueries: uniqueStrings([
      ...(normalizedAnalysis.styleSearchQueries || []),
      ...(normalizedPrevious.styleSearchQueries || [])
    ], 8),
    confidence: normalizedAnalysis.confidence ?? normalizedPrevious.confidence,
    reason: normalizedAnalysis.reason || normalizedPrevious.reason || '',
    lastUserMessage: userMessage || normalizedPrevious.lastUserMessage || '',
    updatedAt: nowIso()
  });
}

function hasConsumedUserMusicContext(sessionContext = {}, musicContext = {}) {
  const context = normalizeMusicContext(musicContext);
  if (!context.lastUserMessage || !context.version) return false;
  return Number(sessionContext.lastBoundMusicContextVersion || 0) >= Number(context.version || 0);
}

function softenConsumedMusicContext(musicContext = {}) {
  const context = normalizeMusicContext(musicContext);
  return normalizeMusicContext({
    ...context,
    lastUserMessage: '',
    reason: '',
    musicIntent: context.musicIntent === 'explicit_music' ? 'mood_signal' : context.musicIntent
  });
}

function getEffectiveMusicContextForRecommendation(sessionContext = {}, { userMessage = '' } = {}) {
  const context = normalizeMusicContext(sessionContext.musicContext || {});
  if (userMessage) return context;
  return hasConsumedUserMusicContext(sessionContext, context) ? softenConsumedMusicContext(context) : context;
}

function getEffectiveMusicContextForHost(sessionContext = {}, musicContext = {}) {
  const context = normalizeMusicContext(musicContext || sessionContext.musicContext || {});
  return hasConsumedUserMusicContext(sessionContext, context) ? softenConsumedMusicContext(context) : context;
}

function moodFromMusicContext(context = {}) {
  const musicContext = normalizeMusicContext(context);
  return normalizeMoodDecision({
    shouldRecommend: musicContext.musicIntent !== 'chat' && musicContext.musicIntent !== 'suppressed',
    mood: musicContext.mood,
    energy: musicContext.energy,
    intent: musicContext.musicIntent === 'explicit_music' ? 'music' : 'mood',
    searchHints: musicContext.searchHints,
    preferenceHints: musicContext.preferenceHints,
    avoidHints: musicContext.avoidHints,
    musicIntent: musicContext.musicIntent,
    vocalPolicy: musicContext.vocalPolicy,
    confidence: musicContext.confidence,
    reason: musicContext.reason
  });
}

export function decideQueuePolicy({ analysis = {}, turnAction = {}, currentQueueItem = null } = {}) {
  const mood = normalizeMoodDecision(analysis);
  if (mood.musicIntent === 'suppressed' || turnAction?.reason === 'user explicitly rejected playback or switching') {
    return { action: RADIO_QUEUE_POLICIES.CLEAR, reason: 'user suppressed music' };
  }
  if (mood.musicIntent === 'explicit_music') {
    return { action: RADIO_QUEUE_POLICIES.HARD_PREEMPT, reason: 'explicit music request' };
  }
  if (turnAction?.action === TURN_ACTIONS.RECOMMEND_AND_PLAY && mood.intent === 'music') {
    return { action: RADIO_QUEUE_POLICIES.HARD_PREEMPT, reason: 'recommend action' };
  }
  if (mood.musicIntent === 'mood_signal' && (mood.confidence ?? 0) >= 0.65) {
    const matches = currentQueueItem ? queueItemMatchesMusicContext(currentQueueItem, mood) : false;
    return {
      action: matches ? RADIO_QUEUE_POLICIES.REFRESH_TAIL : RADIO_QUEUE_POLICIES.SOFT_PREEMPT,
      reason: matches ? 'ready queue still matches mood' : 'strong mood shift'
    };
  }
  return { action: RADIO_QUEUE_POLICIES.REFRESH_TAIL, reason: 'ordinary chat updates future queue' };
}

export function queueItemMatchesMusicContext(item = {}, musicContext = {}) {
  if (!item?.track?.id) return false;
  const itemContext = normalizeMusicContext(item.contextSnapshot || {});
  const target = normalizeMusicContext(musicContext || {});
  if (target.musicIntent === 'explicit_music') return false;
  if (target.vocalPolicy === VOCAL_POLICIES.INSTRUMENTAL_ONLY &&
      itemContext.vocalPolicy !== VOCAL_POLICIES.INSTRUMENTAL_ONLY) return false;
  if (queueItemConflictsWithAvoidHints(item, target)) return false;
  if (itemContext.energy === 'high' && target.energy === 'low') return false;
  if (itemContext.energy === 'low' && target.energy === 'high') return false;
  if (target.mood !== 'random' && itemContext.mood !== 'random' && target.mood !== itemContext.mood) {
    const compatible = new Set([
      'comfort:calm',
      'calm:comfort',
      'night:calm',
      'calm:night',
      'healing:comfort',
      'comfort:healing'
    ]);
    if (!compatible.has(`${itemContext.mood}:${target.mood}`)) return false;
  }
  const itemHints = new Set((itemContext.searchHints || []).map(normalizeMusicText).filter(Boolean));
  const targetHints = (target.searchHints || []).map(normalizeMusicText).filter(Boolean);
  if (targetHints.length && itemHints.size && !targetHints.some(hint => itemHints.has(hint))) {
    return false;
  }
  return true;
}

function queueItemConflictsWithAvoidHints(item = {}, musicContext = {}) {
  const avoidHints = (musicContext.avoidHints || []).map(normalizeMusicText).filter(Boolean);
  if (!avoidHints.length) return false;
  const track = item.track || {};
  const itemContext = normalizeMusicContext(item.contextSnapshot || {});
  const searchable = [
    track.name,
    stripSongVersion(track.name),
    ...(Array.isArray(track.artists) ? track.artists : []),
    track.album,
    ...(itemContext.searchHints || []),
    ...(itemContext.preferenceHints || [])
  ].map(normalizeMusicText).filter(Boolean).join(' ');
  if (!searchable) return false;
  return avoidHints.some(hint => hint.length >= 2 && searchable.includes(hint));
}

function applyQueuePolicyToSession({ db, config, netease, sessionId, queuePolicy = {}, musicContext = {}, currentTrack = null, accountContext = null }) {
  const account = normalizeAccountContext(accountContext);
  const action = queuePolicy?.action || RADIO_QUEUE_POLICIES.REFRESH_TAIL;
  if (action === RADIO_QUEUE_POLICIES.CLEAR) {
    clearRadioQueue(db, sessionId);
    return;
  }
  const queue = getSessionQueue(db, sessionId);
  const hasActiveRadioContext = Boolean(currentTrack?.id) || queue.length > 0;
  if (!hasActiveRadioContext) return;
  if (action === RADIO_QUEUE_POLICIES.HARD_PREEMPT) {
    updateQueueMetrics(db, sessionId, { hardPreemptCount: 1 });
    scheduleRadioQueueFill({
      db,
      config,
      netease,
      sessionId,
      reason: queuePolicy.reason || 'hard_preempt',
      preemptReason: inferPreemptReason(queuePolicy, musicContext),
      preempt: true,
      force: true,
      contextSnapshot: musicContext,
      accountContext: account
    });
    return;
  }
  if (action === RADIO_QUEUE_POLICIES.SOFT_PREEMPT) {
    const head = firstReadyQueueItem(queue);
    if (!head || !queueItemMatchesMusicContext(head, musicContext)) {
      updateQueueMetrics(db, sessionId, { softPreemptCount: 1 });
      scheduleRadioQueueFill({
        db,
        config,
        netease,
        sessionId,
        reason: queuePolicy.reason || 'soft_preempt',
        preemptReason: inferPreemptReason(queuePolicy, musicContext),
        preempt: true,
        force: true,
        contextSnapshot: musicContext,
        accountContext: account
      });
    }
  }
}

function inferPreemptReason(queuePolicy = {}, musicContext = {}) {
  if (queuePolicy.reason === 'mode_change') return 'mode_change';
  if (musicContext.musicIntent === 'explicit_music') return 'explicit_music';
  if (musicContext.musicIntent === 'feedback') return 'feedback_change';
  if (musicContext.musicIntent === 'mood_signal') return 'mood_shift';
  if (queuePolicy.action === RADIO_QUEUE_POLICIES.HARD_PREEMPT) return 'explicit_music';
  if (queuePolicy.action === RADIO_QUEUE_POLICIES.SOFT_PREEMPT) return 'mood_shift';
  return queuePolicy.reason || 'context_change';
}

function buildQueuePreemptReply({ userMessage = '', conversationMood = {}, queuePolicy = {} } = {}) {
  const hints = uniqueStrings([
    ...(conversationMood.searchHints || []),
    ...(conversationMood.preferenceHints || [])
  ], 2);
  if (hints.length) {
    return `好，我把下一首先按「${hints.join('、')}」这个方向换掉。现在这首不用硬切，等它接上时会更贴近你刚刚说的感觉。`;
  }
  if (conversationMood.musicIntent === 'explicit_music') {
    return '好，我把下一首按你刚说的要求重新排到最前面。现在这首先不断掉，等下一首接上。';
  }
  return queuePolicy.reason === 'strong mood shift'
    ? '我听到了，这个状态变化挺明显的。下一首我会先往新的情绪方向调，不让队列继续按旧感觉走。'
    : '好，我把下一首重新调整到更贴近你刚刚说的方向。';
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
  if (/开心|高兴|爽|激动|兴奋|松一口气|成就感|完成|做完|搞定|解决|通过|成功|结束/.test(text) &&
      /任务|作业|项目|难做|很难|终于|完成|做完|搞定|解决|通过|成功|结束/.test(text)) {
    return '这真的值得开心一下。一个很难的任务终于做完，那种松一口气的感觉很爽，先让自己好好享受这几分钟。';
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
    ? '我听到了。你可以按自己的节奏继续说，我会顺着你刚才的话接。'
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

function buildRadioHostContext(db, sessionId, context = {}, userMessage = '', accountContext = null) {
  const account = normalizeAccountContext(accountContext);
  return {
    isFirstRadioTurn: !context.radioIntroDone,
    radioTurnCount: Number(context.radioTurnCount || 0),
    trigger: inferRadioTrigger(userMessage),
    recentPlays: getRecentHostPlays(db, 4, account),
    recentFeedback: getRecentSessionFeedback(db, sessionId, 6, account)
  };
}

function getPlayedTrackHistory(db, sessionId, limit = 80, accountContext = null) {
  const account = normalizeAccountContext(accountContext);
  const seen = new Set();
  const items = [];
  const add = (play) => {
    const id = String(play?.track_id || play?.trackId || play?.id || '').trim();
    const name = String(play?.name || '').trim();
    if (!id && !name) return;
    const key = playedSongKey(name) || id;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      id,
      name,
      artists: Array.isArray(play.artists) ? play.artists : [],
      album: play.album || '',
      playedAt: play.played_at || play.playedAt || ''
    });
  };

  try {
    const context = getSessionContext(db, sessionId);
    for (const item of context.radioPlayedSongs || []) add(item);
  } catch {}

  try {
    if (sessionId) {
      db.prepare(`
        SELECT p.track_id AS trackId,
               p.played_at AS playedAt,
               t.name,
               t.artists,
               t.album
        FROM plays p
        JOIN tracks t ON t.id = p.track_id
        WHERE p.track_id IN (
          SELECT track_id FROM plays WHERE account_id = ? ORDER BY played_at DESC LIMIT 300
        )
        AND p.account_id = ?
        ORDER BY p.played_at DESC
        LIMIT ?
      `).all(account.accountId, account.accountId, limit).forEach(row => add({
        ...row,
        id: row.trackId,
        artists: safeJsonArray(row.artists)
      }));
    }
  } catch {}

  try {
    listRecentPlays(db, limit, account.accountId).forEach(add);
  } catch {}

  return items.slice(0, limit);
}

function mergePlayedTrackHistory(baseHistory = [], extraTracks = [], limit = 80) {
  const merged = [];
  const seen = new Set();
  const add = (track = {}) => {
    const key = playedSongKey(track.name) || String(track.id || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push({
      id: String(track.id || track.trackId || ''),
      name: String(track.name || ''),
      artists: Array.isArray(track.artists) ? track.artists : [],
      album: track.album || '',
      playedAt: track.playedAt || track.played_at || ''
    });
  };
  for (const track of extraTracks || []) add(track);
  for (const track of baseHistory || []) add(track);
  return merged.slice(0, limit);
}

function mergePlayedSongContext(existing = [], track = {}) {
  const key = playedSongKey(track?.name);
  if (!key) return Array.isArray(existing) ? existing.slice(0, 80) : [];
  const item = {
    id: String(track.id || ''),
    name: String(track.name || ''),
    artists: Array.isArray(track.artists) ? track.artists.slice(0, 4) : [],
    album: track.album || '',
    noveltyBucket: normalizeNoveltyBucket(track.noveltyBucket),
    discoverySource: track.discoverySource || null,
    recommendationSource: normalizeRecommendationSource(track.recommendationSource),
    key,
    playedAt: nowIso()
  };
  const merged = [item, ...(Array.isArray(existing) ? existing : [])]
    .filter(entry => playedSongKey(entry?.name) || entry?.key);
  const seen = new Set();
  const unique = [];
  for (const entry of merged) {
    const entryKey = entry.key || playedSongKey(entry.name);
    if (!entryKey || seen.has(entryKey)) continue;
    seen.add(entryKey);
    unique.push({ ...entry, key: entryKey });
  }
  return unique.slice(0, 80);
}

function buildPlayedSignatureSet(playedHistory = []) {
  return new Set((playedHistory || [])
    .map(track => track?.key || playedSongKey(track?.name))
    .filter(Boolean));
}

function playedSongKey(name) {
  return normalizeMusicText(stripSongVersion(name));
}

export function trackMatchesPlayedSongName(track, playedHistory = []) {
  const signatures = playedHistory instanceof Set ? playedHistory : buildPlayedSignatureSet(playedHistory);
  const key = playedSongKey(track?.name || track?.song || track?.title || '');
  return Boolean(key && signatures.has(key));
}

export function replayRequestAllowsPlayedSong(track, request = {}) {
  if (!requestAllowsRequestedSongReplay(request)) return false;
  const allowedKey = playedSongKey(request.songTitle);
  const trackKey = playedSongKey(track?.name || track?.song || track?.title || '');
  return Boolean(allowedKey && trackKey && allowedKey === trackKey);
}

function requestAllowsRequestedSongReplay(request = {}) {
  return Boolean(
    request?.songTitle &&
    (request.allowRequestedSongReplay || request.allowPlayedSongReplay)
  );
}

function inferRadioTrigger(userMessage = '') {
  const text = String(userMessage || '').trim();
  if (!text) return '启动电台或自动续播';
  if (/下一首|换一首|切歌|跳过|不喜欢/.test(text)) return '用户想换一首';
  if (/喜欢|好听|可以|不错/.test(text)) return '用户给了正向反馈';
  return `用户刚说：${text.slice(0, 80)}`;
}

function getRecentHostPlays(db, limit = 4, accountContext = null) {
  const account = normalizeAccountContext(accountContext);
  try {
    return listRecentPlays(db, limit, account.accountId).map(play => ({
      name: play.name,
      artists: Array.isArray(play.artists) ? play.artists : [],
      reason: play.reason || '',
      hostText: play.host_text || play.hostText || '',
      playedAt: play.played_at || play.playedAt || ''
    }));
  } catch {
    return [];
  }
}

function getRecentSessionFeedback(db, sessionId, limit = 6, accountContext = null) {
  const account = normalizeAccountContext(accountContext);
  try {
    return db.prepare(`
      SELECT e.event_type AS eventType,
             e.created_at AS createdAt,
             t.name,
             t.artists
      FROM track_feedback_events e
      LEFT JOIN tracks t ON t.id = e.track_id
      WHERE e.account_id = ? AND e.session_id = ?
      ORDER BY e.created_at DESC
      LIMIT ?
    `).all(account.accountId, String(sessionId || ''), limit).map(row => ({
      eventType: row.eventType,
      createdAt: row.createdAt,
      name: row.name || '',
      artists: safeJsonArray(row.artists)
    }));
  } catch {
    return [];
  }
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeJsonObject(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function scheduleMemoryExtraction({ db, config, sessionId, userMessage, assistantText, conversationMood, accountContext = null }) {
  if (!config?.llm?.baseUrl || !config?.llm?.apiKey || !config?.llm?.model) return;
  void extractAndStoreMemories({ db, config, sessionId, userMessage, assistantText, conversationMood, accountContext }).catch(() => {});
}

function rememberMoodEvent({ db, sessionId, conversationMood, accountContext = null, source = 'chat' } = {}) {
  if (!conversationMood?.mood) return;
  try {
    const account = normalizeAccountContext(accountContext);
    recordMoodEvent(db, {
      accountId: account.accountId,
      sessionId,
      mood: conversationMood.mood,
      energy: conversationMood.energy,
      musicIntent: conversationMood.musicIntent || conversationMood.intent,
      source
    });
  } catch {}
}

export async function extractAndStoreMemories({ db, config, sessionId, userMessage, assistantText = '', conversationMood = null, accountContext = null }) {
  const account = normalizeAccountContext(accountContext);
  if (!String(userMessage || '').trim()) return [];
  const existing = retrieveRelevantMemories(db, {
    accountId: account.accountId,
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
        accountId: account.accountId,
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

export function getRecommendationPipeline(config = {}) {
  const value = String(config?.recommendation?.pipeline || process.env.RECOMMENDATION_PIPELINE || '').trim().toLowerCase();
  return value === 'legacy' ? 'legacy' : 'hybrid';
}

export async function buildHybridCandidateContext({
  db,
  config = {},
  netease = null,
  sessionId = '',
  profile = {},
  mode = {},
  userMessage = '',
  conversationMood = null,
  request = {},
  playedIds = new Set(),
  playedSignatures = new Set(),
  accountContext = null,
  styleSearch = searchOnline
} = {}) {
  const pipeline = getRecommendationPipeline(config);
  const disabled = (reason, extra = {}) => ({
    enabled: false,
    reason,
    pipeline,
    candidates: [],
    candidateById: new Map(),
    promptText: '',
    debug: {
      pipeline,
      enabled: false,
      reason,
      totalCandidates: 0,
      promptCandidates: [],
      ...extra,
      updatedAt: nowIso()
    }
  });
  if (pipeline === 'legacy') return disabled('legacy_pipeline');
  if (request?.songTitle) return disabled('explicit_song_request');

  try {
    const account = normalizeAccountContext(accountContext);
    const familiarCandidates = buildLocalRecommendationCandidates({
      db,
      request,
      playedIds,
      playedSignatures,
      accountContext: account
    });
    const styleSearchResult = await buildStyleSearchCandidates({
      config,
      request,
      playedIds,
      playedSignatures,
      styleSearch
    });
    const discoveryResult = await buildDiscoveryRecommendationCandidates({
      db,
      config,
      netease,
      request,
      playedIds,
      playedSignatures,
      familiarCandidates,
      accountContext: account
    });
    const candidates = [...styleSearchResult.candidates, ...familiarCandidates, ...discoveryResult.candidates];
    if (!candidates.length) {
      return disabled('empty_candidate_pool', {
        familiarCount: 0,
        styleSearchCount: 0,
        styleQualifiedCount: 0,
        discoveryCount: 0,
        styleSearchFallbackReason: styleSearchResult.fallbackReason || null,
        discoveryFallbackReason: discoveryResult.fallbackReason || null
      });
    }

    const feedbackById = getFeedbackSummaryMap(db, candidates.map(candidate => candidate.track?.id), account.accountId);
    const strictStyleActive = styleConstraintIsActive(request.styleConstraint, config);
    const ranked = rankAndSelectCandidates(candidates, {
      quotas: strictStyleActive
        ? STYLE_SEARCH_QUOTAS
        : (discoveryResult.candidates.length ? HYBRID_DISCOVERY_QUOTAS : (userMessage || conversationMood?.searchHints?.length ? LOCAL_SEARCH_QUOTAS : LOCAL_AUTO_QUOTAS)),
      limit: Math.min(CANDIDATE_LIMIT, Math.max(HYBRID_PROMPT_CANDIDATE_LIMIT, candidates.length)),
      feedbackById,
      artistPenaltyByName: getArtistPenaltyByName(db, account),
      profile,
      mode,
      userMessage,
      conversationMood,
      styleConstraint: request.styleConstraint,
      seed: `${account.accountId}:${userMessage || conversationMood?.reason || nowIso().slice(0, 10)}`
    });
    const noveltyTarget = getNoveltyTarget({ db, sessionId, accountContext: account, config });
    const promptArtistLimit = getPromptArtistLimit(config, request);
    const promptSelection = strictStyleActive
      ? selectPromptCandidatesForStyle(ranked, {
          limit: HYBRID_PROMPT_CANDIDATE_LIMIT,
          discoveryRatio: getDiscoveryConfig(config).ratio,
          targetNoveltyBucket: noveltyTarget.targetNoveltyBucket,
          styleConstraint: request.styleConstraint,
          config,
          artistLimit: promptArtistLimit
        })
      : selectPromptCandidatesByNovelty(ranked, {
          limit: HYBRID_PROMPT_CANDIDATE_LIMIT,
          discoveryRatio: getDiscoveryConfig(config).ratio,
          targetNoveltyBucket: noveltyTarget.targetNoveltyBucket,
          artistLimit: promptArtistLimit
        });
    const promptCandidates = promptSelection.candidates;
    if (!promptCandidates.length) return disabled('empty_ranked_candidate_pool', { totalCandidates: candidates.length });

    const candidateById = new Map(promptCandidates.map(candidate => [candidateIdForTrack(candidate.track), candidate]));
    const debugCandidates = promptCandidates.slice(0, 12).map(sanitizeCandidateForDebug);
    const discoverySources = summarizeDiscoverySources(discoveryResult.candidates);
    const styleSearchSources = summarizeDiscoverySources(styleSearchResult.candidates);
    return {
      enabled: true,
      reason: strictStyleActive && styleSearchResult.candidates.length
        ? 'hybrid_style_candidate_pool'
        : (discoveryResult.candidates.length ? 'hybrid_balanced_candidate_pool' : 'hybrid_local_candidate_pool'),
      pipeline,
      candidates: promptCandidates,
      candidateById,
      promptText: strictStyleActive
        ? formatStyleHybridCandidatePrompt(promptCandidates, {
            styleConstraint: request.styleConstraint,
            targetNoveltyBucket: noveltyTarget.targetNoveltyBucket
          })
        : formatBalancedHybridCandidatePrompt(promptCandidates, {
            targetNoveltyBucket: noveltyTarget.targetNoveltyBucket
          }),
      debug: {
        pipeline,
        enabled: true,
        reason: strictStyleActive && styleSearchResult.candidates.length
          ? 'hybrid_style_candidate_pool'
          : (discoveryResult.candidates.length ? 'hybrid_balanced_candidate_pool' : 'hybrid_local_candidate_pool'),
        totalCandidates: candidates.length,
        familiarCount: familiarCandidates.length,
        styleConstraint: sanitizeStyleConstraintForDebug(request.styleConstraint),
        styleSearchQueries: request.styleSearchQueries || request.styleConstraint?.searchQueries || [],
        styleSearchCount: styleSearchResult.candidates.length,
        styleQualifiedCount: styleSearchResult.qualifiedCount || 0,
        promptStyleSearchCount: promptSelection.styleSearchCount || 0,
        discoveryCount: discoveryResult.candidates.length,
        rankedCandidates: ranked.length,
        promptLimit: HYBRID_PROMPT_CANDIDATE_LIMIT,
        promptFamiliarCount: promptSelection.familiarCount,
        promptDiscoveryCount: promptSelection.discoveryCount,
        discoveryUnderfilled: promptSelection.discoveryUnderfilled,
        familiarUnderfilled: promptSelection.familiarUnderfilled,
        artistLimit: promptSelection.artistLimit,
        artistLimitApplied: promptSelection.artistLimitApplied,
        artistLimitSkippedCount: promptSelection.artistLimitSkippedCount,
        promptArtistCounts: promptSelection.promptArtistCounts,
        targetNoveltyBucket: noveltyTarget.targetNoveltyBucket,
        noveltyWindow: noveltyTarget.window,
        discoverySources,
        styleSearchSources,
        styleSearchFallbackReason: styleSearchResult.fallbackReason || null,
        discoveryFallbackReason: discoveryResult.fallbackReason || null,
        promptCandidates: debugCandidates,
        updatedAt: nowIso()
      }
    };
  } catch (error) {
    return disabled('candidate_pool_error', { error: String(error?.message || error).slice(0, 180) });
  }
}

function buildLocalRecommendationCandidates({ db, request = {}, playedIds = new Set(), playedSignatures = new Set(), accountContext = null } = {}) {
  const account = normalizeAccountContext(accountContext);
  const candidates = new Map();
  const recentPlays = safeCall(() => listRecentPlays(db, 50, account.accountId), []);
  const recentArtistNames = new Set(recentPlays.flatMap(play => play.artists || []).map(normalizeMusicText).filter(Boolean));
  const explicitArtist = normalizeMusicText(request?.artistConstraint?.label || '');

  const addTrack = (track, source, sourceReason = '') => {
    if (!track?.id || !track?.name) return;
    if (!Array.isArray(track.artists) || !track.artists.length) return;
    if (explicitArtist && !trackArtistMatchesLabel(track, explicitArtist)) return;
    if (trackViolatesSessionConstraints(track, request.sessionConstraints)) return;
    if (trackViolatesVocalPolicy(track, request)) return;
    if (playedIds.has(String(track.id)) && !replayRequestAllowsPlayedSong(track, request)) return;
    if (trackMatchesPlayedSongName(track, playedSignatures) && !replayRequestAllowsPlayedSong(track, request)) return;

    const key = String(track.id);
    const artistRecent = (track.artists || []).some(artist => recentArtistNames.has(normalizeMusicText(artist)));
    const effectiveSource = artistRecent ? 'library_recent' : source;
    const reason = uniqueStrings([
      sourceReason,
      artistRecent ? '接近最近常听艺人' : '',
      track.playlistName ? `来自《${track.playlistName}》` : ''
    ], 4).join('；');
    const candidate = {
      track,
      source: effectiveSource,
      noveltyBucket: 'familiar',
      sourceReason: reason || (effectiveSource === 'library_recent' ? '最近常听相关' : '本地曲库画像')
    };
    const existing = candidates.get(key);
    if (!existing || sourcePriority(candidate.source) > sourcePriority(existing.source)) {
      candidates.set(key, candidate);
    }
  };

  for (const track of safeCall(() => listProfileFallbackTracks(db, LOCAL_CANDIDATE_LIMIT, account), [])) {
    addTrack(track, 'library_deep', track.playlistName ? `画像歌单《${track.playlistName}》` : '画像歌单');
  }
  for (const track of safeCall(() => listTracks(db, LOCAL_CANDIDATE_LIMIT), [])) {
    addTrack(track, 'library_deep', '本地曲库');
  }
  return [...candidates.values()];
}

async function buildStyleSearchCandidates({
  config = {},
  request = {},
  playedIds = new Set(),
  playedSignatures = new Set(),
  styleSearch = searchOnline
} = {}) {
  const styleConfig = getStyleSearchConfig(config);
  const empty = (fallbackReason, extra = {}) => ({
    candidates: [],
    fallbackReason,
    qualifiedCount: 0,
    ...extra
  });
  if (!styleConstraintIsActive(request.styleConstraint, config)) return empty('style_constraint_inactive');
  if (!styleConfig.limit) return empty('style_search_disabled');
  if (typeof styleSearch !== 'function') return empty('style_search_unavailable');

  const queries = normalizeStyleSearchQueries([
    ...(request.styleSearchQueries || []),
    ...(request.styleConstraint?.searchQueries || [])
  ]);
  if (!queries.length) return empty('no_style_search_queries');

  const perQueryLimit = Math.max(3, Math.min(10, Math.ceil(styleConfig.limit / Math.min(queries.length, 3))));
  const jobs = queries.slice(0, 3).map(query => ({
    source: 'style_search',
    query,
    run: () => styleSearch(query, perQueryLimit)
  }));
  const results = await Promise.all(jobs.map(job => runStyleSearchJob(job, styleConfig.timeoutMs)));
  const errors = results
    .filter(result => result.error || result.timedOut)
    .map(result => `${result.query}:${result.timedOut ? 'timeout' : result.error}`);
  const candidates = normalizeStyleSearchCandidates({
    results,
    request,
    playedIds,
    playedSignatures,
    limit: styleConfig.limit,
    config
  });
  return {
    candidates,
    qualifiedCount: candidates.filter(candidate => candidate.styleQualified).length,
    fallbackReason: candidates.length ? null : (errors[0] || 'no_style_search_candidates'),
    errors: errors.slice(0, 3)
  };
}

async function runStyleSearchJob(job, timeoutMs) {
  const guarded = Promise.resolve()
    .then(job.run)
    .then(response => ({
      source: job.source,
      query: job.query,
      records: extractRecords(response?.data ?? response),
      error: null,
      timedOut: false
    }))
    .catch(error => ({
      source: job.source,
      query: job.query,
      records: [],
      error: String(error?.message || error).slice(0, 120),
      timedOut: false
    }));
  return withTimeout(guarded, timeoutMs, {
    source: job.source,
    query: job.query,
    records: [],
    error: 'timeout',
    timedOut: true
  });
}

function normalizeStyleSearchCandidates({
  results = [],
  request = {},
  playedIds = new Set(),
  playedSignatures = new Set(),
  limit = STYLE_SEARCH_DEFAULT_LIMIT,
  config = {}
} = {}) {
  const candidates = new Map();
  const explicitArtist = normalizeMusicText(request?.artistConstraint?.label || '');

  const addTrack = (rawTrack, query) => {
    const track = normalizeDiscoveryTrack(rawTrack);
    if (!track?.id || !track?.name || !track.artists?.length) return;
    if (explicitArtist && !trackArtistMatchesLabel(track, explicitArtist)) return;
    if (trackViolatesSessionConstraints(track, request.sessionConstraints)) return;
    if (trackViolatesVocalPolicy(track, request)) return;
    if (playedIds.has(String(track.id)) && !replayRequestAllowsPlayedSong(track, request)) return;
    const signature = playedSongKey(track.name);
    if (signature && playedSignatures.has(signature) && !replayRequestAllowsPlayedSong(track, request)) return;
    const key = String(track.id);
    if (candidates.has(key)) return;
    const styleResult = getStyleConstraintResult(track, request.styleConstraint, config);
    candidates.set(key, {
      track,
      source: 'style_search',
      noveltyBucket: 'discovery',
      discoverySource: 'style_search',
      styleQualified: styleResult.accepted,
      styleConstraintResult: styleResult,
      sourceReason: query ? `style_search:${query}` : 'style_search'
    });
  };

  for (const result of results || []) {
    for (const record of result.records || []) {
      addTrack(record, result.query || '');
      if (candidates.size >= limit) break;
    }
    if (candidates.size >= limit) break;
  }

  return [...candidates.values()];
}

async function buildDiscoveryRecommendationCandidates({
  db,
  config = {},
  netease = null,
  request = {},
  playedIds = new Set(),
  playedSignatures = new Set(),
  familiarCandidates = [],
  accountContext = null
} = {}) {
  const discoveryConfig = getDiscoveryConfig(config);
  const empty = (fallbackReason, extra = {}) => ({
    candidates: [],
    fallbackReason,
    ...extra
  });
  if (discoveryConfig.ratio <= 0) return empty('discovery_disabled');
  if (!netease || (typeof netease.isConfigured === 'function' && !netease.isConfigured())) {
    return empty('netease_unconfigured');
  }

  const account = normalizeAccountContext(accountContext);
  const seedSongIds = getDiscoverySeedSongIds({ db, familiarCandidates, accountContext: account });
  const cacheKey = buildDiscoveryCacheKey({ account, seedSongIds });
  const cached = readDiscoveryCache(cacheKey);

  const jobs = [];
  if (typeof netease.dailyRecommend === 'function') {
    jobs.push({ source: 'netease_daily', run: () => netease.dailyRecommend() });
  }
  if (seedSongIds.length && typeof netease.moreRecommend === 'function') {
    jobs.push({ source: 'netease_more', run: () => netease.moreRecommend(seedSongIds.slice(0, 6)) });
  }
  if (seedSongIds.length && typeof netease.similarSongs === 'function') {
    jobs.push({ source: 'netease_similar', run: () => netease.similarSongs(seedSongIds[0], 24) });
  }
  if (!jobs.length) return empty('no_discovery_api');

  const results = cached?.results || await Promise.all(jobs.slice(0, 3).map(job => runDiscoveryJob(job, discoveryConfig.timeoutMs)));
  const errors = results
    .filter(result => result.error || result.timedOut)
    .map(result => `${result.source}:${result.timedOut ? 'timeout' : result.error}`);
  if (!cached && results.some(result => result.records?.length)) {
    writeDiscoveryCache(cacheKey, { results }, discoveryConfig.cacheTtlMs);
  }
  const candidates = normalizeDiscoveryCandidates({
    results,
    request,
    playedIds,
    playedSignatures,
    familiarCandidates
  });
  const fallbackReason = candidates.length ? null : (errors[0] || 'no_discovery_candidates');
  const value = {
    candidates,
    fallbackReason,
    errors: errors.slice(0, 3),
    cacheHit: Boolean(cached)
  };
  return value;
}

async function runDiscoveryJob(job, timeoutMs) {
  const guarded = Promise.resolve()
    .then(job.run)
    .then(response => ({
      source: job.source,
      records: extractRecords(response?.data ?? response),
      error: null,
      timedOut: false
    }))
    .catch(error => ({
      source: job.source,
      records: [],
      error: String(error?.message || error).slice(0, 120),
      timedOut: false
    }));
  return withTimeout(guarded, timeoutMs, {
    source: job.source,
    records: [],
    error: 'timeout',
    timedOut: true
  });
}

function normalizeDiscoveryCandidates({
  results = [],
  request = {},
  playedIds = new Set(),
  playedSignatures = new Set(),
  familiarCandidates = []
} = {}) {
  const candidates = new Map();
  const familiarIds = new Set(familiarCandidates.map(candidate => String(candidate?.track?.id || '')).filter(Boolean));
  const familiarSignatures = new Set(familiarCandidates.map(candidate => playedSongKey(candidate?.track?.name)).filter(Boolean));
  const explicitArtist = normalizeMusicText(request?.artistConstraint?.label || '');

  const addTrack = (rawTrack, discoverySource) => {
    const track = normalizeDiscoveryTrack(rawTrack);
    if (!track?.id || !track?.name || !track.artists?.length) return;
    if (explicitArtist && !trackArtistMatchesLabel(track, explicitArtist)) return;
    if (trackViolatesSessionConstraints(track, request.sessionConstraints)) return;
    if (trackViolatesVocalPolicy(track, request)) return;
    if (playedIds.has(String(track.id)) && !replayRequestAllowsPlayedSong(track, request)) return;
    const signature = playedSongKey(track.name);
    if (signature && playedSignatures.has(signature) && !replayRequestAllowsPlayedSong(track, request)) return;
    if (familiarIds.has(String(track.id)) || (signature && familiarSignatures.has(signature))) return;

    const key = String(track.id);
    if (candidates.has(key)) return;
    candidates.set(key, {
      track,
      source: 'ai_discovery',
      noveltyBucket: 'discovery',
      discoverySource,
      sourceReason: discoverySourceLabel(discoverySource)
    });
  };

  for (const result of results || []) {
    for (const record of result.records || []) {
      addTrack(record, result.source || 'netease_discovery');
    }
  }

  return [...candidates.values()];
}

function normalizeDiscoveryTrack(rawTrack) {
  const normalized = normalizeTrack(rawTrack);
  if (!normalized?.id || String(normalized.id).startsWith('local-')) return null;
  if (!normalized.name || !normalized.artists?.length) return null;
  return normalized;
}

function discoverySourceLabel(source = '') {
  const labels = {
    netease_daily: '网易云每日推荐发现',
    netease_more: '网易云更多推荐发现',
    netease_similar: '网易云相似歌曲发现'
  };
  return labels[source] || '网易云发现候选';
}

function getDiscoverySeedSongIds({ db, familiarCandidates = [], accountContext = null } = {}) {
  const account = normalizeAccountContext(accountContext);
  const ids = [];
  const add = (value) => {
    const id = String(value || '').trim();
    if (/^\d+$/.test(id) && !ids.includes(id)) ids.push(id);
  };
  for (const play of safeCall(() => listRecentPlays(db, 12, account.accountId), [])) {
    add(play.originalId || play.track_id || play.trackId || play.id);
  }
  for (const candidate of familiarCandidates || []) {
    add(candidate?.track?.originalId || candidate?.track?.id);
  }
  return ids.slice(0, 8);
}

function buildDiscoveryCacheKey({ account, seedSongIds = [] } = {}) {
  return `${account?.accountId || 'default'}:${seedSongIds.slice(0, 6).join(',') || 'daily'}`;
}

function readDiscoveryCache(key) {
  const cached = discoveryCandidateCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt && cached.expiresAt <= Date.now()) {
    discoveryCandidateCache.delete(key);
    return null;
  }
  return cached.value;
}

function writeDiscoveryCache(key, value, ttlMs) {
  if (!ttlMs || ttlMs <= 0) return;
  discoveryCandidateCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

function getDiscoveryConfig(config = {}) {
  const recommendation = config?.recommendation || {};
  return {
    ratio: clampNumber(recommendation.discoveryRatio ?? process.env.RECOMMENDATION_DISCOVERY_RATIO, 0, 1, HYBRID_DISCOVERY_DEFAULT_RATIO),
    timeoutMs: Math.max(1, Number(recommendation.discoveryTimeoutMs ?? process.env.RECOMMENDATION_DISCOVERY_TIMEOUT_MS ?? HYBRID_DISCOVERY_DEFAULT_TIMEOUT_MS) || HYBRID_DISCOVERY_DEFAULT_TIMEOUT_MS),
    cacheTtlMs: Math.max(0, Number(recommendation.discoveryCacheTtlMs ?? process.env.RECOMMENDATION_DISCOVERY_CACHE_TTL_MS ?? HYBRID_DISCOVERY_DEFAULT_CACHE_TTL_MS) || HYBRID_DISCOVERY_DEFAULT_CACHE_TTL_MS)
  };
}

function getPromptArtistLimit(config = {}, request = {}) {
  if (requestBypassesArtistRepetition(request)) return 0;
  return nonNegativeConfigNumber(
    config?.recommendation?.promptArtistLimit ?? process.env.RECOMMENDATION_PROMPT_ARTIST_LIMIT,
    PROMPT_ARTIST_DEFAULT_LIMIT
  );
}

function nonNegativeConfigNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

function createArtistLimitedAdder(selected, selectedIds, { limit, artistLimit = 0 } = {}) {
  const artistCounts = new Map();
  let skippedCount = 0;
  const add = (candidate) => {
    const id = String(candidate?.track?.id || '');
    if (!id || selectedIds.has(id) || selected.length >= limit) return false;
    const artistKeys = getTrackArtistKeys(candidate.track);
    if (artistLimit > 0 && artistKeys.some(key => (artistCounts.get(key) || 0) >= artistLimit)) {
      skippedCount += 1;
      return false;
    }
    selected.push(candidate);
    selectedIds.add(id);
    for (const key of artistKeys) artistCounts.set(key, (artistCounts.get(key) || 0) + 1);
    return true;
  };
  return {
    add,
    getStats: () => ({
      artistLimit,
      artistLimitApplied: artistLimit > 0,
      artistLimitSkippedCount: skippedCount,
      promptArtistCounts: Object.fromEntries([...artistCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))
    })
  };
}

function getTrackArtistKeys(track = {}) {
  return uniqueStrings((track.artists || []).map(normalizeMusicText).filter(Boolean), 8);
}

function getArtistDensityConfig(config = {}) {
  return {
    window: nonNegativeConfigNumber(
      config?.recommendation?.artistDensityWindow ?? process.env.RECOMMENDATION_ARTIST_DENSITY_WINDOW,
      ARTIST_DENSITY_DEFAULT_WINDOW
    ),
    max: nonNegativeConfigNumber(
      config?.recommendation?.artistDensityMax ?? process.env.RECOMMENDATION_ARTIST_DENSITY_MAX,
      ARTIST_DENSITY_DEFAULT_MAX
    )
  };
}

function requestBypassesArtistRepetition(request = {}) {
  if (request?.songTitle || request?.artistConstraint?.label) return true;
  const text = normalizeMusicText(request?.text || '');
  return /同歌手|这个歌手|这位歌手|这个艺人|这位艺人|他的另一首|她的另一首|他的歌|她的歌|换他|换她|换这个歌手|换这位歌手|继续他|继续她|继续这个歌手|继续这位歌手|继续这个艺人|继续这位艺人/.test(text);
}

function getArtistDensityResult(track = {}, { playedHistory = [], request = {}, config = {} } = {}) {
  const densityConfig = getArtistDensityConfig(config);
  const artistKeys = getTrackArtistKeys(track);
  if (!artistKeys.length || densityConfig.window <= 0 || densityConfig.max <= 0) {
    return { accepted: true, reason: 'disabled', window: densityConfig.window, max: densityConfig.max, counts: {}, blockingArtists: [] };
  }
  if (requestBypassesArtistRepetition(request)) {
    return { accepted: true, reason: 'explicit_request', window: densityConfig.window, max: densityConfig.max, counts: {}, blockingArtists: [] };
  }
  const counts = new Map();
  for (const item of (playedHistory || []).slice(0, densityConfig.window)) {
    for (const key of getTrackArtistKeys(item)) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const blockingArtists = artistKeys.filter(key => (counts.get(key) || 0) >= densityConfig.max);
  return {
    accepted: blockingArtists.length === 0,
    reason: blockingArtists.length ? 'artist_density' : 'ok',
    window: densityConfig.window,
    max: densityConfig.max,
    counts: Object.fromEntries(artistKeys.map(key => [key, counts.get(key) || 0])),
    blockingArtists
  };
}

function selectPromptCandidatesByNovelty(candidates = [], { limit = HYBRID_PROMPT_CANDIDATE_LIMIT, discoveryRatio = HYBRID_DISCOVERY_DEFAULT_RATIO, targetNoveltyBucket = 'balanced', artistLimit = 0 } = {}) {
  const discoveryTarget = Math.max(0, Math.min(limit, Math.round(limit * clampNumber(discoveryRatio, 0, 1, HYBRID_DISCOVERY_DEFAULT_RATIO))));
  const familiarTarget = limit - discoveryTarget;
  const discovery = candidates.filter(candidate => candidate.noveltyBucket === 'discovery');
  const familiar = candidates.filter(candidate => candidate.noveltyBucket !== 'discovery');
  const selected = [];
  const selectedIds = new Set();
  const limiter = createArtistLimitedAdder(selected, selectedIds, { limit, artistLimit });
  const add = limiter.add;

  for (const candidate of discovery.slice(0, discoveryTarget)) add(candidate);
  for (const candidate of familiar.slice(0, familiarTarget)) add(candidate);
  for (const candidate of targetNoveltyBucket === 'discovery' ? discovery : familiar) add(candidate);
  for (const candidate of targetNoveltyBucket === 'discovery' ? familiar : discovery) add(candidate);
  for (const candidate of candidates) add(candidate);

  return {
    candidates: selected,
    discoveryCount: selected.filter(candidate => candidate.noveltyBucket === 'discovery').length,
    familiarCount: selected.filter(candidate => candidate.noveltyBucket !== 'discovery').length,
    discoveryUnderfilled: discovery.length < discoveryTarget,
    familiarUnderfilled: familiar.length < familiarTarget,
    ...limiter.getStats()
  };
}

function selectPromptCandidatesForStyle(candidates = [], { limit = HYBRID_PROMPT_CANDIDATE_LIMIT, discoveryRatio = HYBRID_DISCOVERY_DEFAULT_RATIO, targetNoveltyBucket = 'balanced', styleConstraint = null, config = {}, artistLimit = 0 } = {}) {
  const selected = [];
  const selectedIds = new Set();
  const limiter = createArtistLimitedAdder(selected, selectedIds, { limit, artistLimit });
  const add = limiter.add;
  const styleSearch = candidates.filter(candidate => candidate.source === 'style_search');
  const qualifiedStyle = styleSearch.filter(candidate => trackMatchesStyleConstraint(candidate.track, styleConstraint, config));
  const fallbackStyle = styleSearch.filter(candidate => !trackMatchesStyleConstraint(candidate.track, styleConstraint, config));
  for (const candidate of qualifiedStyle) add(candidate);
  for (const candidate of fallbackStyle) add(candidate);

  const nonStyleSelection = selectPromptCandidatesByNovelty(
    candidates.filter(candidate => candidate.source !== 'style_search'),
    { limit, discoveryRatio, targetNoveltyBucket, artistLimit: 0 }
  );
  for (const candidate of nonStyleSelection.candidates) add(candidate);
  for (const candidate of candidates) add(candidate);

  return {
    candidates: selected,
    discoveryCount: selected.filter(candidate => candidate.noveltyBucket === 'discovery').length,
    familiarCount: selected.filter(candidate => candidate.noveltyBucket !== 'discovery').length,
    styleSearchCount: selected.filter(candidate => candidate.source === 'style_search').length,
    discoveryUnderfilled: nonStyleSelection.discoveryUnderfilled,
    familiarUnderfilled: nonStyleSelection.familiarUnderfilled,
    ...limiter.getStats()
  };
}

function getNoveltyTarget({ db, sessionId = '', accountContext = null, config = {} } = {}) {
  const account = normalizeAccountContext(accountContext);
  const ratio = getDiscoveryConfig(config).ratio;
  const window = HYBRID_DISCOVERY_WINDOW;
  const recent = getRecentNoveltyWindow(db, sessionId, window, account);
  const targetDiscoveryCount = Math.round(Math.max(1, recent.length || window) * ratio);
  const discoveryCount = recent.filter(item => item.noveltyBucket === 'discovery').length;
  let targetNoveltyBucket = 'balanced';
  if (recent.length > 0 && discoveryCount < targetDiscoveryCount) targetNoveltyBucket = 'discovery';
  if (recent.length > 0 && discoveryCount > targetDiscoveryCount) targetNoveltyBucket = 'familiar';
  return {
    targetNoveltyBucket,
    window,
    recentCount: recent.length,
    discoveryCount,
    targetDiscoveryCount
  };
}

function getRecentNoveltyWindow(db, sessionId = '', limit = HYBRID_DISCOVERY_WINDOW, accountContext = null) {
  const account = normalizeAccountContext(accountContext);
  const items = [];
  const seen = new Set();
  const add = (play = {}) => {
    const key = playedSongKey(play.name) || String(play.track_id || play.trackId || play.id || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push({
      key,
      noveltyBucket: noveltyBucketFromPlay(play)
    });
  };
  try {
    const context = getSessionContext(db, sessionId);
    for (const item of context.radioPlayedSongs || []) add(item);
  } catch {}
  try {
    for (const play of listRecentPlays(db, limit * 3, account.accountId)) add(play);
  } catch {}
  return items.slice(0, limit);
}

function noveltyBucketFromPlay(play = {}) {
  const direct = normalizeNoveltyBucket(play.noveltyBucket || play.novelty_bucket);
  if (direct) return direct;
  const source = String(play.source || '').toLowerCase();
  const reason = String(play.reason || '').toLowerCase();
  if (source.includes('discovery') || reason.includes('novelty:discovery')) return 'discovery';
  if (source.includes('familiar') || reason.includes('novelty:familiar')) return 'familiar';
  return 'familiar';
}

function normalizeNoveltyBucket(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'discovery') return 'discovery';
  if (normalized === 'familiar') return 'familiar';
  return '';
}

function summarizeDiscoverySources(candidates = []) {
  const counts = {};
  for (const candidate of candidates || []) {
    const source = candidate.discoverySource || 'unknown';
    counts[source] = (counts[source] || 0) + 1;
  }
  return counts;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function safeCall(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function sourcePriority(source) {
  if (source === 'style_search') return 4;
  if (source === 'ai_discovery') return 3;
  if (source === 'library_recent') return 2;
  return 1;
}

function trackArtistMatchesLabel(track = {}, normalizedLabel = '') {
  if (!normalizedLabel) return true;
  return (track.artists || []).some(artist => {
    const names = expandArtistAliases([artist]);
    return names.some(name => name === normalizedLabel || name.includes(normalizedLabel) || normalizedLabel.includes(name));
  });
}

function candidateIdForTrack(track = {}) {
  return String(track?.id || '').trim();
}

function formatHybridCandidatePrompt(candidates = []) {
  if (!candidates.length) return '本地候选池：无。';
  const lines = candidates.map((candidate, index) => {
    const track = candidate.track || {};
    const artists = (track.artists || []).join('、') || '未知艺人';
    const score = Number.isFinite(Number(candidate.score)) ? Math.round(Number(candidate.score) * 10) / 10 : '';
    const reason = candidate.sourceReason ? `｜依据：${candidate.sourceReason}` : '';
    return `${index + 1}. candidateId=${candidateIdForTrack(track)}｜《${track.name}》 - ${artists}｜来源：${candidate.source || 'local'}${score !== '' ? `｜分数：${score}` : ''}${reason}`;
  });
  return [
    '本地候选池：优先从下面选择；如果确实不适合当前请求，可以忽略候选并按原规则推荐真实可搜歌曲。',
    '如果选择候选池歌曲，必须在对应 pick 中原样填写 candidateId；不要改写 candidateId。',
    ...lines
  ].join('\n');
}

function formatBalancedHybridCandidatePrompt(candidates = [], { targetNoveltyBucket = 'balanced' } = {}) {
  if (!candidates.length) return '候选池：无。';
  const discovery = candidates.filter(candidate => candidate.noveltyBucket === 'discovery');
  const familiar = candidates.filter(candidate => candidate.noveltyBucket !== 'discovery');
  const targetText = targetNoveltyBucket === 'discovery'
    ? '本轮滚动比例偏熟悉，请优先从「发现候选」里选；只有明显不合适才选熟悉候选。'
    : targetNoveltyBucket === 'familiar'
      ? '本轮滚动比例偏发现，请优先从「熟悉候选」里选；只有明显不合适才选发现候选。'
      : '本轮新旧比例接近平衡，请结合上下文在两组里自然选择。';
  return [
    '候选池：下面分为「发现候选」和「熟悉候选」，目标是在最近播放中接近 50% 熟悉歌 + 50% 发现歌。',
    targetText,
    '如果选择候选池歌曲，必须在对应 pick 中原样填写 candidateId；不要改写 candidateId。',
    formatCandidatePromptGroup('发现候选', discovery),
    formatCandidatePromptGroup('熟悉候选', familiar)
  ].filter(Boolean).join('\n');
}

function formatStyleHybridCandidatePrompt(candidates = [], { styleConstraint = null, targetNoveltyBucket = 'balanced' } = {}) {
  if (!candidates.length) return 'Candidate pool: empty.';
  const style = candidates.filter(candidate => candidate.source === 'style_search');
  const qualifiedStyle = style.filter(candidate => trackMatchesStyleConstraint(candidate.track, styleConstraint));
  const fallbackStyle = style.filter(candidate => !trackMatchesStyleConstraint(candidate.track, styleConstraint));
  const discovery = candidates.filter(candidate => candidate.source !== 'style_search' && candidate.noveltyBucket === 'discovery');
  const familiar = candidates.filter(candidate => candidate.source !== 'style_search' && candidate.noveltyBucket !== 'discovery');
  const targetText = targetNoveltyBucket === 'discovery'
    ? 'Novelty balance currently prefers discovery after strict style candidates.'
    : targetNoveltyBucket === 'familiar'
      ? 'Novelty balance currently prefers familiar after strict style candidates.'
      : 'Novelty balance is currently even after strict style candidates.';
  return [
    'Candidate pool with STRICT STYLE CONSTRAINT.',
    formatStyleConstraintForPrompt(styleConstraint),
    'Pick a qualified style_search candidate first when one fits. Do not use ordinary emotional similarity as a substitute for the required style groups.',
    'If no candidate satisfies the strict style, you may omit candidateId and recommend a real searchable song that satisfies the required style.',
    targetText,
    'If choosing a candidate pool song, copy its candidateId exactly.',
    formatCandidatePromptGroup('qualified_style_search', qualifiedStyle),
    formatCandidatePromptGroup('style_search_fallback', fallbackStyle),
    formatCandidatePromptGroup('discovery_candidates', discovery),
    formatCandidatePromptGroup('familiar_candidates', familiar)
  ].filter(Boolean).join('\n');
}

function formatCandidatePromptGroup(title, candidates = []) {
  if (!candidates.length) return `${title}：无。`;
  const lines = candidates.map((candidate, index) => {
    const track = candidate.track || {};
    const artists = (track.artists || []).join('、') || '未知艺人';
    const score = Number.isFinite(Number(candidate.score)) ? Math.round(Number(candidate.score) * 10) / 10 : '';
    const reason = candidate.sourceReason ? `｜依据：${candidate.sourceReason}` : '';
    return `${index + 1}. candidateId=${candidateIdForTrack(track)}｜《${track.name}》 - ${artists}｜来源：${candidate.source || 'local'}${score !== '' ? `｜分数：${score}` : ''}${reason}`;
  });
  return `${title}：\n${lines.join('\n')}`;
}

function sanitizeCandidateForDebug(candidate = {}) {
  return {
    candidateId: candidateIdForTrack(candidate.track),
    source: candidate.source || '',
    noveltyBucket: candidate.noveltyBucket || 'familiar',
    discoverySource: candidate.discoverySource || null,
    score: Number.isFinite(Number(candidate.score)) ? Math.round(Number(candidate.score) * 100) / 100 : null,
    scoreParts: candidate.scoreParts || null,
    sourceReason: String(candidate.sourceReason || '').slice(0, 120),
    track: sanitizeTrackForDebug(candidate.track || {})
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
  styleConstraint = null,
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
      styleConstraint,
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

function scoreCandidate(candidate, { feedback, artistPenaltyByName, profile, mode, userMessage, conversationMood, styleConstraint, seed }) {
  const track = candidate.track || {};
  const scoreParts = {
    base: SOURCE_BASE_SCORES[candidate.source] ?? 30,
    feedback: 0,
    artistCooldown: 0,
    profile: 0,
    intent: 0,
    styleConstraint: 0,
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
  scoreParts.styleConstraint += scoreStyleConstraint(candidate, styleConstraint);

  const score = Object.values(scoreParts).reduce((sum, value) => sum + value, 0);
  return { score, scoreParts };
}

function scoreStyleConstraint(candidate = {}, styleConstraint = null) {
  if (!styleConstraint?.strict || !styleConstraint.requiredGroups?.length) return 0;
  const track = candidate.track || {};
  const metadataText = styleConstraintEvidenceText(track);
  const extendedText = `${metadataText} ${candidate.sourceReason || ''}`;
  let score = candidate.source === 'style_search' ? 28 : 0;
  for (const group of styleConstraint.requiredGroups || []) {
    const metadataMatched = (group || []).some(term => styleTermMatchesText(term, metadataText));
    const extendedMatched = !metadataMatched && (group || []).some(term => styleTermMatchesText(term, extendedText));
    if (metadataMatched) score += 38;
    else if (extendedMatched && candidate.source === 'style_search') score += 12;
    else score -= 55;
  }
  for (const term of styleConstraint.softTerms || []) {
    if (styleTermMatchesText(term, metadataText)) score += 10;
    else if (candidate.source === 'style_search' && styleTermMatchesText(term, extendedText)) score += 4;
  }
  for (const term of styleConstraint.negativeTerms || []) {
    if (styleTermMatchesText(term, metadataText)) score -= 35;
  }
  return score;
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

function getArtistPenaltyByName(db, accountContext = null) {
  const account = normalizeAccountContext(accountContext);
  const recent = listRecentPlays(db, 50, account.accountId);
  const penalties = new Map();
  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;

  for (const play of recent.slice(0, 10)) {
    for (const artist of play.artists || []) {
      const key = String(artist).toLowerCase();
      penalties.set(key, Math.min(penalties.get(key) || 0, RECENT_ARTIST_COOLDOWN_PENALTY));
    }
  }

  for (const play of recent) {
    const playedAt = new Date(play.played_at).getTime();
    if (!Number.isFinite(playedAt) || playedAt < threeHoursAgo) continue;
    for (const artist of play.artists || []) {
      const key = String(artist).toLowerCase();
      penalties.set(key, Math.min(penalties.get(key) || 0, HOT_ARTIST_COOLDOWN_PENALTY));
    }
  }

  return penalties;
}

async function callDJ({ db, config, netease, sessionId, profile, weather, timeOfDay, hour, mode, prefs, history, userMessage, conversationMood = null, memoryContext = {}, hostContext = {}, environmentContext = {}, avoidTracks = [], sessionConstraints = {}, accountContext = null, deferHostText = false }) {
  const account = normalizeAccountContext(accountContext);
  const playedHistory = mergePlayedTrackHistory(getPlayedTrackHistory(db, sessionId, 80, account), avoidTracks);
  const playedIds = new Set(playedHistory.map(track => String(track.id || '')).filter(Boolean));
  const playedSignatures = buildPlayedSignatureSet(playedHistory);
  const request = getMusicRequestConstraints(db, userMessage, mode, sessionConstraints);
  if (!request.vocalPolicy && conversationMood?.vocalPolicy) {
    request.vocalPolicy = normalizeVocalPolicy(conversationMood.vocalPolicy);
  }
  const moodStyleConstraint = normalizeStyleConstraint(conversationMood?.styleConstraint, {
    text: userMessage,
    mode,
    searchQueries: conversationMood?.styleSearchQueries || []
  });
  request.styleConstraint = mergeStyleConstraints(request.styleConstraint, moodStyleConstraint);
  request.styleSearchQueries = uniqueStrings([
    ...(request.styleSearchQueries || []),
    ...(conversationMood?.styleSearchQueries || []),
    ...(request.styleConstraint?.searchQueries || [])
  ], 8);
  const candidateContext = await buildHybridCandidateContext({
    db,
    config,
    netease,
    sessionId,
    profile,
    mode,
    userMessage,
    conversationMood,
    request,
    playedIds,
    playedSignatures,
    accountContext: account
  });
  setRadioDebugInfo(db, sessionId, { lastCandidatePool: candidateContext.debug });
  const failedPicks = [];
  let lastPlan = null;
  let newMode = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const plan = await generateSongPlan({
      config,
      profile,
      weather,
      timeOfDay,
      hour,
      mode,
      prefs,
      history,
      userMessage,
      conversationMood,
      memoryContext,
      request,
      failedPicks,
      playedHistory,
      hostContext,
      environmentContext,
      candidateContext
    });
    lastPlan = plan;
    setRadioDebugInfo(db, sessionId, { lastSongPlan: sanitizeSongPlan(plan, attempt) });
    if (!newMode) newMode = modeDecisionFromPlan(plan);
    if (!plan.picks.length) break;

    const resolved = await resolveSongPlanTrack({
      db,
      config,
      netease,
      sessionId,
      plan,
      playedIds,
      playedSignatures,
      playedHistory,
      request,
      candidateById: candidateContext.candidateById
    });
    setRadioDebugInfo(db, sessionId, { lastSearchDiagnostics: resolved.diagnostics || [] });
    if (resolved.track) {
      const recommendationSource = buildRecommendationSource({
        selectedPick: resolved.pick,
        selectedTrack: resolved.track,
        noveltyBucket: resolved.noveltyBucket,
        discoverySource: resolved.discoverySource,
        userMessage,
        conversationMood,
        hostContext
      });
      const reason = resolved.pick.reason || '根据当前状态和音乐画像推荐';
      const explanation = buildRecommendationExplanation({
        selectedPick: resolved.pick,
        selectedTrack: resolved.track,
        userMessage,
        conversationMood,
        timeOfDay,
        weather,
        profile,
        hostContext,
        environmentContext,
        recommendationSource,
        source: resolved.pick?.reason ? 'llm_pick' : 'fallback'
      });
      if (deferHostText) {
        return {
          chatText: '',
          track: resolved.track,
          reason,
          explanation,
          noveltyBucket: resolved.noveltyBucket || null,
          discoverySource: resolved.discoverySource || null,
          recommendationSource,
          newMode
        };
      }
      const chatText = await generateFinalHostText({
        config,
        plan,
        selectedPick: resolved.pick,
        selectedTrack: resolved.track,
        profile,
        prefs,
        history,
        timeOfDay,
        hour,
        weather,
        conversationMood,
        userMessage,
        memoryContext,
        hostContext,
        environmentContext
      });
      return {
        chatText,
        track: resolved.track,
        reason,
        explanation,
        noveltyBucket: resolved.noveltyBucket || null,
        discoverySource: resolved.discoverySource || null,
        recommendationSource,
        newMode
      };
    }
    failedPicks.push(...resolved.failedPicks);
  }

  const fallback = await resolveRecommendationFallback({
    db,
    config,
    netease,
    sessionId,
    profile,
    timeOfDay,
    weather,
    conversationMood,
    userMessage,
    hostContext,
    failedPicks,
    lastPlan,
    playedIds,
    playedSignatures,
    playedHistory,
    request
  });
  if (fallback?.track) {
    const fallbackPlan = {
      picks: [fallback.pick],
      hostDraft: fallback.hostDraft || '',
      mode: null
    };
    setRadioDebugInfo(db, sessionId, {
      lastRecommendationFailure: null,
      lastSearchDiagnostics: fallback.diagnostics || []
    });
    const recommendationSource = buildRecommendationSource({
      selectedPick: fallback.pick,
      selectedTrack: fallback.track,
      noveltyBucket: fallback.noveltyBucket,
      discoverySource: fallback.discoverySource || 'library_deep',
      userMessage,
      conversationMood,
      hostContext
    });
    const explanation = buildRecommendationExplanation({
      selectedPick: fallback.pick,
      selectedTrack: fallback.track,
      userMessage,
      conversationMood,
      timeOfDay,
      weather,
      profile,
      hostContext,
      environmentContext,
      recommendationSource,
      source: 'fallback'
    });
    if (deferHostText) {
      return {
        chatText: '',
        track: fallback.track,
        reason: fallback.reason,
        explanation,
        recommendationSource,
        newMode
      };
    }
    const chatText = await generateFinalHostText({
      config,
      plan: fallbackPlan,
      selectedPick: fallback.pick,
      selectedTrack: fallback.track,
      profile,
      prefs,
      history,
      timeOfDay,
      hour,
      weather,
      conversationMood,
      userMessage,
      memoryContext,
      hostContext,
      environmentContext
    });
    return {
      chatText,
      track: fallback.track,
      reason: fallback.reason,
      explanation,
      recommendationSource,
      newMode
    };
  }

  setRadioDebugInfo(db, sessionId, {
    lastRecommendationFailure: buildRecommendationFailure({
      stage: fallback?.stage || (lastPlan?.picks?.length ? 'playable_check' : 'llm_plan'),
      message: fallback?.message || 'LLM 推荐和画像兜底都没有确认到可播放歌曲。',
      failedPicks,
      lastPlan
    })
  });

  return {
    chatText: buildNoPlayableSongText(lastPlan),
    track: null,
    reason: 'LLM 推荐歌曲未确认到可播放源',
    newMode
  };
}

async function resolveRecommendationFallback({
  db,
  config,
  netease,
  profile,
  timeOfDay,
  weather,
  conversationMood,
  userMessage,
  hostContext,
  failedPicks = [],
  lastPlan = null,
  playedIds = new Set(),
  playedSignatures = new Set(),
  playedHistory = [],
  request = {}
} = {}) {
  const replayKey = requestAllowsRequestedSongReplay(request) ? playedSongKey(request.songTitle) : '';
  const failedNameKeys = new Set([
    ...(failedPicks || []).map(pick => playedSongKey(pick?.name)),
    request?.songTitle && !requestAllowsRequestedSongReplay(request) ? playedSongKey(request.songTitle) : ''
  ].filter(key => key && key !== replayKey));

  const sameArtist = await resolveSameArtistFallback({
    db,
    config,
    netease,
    failedPicks,
    playedIds,
    playedSignatures,
    playedHistory,
    failedNameKeys,
    request
  });
  if (sameArtist?.track) return sameArtist;

  const profileFallback = await resolveProfileLibraryFallback({
    db,
    config,
    netease,
    profile,
    conversationMood,
    playedIds,
    playedSignatures,
    playedHistory,
    failedNameKeys,
    request
  });
  if (profileFallback?.track) return profileFallback;

  return {
    track: null,
    stage: profileFallback?.stage || sameArtist?.stage || 'profile_fallback',
    message: profileFallback?.message || sameArtist?.message || '没有可用的画像兜底歌曲。',
    diagnostics: [
      ...(sameArtist?.diagnostics || []),
      ...(profileFallback?.diagnostics || [])
    ],
    lastPlan,
    timeOfDay,
    weather,
    userMessage,
    hostContext
  };
}

async function resolveSameArtistFallback({ db, config, netease, failedPicks = [], request = {}, playedIds, playedSignatures, playedHistory = [], failedNameKeys }) {
  const artists = uniqueStrings([
    ...(failedPicks || []).flatMap(pick => pick?.artists || []),
    request?.artistConstraint?.label || ''
  ], 5).filter(artist => !trackViolatesSessionConstraints({ name: '', artists: [artist] }, request.sessionConstraints));
  const diagnostics = [];
  if (!artists.length) {
    return { track: null, stage: 'netease_search', message: '没有可用于同艺人兜底的艺人信息。', diagnostics };
  }

  for (const artist of artists) {
    const diagnostic = {
      pick: { name: '', artists: [artist], reason: 'same_artist_fallback' },
      queries: [artist],
      hits: [],
      fallbackSource: 'same_artist'
    };
    let tracks = [];
    try {
      tracks = await searchOnline(artist, 20);
    } catch (error) {
      diagnostic.failedReason = String(error?.message || error).slice(0, 120);
      diagnostics.push(trimSearchDiagnostic(diagnostic));
      continue;
    }
    for (const track of tracks) {
      const hit = {
        track: sanitizeTrackForDebug(track),
        score: scoreFallbackTrack(track, { profile: null, conversationMood: null, artist }),
        accepted: true,
        filterReason: null,
        playable: null
      };
      diagnostic.hits.push(hit);
      if (trackViolatesSessionConstraints(track, request.sessionConstraints)) {
        hit.accepted = false;
        hit.filterReason = 'session_constraint';
        continue;
      }
      if (trackViolatesVocalPolicy(track, request)) {
        hit.accepted = false;
        hit.filterReason = 'vocal_policy';
        continue;
      }
      const styleConstraintResult = getStyleConstraintResult(track, request.styleConstraint, config);
      hit.styleConstraintResult = styleConstraintResult;
      if (!styleConstraintResult.accepted) {
        hit.accepted = false;
        hit.filterReason = 'style_constraint';
        continue;
      }
      if (shouldSkipFallbackTrack(track, { playedIds, playedSignatures, failedNameKeys, request })) {
        hit.accepted = false;
        hit.filterReason = 'played_or_failed_song';
        continue;
      }
      const artistDensityResult = getArtistDensityResult(track, { playedHistory, request, config });
      hit.artistDensityResult = artistDensityResult;
      if (!artistDensityResult.accepted) {
        hit.accepted = false;
        hit.filterReason = 'artist_density';
        continue;
      }
      const playable = await resolvePlayableTrack(db, netease, track, playableResolveOptions(config, { includeLyric: false }));
      hit.playable = Boolean(playable?.playable);
      if (!playable?.playable) {
        hit.accepted = false;
        hit.filterReason = 'not_playable';
        continue;
      }
      const withLyric = await resolvePlayableTrack(db, netease, playable, playableResolveOptions(config, { includeLyric: true }));
      const selectedTrack = withLyric?.playable ? withLyric : playable;
      diagnostic.selectedTrackId = String(selectedTrack.id || '');
      diagnostics.push(trimSearchDiagnostic(diagnostic));
      const requestedText = request?.songTitle
        ? `《${request.songTitle}》暂时没有放出来，先换同歌手另一首。`
        : '同艺人里换一首更贴近当前氛围的歌。';
      return {
        track: selectedTrack,
        pick: {
          name: selectedTrack.name,
          artists: selectedTrack.artists || [artist],
          reason: requestedText,
          hostLine: requestedText
        },
        reason: requestedText,
        hostDraft: requestedText,
        diagnostics
      };
    }
    if (!diagnostic.failedReason) diagnostic.failedReason = 'no_playable_same_artist_track';
    diagnostics.push(trimSearchDiagnostic(diagnostic));
  }

  return { track: null, stage: 'netease_search', message: '同艺人兜底没有找到可播放歌曲。', diagnostics };
}

async function resolveProfileLibraryFallback({ db, config, netease, profile = {}, conversationMood = null, playedIds, playedSignatures, playedHistory = [], failedNameKeys, request = {} }) {
  const tracks = listProfileFallbackTracks(db, 220);
  const diagnostics = [{
    pick: { name: 'profile_library_fallback', artists: [], reason: 'profile_fallback' },
    queries: ['current account profile playlists'],
    hits: [],
    fallbackSource: 'profile_library'
  }];
  if (!tracks.length) {
    return { track: null, stage: 'profile_fallback', message: '当前账号没有可用于兜底的画像歌单歌曲。', diagnostics };
  }

  const ranked = tracks
    .filter(track => !shouldSkipFallbackTrack(track, { playedIds, playedSignatures, failedNameKeys, request }))
    .filter(track => !trackViolatesSessionConstraints(track, request.sessionConstraints))
    .filter(track => !trackViolatesVocalPolicy(track, request))
    .filter(track => !trackViolatesStyleConstraint(track, request.styleConstraint, config))
    .map((track, index) => ({ track, score: scoreFallbackTrack(track, { profile, conversationMood }) - index * 0.01 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 32);

  for (const item of ranked) {
    const hit = {
      track: sanitizeTrackForDebug(item.track),
      score: Math.round(item.score * 100) / 100,
      accepted: true,
      filterReason: null,
      playable: null
    };
    diagnostics[0].hits.push(hit);
    const artistDensityResult = getArtistDensityResult(item.track, { playedHistory, request, config });
    hit.artistDensityResult = artistDensityResult;
    if (!artistDensityResult.accepted) {
      hit.accepted = false;
      hit.filterReason = 'artist_density';
      continue;
    }
    const playable = await resolvePlayableTrack(db, netease, item.track, playableResolveOptions(config, { includeLyric: false }));
    hit.playable = Boolean(playable?.playable);
    if (!playable?.playable) {
      hit.accepted = false;
      hit.filterReason = 'not_playable';
      continue;
    }
    const withLyric = await resolvePlayableTrack(db, netease, playable, playableResolveOptions(config, { includeLyric: true }));
    const selectedTrack = withLyric?.playable ? withLyric : playable;
    diagnostics[0].selectedTrackId = String(selectedTrack.id || '');
    const reason = 'LLM 推荐未确认到可播放源，改用当前账号画像/歌单兜底。';
    return {
      track: selectedTrack,
      pick: {
        name: selectedTrack.name,
        artists: selectedTrack.artists || [],
        reason,
        hostLine: reason
      },
      reason,
      hostDraft: reason,
      diagnostics: [trimSearchDiagnostic(diagnostics[0])]
    };
  }

  diagnostics[0].failedReason = 'no_playable_profile_track';
  return { track: null, stage: 'profile_fallback', message: '画像歌单兜底歌曲都没有确认到可播放源。', diagnostics: [trimSearchDiagnostic(diagnostics[0])] };
}

function shouldSkipFallbackTrack(track, { playedIds = new Set(), playedSignatures = new Set(), failedNameKeys = new Set(), request = {} } = {}) {
  const id = String(track?.id || '').trim();
  if (id && playedIds.has(id) && !replayRequestAllowsPlayedSong(track, request)) return true;
  if (trackMatchesPlayedSongName(track, playedSignatures) && !replayRequestAllowsPlayedSong(track, request)) return true;
  const nameKey = playedSongKey(track?.name || track?.song || track?.title || '');
  if (nameKey && failedNameKeys.has(nameKey)) return true;
  return false;
}

function scoreFallbackTrack(track, { profile = {}, conversationMood = null, artist = '' } = {}) {
  const text = `${track?.name || ''} ${(track?.artists || []).join(' ')} ${track?.album || ''} ${track?.playlistName || ''}`.toLowerCase();
  const structured = profile?.structured || {};
  let score = 50;
  if (track?.originalId || track?.playable) score += 18;
  const topArtists = Array.isArray(structured.artists) ? structured.artists.slice(0, 12) : [];
  for (const [index, item] of topArtists.entries()) {
    const name = String(item?.name || '').toLowerCase();
    if (name && text.includes(name)) score += Math.max(4, 18 - index);
  }
  if (artist && text.includes(String(artist).toLowerCase())) score += 20;
  const hints = [
    conversationMood?.mood,
    conversationMood?.energy,
    ...(conversationMood?.searchHints || []),
    ...(conversationMood?.preferenceHints || [])
  ].map(value => String(value || '').toLowerCase()).filter(Boolean);
  for (const hint of hints.slice(0, 8)) {
    if (hint.length >= 2 && text.includes(hint)) score += 6;
  }
  const positiveSignals = ['remaster', '热门', '精选', 'best', 'original'];
  for (const signal of positiveSignals) {
    if (text.includes(signal.toLowerCase())) score += 2;
  }
  score += fallbackVersionScore(track);
  return score;
}

function fallbackVersionScore(track) {
  const markers = getTrackVersionMarkers(track);
  if (!markers.length) return 6;
  if (markers.includes('live')) return -10;
  if (markers.some(marker => ['cover', 'remix', 'instrumental'].includes(marker))) return -18;
  return -4;
}

function buildRecommendationFailure({ stage = 'playable_check', message = '', failedPicks = [], lastPlan = null } = {}) {
  return {
    stage,
    message: String(message || '推荐失败').slice(0, 180),
    failedPicks: (failedPicks?.length ? failedPicks : lastPlan?.picks || []).map(sanitizeSongPick).slice(0, 6),
    updatedAt: nowIso()
  };
}

function playableResolveOptions(config = {}, options = {}) {
  return {
    ...options,
    requireBrowserPlayUrl: Boolean(config?.playback?.requireBrowserPlayUrl)
  };
}

async function generateSongPlan({ config, profile, weather, timeOfDay, hour, mode, prefs, history, userMessage, conversationMood, memoryContext, request, failedPicks = [], playedHistory = [], hostContext = {}, environmentContext = {}, candidateContext = null }) {
  const fallbackPlan = {
    picks: [],
    hostDraft: fallbackChat(timeOfDay, weather, profile),
    mode: null
  };
  if (!config?.llm?.baseUrl || !config?.llm?.apiKey || !config?.llm?.model) return fallbackPlan;

  const modeText = mode?.genre
    ? `当前模式：${mode.genre}（${mode.note || '用户指定'}）。`
    : '当前模式：无特殊模式。';
  const requestTextParts = [
    request?.artistConstraint?.label ? `指定艺人：${request.artistConstraint.label}` : '',
    request?.songTitle ? `指定歌名：${request.songTitle}` : '',
    styleConstraintIsActive(request?.styleConstraint, config) ? formatStyleConstraintForPrompt(request.styleConstraint) : ''
  ];
  const requestText = requestTextParts.filter(Boolean).join('；') || '无明确歌名/艺人约束';
  const sessionConstraintText = formatSessionConstraintsForPrompt(request?.sessionConstraints);
  const vocalPolicyText = formatVocalPolicyForPrompt(request);
  const failedText = failedPicks.length
    ? `上一批没有确认到可播放源，请避开这些歌：${failedPicks.map(pick => `${pick.name}${pick.artists?.length ? ' - ' + pick.artists.join('、') : ''}`).join('；')}`
    : '没有失败歌单。';
  const playedText = formatPlayedSongExclusions(playedHistory, request);
  const replayRule = requestAllowsRequestedSongReplay(request)
    ? `已播放歌名通常必须避开；但本次用户明确点名《${request.songTitle}》，这一个歌名允许重复播放，其他已播放歌仍必须避开同名任何版本。`
    : '已播放歌名必须避开：只要歌名相同，就不能再推荐任何版本、翻唱、Live、Remix、Album Version 或不同艺人版本。';
  const profilePrompt = formatProfileSummaryForPrompt(profile);
  const candidatePrompt = candidateContext?.enabled ? candidateContext.promptText : '本地候选池：无，按原规则推荐真实可搜歌曲。';
  const weatherRadioPrompt = formatWeatherRadioForPrompt(environmentContext.weatherRadio);
  const musicRecapPrompt = formatOpeningMusicRecapForPrompt(hostContext.openingRecap);

  const raw = await generateChatCompletion(config.llm, [
    {
      role: 'system',
      content: [
        '你是灿灿电台的选歌大脑。你的任务不是生成搜索关键词，而是直接推荐真实存在、音乐平台容易搜到的具体歌曲。',
        buildCanCanBackgroundPrompt(userMessage),
        'If MUSIC_RECAP has openingLine, naturally mention it once at the start. If it is none, do not invent yesterday usage. WEATHER_RADIO is atmosphere only and must not override explicit user requests.',
        '必须结合时间、天气、听众画像、偏好、当前对话和明确请求，给出 3 首备选歌。',
        '时间天气只是事实背景，不是固定开场模板；不要因为历史对话把当前上午/下午写成晚上，也不要编造未来天气。',
        '每首都必须有明确歌名和主要艺人。优先推荐知名度较高、音乐更可能搜到并可播放的版本。',
        '如果提供了本地候选池，优先从候选池中挑选最贴合当前语境的歌曲；这能更好利用听众画像、历史反馈和本地可播曲库。',
        '若选择本地候选池歌曲，pick 必须包含对应 candidateId，歌名和艺人应与候选池一致。若候选池都不合适，可以不填 candidateId 并继续按真实歌曲推荐。',
        '“深夜、安静、陪伴、适合放松、开心、提神”等只能用于理解氛围，不能当作歌曲名或主搜索词，除非它本来就是你明确推荐的真实歌名且给出了艺人。',
        '搜索 queries 必须像音乐软件里会输入的短词，优先“歌名 艺人”和“艺人 歌名”。不要输出长句。',
        '如果用户明确指定艺人、歌名或风格，必须优先满足；不确定时选更常见、更好搜的歌曲。',
        'If STRICT_STYLE_CONSTRAINT is present, the requiredGroups are hard requirements. Do not substitute a normal ballad, nostalgia song, or mood-similar song when it lacks the requested style evidence.',
        'The listener profile is an objective preference summary. Treat it as style guidance only; do not repeatedly recommend a concrete artist unless the user explicitly asks for that artist.',
        'WEATHER_RADIO and MUSIC_RECAP are light ranking signals only. Explicit song, artist, style, or current mood requests must win over weather and recap hints.',
        '如果存在本场禁听，禁听优先级高于听众画像、历史偏好和兜底推荐；不要推荐禁听歌手，也不要推荐歌名命中禁听词的歌曲。',
        vocalPolicyText,
        '如果用户说“他的另一首/她的另一首/这个歌手的另一首/换这位歌手”，优先参考最近播放歌曲的艺人，把它理解成当前或上一首歌的主艺人。',
        replayRule,
        'hostLine 只是备用素材，不是最终导播词。不要写成“刚才……现在……”“上一首……接下来……”或“接下来放……”。可以只写一个自然的导播方向。',
        '只输出严格 JSON，不要 Markdown，不要解释。',
        'JSON 格式：{"picks":[{"candidateId":"可选，本地候选池ID","name":"歌名","artists":["艺人"],"reason":"一句话理由","queries":["歌名 艺人","艺人 歌名"],"hostLine":"40-90字电台导播词"}],"hostDraft":"40-90字自然主持词","mode":null}'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `APP_TIME_CONTEXT：${formatEnvironmentContext(environmentContext)}`,
        `此刻：${timeOfDay} ${hour}点，${weather}`,
        `听众画像：${profilePrompt}`,
        `偏好设置：${JSON.stringify(normalizeRuntimePrefs(prefs))}`,
        modeText,
        `明确请求：${requestText}`,
        sessionConstraintText,
        vocalPolicyText,
        weatherRadioPrompt,
        musicRecapPrompt,
        candidatePrompt,
        conversationMood ? `对话情绪：${JSON.stringify(conversationMood)}` : '对话情绪：无',
        formatRecentHostPlays(hostContext.recentPlays),
        playedText,
        memoryContext?.promptText || '相关长期记忆：无',
        memoryContext?.sessionSummary ? `本轮会话摘要：${memoryContext.sessionSummary}` : '本轮会话摘要：无',
        `最近对话：${history.length ? '\n' + history.map(h => `[${h.role === 'user' ? '听众' : '灿灿'}]: ${h.content}`).join('\n') : '（新对话）'}`,
        userMessage ? `听众刚说：${userMessage}` : '听众刚启动电台或上一首播完。',
        failedText
      ].join('\n')
    }
  ], () => JSON.stringify(fallbackPlan));

  return parseSongPlanResponse(raw, fallbackPlan);
}

export function parseSongPlanResponse(raw, fallbackPlan = { picks: [], hostDraft: '', mode: null }) {
  const text = stripCodeFence(String(raw || '')).trim();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try { parsed = JSON.parse(objectMatch[0]); } catch {}
    }
  }
  if (!parsed) return fallbackPlan;
  const rawPicks = Array.isArray(parsed) ? parsed : (parsed.picks || parsed.songs || parsed.recommendations || []);
  const picks = rawPicks
    .map(normalizeSongPick)
    .filter(pick => pick.name && pick.artists.length)
    .slice(0, 3);
  return {
    picks,
    hostDraft: String(parsed.hostDraft || parsed.hostText || parsed.chatText || '').trim(),
    mode: parsed.mode ?? null
  };
}

function normalizeSongPick(raw = {}) {
  const name = String(raw.name || raw.song || raw.title || raw.songName || '').trim();
  const artists = normalizeArtistList(raw.artists || raw.artist || raw.singer || raw.singers);
  return {
    candidateId: String(raw.candidateId || raw.candidate_id || '').trim(),
    name,
    artists,
    reason: String(raw.reason || '').trim(),
    queries: Array.isArray(raw.queries) ? raw.queries.map(q => String(q || '').trim()).filter(Boolean) : [],
    hostLine: String(raw.hostLine || raw.hostText || '').trim()
  };
}

function normalizeArtistList(value) {
  if (Array.isArray(value)) return uniqueStrings(value, 4);
  return uniqueStrings(String(value || '').split(/[、,，/&\s]+/), 4);
}

function formatPlayedSongExclusions(playedHistory = [], request = {}) {
  const songs = [];
  const seen = new Set();
  const allowedReplayKey = requestAllowsRequestedSongReplay(request) ? playedSongKey(request.songTitle) : '';
  for (const track of playedHistory || []) {
    const key = playedSongKey(track?.name);
    if (!key || seen.has(key)) continue;
    if (allowedReplayKey && key === allowedReplayKey) continue;
    seen.add(key);
    songs.push(`${track.name}${track.artists?.length ? ' - ' + track.artists.join('、') : ''}`);
    if (songs.length >= 30) break;
  }
  const replayText = allowedReplayKey && request?.songTitle
    ? `用户本轮明确点名《${request.songTitle}》，这一个歌名允许重复播放；`
    : '';
  return songs.length
    ? `${replayText}本轮/最近其他已经播放过的歌名，后续必须避开同名任何版本：${songs.join('；')}`
    : `${replayText}本轮/最近已播放歌名：${replayText ? '除本次指定歌曲外无其他限制' : '无'}`;
}

async function resolveSongPlanTrack({ db, config, netease, sessionId, plan, playedIds, playedSignatures = new Set(), playedHistory = [], request = {}, candidateById = new Map() }) {
  const failedPicks = [];
  const diagnostics = [];
  for (const pick of plan.picks) {
    const effectivePick = applyRequestToSongPick(pick, request);
    const pickDiagnostic = {
      pick: sanitizeSongPick(effectivePick),
      llmPick: request?.songTitle ? sanitizeSongPick(pick) : null,
      queries: buildSongSearchQueries(effectivePick, { request }),
      hits: [],
      selectedTrackId: null,
      failedReason: null
    };
    if (trackMatchesPlayedSongName(effectivePick, playedSignatures) && !replayRequestAllowsPlayedSong(effectivePick, request)) {
      pickDiagnostic.failedReason = 'played_song_name';
      diagnostics.push(pickDiagnostic);
      failedPicks.push(effectivePick);
      continue;
    }
    if (songPickViolatesSessionConstraints(effectivePick, request.sessionConstraints)) {
      pickDiagnostic.failedReason = 'session_constraint';
      diagnostics.push(pickDiagnostic);
      failedPicks.push(effectivePick);
      continue;
    }
    if (songPickViolatesVocalPolicy(effectivePick, request)) {
      pickDiagnostic.failedReason = 'vocal_policy';
      diagnostics.push(pickDiagnostic);
      failedPicks.push(effectivePick);
      continue;
    }
    const candidateResolved = await resolveCandidatePickTrack({
      db,
      config,
      netease,
      pick: effectivePick,
      playedIds,
      playedSignatures,
      playedHistory,
      request,
      candidateById
    });
    if (candidateResolved?.diagnostic) diagnostics.push(candidateResolved.diagnostic);
    if (candidateResolved?.track) {
      return {
        track: candidateResolved.track,
        pick: candidateResolved.pick,
        noveltyBucket: candidateResolved.noveltyBucket || null,
        discoverySource: candidateResolved.discoverySource || null,
        diagnostics
      };
    }
    const search = await searchTracksForSongPick(effectivePick, { request });
    pickDiagnostic.queries = search.queries;
    pickDiagnostic.queryDiagnostics = search.queryDiagnostics;
    const ranked = search.tracks
      .map(track => {
        const scoreDetails = scoreSearchTrackForPickDetails(track, effectivePick);
        const score = scoreDetails.score;
        const styleConstraintResult = getStyleConstraintResult(track, request.styleConstraint, config);
        const diagnostic = {
          track: sanitizeTrackForDebug(track),
          score,
          accepted: score >= 100 && styleConstraintResult.accepted,
          filterReason: score >= 100
            ? (styleConstraintResult.accepted ? scoreDetails.filterReason : 'style_constraint')
            : (scoreDetails.filterReason || 'name_or_artist_mismatch'),
          scoreParts: scoreDetails.scoreParts,
          styleConstraintResult,
          playable: null
        };
        pickDiagnostic.hits.push(diagnostic);
        return { track, score, scoreDetails, diagnostic };
      })
      .filter(item => item.score >= 100)
      .sort(compareSearchTrackScores)
      .slice(0, 8);

    for (const item of ranked) {
      const track = item.track;
      if (trackViolatesSessionConstraints(track, request.sessionConstraints)) {
        item.diagnostic.accepted = false;
        item.diagnostic.filterReason = 'session_constraint';
        continue;
      }
      if (trackViolatesVocalPolicy(track, request, effectivePick)) {
        item.diagnostic.accepted = false;
        item.diagnostic.filterReason = 'vocal_policy';
        continue;
      }
      const styleConstraintResult = getStyleConstraintResult(track, request.styleConstraint, config);
      item.diagnostic.styleConstraintResult = styleConstraintResult;
      if (!styleConstraintResult.accepted) {
        item.diagnostic.accepted = false;
        item.diagnostic.filterReason = 'style_constraint';
        continue;
      }
      if (playedIds.has(String(track.id)) && !replayRequestAllowsPlayedSong(track, request)) {
        item.diagnostic.accepted = false;
        item.diagnostic.filterReason = 'played_track_id';
        continue;
      }
      if (trackMatchesPlayedSongName(track, playedSignatures) && !replayRequestAllowsPlayedSong(track, request)) {
        item.diagnostic.accepted = false;
        item.diagnostic.filterReason = 'played_song_name';
        continue;
      }
      if (trackMatchesPlayedSongName(track, playedSignatures) && replayRequestAllowsPlayedSong(track, request)) {
        item.diagnostic.filterReason = 'allowed_explicit_replay';
      }
      const artistDensityResult = getArtistDensityResult(track, { playedHistory, request, config });
      item.diagnostic.artistDensityResult = artistDensityResult;
      if (!artistDensityResult.accepted) {
        item.diagnostic.accepted = false;
        item.diagnostic.filterReason = 'artist_density';
        continue;
      }
      const playableStarted = Date.now();
      const playable = await resolvePlayableTrack(db, netease, track, playableResolveOptions(config, { includeLyric: false }));
      item.diagnostic.playable = Boolean(playable?.playable);
      item.diagnostic.playableMs = Date.now() - playableStarted;
      if (!playable?.playable) {
        item.diagnostic.accepted = false;
        item.diagnostic.filterReason = 'not_playable';
        continue;
      }
      const withLyric = await resolvePlayableTrack(db, netease, playable, playableResolveOptions(config, { includeLyric: true }));
      pickDiagnostic.selectedTrackId = String((withLyric?.playable ? withLyric : playable)?.id || '');
      diagnostics.push(trimSearchDiagnostic(pickDiagnostic));
      return {
        track: withLyric?.playable ? withLyric : playable,
        pick: normalizeSelectedPick(effectivePick, withLyric?.playable ? withLyric : playable),
        diagnostics
      };
    }
    if (!pickDiagnostic.failedReason) {
      pickDiagnostic.failedReason = ranked.some(item => item.diagnostic?.filterReason === 'style_constraint')
        ? 'style_constraint_no_match'
        : ranked.some(item => item.diagnostic?.filterReason === 'artist_density')
          ? 'artist_density'
        : (ranked.length ? 'no_playable_match' : 'no_matching_search_hit');
    }
    diagnostics.push(trimSearchDiagnostic(pickDiagnostic));
    failedPicks.push(effectivePick);
  }
  return { track: null, pick: null, failedPicks, diagnostics };
}

async function resolveCandidatePickTrack({ db, config, netease, pick = {}, playedIds, playedSignatures, playedHistory = [], request = {}, candidateById = new Map() } = {}) {
  const candidateId = String(pick.candidateId || '').trim();
  if (!candidateId) return null;
  const candidate = candidateById instanceof Map ? candidateById.get(candidateId) : null;
  const diagnostic = {
    pick: sanitizeSongPick(pick),
    queries: [`candidate:${candidateId}`],
    hits: [],
    selectedTrackId: null,
    failedReason: null,
    fallbackSource: 'hybrid_candidate',
    noveltyBucket: candidate?.noveltyBucket || null,
    discoverySource: candidate?.discoverySource || null
  };
  if (!candidate?.track?.id) {
    diagnostic.failedReason = 'candidate_not_found';
    return { track: null, pick: null, diagnostic: trimSearchDiagnostic(diagnostic) };
  }

  const track = candidate.track;
  const hit = {
    track: sanitizeTrackForDebug(track),
    score: Number.isFinite(Number(candidate.score)) ? Math.round(Number(candidate.score) * 100) / 100 : null,
    accepted: true,
    filterReason: 'candidate_id_match',
    scoreParts: candidate.scoreParts || null,
    noveltyBucket: candidate.noveltyBucket || null,
    discoverySource: candidate.discoverySource || null,
    playable: null
  };
  diagnostic.hits.push(hit);

  if (trackViolatesSessionConstraints(track, request.sessionConstraints)) {
    hit.accepted = false;
    hit.filterReason = 'session_constraint';
    diagnostic.failedReason = 'session_constraint';
    return { track: null, pick: null, diagnostic: trimSearchDiagnostic(diagnostic) };
  }
  if (trackViolatesVocalPolicy(track, request, pick)) {
    hit.accepted = false;
    hit.filterReason = 'vocal_policy';
    diagnostic.failedReason = 'vocal_policy';
    return { track: null, pick: null, diagnostic: trimSearchDiagnostic(diagnostic) };
  }
  const styleConstraintResult = getStyleConstraintResult(track, request.styleConstraint, config);
  hit.styleConstraintResult = styleConstraintResult;
  if (!styleConstraintResult.accepted) {
    hit.accepted = false;
    hit.filterReason = 'style_constraint';
    diagnostic.failedReason = 'style_constraint_no_match';
    return { track: null, pick: null, diagnostic: trimSearchDiagnostic(diagnostic) };
  }
  if (playedIds.has(String(track.id)) && !replayRequestAllowsPlayedSong(track, request)) {
    hit.accepted = false;
    hit.filterReason = 'played_track_id';
    diagnostic.failedReason = 'played_track_id';
    return { track: null, pick: null, diagnostic: trimSearchDiagnostic(diagnostic) };
  }
  if (trackMatchesPlayedSongName(track, playedSignatures) && !replayRequestAllowsPlayedSong(track, request)) {
    hit.accepted = false;
    hit.filterReason = 'played_song_name';
    diagnostic.failedReason = 'played_song_name';
    return { track: null, pick: null, diagnostic: trimSearchDiagnostic(diagnostic) };
  }
  const artistDensityResult = getArtistDensityResult(track, { playedHistory, request, config });
  hit.artistDensityResult = artistDensityResult;
  if (!artistDensityResult.accepted) {
    hit.accepted = false;
    hit.filterReason = 'artist_density';
    diagnostic.failedReason = 'artist_density';
    return { track: null, pick: null, diagnostic: trimSearchDiagnostic(diagnostic) };
  }

  const playableStarted = Date.now();
  const playable = await resolvePlayableTrack(db, netease, track, playableResolveOptions(config, { includeLyric: false }));
  hit.playable = Boolean(playable?.playable);
  hit.playableMs = Date.now() - playableStarted;
  if (!playable?.playable) {
    hit.accepted = false;
    hit.filterReason = 'not_playable';
    diagnostic.failedReason = 'candidate_not_playable';
    return { track: null, pick: null, diagnostic: trimSearchDiagnostic(diagnostic) };
  }

  const withLyric = await resolvePlayableTrack(db, netease, playable, playableResolveOptions(config, { includeLyric: true }));
  const selectedTrack = withLyric?.playable ? withLyric : playable;
  diagnostic.selectedTrackId = String(selectedTrack.id || '');
  return {
    track: selectedTrack,
    pick: normalizeSelectedPick({
      ...pick,
      name: selectedTrack.name || pick.name,
      artists: selectedTrack.artists?.length ? selectedTrack.artists : pick.artists,
      noveltyBucket: candidate.noveltyBucket || null,
      discoverySource: candidate.discoverySource || null,
      reason: pick.reason || candidate.sourceReason || '来自你的本地音乐画像候选'
    }, selectedTrack),
    noveltyBucket: candidate.noveltyBucket || null,
    discoverySource: candidate.discoverySource || null,
    diagnostic: trimSearchDiagnostic(diagnostic)
  };
}

function applyRequestToSongPick(pick = {}, request = {}) {
  if (!request?.songTitle) return pick;
  const requestArtists = request.artistConstraint?.label
    ? [request.artistConstraint.label]
    : normalizeArtistList(pick.artists || []);
  return {
    ...pick,
    name: request.songTitle,
    artists: requestArtists,
    artistMatchMode: request.artistConstraint?.label ? 'required' : 'soft',
    requestText: request.text || '',
    requestedSongTitle: request.songTitle
  };
}

function normalizeSelectedPick(pick = {}, selectedTrack = {}) {
  return {
    ...pick,
    name: selectedTrack?.name || pick.name,
    artists: selectedTrack?.artists?.length ? selectedTrack.artists : pick.artists
  };
}

function compareSearchTrackScores(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const versionDelta = (b.scoreDetails?.scoreParts?.version || 0) - (a.scoreDetails?.scoreParts?.version || 0);
  if (versionDelta) return versionDelta;
  const artistDelta = (b.scoreDetails?.scoreParts?.artist || 0) - (a.scoreDetails?.scoreParts?.artist || 0);
  if (artistDelta) return artistDelta;
  return 0;
}

async function searchTracksForSongPick(pick, { request = {} } = {}) {
  const seen = new Set();
  const results = [];
  const queries = buildSongSearchQueries(pick, { request });
  const queryDiagnostics = [];
  for (const query of queries) {
    try {
      const tracks = await searchOnline(query, 10);
      queryDiagnostics.push({ query, count: tracks.length, error: null });
      for (const track of tracks) {
        const id = String(track?.id || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        results.push(track);
      }
    } catch (error) {
      queryDiagnostics.push({ query, count: 0, error: String(error?.message || error).slice(0, 160) });
    }
  }
  return { tracks: results, queries, queryDiagnostics };
}

function sanitizeSongPlan(plan = {}, attempt = 0) {
  return {
    attempt,
    picks: (plan?.picks || []).map(sanitizeSongPick).slice(0, 3),
    hostDraft: String(plan?.hostDraft || '').slice(0, 160),
    mode: plan?.mode ?? null,
    updatedAt: nowIso()
  };
}

function sanitizeSongPick(pick = {}) {
  return {
    candidateId: String(pick.candidateId || '').slice(0, 80),
    name: String(pick.name || '').slice(0, 80),
    artists: normalizeArtistList(pick.artists || []).slice(0, 4),
    reason: String(pick.reason || '').slice(0, 140),
    queries: Array.isArray(pick.queries) ? pick.queries.map(query => String(query || '').slice(0, 60)).slice(0, 5) : []
  };
}

function sanitizeTrackForDebug(track = {}) {
  return {
    id: String(track.id || ''),
    name: String(track.name || '').slice(0, 80),
    artists: Array.isArray(track.artists) ? track.artists.slice(0, 4) : [],
    album: String(track.album || '').slice(0, 80)
  };
}

function trimSearchDiagnostic(diagnostic = {}) {
  return {
    ...diagnostic,
    hits: (diagnostic.hits || []).slice(0, 8)
  };
}

export function buildSongSearchQueries(pick = {}, { request = {} } = {}) {
  const name = String(request?.songTitle || pick.name || '').trim();
  const artists = normalizeArtistList(pick.artists || []);
  if (!name) return [];
  const explicitArtist = String(request?.artistConstraint?.label || '').trim();
  const primaryArtist = explicitArtist || artists[0] || '';
  const querySeeds = request?.songTitle
    ? [
        name,
        explicitArtist ? `${name} ${explicitArtist}` : '',
        explicitArtist ? `${explicitArtist} ${name}` : '',
        ...(explicitArtist ? pick.queries || [] : [])
      ]
    : [
        primaryArtist ? `${name} ${primaryArtist}` : '',
        primaryArtist ? `${primaryArtist} ${name}` : '',
        ...(pick.queries || []),
        name
      ];
  const nameToken = normalizeMusicText(name);
  return uniqueStrings(querySeeds
    .map(sanitizeSongSearchQuery)
    .filter(query => query && normalizeMusicText(query).includes(nameToken)), 5);
}

function sanitizeSongSearchQuery(value) {
  const clean = String(value || '')
    .replace(/[“”"']/g, '')
    .replace(/[。！？!?；;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean || clean.length > 40 || normalizeMusicText(clean).length < 2) return '';
  return clean;
}

export function trackMatchesSongPick(track, pick = {}) {
  return scoreSearchTrackForPick(track, pick) >= 100;
}

export function scoreSearchTrackForPick(track, pick = {}) {
  return scoreSearchTrackForPickDetails(track, pick).score;
}

export function scoreSearchTrackForPickDetails(track, pick = {}) {
  const wantedName = normalizeMusicText(pick.name);
  const wantedBaseName = normalizeMusicText(stripSongVersion(pick.name));
  const actualName = normalizeMusicText(track?.name || '');
  const actualBaseName = normalizeMusicText(stripSongVersion(track?.name || ''));
  const scoreParts = { name: 0, artist: 0, version: 0 };
  if (!wantedName || !actualName) return { score: 0, scoreParts, filterReason: 'missing_name' };

  let nameScore = 0;
  if (actualName === wantedName || actualBaseName === wantedBaseName) nameScore = 120;
  else if (actualName.includes(wantedName) || wantedName.includes(actualName)) nameScore = 96;
  else if (wantedBaseName && (actualBaseName.includes(wantedBaseName) || wantedBaseName.includes(actualBaseName))) nameScore = 90;
  scoreParts.name = nameScore;
  if (nameScore < 80) return { score: 0, scoreParts, filterReason: 'name_mismatch' };

  const wantedArtists = expandArtistAliases(normalizeArtistList(pick.artists || []));
  if (!wantedArtists.length) {
    scoreParts.artist = 20;
  } else {
    const actualArtists = expandArtistAliases(track?.artists || []);
    const artistMatched = actualArtists.some(artist =>
      wantedArtists.some(wanted => artist === wanted || artist.includes(wanted) || wanted.includes(artist))
    );
    if (artistMatched) {
      scoreParts.artist = 45;
    } else if (pick.artistMatchMode === 'soft' || pick.allowArtistMismatch) {
      scoreParts.artist = -8;
    } else {
      return { score: 0, scoreParts, filterReason: 'artist_mismatch' };
    }
  }

  const version = scoreTrackVersionForPick(track, pick);
  scoreParts.version = version.score;
  const score = Object.values(scoreParts).reduce((sum, value) => sum + value, 0);
  let filterReason = null;
  if (scoreParts.artist < 0) filterReason = 'artist_mismatch_soft_penalty';
  if (version.reason && version.score < 0) filterReason = version.reason;
  return {
    score,
    scoreParts,
    filterReason: score >= 100 ? filterReason : (filterReason || 'name_or_artist_mismatch')
  };
}

function scoreTrackVersionForPick(track, pick = {}) {
  const requested = requestedVersionKind(pick);
  const markers = getTrackVersionMarkers(track);
  if (!markers.length) return { score: 12, reason: 'original_preferred' };
  if (requested && markers.includes(requested)) return { score: 18, reason: `requested_version_${requested}` };
  if (requested) return { score: -6, reason: `requested_version_mismatch_${requested}` };
  if (markers.includes('live')) return { score: -35, reason: 'version_penalty_live' };
  if (markers.includes('remix')) return { score: -45, reason: 'version_penalty_remix' };
  if (markers.includes('cover')) return { score: -45, reason: 'version_penalty_cover' };
  if (markers.includes('instrumental')) return { score: -40, reason: 'version_penalty_instrumental' };
  return { score: -18, reason: 'version_penalty_variant' };
}

function requestedVersionKind(pick = {}) {
  const text = `${pick.requestText || ''} ${pick.versionPreference || ''}`.toLowerCase();
  if (/live|现场|演唱会|concert/.test(text)) return 'live';
  if (/remix|混音|dj\b|电音/.test(text)) return 'remix';
  if (/cover|翻唱/.test(text)) return 'cover';
  if (/伴奏|纯音乐|instrumental|钢琴|piano|beat|type\s*beat/.test(text)) return 'instrumental';
  return '';
}

function getTrackVersionMarkers(track = {}) {
  const text = `${track?.name || ''} ${track?.album || ''}`.toLowerCase();
  const markers = [];
  if (/live|现场|演唱会|concert/.test(text)) markers.push('live');
  if (/remix|混音|dj\b|电音/.test(text)) markers.push('remix');
  if (/cover|翻唱|翻自/.test(text)) markers.push('cover');
  if (/伴奏|纯音乐|instrumental|钢琴|piano|beat|type\s*beat|free/.test(text)) markers.push('instrumental');
  if (!markers.length && /(?:^|[\s(（-])(?:album|single|studio)\s*version|录音室版|专辑版|国语版|粤语版/.test(text)) markers.push('variant');
  return [...new Set(markers)];
}

function expandArtistAliases(artists = []) {
  const names = new Set();
  for (const artist of artists || []) {
    const raw = String(artist || '').trim();
    if (!raw) continue;
    names.add(normalizeMusicText(raw));
    for (const [label, aliases] of KNOWN_ARTIST_ALIASES) {
      const normalizedGroup = [label, ...aliases].map(normalizeMusicText);
      if (normalizedGroup.includes(normalizeMusicText(raw))) {
        normalizedGroup.forEach(name => names.add(name));
      }
    }
  }
  return [...names].filter(Boolean);
}

function stripSongVersion(value) {
  return String(value || '')
    .replace(/[（(【[].*?[）)】\]]/g, '')
    .replace(/\s*[-–—]+\s*(album\s*version|single\s*version|live\s*version|studio\s*version|remix|cover|live|伴奏|纯音乐|翻唱|现场版|录音室版|.*版)\s*$/gi, '')
    .replace(/\b(album\s*version|single\s*version|live\s*version|studio\s*version|live|remix|cover)\b/gi, '')
    .replace(/(伴奏|纯音乐|翻唱|现场版|录音室版|专辑版|国语版|粤语版|版本|版)$/g, '')
    .trim();
}

async function generateFinalHostText({
  config,
  plan,
  selectedPick,
  selectedTrack,
  profile,
  prefs,
  history,
  timeOfDay,
  hour,
  weather,
  conversationMood,
  userMessage,
  memoryContext,
  hostContext = {},
  environmentContext = {}
}) {
  const fallbackText = finalizeSongPlanHostText({
    plan,
    selectedPick,
    selectedTrack,
    timeOfDay,
    weather,
    conversationMood,
    userMessage,
    hostContext
  });
  if (!config?.llm?.baseUrl || !config?.llm?.apiKey || !config?.llm?.model) return fallbackText;

  const artistText = (selectedTrack.artists || selectedPick?.artists || []).join('、');
  const raw = await generateChatCompletion(config.llm, buildFinalHostMessages({
    selectedTrack,
    selectedPick,
    plan,
    artistText,
    profile,
    prefs,
    history,
    timeOfDay,
    hour,
    weather,
    conversationMood,
    userMessage,
    memoryContext,
    hostContext,
    environmentContext
  }), () => JSON.stringify({ chatText: fallbackText }));

  const parsedText = parseFinalHostText(raw, fallbackText);
  return finalizeSongPlanHostText({
    plan,
    selectedPick,
    selectedTrack,
    timeOfDay,
    weather,
    conversationMood,
    userMessage,
    overrideText: parsedText,
    hostContext
  });
}

export function buildFinalHostMessages({
  selectedTrack,
  selectedPick = {},
  plan = {},
  artistText = '',
  profile = {},
  prefs = {},
  history = [],
  timeOfDay,
  hour,
  weather,
  conversationMood,
  userMessage,
  memoryContext = {},
  hostContext = {},
  environmentContext = {}
} = {}) {
  const firstTurn = Boolean(hostContext.isFirstRadioTurn);
  const profilePrompt = formatProfileSummaryForPrompt(profile);
  const weatherRadioPrompt = formatWeatherRadioForPrompt(environmentContext.weatherRadio);
  const musicRecapPrompt = formatOpeningMusicRecapForPrompt(hostContext.openingRecap);
  return [
    {
      role: 'system',
      content: [
        '你是灿灿，私人电台 AI DJ。最终可播放歌曲已经确认，你只负责写播出前导播词。',
        buildCanCanBackgroundPrompt(userMessage),
        'If MUSIC_RECAP has openingLine, naturally mention it once at the start. If it is none, do not invent yesterday usage. WEATHER_RADIO is atmosphere only and must not override explicit user requests.',
        '写 40-110 个中文字，像真实电台里临场说的一小段话。可以温柔、俏皮、安静、直接、轻轻吐槽，但不要像推荐理由、搜索说明或固定播报。',
        '不要套固定模板。尤其避免反复使用“刚才……现在……”“上一首……接下来……”“那首……这首……”“我找到……”“愿这首歌……”“陪你……一会儿”“把声音递给你”“让气氛慢慢……”这类结构。',
        firstTurn
          ? '这是本轮电台第一次播歌，可以自然交代一次时间、天气或城市，但最多一句，不要写成天气播报。'
          : '这不是本轮电台第一次播歌。除非用户主动问天气，否则不要再用时间、天气、城市、温度开头，也不要重复“深夜的上海”。',
        '时间天气是事实背景，不是固定模板。后续导播只有用户主动问、或歌曲氛围明显适合时才可以轻描淡写提；如果提到，必须严格按 APP_TIME_CONTEXT，不要编造今晚、明天或稍后的天气。',
        '上一首歌、最近操作、喜欢/不喜欢/下一首，只是可选素材，不要强行做上一首到当前歌曲的转场。',
        '可以只抓一个角度写：回应听众刚才的话、点一下这首歌的声音气质、点一下歌手或歌名带来的感觉、直接带进歌曲、用一个很短的画面或情绪、轻轻开个小玩笑。',
        '必须只围绕最终确认的歌曲和艺人展开。不能提到其他候选歌名、候选艺人或“我推荐了三首”。',
        '必须准确包含最终歌曲名，最好用书名号；可以包含艺人名。不要编造歌词、专辑、故事或不可确认的信息。',
        '句式自由，可以短句、停顿、比喻或轻声聊天，但每次角度要不同。不要输出 Markdown，不要解释。只输出严格 JSON：{"chatText":"40-110字导播词"}'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `本轮是否第一次播歌：${firstTurn ? '是，可以轻描淡写使用一次时间天气' : '否，避免天气时间模板'}`,
        `触发原因：${hostContext.trigger || inferRadioTrigger(userMessage)}`,
        `最终歌曲：${selectedTrack?.name || ''}`,
        `最终艺人：${artistText || (selectedTrack?.artists || selectedPick?.artists || []).join('、') || '未知'}`,
        selectedTrack?.album ? `专辑：${selectedTrack.album}` : '',
        weatherRadioPrompt,
        musicRecapPrompt,
        `APP_TIME_CONTEXT：${formatEnvironmentContext(environmentContext)}`,
        firstTurn ? `时间天气参考：${timeOfDay} ${hour}点，${weather}` : `时间天气仅供理解氛围，不要写进导播词：${timeOfDay} ${hour}点，${weather}`,
        `听众画像：${profilePrompt}`,
        `偏好设置：${JSON.stringify(normalizeRuntimePrefs(prefs))}`,
        conversationMood ? `对话情绪：${JSON.stringify(conversationMood)}` : '对话情绪：无',
        formatRecentHostPlays(hostContext.recentPlays),
        formatRecentHostFeedback(hostContext.recentFeedback),
        formatRecentHostTexts(hostContext.recentPlays),
        memoryContext?.promptText || '相关长期记忆：无',
        memoryContext?.sessionSummary ? `本轮会话摘要：${memoryContext.sessionSummary}` : '本轮会话摘要：无',
        `最近对话：${history.length ? '\n' + history.map(h => `[${h.role === 'user' ? '听众' : '灿灿'}]: ${h.content}`).join('\n') : '（新对话）'}`,
        userMessage ? `听众刚说：${userMessage}` : '听众刚启动电台或上一首播完。',
        selectedPick?.reason ? `选这首的理由：${selectedPick.reason}` : '',
        selectedPick?.hostLine ? `选歌阶段备用导播，仅可参考素材，不能照抄句式：${selectedPick.hostLine}` : '',
        plan?.hostDraft ? `选歌阶段整体导播，仅可参考素材，不能照抄句式：${plan.hostDraft}` : ''
      ].filter(Boolean).join('\n')
    }
  ];
}

function formatRecentHostPlays(plays = []) {
  const items = (plays || []).slice(0, 4).filter(play => play?.name);
  if (!items.length) return '最近播放：无';
  return `最近播放：\n${items.map((play, index) =>
    `${index + 1}. ${play.name}${play.artists?.length ? ' - ' + play.artists.join('、') : ''}${play.reason ? `（${play.reason}）` : ''}`
  ).join('\n')}`;
}

function formatRecentHostFeedback(events = []) {
  const items = (events || []).slice(0, 6).filter(event => event?.eventType);
  if (!items.length) return '最近操作反馈：无';
  const labels = { like: '喜欢', dislike: '不喜欢', skip: '下一首/跳过', complete: '完整播放' };
  return `最近操作反馈：\n${items.map((event, index) =>
    `${index + 1}. ${labels[event.eventType] || event.eventType}${event.name ? `：${event.name}${event.artists?.length ? ' - ' + event.artists.join('、') : ''}` : ''}`
  ).join('\n')}`;
}

function formatRecentHostTexts(plays = []) {
  const items = (plays || [])
    .map(play => String(play?.hostText || '').trim())
    .filter(Boolean)
    .slice(0, 3);
  if (!items.length) return '最近导播词：无';
  return `最近导播词如下，只用于避免重复句式，不要模仿：\n${items.map((text, index) => `${index + 1}. ${text}`).join('\n')}\n这次请换一个开头、换一个句式，不要复用“刚才/现在/接下来/上一首”的转场结构。`;
}

export function parseFinalHostText(raw, fallbackText = '') {
  const text = stripCodeFence(String(raw || '')).trim();
  if (!text) return fallbackText;
  try {
    const parsed = JSON.parse(text);
    const chatText = String(parsed.chatText || parsed.text || '').trim();
    return chatText || fallbackText;
  } catch {
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]);
        const chatText = String(parsed.chatText || parsed.text || '').trim();
        if (chatText) return chatText;
      } catch {}
    }
  }
  return text;
}

function finalizeSongPlanHostText({ plan, selectedPick, selectedTrack, timeOfDay, weather, conversationMood, userMessage, overrideText = '', hostContext = {} }) {
  const candidateTracks = plan.picks.map((pick, index) => ({
    id: `plan-${index}`,
    name: pick.name,
    artists: pick.artists
  }));
  const fallbackText = buildConfirmedTrackHostFallback({ selectedTrack, timeOfDay, weather, conversationMood, userMessage, hostContext });
  const baseText = overrideText || chooseBestPlanHostText(plan, selectedPick, selectedTrack) || fallbackText;
  const cleanedText = stripUnselectedQuotedSongTitles(baseText, selectedTrack);
  const finalText = ensureRecommendationTextMatchesTrack(cleanedText, selectedTrack, candidateTracks, {
    timeOfDay,
    weather,
    conversationMood,
    userMessage
  });
  const finalTextWithRecap = applyOpeningMusicRecapToHostText(finalText, hostContext.openingRecap);
  if (hostTextLength(finalText) < 35) {
    return applyOpeningMusicRecapToHostText(ensureRecommendationTextMatchesTrack(fallbackText, selectedTrack, candidateTracks, {
      timeOfDay,
      weather,
      conversationMood,
      userMessage
    }), hostContext.openingRecap);
  }
  return finalTextWithRecap;
}

function chooseBestPlanHostText(plan = {}, selectedPick = {}, selectedTrack = {}) {
  const options = [plan.hostDraft, selectedPick.hostLine]
    .map(text => String(text || '').trim())
    .filter(Boolean);
  if (!options.length) return '';
  const selectedName = normalizeMusicText(selectedTrack?.name || '');
  return options
    .sort((a, b) => hostTextScore(b, selectedName) - hostTextScore(a, selectedName))[0];
}

function hostTextScore(text, selectedName) {
  const normalized = normalizeMusicText(text);
  return hostTextLength(text) + (selectedName && normalized.includes(selectedName) ? 60 : 0);
}

function hostTextLength(text) {
  return String(text || '').replace(/\s+/g, '').length;
}

export function buildConfirmedTrackHostFallback({ selectedTrack, timeOfDay, weather, conversationMood, userMessage, hostContext = {} }) {
  const artists = (selectedTrack.artists || []).join('、');
  const trackLabel = `《${selectedTrack.name}》${artists ? ' - ' + artists : ''}`;
  if (!hostContext.isFirstRadioTurn) {
    return `这首是 ${trackLabel}。我们先不多说，听它自己慢慢展开。`;
  }
  if (userMessage) {
    return `这首是 ${trackLabel}。你刚刚说的那一点心情，先交给音乐接一下。`;
  }
  if (conversationMood?.mood && conversationMood.mood !== 'random') {
    return `这首是 ${trackLabel}。不用急着判断合不合适，先听它开口。`;
  }
  return `给你放 ${trackLabel}。先听这首。`;
}

function stripUnselectedQuotedSongTitles(text, selectedTrack) {
  const selected = normalizeMusicText(selectedTrack?.name || '');
  if (!selected) return String(text || '').trim();
  return String(text || '').replace(/《([^》]+)》/g, (match, title) => {
    const normalized = normalizeMusicText(title);
    return normalized === selected || selected.includes(normalized) || normalized.includes(selected)
      ? match
      : '这首歌';
  }).trim();
}

function modeDecisionFromPlan(plan = {}) {
  if (plan.mode === 'reset') return {};
  if (plan.mode && typeof plan.mode === 'string') {
    return { genre: plan.mode, note: '用户指定' };
  }
  return null;
}

function buildNoPlayableSongText(plan = null) {
  if (plan?.picks?.length) {
    return '我刚刚按歌名和艺人去确认了几首歌，但这两批都没有拿到稳定可播放源。我先不硬播不相关的歌，你可以换个歌手、歌名或风格我再找。';
  }
  return '我现在没能生成一组可靠的具体歌名，所以先不乱播。你可以直接说一个歌手、歌名或想要的风格，我再帮你找。';
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

function ensureSession(db, sessionId, accountContext = null) {
  const account = normalizeAccountContext(accountContext);
  let id = String(sessionId || '').trim() || crypto.randomUUID();
  const existing = db.prepare('SELECT id, account_id AS accountId FROM radio_sessions WHERE id = ?').get(id);
  if (existing?.accountId && existing.accountId !== account.accountId) {
    id = crypto.randomUUID();
  }
  const scopedExisting = db.prepare('SELECT id FROM radio_sessions WHERE id = ? AND account_id = ?').get(id, account.accountId);
  if (!scopedExisting) {
    db.prepare('INSERT INTO radio_sessions (id, account_id, created_at, context_json, queue_json) VALUES (?,?,?,?,?)')
      .run(id, account.accountId, nowIso(), '{}', '[]');
  }
  return id;
}
