import { animate } from '/vendor/anime.esm.min.js';
import {
  addPlaybackItem,
  canMovePlaybackPrevious,
  getNextPlaybackItem,
  getPreviousPlaybackItem,
  movePlaybackCursor
} from './playback-sequence.js';
import { ensureDemoDeviceId, rotateDemoDeviceId } from './device-identity.js';
import { getTrackNeteaseSongId } from './track-identity.js';

const AI_MUSIC_MODE_STORAGE_KEY = 'mymusic:aiMusicMode';
const DEVICE_SNAPSHOT_STORAGE_PREFIX = 'mymusic:deviceSnapshot:v1:';
const DEVICE_SNAPSHOT_VERSION = 1;
const DEVICE_SNAPSHOT_MAX_MEMORIES = 80;
const DEVICE_SNAPSHOT_MAX_HISTORY_EVENTS = 400;
const DEVICE_SNAPSHOT_HISTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_DEVICE_PREFERENCES = {
  chatMusicBalance: 'friend',
  recommendationFrequency: 'medium',
  voiceMode: 'recommendations',
  moodMode: 'auto',
  lowDistractionMode: false,
  scheduleAwareEnabled: false,
  note: ''
};

const state = {
  sessionId: null,
  current: null,
  library: null,
  playerPollTimer: null,
  feedbackSent: new Set(),
  activePlayback: null,
  lyricLines: [],
  activeLyricIndex: -1,
  avatarState: 'idle',
  preferences: null,
  feedbackSummary: null,
  memories: [],
  moodStats: null,
  diaryOverview: null,
  mixerRefreshTimer: null,
  librarySyncTimer: null,
  librarySyncStatus: null,
  profileSelectionDirty: false,
  librarySyncNotice: '',
  radioPrefetchPromise: null,
  radioPrefetchRetryTimer: null,
  radioPrefetchRetryDepth: 0,
  playbackSequence: [],
  playbackCursor: -1,
  demoSelfCheck: null,
  demoSelfCheckRunning: false,
  radioTurnSeq: 0,
  activeRadioTurn: null,
  playbackTokenSeq: 0,
  activePlaybackToken: 0,
  deviceSnapshotRestorePromise: null,
  songFadeInFrame: null,
  songFadeInActive: false,
  songFadeInTrackKey: null,
  songFadeInOfficial: false,
  radioMode: 'single',
  scheduleStatus: null,
  schedulePlanning: false,
  activeConcert: null,
  concertStatus: 'idle',
  concertSettings: {
    length: 5,
    genres: [],
    mood: '自动',
    scene: '自动',
    audiencePreset: '温暖',
    note: ''
  },
  concertDanmaku: { ai: true, real: true },
  sessionConstraints: { rules: [], remainingTracks: 0 },
  aiMusicMode: readStoredAiMusicMode()
};

const progressSeekState = {
  dragging: false,
  suppressClick: false,
  pointerId: null,
  previewTime: null,
  documentListenersReady: false
};

let progressAnimationFrame = null;

const DANMAKU_MIN_DELAY_MS = 4500;
const DANMAKU_MAX_DELAY_MS = 9500;
const DANMAKU_INITIAL_DELAY_MS = 1800;
const DANMAKU_MAX_VISIBLE = 4;
const RADIO_PREFETCH_TARGET_ACTIVE = 2;
const RADIO_PREFETCH_RETRY_DELAY_MS = 8000;
const RADIO_PREFETCH_MAX_RETRIES = 2;
const TTS_SONG_OVERLAP_MS = 5000;
const SONG_FADE_IN_MS = 5000;
const HOST_TTS_DUCK_VOLUME = 0.65;
const danmakuState = {
  timer: null,
  token: 0,
  activeTrackId: null,
  activeSongId: null,
  comments: [],
  remainingComments: [],
  realCache: new Map(),
  aiCache: new Map()
};

function ensureDemoVisitorId() {
  return ensureDemoDeviceId();
}

function deviceSnapshotKey(deviceId = ensureDemoVisitorId()) {
  return `${DEVICE_SNAPSHOT_STORAGE_PREFIX}${deviceId}`;
}

function readDeviceSnapshot(deviceId = ensureDemoVisitorId()) {
  try {
    const raw = localStorage.getItem(deviceSnapshotKey(deviceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== DEVICE_SNAPSHOT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearDeviceSnapshot(deviceId = ensureDemoVisitorId()) {
  try {
    localStorage.removeItem(deviceSnapshotKey(deviceId));
  } catch {}
}

function persistDeviceSnapshot(data = {}, options = {}) {
  let deviceId = '';
  try {
    deviceId = ensureDemoVisitorId();
  } catch {
    return;
  }
  const previous = readDeviceSnapshot(deviceId) || {};
  const next = {
    version: DEVICE_SNAPSHOT_VERSION,
    deviceId,
    updatedAt: new Date().toISOString(),
    preferences: previous.preferences || null,
    memories: Array.isArray(previous.memories) ? previous.memories : [],
    feedbackSummary: previous.feedbackSummary || null,
    moodStats: previous.moodStats || null,
    history: Array.isArray(previous.history) ? sanitizeHistorySnapshotList(previous.history) : []
  };

  if (Object.prototype.hasOwnProperty.call(data, 'preferences')) {
    const preferences = sanitizePreferenceSnapshot(data.preferences);
    const hasUsefulNext = hasUsefulPreferenceSnapshot(preferences);
    const hasUsefulPrevious = hasUsefulPreferenceSnapshot(previous.preferences);
    next.preferences = hasUsefulNext || options.replaceDefaultPreferences || !hasUsefulPrevious
      ? preferences
      : previous.preferences;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'memories')) {
    const memories = sanitizeMemorySnapshotList(data.memories);
    next.memories = memories.length || options.replaceEmptyMemories || !(previous.memories || []).length
      ? memories
      : previous.memories;
  }
  if (data.feedbackSummary) next.feedbackSummary = data.feedbackSummary;
  if (data.moodStats) next.moodStats = data.moodStats;
  if (Object.prototype.hasOwnProperty.call(data, 'history')) {
    const history = sanitizeHistorySnapshotList(data.history);
    next.history = history.length || options.replaceHistory || !next.history.length
      ? history
      : next.history;
  }

  if (!hasUsefulDeviceSnapshot(next)) return;
  try {
    localStorage.setItem(deviceSnapshotKey(deviceId), JSON.stringify(next));
  } catch {}
}

function sanitizePreferenceSnapshot(preferences = {}) {
  const source = preferences && typeof preferences === 'object' ? preferences : {};
  return {
    chatMusicBalance: source.chatMusicBalance || DEFAULT_DEVICE_PREFERENCES.chatMusicBalance,
    recommendationFrequency: source.recommendationFrequency || DEFAULT_DEVICE_PREFERENCES.recommendationFrequency,
    voiceMode: source.voiceMode || DEFAULT_DEVICE_PREFERENCES.voiceMode,
    moodMode: source.moodMode || DEFAULT_DEVICE_PREFERENCES.moodMode,
    lowDistractionMode: source.lowDistractionMode === true,
    scheduleAwareEnabled: source.scheduleAwareEnabled === true,
    note: String(source.note || '').slice(0, 500)
  };
}

function sanitizeMemorySnapshotList(memories = []) {
  return Array.isArray(memories)
    ? memories.map(sanitizeMemorySnapshot).filter(Boolean).slice(0, DEVICE_SNAPSHOT_MAX_MEMORIES)
    : [];
}

function sanitizeMemorySnapshot(memory = {}) {
  if (!memory || typeof memory !== 'object') return null;
  const content = String(memory.content || '').trim().slice(0, 180);
  if (!content) return null;
  return {
    id: memory.id,
    kind: String(memory.kind || 'preference'),
    content,
    tags: Array.isArray(memory.tags) ? memory.tags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 12) : [],
    confidence: clampNumber(memory.confidence, 0, 1, 0.5),
    importance: clampNumber(memory.importance, 0, 1, 0.5),
    sourceSessionId: memory.sourceSessionId || 'device-snapshot',
    updatedAt: memory.updatedAt || null
  };
}

function sanitizeHistorySnapshotList(history = []) {
  if (!Array.isArray(history)) return [];
  const cutoff = Date.now() - DEVICE_SNAPSHOT_HISTORY_TTL_MS;
  const map = new Map();
  for (const item of history) {
    const event = sanitizeHistorySnapshotEvent(item);
    if (!event) continue;
    const eventTime = new Date(event.playedAt || event.createdAt).getTime();
    if (!Number.isFinite(eventTime) || eventTime < cutoff) continue;
    map.set(historySnapshotEventKey(event), event);
  }
  return [...map.values()]
    .sort((a, b) => new Date(a.playedAt || a.createdAt) - new Date(b.playedAt || b.createdAt))
    .slice(-DEVICE_SNAPSHOT_MAX_HISTORY_EVENTS);
}

function sanitizeHistorySnapshotEvent(event = {}) {
  if (!event || typeof event !== 'object') return null;
  const type = event.type === 'feedback' ? 'feedback' : event.type === 'play' ? 'play' : '';
  if (!type) return null;
  const track = sanitizeHistoryTrackSnapshot(event.track || event);
  if (!track?.id) return null;
  const createdAt = normalizeHistorySnapshotIso(event.createdAt || event.playedAt);
  const playedAt = normalizeHistorySnapshotIso(event.playedAt || event.createdAt);
  if (type === 'play') {
    if (!playedAt) return null;
    return {
      type,
      track,
      trackId: track.id,
      playedAt,
      source: String(event.source || 'browser').slice(0, 40),
      reason: String(event.reason || '').slice(0, 240)
    };
  }
  const eventType = ['like', 'dislike', 'complete', 'skip'].includes(event.eventType) ? event.eventType : '';
  if (!eventType || !createdAt) return null;
  return {
    type,
    track,
    trackId: track.id,
    eventType,
    createdAt,
    sessionId: event.sessionId ? String(event.sessionId).slice(0, 80) : null,
    elapsedMs: Math.max(0, Number(event.elapsedMs) || 0),
    durationMs: Math.max(0, Number(event.durationMs || track.durationMs) || 0),
    source: String(event.source || 'ui').slice(0, 40)
  };
}

function sanitizeHistoryTrackSnapshot(track = {}) {
  if (!track || typeof track !== 'object') return null;
  const id = String(track.id || track.trackId || '').trim();
  if (!id) return null;
  return {
    id,
    name: String(track.name || '未知歌曲').slice(0, 160),
    artists: Array.isArray(track.artists) ? track.artists.map((artist) => String(artist || '').trim()).filter(Boolean).slice(0, 8) : [],
    album: String(track.album || '').slice(0, 160),
    coverUrl: String(track.coverUrl || track.cover_url || '').slice(0, 500),
    durationMs: Math.max(0, Number(track.durationMs || track.duration_ms) || 0)
  };
}

function normalizeHistorySnapshotIso(value) {
  const date = value ? new Date(value) : new Date();
  const time = date.getTime();
  if (!Number.isFinite(time)) return '';
  const maxFuture = Date.now() + 60 * 60 * 1000;
  if (time > maxFuture) return '';
  return date.toISOString();
}

function historySnapshotEventKey(event = {}) {
  return [
    event.type || '',
    event.trackId || event.track?.id || '',
    event.eventType || '',
    event.playedAt || event.createdAt || ''
  ].join('|');
}

function persistDeviceHistoryEvent(event = {}) {
  let deviceId = '';
  try {
    deviceId = ensureDemoVisitorId();
  } catch {
    return;
  }
  const previous = readDeviceSnapshot(deviceId) || {};
  const history = sanitizeHistorySnapshotList([
    ...(Array.isArray(previous.history) ? previous.history : []),
    event
  ]);
  persistDeviceSnapshot({ history }, { replaceHistory: true });
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function hasUsefulDeviceSnapshot(snapshot = {}) {
  return hasUsefulPreferenceSnapshot(snapshot.preferences)
    || (Array.isArray(snapshot.memories) && snapshot.memories.length > 0)
    || (Array.isArray(snapshot.history) && snapshot.history.length > 0);
}

function hasUsefulPreferenceSnapshot(preferences = {}) {
  if (!preferences || typeof preferences !== 'object') return false;
  return Object.entries(DEFAULT_DEVICE_PREFERENCES).some(([key, defaultValue]) => {
    const value = preferences[key];
    return String(value ?? defaultValue) !== String(defaultValue);
  });
}

function shouldRestoreDeviceSnapshot(snapshot = {}, serverState = {}) {
  if (!hasUsefulDeviceSnapshot(snapshot)) return false;
  if ((snapshot.history || []).length > 0 && shouldRestoreDiaryHistorySnapshot(snapshot.history, serverState.diaryOverview)) {
    return true;
  }
  const serverMemories = Array.isArray(serverState.memories) ? serverState.memories : [];
  if ((snapshot.memories || []).length > 0 && serverMemories.length === 0) return true;

  const localPrefs = sanitizePreferenceSnapshot(snapshot.preferences || {});
  const serverPrefs = sanitizePreferenceSnapshot(serverState.preferences || {});
  if (!hasUsefulPreferenceSnapshot(localPrefs)) return false;
  return Object.entries(localPrefs).some(([key, value]) => {
    const defaultValue = DEFAULT_DEVICE_PREFERENCES[key];
    return String(value ?? defaultValue) !== String(defaultValue)
      && String(serverPrefs[key] ?? defaultValue) === String(defaultValue);
  });
}

function shouldRestoreDiaryHistorySnapshot(history = [], overview = null) {
  if (!overview || !Array.isArray(history) || history.length === 0) return false;
  const detailHasActivity = Boolean(overview.detail?.hasActivity);
  const timelineHasActivity = Array.isArray(overview.timeline) && overview.timeline.some((day) => day?.hasActivity);
  if (detailHasActivity) return false;
  const dates = new Set([
    overview.selectedDate,
    overview.detail?.date,
    ...(Array.isArray(overview.timeline) && !timelineHasActivity ? overview.timeline.map((day) => day?.date) : [])
  ].filter(Boolean));
  if (!dates.size) return !timelineHasActivity;
  const timeZone = overview.timeZone || 'Asia/Shanghai';
  return history.some((event) => dates.has(localDateFromHistoryEvent(event, timeZone)));
}

function localDateFromHistoryEvent(event = {}, timeZone = 'Asia/Shanghai') {
  const iso = event.playedAt || event.createdAt;
  if (!iso) return '';
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(iso)).reduce((result, item) => ({ ...result, [item.type]: item.value }), {});
    return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : '';
  } catch {
    return '';
  }
}

async function restoreDeviceSnapshotIfNeeded(serverState = {}) {
  const snapshot = readDeviceSnapshot();
  if (!shouldRestoreDeviceSnapshot(snapshot, serverState)) {
    persistDeviceSnapshot(serverState);
    return null;
  }
  if (state.deviceSnapshotRestorePromise) return state.deviceSnapshotRestorePromise;
  state.deviceSnapshotRestorePromise = api('/api/demo/guest/restore', {
    method: 'POST',
    body: { snapshot }
  }).then((data) => {
    if (data.preferences) {
      state.preferences = data.preferences;
      applyLowDistractionVisualMode(state.preferences);
    }
    if (Array.isArray(data.memories)) state.memories = data.memories;
    if (data.feedbackSummary) state.feedbackSummary = data.feedbackSummary;
    persistDeviceSnapshot({
      preferences: state.preferences,
      memories: state.memories,
      feedbackSummary: state.feedbackSummary
    }, { replaceDefaultPreferences: true, replaceEmptyMemories: true });
    return data;
  }).catch(() => null).finally(() => {
    state.deviceSnapshotRestorePromise = null;
  });
  return state.deviceSnapshotRestorePromise;
}

async function bootstrapDeviceSnapshotRestore() {
  const snapshot = readDeviceSnapshot();
  if (!hasUsefulDeviceSnapshot(snapshot)) return;
  const [prefData, memoryData] = await Promise.all([
    api('/api/preferences').catch(() => ({ preferences: state.preferences || {}, feedbackSummary: state.feedbackSummary || {} })),
    api('/api/memories').catch(() => ({ memories: state.memories || [] }))
  ]);
  const preferences = prefData.preferences || state.preferences || {};
  const memories = Array.isArray(memoryData.memories) ? memoryData.memories : state.memories || [];
  state.preferences = preferences;
  state.feedbackSummary = prefData.feedbackSummary || state.feedbackSummary || {};
  state.memories = memories;
  await restoreDeviceSnapshotIfNeeded({ preferences, memories, feedbackSummary: state.feedbackSummary });
  refreshMixerUsagePanels();
}

// Module-level mutable state — MUST be declared before render() call at line ~30
let statusLocked = false;
let btnFeedbackReady = false;
let loadingMsgIndex = 0;
let loadingMsgTimer = null;
let loadingMessageEl = null;
const activeLoadingMessages = new Set();
let savedChatHTML = '';
let avatarRestoreTimer = null;
let avatarFrameTimer = null;
let avatarFrameSequenceToken = 0;
let avatarVideoToken = 0;
let avatarTransitionToken = 0;
let avatarTransitionTimer = null;
let avatarPreloadScheduled = false;
let avatarHealthMonitorReady = false;
let avatarVideoRetryTimer = null;
let preferencesLoadPromise = null;
const VISUALIZER_DEBUG = false;
const visualizerReducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
const visualizerPalette = ['#00f0ff', '#ff00ff', '#ffd700', '#7f5bff'];
const visualizerState = {
  mode: 'off',
  particles: [],
  lastTime: 0,
  lastRender: 0,
  lastAnalysisTry: 0,
  lastCanvasMeasure: 0,
  lastRailMeasure: 0,
  dpr: 1,
  cssWidth: 0,
  cssHeight: 0,
  rails: null,
  intensity: { low: 0, mid: 0, high: 0, overall: 0, beat: 0 },
  smoothedOverall: 0,
  lastOverall: 0,
  hostReleaseStartedAt: 0,
  hostReleaseDurationMs: 720
};
let visualizerAnimId = null;
let visualizerAudioCtx = null;
let visualizerActiveAudio = null;
let visualizerActiveAnalyser = null;
let visualizerFrequencyData = null;
let visualizerCaptureWarningShown = false;
const visualizerCaptureCache = new WeakMap();
const visualizerCaptureEntries = new Set();
let _drawFrameCount = 0;
let _drawLogged = false;

visualizerReducedMotion?.addEventListener?.('change', () => {
  const canvas = document.querySelector('#visualizer-canvas');
  seedVisualizerParticles(canvas, true);
});

function makeAvatarFrameSequence(stateName, durations, options = {}) {
  return {
    spriteSrc: options.sprite === false ? '' : `/avatar/sprites/${stateName}.png`,
    loopMs: durations.reduce((total, durationMs) => total + durationMs, 0),
    frames: durations.map((durationMs, index) => ({
      src: `/avatar/frames/${stateName}/${String(index).padStart(2, '0')}.png`,
      durationMs
    }))
  };
}

const avatarFrameSequences = {
  idle: makeAvatarFrameSequence('idle', [180, 200, 220, 240, 120, 120, 200, 220, 240, 260, 300, 367]),
  listening: makeAvatarFrameSequence('listening', [240, 260, 280, 320, 360, 320, 280, 260, 240, 260, 300, 280]),
  talking: makeAvatarFrameSequence('talking', [220, 220, 220, 240, 240, 240, 220, 100, 220, 240, 240, 400]),
  searching: makeAvatarFrameSequence('searching', [300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300, 300]),
  reading: makeAvatarFrameSequence('reading', [240, 240, 250, 260, 260, 250, 240, 240, 250, 260, 260, 250]),
  // The happy strip can expose adjacent cells in the square avatar viewport; frame PNGs stay single-frame.
  happy: makeAvatarFrameSequence('happy', [160, 160, 170, 180, 180, 170, 160, 220], { sprite: false })
};

const AVATAR_VIDEO_VERSION = '4';
const AVATAR_FALLBACK_IMAGE = `/avatar/source/cancan-first-frame.png?v=${AVATAR_VIDEO_VERSION}`;
const avatarMotionMap = {
  idle: `/avatar/webm/idle.webm?v=${AVATAR_VIDEO_VERSION}`,
  listening: `/avatar/webm/listening.webm?v=${AVATAR_VIDEO_VERSION}`,
  talking: `/avatar/webm/talking.webm?v=${AVATAR_VIDEO_VERSION}`,
  searching: `/avatar/webm/searching_music.webm?v=${AVATAR_VIDEO_VERSION}`,
  reading: `/avatar/webm/reading_book.webm?v=${AVATAR_VIDEO_VERSION}`,
  happy: `/avatar/webm/happy.webm?v=${AVATAR_VIDEO_VERSION}`
};

const avatarStateAliases = {
  searching_music: 'searching',
  reading_book: 'reading'
};
const avatarStateLabels = {
  idle: 'IDLE',
  listening: 'LISTENING',
  talking: 'TALKING',
  searching: 'SEARCH',
  reading: 'READING',
  happy: 'HAPPY'
};
const AVATAR_TRANSITION_MS = 260;
const AVATAR_HAPPY_DISPLAY_MS = 6000;
const AVATAR_MIN_TALKING_MS = 1800;
const AVATAR_MAX_TALKING_MS = 6800;
const SILENT_AUDIO_DATA_URI = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAAAA==';

const mixerOptions = {
  chatMusicBalance: [
    { value: 'friend', label: '更像朋友', detail: '先聊天，少打断，音乐自然接入。' },
    { value: 'balanced', label: '平衡', detail: '聊天和推歌都保持存在感。' },
    { value: 'dj', label: '更像 DJ', detail: '更主动接歌，电台感更强。' }
  ],
  recommendationFrequency: [
    { value: 'low', label: '少', detail: '只有明确需求或强情绪时主动推荐。' },
    { value: 'medium', label: '中', detail: '在合适的聊天节点自然接歌。' },
    { value: 'high', label: '多', detail: '更频繁捕捉场景并切换氛围。' }
  ],
  voiceMode: [
    { value: 'off', label: '关闭', detail: '只显示文字，不合成语音。' },
    { value: 'recommendations', label: '只播推荐', detail: '真正接歌时才播报。' },
    { value: 'all', label: '每句都播', detail: '聊天回复也会语音化。' }
  ],
  moodMode: [
    { value: 'comfort', label: '陪伴', detail: '更柔和，照顾低落或疲惫。' },
    { value: 'focus', label: '专注', detail: '减少打扰，偏稳定和清晰。' },
    { value: 'calm', label: '放松', detail: '降低能量，适合慢下来。' },
    { value: 'night', label: '深夜', detail: '更安静，适合夜晚和睡前。' },
    { value: 'random', label: '随机', detail: '保留一点不可预测的电台感。' }
  ]
};

const view = document.querySelector('#view');
const template = document.querySelector('#player-template');

window.addEventListener('popstate', render);
document.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest('[data-link]') : null;
  if (!link) return;
  event.preventDefault();
  history.pushState({}, '', link.href);
  render();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

globalThis.myMusicAvatar = {
  states: Object.keys(avatarFrameSequences),
  setState: setAvatarState,
  getState: () => document.querySelector('#ai-dj-avatar')?.dataset.state || state.avatarState
};

render();

async function render() {
  // Save chat messages before clearing (they're in #view)
  const chatEl = document.querySelector('#chat-messages');
  if (chatEl) savedChatHTML = chatEl.innerHTML;

  // Move persistent audio elements back to hidden layer before clearing view
  if (view.__audioCleanup) { view.__audioCleanup(); view.__audioCleanup = null; }

  if (state.mixerRefreshTimer && !isUsageInsightsRoute()) {
    clearInterval(state.mixerRefreshTimer);
    state.mixerRefreshTimer = null;
  }
  if (state.librarySyncTimer && location.pathname !== '/library') {
    clearInterval(state.librarySyncTimer);
    state.librarySyncTimer = null;
  }

  document.querySelectorAll('.nav a').forEach((link) => {
    link.classList.toggle('active', new URL(link.href).pathname === location.pathname);
  });
  if (location.pathname === '/library') return renderLibrary();
  if (location.pathname === '/diary') return renderDiary();
  if (location.pathname === '/mixer') return renderMixer();
  if (location.pathname === '/settings') return renderSettings();
  return renderPlayer();
}


// --- Audio visualizer ---
// Prefer a real analyser on the existing audio elements; fall back gracefully when
// the browser or media source blocks Web Audio inspection.

function visualizerLog(...args) {
  if (VISUALIZER_DEBUG) console.log('[viz]', ...args);
}

function initVisualizer() {
  const canvas = document.querySelector('#visualizer-canvas');
  if (!canvas) return;
  canvas.hidden = false;
  canvas.style.display = 'block';
  setupVisualizerCanvas(canvas, true);
  startDrawLoop(canvas, 'idle');
}

function switchVisualizerTo(kind) {
  visualizerLog('switchVisualizerTo(' + kind + ')');
  const canvas = document.querySelector('#visualizer-canvas');

  const hideAll = () => {
    stopDrawLoop();
    clearVisualizerAnalysis();
    setVisualizerMode('off');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'none';
    }
  };
  if (kind === 'off') {
    hideAll();
    return;
  }

  if (canvas) {
    canvas.style.display = 'block';
    setupVisualizerCanvas(canvas);
  }

  stopDrawLoop();
  if (kind === 'idle') {
    clearVisualizerAnalysis();
    startDrawLoop(canvas, 'idle');
    return;
  }
  const mode = kind === 'host' ? 'host' : 'song';
  ensureVisualizerAnalysis(mode);
  startDrawLoop(canvas, mode);
}

function startDrawLoop(canvas, mode = 'idle') {
  if (visualizerAnimId || !canvas) return;
  visualizerLog('startDrawLoop, mode:', mode);
  setVisualizerMode(mode);
  setupVisualizerCanvas(canvas);
  _drawFrameCount = 0;
  _drawLogged = false;
  visualizerState.lastTime = performance.now();
  visualizerState.lastRender = 0;
  function frame(now) {
    visualizerAnimId = requestAnimationFrame(frame);
    if (now - visualizerState.lastRender < 33) return;
    const dt = Math.min(33, Math.max(12, now - visualizerState.lastTime || 16));
    visualizerState.lastTime = now;
    visualizerState.lastRender = now;
    _drawFrameCount++;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (now - visualizerState.lastCanvasMeasure > 500) setupVisualizerCanvas(canvas);
    if (VISUALIZER_DEBUG && !_drawLogged && _drawFrameCount % 30 === 0) {
      console.log('[viz] frame #' + _drawFrameCount, 'mode:', visualizerState.mode, 'intensity:', visualizerState.intensity);
      if (_drawFrameCount >= 120) _drawLogged = true;
    }
    drawParticleVisualizer(ctx, canvas, dt);
  }
  visualizerAnimId = requestAnimationFrame(frame);
}

function stopDrawLoop() {
  if (visualizerAnimId) { cancelAnimationFrame(visualizerAnimId); visualizerAnimId = null; }
}

function setVisualizerMode(mode = 'idle') {
  const previousMode = visualizerState.mode;
  visualizerState.mode = mode;
  if (previousMode === 'host' && mode === 'song' && !visualizerReducedMotion?.matches) {
    visualizerState.hostReleaseStartedAt = performance.now();
  } else if (mode !== 'song') {
    visualizerState.hostReleaseStartedAt = 0;
  }
  const canvas = document.querySelector('#visualizer-canvas');
  if (canvas) canvas.dataset.visualizerMode = mode;
  seedVisualizerParticles(canvas);
}

function getHostReleaseTransition() {
  if (visualizerState.mode !== 'song' || !visualizerState.hostReleaseStartedAt) {
    return { pull: 0, bloom: 0 };
  }
  const elapsed = performance.now() - visualizerState.hostReleaseStartedAt;
  const rawProgress = Math.min(1, elapsed / visualizerState.hostReleaseDurationMs);
  if (rawProgress >= 1) {
    visualizerState.hostReleaseStartedAt = 0;
    return { pull: 0, bloom: 0 };
  }
  const easedProgress = 1 - Math.pow(1 - rawProgress, 3);
  return {
    pull: 1 - easedProgress,
    bloom: Math.sin(rawProgress * Math.PI)
  };
}

function getVisualizerAudioElement(kind = visualizerState.mode) {
  if (kind === 'host') return document.querySelector('#host-audio');
  if (kind === 'song') return document.querySelector('#song-audio');
  return null;
}

function clearVisualizerAnalysis() {
  releaseVisualizerCapture(visualizerActiveAudio);
  releaseInactiveVisualizerCaptures(null);
  visualizerActiveAudio = null;
  visualizerActiveAnalyser = null;
  visualizerFrequencyData = null;
}

function releaseVisualizerCapture(audio) {
  if (!audio) return;
  const cached = visualizerCaptureCache.get(audio);
  if (!cached) return;
  try { cached.source?.disconnect?.(); } catch {}
  try { cached.analyser?.disconnect?.(); } catch {}
  cached.connected = false;
  if (cached.kind === 'media') return;
  try {
    for (const track of cached.stream?.getTracks?.() || []) track.stop?.();
  } catch {}
  visualizerCaptureCache.delete(audio);
  visualizerCaptureEntries.delete(cached);
}

function releaseInactiveVisualizerCaptures(activeAudio = null) {
  for (const entry of [...visualizerCaptureEntries]) {
    if (entry.audio && entry.audio !== activeAudio) releaseVisualizerCapture(entry.audio);
  }
}

function ensureVisualizerAudioContext() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!visualizerAudioCtx) visualizerAudioCtx = new AudioContextCtor();
  if (visualizerAudioCtx.state === 'suspended') {
    visualizerAudioCtx.resume().catch(() => {});
  }
  return visualizerAudioCtx;
}

function configureVisualizerAnalyser(analyser) {
  analyser.fftSize = 128;
  analyser.smoothingTimeConstant = 0.58;
  return analyser;
}

function connectVisualizerMediaEntry(entry) {
  if (entry.connected) return;
  entry.source.connect(entry.analyser);
  entry.analyser.connect(entry.ctx.destination);
  entry.connected = true;
}

function getOrCreateMediaElementAnalyser(audio, ctx) {
  if (!ctx?.createMediaElementSource || !audio) return null;
  const cached = visualizerCaptureCache.get(audio);
  if (cached?.kind === 'media' && cached.ctx === ctx && cached.analyser) {
    connectVisualizerMediaEntry(cached);
    return cached.analyser;
  }
  if (cached?.kind === 'capture') releaseVisualizerCapture(audio);

  try {
    const source = ctx.createMediaElementSource(audio);
    const analyser = configureVisualizerAnalyser(ctx.createAnalyser());
    const entry = { kind: 'media', audio, ctx, source, analyser, connected: false };
    connectVisualizerMediaEntry(entry);
    visualizerCaptureCache.set(audio, entry);
    visualizerCaptureEntries.add(entry);
    return analyser;
  } catch (error) {
    if (!visualizerCaptureWarningShown) {
      console.warn('[viz] media element analysis unavailable:', error?.message || error);
      visualizerCaptureWarningShown = true;
    }
    return null;
  }
}

function getOrCreateCaptureAnalyser(audio) {
  const ctx = ensureVisualizerAudioContext();
  if (!ctx || !audio) return null;

  const cached = visualizerCaptureCache.get(audio);
  if (cached?.ctx === ctx && cached.analyser) {
    if (cached.kind === 'media') connectVisualizerMediaEntry(cached);
    return cached.analyser;
  }

  const mediaAnalyser = getOrCreateMediaElementAnalyser(audio, ctx);
  if (mediaAnalyser) return mediaAnalyser;

  const capture = audio.captureStream || audio.mozCaptureStream;
  if (!capture) return null;

  try {
    const stream = capture.call(audio);
    const source = ctx.createMediaStreamSource(stream);
    const analyser = configureVisualizerAnalyser(ctx.createAnalyser());
    source.connect(analyser);
    const entry = { kind: 'capture', audio, ctx, stream, source, analyser, connected: true };
    visualizerCaptureCache.set(audio, entry);
    visualizerCaptureEntries.add(entry);
    return analyser;
  } catch (error) {
    if (!visualizerCaptureWarningShown) {
      console.warn('[viz] audio capture analysis unavailable:', error?.message || error);
      visualizerCaptureWarningShown = true;
    }
    return null;
  }
}

function ensureVisualizerAnalysis(kind = visualizerState.mode) {
  const audio = getVisualizerAudioElement(kind);
  if (!audio || audio.paused || audio.ended) return false;
  if (visualizerActiveAudio === audio && visualizerActiveAnalyser) return true;

  const now = performance.now();
  if (now - visualizerState.lastAnalysisTry < 450) return false;
  visualizerState.lastAnalysisTry = now;

  const analyser = getOrCreateCaptureAnalyser(audio);
  if (!analyser) return false;
  releaseInactiveVisualizerCaptures(audio);
  visualizerActiveAudio = audio;
  visualizerActiveAnalyser = analyser;
  visualizerFrequencyData = null;
  return true;
}

function setupVisualizerCanvas(canvas, force = false) {
  visualizerState.lastCanvasMeasure = performance.now();
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 1.25);
  const width = Math.max(1, Math.round(rect.width || canvas.clientWidth || 600));
  const height = Math.max(1, Math.round(rect.height || canvas.clientHeight || 72));
  if (!force && visualizerState.cssWidth === width && visualizerState.cssHeight === height && visualizerState.dpr === dpr) return;
  visualizerState.cssWidth = width;
  visualizerState.cssHeight = height;
  visualizerState.dpr = dpr;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  visualizerState.rails = null;
  seedVisualizerParticles(canvas, true);
}

function seedVisualizerParticles(canvas, force = false) {
  if (!canvas || visualizerState.mode === 'off') {
    visualizerState.particles = [];
    return;
  }
  const target = targetVisualizerParticleCount();
  if (!force && Math.abs(visualizerState.particles.length - target) < 8) return;
  visualizerState.particles = Array.from({ length: target }, (_, i) => createVisualizerParticle(i));
}

function targetVisualizerParticleCount() {
  const reduceMotion = Boolean(visualizerReducedMotion?.matches);
  const mobile = globalThis.matchMedia?.('(max-width: 760px)')?.matches;
  if (reduceMotion) return mobile ? 14 : 22;
  return mobile ? 34 : 64;
}

function createVisualizerParticle(index = 0) {
  const rails = getVisualizerRails();
  const rail = rails[index % rails.length] || { x: 0, y: 0, width: visualizerState.cssWidth || 1200, height: visualizerState.cssHeight || 800, side: 'left' };
  return {
    side: rail.side,
    x: rail.x + Math.random() * rail.width,
    y: rail.y + Math.random() * rail.height,
    vx: (rail.side === 'left' ? 1 : -1) * (0.08 + Math.random() * 0.34),
    vy: -0.38 + Math.random() * 0.76,
    size: 1 + (index % 4),
    phase: Math.random() * Math.PI * 2,
    depth: 0.35 + Math.random() * 0.75,
    color: visualizerPalette[index % visualizerPalette.length]
  };
}

function resetVisualizerParticle(particle, index = 0) {
  const rails = getVisualizerRails();
  const fallbackRail = rails[index % rails.length] || { x: 0, y: 0, width: visualizerState.cssWidth || 1200, height: visualizerState.cssHeight || 800, side: 'left' };
  const rail = rails.find((item) => item.side === particle.side) || fallbackRail;
  particle.side = rail.side;
  particle.x = rail.x + Math.random() * rail.width;
  particle.y = rail.y + Math.random() * rail.height;
  particle.vx = (rail.side === 'left' ? 1 : -1) * (0.08 + Math.random() * 0.34);
  particle.vy = -0.38 + Math.random() * 0.76;
  particle.depth = 0.35 + Math.random() * 0.75;
  particle.phase = Math.random() * Math.PI * 2;
  particle.color = visualizerPalette[index % visualizerPalette.length];
}

function getVisualizerRails({ force = false } = {}) {
  const now = performance.now();
  if (!force && visualizerState.rails && now - visualizerState.lastRailMeasure < 500) return visualizerState.rails;
  const width = visualizerState.cssWidth || window.innerWidth || 1200;
  const height = visualizerState.cssHeight || window.innerHeight || 800;
  const shell = document.querySelector('.player-shell') || document.querySelector('.view');
  const rect = shell?.getBoundingClientRect();
  const minRail = width <= 760 ? 26 : 72;
  const sideGap = width <= 760 ? 8 : 24;
  const leftWidth = rect ? Math.max(minRail, Math.min(280, rect.left - sideGap)) : Math.max(minRail, width * 0.16);
  const rightStart = rect ? Math.min(width - minRail, rect.right + sideGap) : width * 0.84;
  const rightWidth = Math.max(minRail, width - rightStart);
  visualizerState.lastRailMeasure = now;
  visualizerState.rails = [
    { side: 'left', x: 0, y: 0, width: leftWidth, height },
    { side: 'right', x: rightStart, y: 0, width: rightWidth, height }
  ];
  return visualizerState.rails;
}

function drawParticleVisualizer(ctx, canvas, dt) {
  const width = visualizerState.cssWidth || canvas.width;
  const height = visualizerState.cssHeight || canvas.height;
  const dpr = visualizerState.dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const intensity = computeVisualizerIntensity();
  visualizerState.intensity = intensity;
  const mode = visualizerState.mode;
  const reduceMotion = Boolean(visualizerReducedMotion?.matches);
  const low = mode === 'idle' ? Math.max(0.08, intensity.low) : intensity.low;
  const mid = mode === 'idle' ? Math.max(0.05, intensity.mid) : intensity.mid;
  const high = mode === 'idle' ? Math.max(0.04, intensity.high) : intensity.high;
  const beat = reduceMotion ? 0 : intensity.beat;

  updateVisualizerParticles(ctx, width, height, { low, mid, high, beat, dt, mode, reduceMotion });
}

function computeVisualizerIntensity() {
  const analysed = readVisualizerAnalysis();
  const idle = 0.055 + Math.sin(performance.now() / 1400) * 0.012;
  const fallbackPulse = currentAudioPulse();
  const boost = (value, factor, cap) => Math.min(cap, value * factor);
  const raw = analysed ? {
    low: boost(analysed.low, 1.86, 0.98),
    mid: boost(analysed.mid, 1.58, 0.9),
    high: boost(analysed.high, 1.76, 0.88),
    overall: boost(analysed.overall, 1.74, 0.92)
  } : {
    low: fallbackPulse,
    mid: fallbackPulse * 0.74,
    high: fallbackPulse * 0.48,
    overall: fallbackPulse
  };
  const overall = Math.max(idle, raw.overall, fallbackPulse * 0.42);
  visualizerState.smoothedOverall = visualizerState.smoothedOverall * 0.78 + overall * 0.22;
  const lift = Math.max(0, overall - visualizerState.lastOverall);
  const beat = analysed
    ? lift * 7.8 + Math.max(0, overall - visualizerState.smoothedOverall) * 3.8
    : fallbackPulse * 0.32;
  visualizerState.lastOverall = overall;
  return {
    low: Math.max(0.04, raw.low, visualizerState.smoothedOverall * 0.62),
    mid: Math.max(0.035, raw.mid, visualizerState.smoothedOverall * 0.44),
    high: Math.max(0.025, raw.high, visualizerState.smoothedOverall * 0.3),
    overall: visualizerState.smoothedOverall,
    beat: Math.min(0.82, beat)
  };
}

function readVisualizerAnalysis() {
  const mode = visualizerState.mode;
  const audio = getVisualizerAudioElement(mode);
  if (!audio || audio.paused || audio.ended) return null;
  ensureVisualizerAnalysis(mode);
  const analyser = visualizerActiveAudio === audio ? visualizerActiveAnalyser : null;
  if (!analyser) return null;

  if (!visualizerFrequencyData || visualizerFrequencyData.length !== analyser.frequencyBinCount) {
    visualizerFrequencyData = new Uint8Array(analyser.frequencyBinCount);
  }
  analyser.getByteFrequencyData(visualizerFrequencyData);

  const band = (start, end) => {
    let sum = 0;
    let count = 0;
    for (let i = start; i < end && i < visualizerFrequencyData.length; i += 1) {
      sum += visualizerFrequencyData[i];
      count += 1;
    }
    return count ? sum / (count * 255) : 0;
  };

  const low = band(0, 8);
  const mid = band(8, 24);
  const high = band(24, visualizerFrequencyData.length);
  const overall = low * 0.54 + mid * 0.32 + high * 0.14;
  if (overall < 0.008) return null;
  return { low, mid, high, overall };
}

function currentAudioPulse() {
  const audio = visualizerState.mode === 'host'
    ? document.querySelector('#host-audio')
    : document.querySelector('#song-audio');
  if (!audio || audio.paused || audio.ended) return 0;
  const t = audio.currentTime || performance.now() / 1000;
  const primary = (Math.sin(t * Math.PI * 1.7) + 1) * 0.5;
  const secondary = (Math.sin(t * Math.PI * 0.73 + 1.8) + 1) * 0.5;
  const isHost = visualizerState.mode === 'host';
  const base = isHost ? 0.14 : 0.18;
  return Math.min(isHost ? 0.36 : 0.42, base + primary * 0.15 + secondary * 0.09);
}

function updateVisualizerParticles(ctx, width, height, values) {
  const { low, mid, high, beat, dt, mode, reduceMotion } = values;
  const motionStep = 0.04;
  const hostRelease = reduceMotion ? { pull: 0, bloom: 0 } : getHostReleaseTransition();
  const speed = reduceMotion
    ? 0.16 + mid * 0.6
    : (mode === 'song' ? 0.86 : 0.58) + mid * 2.6 + beat * 1.7;
  const pulse = reduceMotion
    ? low * 5 + high * 2
    : (mode === 'host' ? low * 15 : low * 15) + high * 10.5 + beat * 9.5;
  const rails = getVisualizerRails();
  for (const [index, particle] of visualizerState.particles.entries()) {
    const rail = rails.find((item) => item.side === particle.side) || rails[index % rails.length];
    if (!rail) continue;
    particle.phase += 0.02 * dt * particle.depth;
    const driftY = Math.sin(particle.phase) * (0.14 + low * 0.72 + beat * 0.54);
    particle.x += particle.vx * speed * dt * motionStep * particle.depth;
    particle.y += (particle.vy + driftY - beat * 0.18) * dt * motionStep;
    if (mode === 'host' || hostRelease.pull > 0) {
      const centerX = particle.side === 'left' ? rail.x + rail.width * 0.58 : rail.x + rail.width * 0.42;
      const centerY = height * 0.5;
      const pull = mode === 'host' ? 1 : hostRelease.pull;
      particle.x += (centerX - particle.x) * 0.00125 * dt * particle.depth * pull;
      particle.y += (centerY - particle.y) * 0.0015 * dt * particle.depth * pull;
      if (mode === 'song' && hostRelease.bloom > 0) {
        particle.x += (particle.x - centerX) * 0.0012 * dt * particle.depth * hostRelease.bloom;
        particle.y += (particle.y - centerY) * 0.0009 * dt * particle.depth * hostRelease.bloom;
      }
    }
    if (
      particle.x < rail.x - 18 ||
      particle.x > rail.x + rail.width + 18 ||
      particle.y < -18 ||
      particle.y > height + 18
    ) {
      resetVisualizerParticle(particle, index);
    }

    const size = Math.max(1, Math.round(particle.size + pulse * particle.depth * 0.3 + hostRelease.bloom * 1.2));
    const alpha = Math.min(0.9, 0.18 + low * 0.44 + high * 0.34 + beat * 0.28 + particle.depth * 0.12 + hostRelease.bloom * 0.08);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.shadowColor = particle.color;
    ctx.shadowBlur = reduceMotion ? 0 : 2.4 + low * 8.5 + beat * 5 + hostRelease.bloom * 3;
    ctx.fillRect(Math.round(particle.x), Math.round(particle.y), size, size);
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function stopVisualizer() {
  switchVisualizerTo('off');
}

function normalizeAvatarState(nextState) {
  const normalized = avatarStateAliases[nextState] || nextState || 'idle';
  return avatarFrameSequences[normalized] || avatarMotionMap[normalized] ? normalized : 'idle';
}

function stopAvatarFrameSequence() {
  avatarFrameSequenceToken += 1;
  if (avatarFrameTimer) {
    clearTimeout(avatarFrameTimer);
    avatarFrameTimer = null;
  }
}

function getAvatarVideos(root) {
  return Array.from(root?.querySelectorAll?.('.avatar-video') || []);
}

function getActiveAvatarVideo(root) {
  return getAvatarVideos(root).find((video) => video.classList.contains('is-active') && !video.hidden)
    || getAvatarVideos(root).find((video) => !video.hidden)
    || null;
}

function getStandbyAvatarVideo(root) {
  const videos = getAvatarVideos(root);
  const activeVideo = getActiveAvatarVideo(root);
  return videos.find((video) => video !== activeVideo) || videos[0] || null;
}

function cancelAvatarVideoFrameCallback(video) {
  if (!video?.__avatarFrameCallbackId) return;
  video.cancelVideoFrameCallback?.(video.__avatarFrameCallbackId);
  video.__avatarFrameCallbackId = null;
}

function clearAvatarVideoHandlers(video) {
  if (!video) return;
  cancelAvatarVideoFrameCallback(video);
  video.onerror = null;
  video.onloadeddata = null;
  video.onended = null;
  video.onpause = null;
  video.onstalled = null;
  video.onwaiting = null;
}

function waitForAvatarVideoFrame(video, callback) {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAvatarVideoFrameCallback(video);
    callback();
  };
  if (typeof video.requestVideoFrameCallback === 'function') {
    video.__avatarFrameCallbackId = video.requestVideoFrameCallback(finish);
  } else {
    requestAnimationFrame(finish);
  }
  setTimeout(finish, 220);
}

function setDisplayedAvatarState(root, displayedState) {
  root.dataset.state = displayedState;
  delete root.dataset.pendingState;
  const status = root.querySelector('.avatar-status');
  if (status) status.textContent = avatarStateLabels[displayedState] || 'IDLE';
}

function scheduleAvatarRestore(options = {}) {
  if (!options.temporaryMs) return;
  if (avatarRestoreTimer) clearTimeout(avatarRestoreTimer);
  const restoreState = options.restoreState || getContextualAvatarState();
  avatarRestoreTimer = setTimeout(() => {
    avatarRestoreTimer = null;
    setAvatarState(restoreState);
  }, options.temporaryMs);
}

function hideAvatarVideos(root, except = null) {
  getAvatarVideos(root).forEach((video) => {
    if (video === except) return;
    clearAvatarVideoHandlers(video);
    video.pause();
    video.hidden = true;
    video.classList.remove('is-active', 'is-pending');
  });
}

function captureAvatarTransitionFrame(root, video, image) {
  const canvas = root.querySelector('#avatar-transition-frame');
  const source = video && !video.hidden && video.readyState >= 2
    ? video
    : image && !image.hidden && image.complete
      ? image
      : null;
  if (!canvas || !source) return null;

  const width = video && source === video ? video.videoWidth : image.naturalWidth;
  const height = video && source === video ? video.videoHeight : image.naturalHeight;
  if (!width || !height) return null;

  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  try {
    context.clearRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
  } catch {
    return null;
  }
  return canvas;
}

function beginAvatarTransition(root, video, image) {
  avatarTransitionToken += 1;
  const token = avatarTransitionToken;
  if (avatarTransitionTimer) {
    clearTimeout(avatarTransitionTimer);
    avatarTransitionTimer = null;
  }

  const canvas = captureAvatarTransitionFrame(root, video, image);
  root.classList.remove('is-avatar-revealing');
  root.classList.remove('is-avatar-transitioning');
  if (!canvas) return token;

  canvas.classList.remove('is-revealing');
  canvas.hidden = false;
  void canvas.offsetWidth;
  root.classList.add('is-avatar-transitioning');
  return token;
}

function finishAvatarTransition(root, token) {
  if (!token || token !== avatarTransitionToken) return;
  const canvas = root.querySelector('#avatar-transition-frame');
  if (!canvas || canvas.hidden) {
    root.classList.remove('is-avatar-transitioning', 'is-avatar-revealing');
    return;
  }

  root.classList.add('is-avatar-revealing');
  canvas.classList.add('is-revealing');
  avatarTransitionTimer = setTimeout(() => {
    if (token !== avatarTransitionToken) return;
    canvas.hidden = true;
    canvas.classList.remove('is-revealing');
    root.classList.remove('is-avatar-transitioning', 'is-avatar-revealing');
    avatarTransitionTimer = null;
  }, AVATAR_TRANSITION_MS);
}

function revealAvatarVideo(root, video, image, displayedState, requestToken, options = {}) {
  if (requestToken !== avatarVideoToken) return;
  if (avatarVideoRetryTimer) {
    clearTimeout(avatarVideoRetryTimer);
    avatarVideoRetryTimer = null;
  }
  const previousVideo = getActiveAvatarVideo(root);
  const transitionToken = beginAvatarTransition(root, previousVideo, image);

  hideAvatarVideos(root, video);
  root.classList.remove('is-fallback');
  root.classList.remove('is-frame-sequence', 'is-sprite-sequence');
  video.classList.remove('is-pending');
  video.classList.add('is-active');
  video.hidden = false;
  if (image) image.hidden = true;
  setDisplayedAvatarState(root, displayedState);
  finishAvatarTransition(root, transitionToken);
  scheduleAvatarRestore(options);
}

function restartAvatarVideo(root, video, image, requestToken, displayedState = 'idle', options = {}) {
  if (requestToken !== avatarVideoToken) return;
  const transitionToken = beginAvatarTransition(root, video, image);
  video.currentTime = 0;
  video.play().then(() => {
    if (requestToken !== avatarVideoToken) return;
    root.classList.remove('is-fallback');
    video.hidden = false;
    if (image) image.hidden = true;
    waitForAvatarVideoFrame(video, () => {
      if (requestToken !== avatarVideoToken) return;
      finishAvatarTransition(root, transitionToken);
    });
  }).catch(() => {
    finishAvatarTransition(root, transitionToken);
    scheduleAvatarVideoRetry(displayedState, requestToken, options);
  });
}

function scheduleAvatarVideoRetry(displayedState, requestToken, options = {}, delayMs = 2400) {
  if (requestToken !== avatarVideoToken) return;
  if (!avatarMotionMap[displayedState]) return;
  if (avatarVideoRetryTimer) clearTimeout(avatarVideoRetryTimer);
  avatarVideoRetryTimer = setTimeout(() => {
    avatarVideoRetryTimer = null;
    if (requestToken !== avatarVideoToken) return;
    const root = document.querySelector('#ai-dj-avatar');
    if (!root) return;
    const activeVideo = getActiveAvatarVideo(root);
    const needsRetry = root.classList.contains('is-fallback')
      || root.classList.contains('is-frame-sequence')
      || !activeVideo
      || activeVideo.paused
      || activeVideo.ended
      || activeVideo.readyState < 2;
    if (needsRetry) setAvatarState(displayedState, options);
  }, delayMs);
}

function playAvatarVideoOrFallback(
  root,
  image,
  src,
  sequence = null,
  requestToken = avatarVideoToken,
  displayedState = 'idle',
  options = {}
) {
  root.classList.remove('is-frame-sequence');
  root.classList.remove('is-sprite-sequence');
  const sprite = root.querySelector('#avatar-sprite');
  if (sprite) sprite.hidden = true;
  const activeVideo = getActiveAvatarVideo(root);
  if (image && !activeVideo && image.getAttribute('src') !== AVATAR_FALLBACK_IMAGE) {
    image.src = AVATAR_FALLBACK_IMAGE;
  }

  const showSourceFallback = () => {
    if (requestToken !== avatarVideoToken) return;
    root.classList.add('is-fallback');
    hideAvatarVideos(root);
    if (image) {
      if (image.getAttribute('src') !== AVATAR_FALLBACK_IMAGE) image.src = AVATAR_FALLBACK_IMAGE;
      image.hidden = false;
    }
    setDisplayedAvatarState(root, displayedState);
    scheduleAvatarRestore(options);
    scheduleAvatarVideoRetry(displayedState, requestToken, options);
  };

  const showSequenceFallback = () => {
    if (requestToken !== avatarVideoToken) return;
    if (sequence?.frames?.length) {
      playAvatarFrameSequence(root, image, sequence, '', displayedState, options);
      scheduleAvatarVideoRetry(displayedState, requestToken, options);
    } else {
      showSourceFallback();
    }
  };

  if (activeVideo?.getAttribute('src') === src && activeVideo.readyState >= 2) {
    hideAvatarVideos(root, activeVideo);
    clearAvatarVideoHandlers(activeVideo);
    activeVideo.loop = true;
    activeVideo.onended = () => restartAvatarVideo(root, activeVideo, image, requestToken, displayedState, options);
    activeVideo.play().catch(showSequenceFallback);
    setDisplayedAvatarState(root, displayedState);
    scheduleAvatarRestore(options);
    return;
  }

  const video = getStandbyAvatarVideo(root);
  if (!video || !src) {
    showSourceFallback();
    return;
  }

  clearAvatarVideoHandlers(video);
  video.pause();
  video.hidden = true;
  video.classList.remove('is-active', 'is-pending');
  video.onerror = () => {
    showSequenceFallback();
  };
  video.onstalled = () => scheduleAvatarVideoRetry(displayedState, requestToken, options);
  video.onwaiting = () => scheduleAvatarVideoRetry(displayedState, requestToken, options, 5000);
  video.onloadeddata = () => {
    if (requestToken !== avatarVideoToken) return;
    video.currentTime = 0;
    video.hidden = false;
    video.classList.add('is-pending');
    video.play().then(() => {
      if (requestToken !== avatarVideoToken) return;
      waitForAvatarVideoFrame(video, () => {
        revealAvatarVideo(root, video, image, displayedState, requestToken, options);
      });
    }).catch(showSequenceFallback);
  };
  video.loop = true;
  video.onended = () => restartAvatarVideo(root, video, image, requestToken, displayedState, options);

  if (video.getAttribute('src') !== src) {
    video.src = src;
    video.load();
  } else if (video.readyState >= 2) {
    video.onloadeddata();
  }
}

function ensureAvatarSprite(root) {
  let sprite = root.querySelector('#avatar-sprite');
  let strip = root.querySelector('#avatar-sprite-strip');
  if (!sprite) {
    sprite = document.createElement('div');
    sprite.id = 'avatar-sprite';
    sprite.className = 'avatar-sprite';
    sprite.hidden = true;
    root.prepend(sprite);
  }
  if (!strip) {
    strip = document.createElement('img');
    strip.id = 'avatar-sprite-strip';
    strip.className = 'avatar-sprite-strip';
    strip.alt = '';
    sprite.appendChild(strip);
  }
  return { sprite, strip };
}

function playAvatarFrameSequence(root, image, sequence, fallbackSrc, displayedState = 'idle', options = {}) {
  if (!image || !sequence?.frames?.length) {
    playAvatarVideoOrFallback(root, image, fallbackSrc, null, avatarVideoToken, displayedState, options);
    return;
  }

  stopAvatarFrameSequence();
  const token = avatarFrameSequenceToken;
  let index = 0;

  if (!sequence.spriteSrc) {
    playAvatarImageFrameSequence(root, image, sequence, fallbackSrc, token, displayedState, options);
    return;
  }

  const { sprite, strip } = ensureAvatarSprite(root);

  const showSpriteFrame = () => {
    if (token !== avatarFrameSequenceToken) return;
    const frame = sequence.frames[index % sequence.frames.length];
    strip.style.transform = `translate3d(-${(index * 100) / sequence.frames.length}%, 0, 0)`;
    index = (index + 1) % sequence.frames.length;
    avatarFrameTimer = setTimeout(showSpriteFrame, frame.durationMs || sequence.loopMs / sequence.frames.length);
  };

  root.classList.remove('is-fallback');
  root.classList.add('is-frame-sequence');
  root.classList.add('is-sprite-sequence');
  hideAvatarVideos(root);
  image.hidden = true;
  sprite.hidden = false;
  setDisplayedAvatarState(root, displayedState);
  scheduleAvatarRestore(options);
  strip.style.width = `${sequence.frames.length * 100}%`;
  strip.style.transform = 'translate3d(0, 0, 0)';

  strip.onerror = () => {
    if (token !== avatarFrameSequenceToken) return;
    root.classList.remove('is-sprite-sequence');
    sprite.hidden = true;
    image.hidden = false;
    playAvatarImageFrameSequence(root, image, sequence, fallbackSrc, token, displayedState, options);
  };
  strip.onload = () => {
    if (token !== avatarFrameSequenceToken) return;
    showSpriteFrame();
  };

  if (strip.getAttribute('src') !== sequence.spriteSrc) {
    strip.src = sequence.spriteSrc;
  } else if (strip.complete) {
    showSpriteFrame();
  }
}

function playAvatarImageFrameSequence(
  root,
  image,
  sequence,
  fallbackSrc,
  token,
  displayedState = 'idle',
  options = {}
) {
  root.classList.remove('is-fallback');
  root.classList.remove('is-sprite-sequence');
  root.classList.add('is-frame-sequence');

  const sprite = root.querySelector('#avatar-sprite');
  if (sprite) sprite.hidden = true;
  hideAvatarVideos(root);
  image.hidden = false;
  setDisplayedAvatarState(root, displayedState);
  scheduleAvatarRestore(options);

  let index = 0;
  image.onerror = () => {
    if (token !== avatarFrameSequenceToken) return;
    stopAvatarFrameSequence();
    playAvatarVideoOrFallback(root, image, fallbackSrc, null, avatarVideoToken, displayedState, options);
  };
  const showFrame = () => {
    if (token !== avatarFrameSequenceToken) return;
    const frame = sequence.frames[index % sequence.frames.length];
    image.src = frame.src;
    index = (index + 1) % sequence.frames.length;
    avatarFrameTimer = setTimeout(showFrame, frame.durationMs || sequence.loopMs / sequence.frames.length);
  };
  showFrame();
}

function setAvatarState(nextState = 'idle', options = {}) {
  const normalized = normalizeAvatarState(nextState);
  state.avatarState = normalized;
  avatarVideoToken += 1;

  if (avatarRestoreTimer) {
    clearTimeout(avatarRestoreTimer);
    avatarRestoreTimer = null;
  }

  const root = document.querySelector('#ai-dj-avatar');
  if (!root) return;

  const image = document.querySelector('#avatar-image');
  root.dataset.pendingState = normalized;

  const src = avatarMotionMap[normalized];
  const sequence = avatarFrameSequences[normalized];

  if (src) {
    stopAvatarFrameSequence();
    playAvatarVideoOrFallback(root, image, src, sequence, avatarVideoToken, normalized, options);
  } else if (sequence) {
    playAvatarFrameSequence(root, image, sequence, '', normalized, options);
  } else {
    stopAvatarFrameSequence();
    playAvatarVideoOrFallback(root, image, '', null, avatarVideoToken, normalized, options);
  }
}

function scheduleAvatarVideoPreload() {
  if (avatarPreloadScheduled) return;
  avatarPreloadScheduled = true;

  const preload = async () => {
    const urls = [...new Set(Object.values(avatarMotionMap))];
    let index = 0;
    const worker = async () => {
      while (index < urls.length) {
        const src = urls[index];
        index += 1;
        try {
          const response = await fetch(src, { cache: 'force-cache', credentials: 'same-origin' });
          if (response.ok) await response.blob();
        } catch {
          // Playback still has its normal network and frame-sequence fallbacks.
        }
      }
    };
    await Promise.all([worker(), worker()]);
  };

  setTimeout(() => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => { void preload(); }, { timeout: 2500 });
    } else {
      void preload();
    }
  }, 1200);
}

function reviveAvatarVideo() {
  if (avatarRestoreTimer) return;
  const root = document.querySelector('#ai-dj-avatar');
  if (!root) return;
  const normalized = normalizeAvatarState(state.avatarState || getContextualAvatarState());
  const src = avatarMotionMap[normalized];
  if (!src) return;
  const activeVideo = getActiveAvatarVideo(root);
  const needsRevive = root.classList.contains('is-fallback')
    || root.classList.contains('is-frame-sequence')
    || !activeVideo
    || activeVideo.getAttribute('src') !== src
    || activeVideo.paused
    || activeVideo.ended
    || activeVideo.readyState < 2;
  if (!needsRevive) return;
  if (activeVideo?.getAttribute('src') === src && !activeVideo.hidden && activeVideo.readyState >= 2) {
    activeVideo.loop = true;
    activeVideo.play().catch(() => setAvatarState(normalized));
    return;
  }
  setAvatarState(normalized);
}

function startAvatarHealthMonitor() {
  if (avatarHealthMonitorReady) return;
  avatarHealthMonitorReady = true;
  setInterval(() => reviveAvatarVideo(), 12000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) setTimeout(() => reviveAvatarVideo(), 250);
  });
  window.addEventListener('focus', () => setTimeout(() => reviveAvatarVideo(), 250));
  window.addEventListener('pageshow', () => setTimeout(() => reviveAvatarVideo(), 250));
}

function getContextualAvatarState() {
  const hostAudio = document.querySelector('#host-audio');
  const songAudio = document.querySelector('#song-audio');
  if (hostAudio?.src && !hostAudio.paused && !hostAudio.ended) return 'talking';
  if (songAudio?.src && !songAudio.paused && !songAudio.ended) return 'listening';
  return 'idle';
}

function setRadioButtonState(mode = 'idle') {
  const startBtn = document.querySelector('#start-btn');
  const concertStartBtn = document.querySelector('#concert-start-btn');
  const activeMode = state.radioMode === 'concert' ? 'concert' : 'single';
  const buttons = [
    { el: startBtn, mode: 'single', idleText: '单曲模式', loadingText: '单曲搜索中', activeText: '单曲电台中' },
    { el: concertStartBtn, mode: 'concert', idleText: '音乐会模式', loadingText: '编排音乐会中', activeText: '音乐会进行中' }
  ];
  buttons.forEach(({ el, mode: buttonMode, idleText, loadingText, activeText }) => {
    if (!el) return;
    const isActiveMode = activeMode === buttonMode;
    el.dataset.radioState = isActiveMode ? mode : 'idle';
    el.classList.toggle('is-selected', isActiveMode);
    el.setAttribute('aria-pressed', String(isActiveMode));
    if (isActiveMode && mode === 'loading') el.textContent = loadingText;
    else if (isActiveMode && mode === 'active') el.textContent = activeText;
    else el.textContent = idleText;
  });
}
// --- Button press feedback ---

function initButtonFeedback() {
  if (btnFeedbackReady) return;
  btnFeedbackReady = true;

  document.addEventListener('mousedown', (e) => {
    const btn = closestButtonFromEvent(e);
    if (!btn) return;
    btn.classList.add('btn-pressed');
  });
  document.addEventListener('mouseup', (e) => {
    const btn = closestButtonFromEvent(e);
    if (!btn) return;
    btn.classList.remove('btn-pressed');
  });
  document.addEventListener('mouseleave', (e) => {
    const btn = closestButtonFromEvent(e);
    if (btn) btn.classList.remove('btn-pressed');
  }, true);
  document.addEventListener('touchstart', (e) => {
    const btn = closestButtonFromEvent(e);
    if (!btn) return;
    btn.classList.add('btn-pressed');
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    const btn = closestButtonFromEvent(e);
    if (!btn) return;
    btn.classList.remove('btn-pressed');
  });
}

function closestButtonFromEvent(event) {
  const target = event?.target;
  if (target instanceof Element) return target.closest('button');
  const parent = target?.parentElement;
  return parent instanceof Element ? parent.closest('button') : null;
}

function setRadioMode(mode = 'single') {
  state.radioMode = mode === 'concert' ? 'concert' : 'single';
  if (state.radioMode === 'single') {
    state.activeConcert = null;
    state.concertStatus = 'idle';
  } else if (!state.activeConcert) {
    clearRadioPrefetchRetry();
    state.concertStatus = 'loading';
  }
  setRadioButtonState(state.current?.track || state.sessionId ? 'active' : 'idle');
  renderConcertConsole();
}

function hasCurrentPlaybackCandidate() {
  const songAudio = document.querySelector('#song-audio');
  return Boolean(songAudio?.currentSrc || songAudio?.src || state.current?.track);
}

function startSingleRadioFromControls() {
  setRadioMode('single');
  api('/api/player/stop', { method: 'POST', body: {} }).catch(() => {});
  startRadio();
}

function renderPlayer() {
  view.innerHTML = '';
  view.append(template.content.cloneNode(true));
  loadPreferences().catch(() => {});
  bootstrapDeviceSnapshotRestore().catch(() => {});

  // Move persistent audio elements into the player layout
  const leftCol = document.querySelector('.left-col');
  const audioLayer = document.querySelector('#audio-layer');
  const audioEls = ['#host-audio', '#song-audio'];
  const savedDisplay = [];
  audioEls.forEach((sel, i) => {
    const el = audioLayer.querySelector(sel);
    if (el) {
      savedDisplay[i] = el.style.display;
      el.style.display = '';
      // Insert before #progress-container
      const statusEl = leftCol.querySelector('#progress-container');
      if (statusEl) leftCol.insertBefore(el, statusEl);
    }
  });
  // Store for cleanup on navigation
  view.__audioCleanup = () => {
    audioEls.forEach((sel, i) => {
      const el = leftCol.querySelector(sel);
      if (el) {
        el.style.display = savedDisplay[i] || '';
        audioLayer.appendChild(el);
      }
    });
  };

  const startBtn = document.querySelector('#start-btn');
  const concertStartBtn = document.querySelector('#concert-start-btn');
  const previousBtn = document.querySelector('#previous-btn');
  const nextBtn = document.querySelector('#next-btn');
  const playToggleBtn = document.querySelector('#play-toggle-btn');
  const chatForm = document.querySelector('#chat-form');
  const scenePrompts = document.querySelector('#scene-prompts');
  const modeResetBtn = document.querySelector('#mode-reset-btn');
  const aiMusicToggle = document.querySelector('#ai-music-toggle');
  const aiMusicDownload = document.querySelector('#ai-music-download');
  const { likeBtn, dislikeBtn } = ensureFeedbackButtons();

  startBtn.addEventListener('click', () => startSingleRadioFromControls());
  concertStartBtn?.addEventListener('click', () => openConcertSetup());
  previousBtn?.addEventListener('click', () => previousTrack());
  nextBtn.addEventListener('click', () => nextTrack({ skipCurrent: true }));
  playToggleBtn?.addEventListener('click', () => {
    if (playToggleBtn.classList.contains('is-playing')) pausePlayback();
    else if (!hasCurrentPlaybackCandidate()) startSingleRadioFromControls();
    else resumePlayback();
  });
  modeResetBtn.addEventListener('click', () => resetMode());
  aiMusicToggle?.addEventListener('click', () => setAiMusicMode(!state.aiMusicMode));
  aiMusicDownload?.addEventListener('click', (event) => {
    if (aiMusicDownload.getAttribute('aria-disabled') === 'true') event.preventDefault();
  });
  likeBtn.addEventListener('click', () => {
    setAvatarState('happy', { temporaryMs: AVATAR_HAPPY_DISPLAY_MS });
    showLikeBurst();
    reportFeedback('like');
  });
  dislikeBtn.addEventListener('click', () => handleDislike());

  chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.querySelector('#chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    sendChat(msg);
  });

  scenePrompts?.addEventListener('click', (event) => {
    const button = closestButtonFromEvent(event);
    if (!button?.matches('[data-scene-prompt]')) return;
    const scene = button.dataset.scenePrompt?.trim();
    if (!scene) return;
    handleScenePrompt(scene);
  });
  bindConcertSetupInteractions();
  document.querySelector('#concert-console-panel')?.addEventListener('click', (event) => {
    const button = closestButtonFromEvent(event);
    if (button?.matches('[data-concert-index]')) {
      const index = Number(button.dataset.concertIndex);
      if (Number.isInteger(index)) jumpConcertTo(index);
      return;
    }
    if (button?.matches('[data-concert-host-event]')) {
      replayConcertHostEvent(button.dataset.concertHostEvent);
      return;
    }
    if (button?.matches('[data-danmaku-source]')) {
      toggleConcertDanmakuSource(button.dataset.danmakuSource);
      return;
    }
    if (button?.matches('[data-concert-fallback-length]')) {
      state.concertSettings.length = Number(button.dataset.concertFallbackLength);
      startConcertRadio({ settings: state.concertSettings });
      return;
    }
    if (button?.matches('[data-concert-encore]')) {
      startConcertEncore();
      return;
    }
    if (button?.matches('[data-concert-new]')) openConcertSetup();
  });
  document.querySelector('#session-constraint-bar')?.addEventListener('click', (event) => {
    const button = closestButtonFromEvent(event);
    const label = button?.dataset.constraintLabel;
    if (label) sendChat(`取消${label}限制`);
  });

  // Restore saved chat messages
  if (savedChatHTML) {
    const chatMessages = document.querySelector('#chat-messages');
    if (chatMessages) chatMessages.innerHTML = savedChatHTML;
    savedChatHTML = '';
  }

  if (state.current) updatePlayer(state.current, false);
  else renderLyricStandby();
  scheduleLyricResyncToCurrentPlayback();
  updatePreviousButtonState();
  setAvatarState(state.avatarState || getContextualAvatarState());
  scheduleAvatarVideoPreload();
  startAvatarHealthMonitor();
  setRadioButtonState(state.sessionId || state.current?.track ? 'active' : 'idle');
  startPlayerPolling();
  initButtonFeedback();
  initVisualizer();
  initProgressBar();
  updateAiMusicToggle();
  updateAiMusicDownload(state.current?.track || null);
  renderConcertConsole();
  renderSessionConstraintBar();
  scheduleRadioPrefetch();
  loadDiaryRadioEntry().catch(() => {});
}

function ensureFeedbackButtons() {
  const controls = document.querySelector('.feedback-controls') || document.querySelector('.transport-mini');
  let likeBtn = document.querySelector('#like-btn');
  let dislikeBtn = document.querySelector('#dislike-btn');
  if (!likeBtn) {
    likeBtn = document.createElement('button');
    likeBtn.id = 'like-btn';
    likeBtn.type = 'button';
    likeBtn.title = '喜欢';
    likeBtn.textContent = '喜欢';
    controls?.appendChild(likeBtn);
  }
  if (!dislikeBtn) {
    dislikeBtn = document.createElement('button');
    dislikeBtn.id = 'dislike-btn';
    dislikeBtn.type = 'button';
    dislikeBtn.title = '不喜欢';
    dislikeBtn.textContent = '不喜欢';
    controls?.appendChild(dislikeBtn);
  }
  return { likeBtn, dislikeBtn };
}

function setPlaybackToggleState(isPlaying) {
  const button = document.querySelector('#play-toggle-btn');
  if (!button) return;
  button.classList.toggle('is-playing', Boolean(isPlaying));
  button.classList.toggle('is-paused', !isPlaying);
  const label = isPlaying ? '暂停' : '继续';
  button.title = label;
  button.setAttribute('aria-label', label);
}

function readStoredAiMusicMode() {
  try {
    return localStorage.getItem(AI_MUSIC_MODE_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

function setAiMusicMode(enabled, { announce = true } = {}) {
  state.aiMusicMode = Boolean(enabled);
  if (state.aiMusicMode) {
    clearRadioPrefetchRetry();
    state.radioMode = 'single';
    state.activeConcert = null;
    state.concertStatus = 'idle';
  }
  try {
    localStorage.setItem(AI_MUSIC_MODE_STORAGE_KEY, state.aiMusicMode ? 'on' : 'off');
  } catch {
    // Storage failures should not block the local playback mode switch.
  }
  updateAiMusicToggle();
  setRadioButtonState(state.current?.track || state.sessionId ? 'active' : 'idle');
  renderConcertConsole();
  if (announce) {
    appendChat({
      role: 'dj',
      text: state.aiMusicMode
        ? 'AI 原创电台模式已开启，后续歌曲会由灿灿根据此刻状态和音乐画像生成。'
        : 'AI 原创电台模式已关闭，后续恢复普通推荐播放。'
    });
  }
}

function updateAiMusicToggle() {
  const button = document.querySelector('#ai-music-toggle');
  if (!button) return;
  button.classList.toggle('is-active', state.aiMusicMode);
  button.setAttribute('aria-pressed', state.aiMusicMode ? 'true' : 'false');
  button.title = state.aiMusicMode ? '关闭 AI 原创电台模式' : '开启 AI 原创电台模式';
}

function updateAiMusicDownload(track = null) {
  const link = document.querySelector('#ai-music-download');
  const label = document.querySelector('#ai-music-download-label');
  if (!link) return;

  const canDownload = Boolean(track?.aiGenerated && track?.playUrl);
  link.classList.toggle('is-ready', canDownload);
  link.classList.toggle('is-disabled', !canDownload);
  link.setAttribute('aria-disabled', canDownload ? 'false' : 'true');
  link.tabIndex = canDownload ? 0 : -1;

  if (canDownload) {
    link.href = track.playUrl;
    link.download = buildAiMusicDownloadFilename(track);
    link.title = '下载当前 AI 原创歌曲';
    link.setAttribute('aria-label', '下载本次AI原创的歌曲');
    label && (label.textContent = '下载AI原创');
  } else {
    link.href = '#';
    link.removeAttribute('download');
    link.title = 'AI 原创歌曲生成后可下载';
    link.setAttribute('aria-label', 'AI 原创歌曲生成后可下载');
    label && (label.textContent = '下载AI原创');
  }
}

function buildAiMusicDownloadFilename(track = {}) {
  const base = sanitizeDownloadFilename(track.name || 'AI原创歌曲') || 'AI原创歌曲';
  return `${base}-灿灿AI原创.mp3`;
}

function sanitizeDownloadFilename(value = '') {
  return String(value || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
    .slice(0, 80);
}

async function handleDislike() {
  showDislikeBurst();
  setAvatarState('searching');
  const stopCurrentPromise = pauseCurrentPlaybackForTransition();
  await reportFeedback('dislike');
  await stopCurrentPromise;
  nextTrack({ skipCurrent: false });
}

function ensureFxLayer() {
  let layer = document.querySelector('#screen-fx-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'screen-fx-layer';
    layer.className = 'screen-fx-layer';
    document.body.appendChild(layer);
  }
  return layer;
}

function showLikeBurst() {
  const layer = ensureFxLayer();
  const wrap = document.createElement('div');
  wrap.className = 'pixel-heart-burst';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = `
    <span class="pixel-heart-core"></span>
    ${Array.from({ length: 16 }, (_, i) => `<span class="pixel-spark" style="--i:${i}"></span>`).join('')}
  `;
  layer.appendChild(wrap);

  animate(wrap, {
    scale: [0.55, 1.18, 1],
    opacity: [0, 1, 0],
    duration: 1050,
    ease: 'outExpo',
    onComplete: () => wrap.remove()
  });

  wrap.querySelectorAll('.pixel-spark').forEach((spark, i) => {
    const angle = (Math.PI * 2 * i) / 16;
    const distance = 76 + (i % 4) * 16;
    animate(spark, {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      scale: [1, 0],
      opacity: [1, 0],
      duration: 720,
      delay: 80,
      ease: 'outQuad'
    });
  });
}

function showDislikeBurst() {
  const layer = ensureFxLayer();
  const wrap = document.createElement('div');
  wrap.className = 'pixel-block-burst';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = Array.from({ length: 28 }, (_, i) => `<span class="pixel-block" style="--i:${i}"></span>`).join('');
  layer.appendChild(wrap);

  wrap.querySelectorAll('.pixel-block').forEach((block, i) => {
    const angle = (Math.PI * 2 * i) / 28;
    const distance = 54 + (i % 7) * 13;
    const spin = i % 2 === 0 ? 90 : -90;
    animate(block, {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      rotate: spin,
      scale: [1, 0.25],
      opacity: [1, 0],
      duration: 620 + (i % 5) * 40,
      ease: 'outExpo'
    });
  });

  animate(wrap, {
    scale: [0.85, 1.1],
    opacity: [1, 0],
    duration: 820,
    ease: 'outQuad',
    onComplete: () => wrap.remove()
  });
}

// --- Loading message rotator ---
const loadingMessages = [
  '灿灿正在帮你挑选歌曲...',
  '灿灿正在翻阅你的音乐记忆...',
  '灿灿正在感受今晚的氛围...',
  '灿灿正在计算最佳频率...',
  '灿灿正在解码你的音乐DNA...',
  '灿灿正在扫描地下电台信号...',
  '灿灿正在校准音频矩阵...',
  '灿灿正在连接赛博音乐网络...',
];

const aiMusicLoadingMessages = [
  '灿灿正在读取此刻状态...',
  '灿灿正在匹配你的音乐画像...',
  '灿灿正在写更贴近当下的歌词...',
  '灿灿正在把最近对话做成旋律...',
];

const concertLoadingMessages = [
  '灿灿正在编排整场音乐会...',
  '灿灿正在校验每首歌能不能稳定播放...',
  '灿灿正在划分节目幕次...',
  '灿灿正在写开场、串场和谢幕...',
];

const concertNextLoadingMessages = [
  '灿灿正在切到音乐会下一首...',
  '灿灿正在保持现场节奏...',
];

const chatLoadingMessages = [
  '灿灿正在回复...',
  '灿灿正在读你的消息...',
  '灿灿正在想怎么跟你说...',
];

function startLoadingMessages(kind = 'music') {
  const messages = kind === 'chat'
    ? chatLoadingMessages
    : kind === 'aiMusic'
    ? aiMusicLoadingMessages
    : kind === 'concert'
    ? concertLoadingMessages
    : kind === 'concertNext'
    ? concertNextLoadingMessages
    : loadingMessages;
  statusLocked = true;
  setAvatarState(kind === 'chat' ? 'reading' : 'searching');
  const loading = {
    el: appendChat({ role: 'dj', loading: true }),
    index: 0,
    messages,
    timer: null
  };
  activeLoadingMessages.add(loading);
  loadingMessageEl = loading.el;
  loadingMsgIndex = 0;
  showLoadingMessage(loading);
  loading.timer = setInterval(() => {
    loading.index = (loading.index + 1) % loading.messages.length;
    if (loading.el === loadingMessageEl) loadingMsgIndex = loading.index;
    showLoadingMessage(loading);
  }, kind === 'chat' ? 1600 : 2800);
  loadingMsgTimer = loading.timer;
  return loading;
}

function showLoadingMessage(loading = null) {
  const currentLoading = loading?.el
    ? loading
    : [...activeLoadingMessages].find(item => item.el === loadingMessageEl);
  const el = currentLoading?.el?.isConnected
    ? currentLoading.el.querySelector('[data-loading-text]')
    : null;
  if (!el) return;
  const messages = currentLoading.messages || loadingMessages;
  const msg = messages[currentLoading.index] || messages[0] || '';
  el.innerHTML = `
    <span class="glitch-text" data-text="${escapeAttr(msg)}">${escapeHtml(msg)}</span>
    <span class="loading-dots">
      <span></span><span></span><span></span>
    </span>
  `;
  el.style.color = 'var(--cyan)';
}

function stopLoadingMessages({ remove = false, loading = null } = {}) {
  const target = loading?.el
    ? loading
    : [...activeLoadingMessages].find(item => item.el === loadingMessageEl);
  if (target) {
    if (target.timer) clearInterval(target.timer);
    if (remove && target.el?.isConnected) target.el.remove();
    activeLoadingMessages.delete(target);
    if (loadingMessageEl === target.el) {
      const latest = [...activeLoadingMessages].at(-1);
      loadingMessageEl = latest?.el || (remove ? null : target.el);
      loadingMsgTimer = latest?.timer || null;
      loadingMsgIndex = latest?.index || 0;
    }
  } else if (loadingMsgTimer) {
    clearInterval(loadingMsgTimer);
    loadingMsgTimer = null;
  }
  statusLocked = activeLoadingMessages.size > 0;
}

function replaceLoadingMessage({ text, track, explanation, loading = null }) {
  const target = loading?.el
    ? loading
    : [...activeLoadingMessages].find(item => item.el === loadingMessageEl)
      || (loadingMessageEl?.isConnected ? { el: loadingMessageEl, timer: loadingMsgTimer } : null);
  if (!target?.el?.isConnected) {
    return appendChat({ role: 'dj', text, track, explanation });
  }
  stopLoadingMessages({ loading: target });
  renderChatMessageContent(target.el, { text, track, explanation });
  target.el.classList.remove('loading-msg');
  target.el.removeAttribute('aria-live');
  if (loadingMessageEl === target.el) {
    const latest = [...activeLoadingMessages].at(-1);
    loadingMessageEl = latest?.el || null;
    loadingMsgTimer = latest?.timer || null;
    loadingMsgIndex = latest?.index || 0;
  }
  scrollChatToBottom();
  return null;
}

function ensureSessionId() {
  if (!state.sessionId) {
    state.sessionId = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  return state.sessionId;
}

function beginRadioTurn({ interruptPlayback = true } = {}) {
  if (state.activeRadioTurn?.controller && !state.activeRadioTurn.controller.signal.aborted) {
    state.activeRadioTurn.controller.abort();
  }
  if (state.activeRadioTurn?.loading) {
    stopLoadingMessages({ remove: true, loading: state.activeRadioTurn.loading });
  }
  interruptPendingHostSpeech();
  if (interruptPlayback) {
    invalidateActivePlaybackEvents();
    clearSongAudioHandlers();
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const turn = {
    id: ++state.radioTurnSeq,
    controller,
    loading: null
  };
  state.activeRadioTurn = turn;
  return turn;
}

function attachRadioTurnLoading(radioTurn, loading) {
  if (!isActiveRadioTurn(radioTurn)) return;
  radioTurn.loading = loading;
}

function clearRadioTurnLoading(radioTurn, loading) {
  if (!radioTurn || state.activeRadioTurn?.id !== radioTurn.id) return;
  if (!loading || radioTurn.loading === loading) radioTurn.loading = null;
}

function isActiveRadioTurn(radioTurn) {
  return !radioTurn || state.activeRadioTurn?.id === radioTurn.id;
}

function isInterruptedRadioTurn(radioTurn, error = null) {
  return Boolean(radioTurn && (
    !isActiveRadioTurn(radioTurn) ||
    radioTurn.controller?.signal.aborted ||
    error?.name === 'AbortError'
  ));
}

function radioTurnSignal(radioTurn) {
  return radioTurn?.controller?.signal;
}

function isCurrentPlaybackTurn(radioTurn, track, playbackToken = null) {
  return isActiveRadioTurn(radioTurn) &&
    (!playbackToken || state.activePlaybackToken === playbackToken) &&
    (!track?.id || state.current?.track?.id === track.id);
}

function interruptPendingHostSpeech() {
  const hostAudio = document.querySelector('#host-audio');
  if (hostAudio && hostAudio.dataset.voicePriming !== 'true') {
    hostAudio.onended = null;
    hostAudio.onplay = null;
    hostAudio.ontimeupdate = null;
    hostAudio.volume = 1;
    hostAudio.pause();
  }
  const wasFadingSong = state.songFadeInActive || Boolean(state.songFadeInTrackKey);
  const shouldPauseFadingSong = wasFadingSong && !state.songFadeInOfficial;
  cancelSongFadeIn({ resetVolume: true });
  if (shouldPauseFadingSong) document.querySelector('#song-audio')?.pause();
  window.speechSynthesis?.cancel?.();
}

function invalidateActivePlaybackEvents() {
  state.activePlaybackToken = ++state.playbackTokenSeq;
}

function getSongFadeTrackKey(track = {}) {
  return String(track?.id || track?.playUrl || '');
}

function audioHasTrackSource(audio, track = {}) {
  if (!audio || !track?.playUrl) return false;
  if (audio.getAttribute('src') === track.playUrl) return true;
  try {
    return audio.currentSrc === new URL(track.playUrl, window.location.href).href;
  } catch {
    return false;
  }
}

function cancelSongFadeIn({ resetVolume = true } = {}) {
  if (state.songFadeInFrame) {
    cancelAnimationFrame(state.songFadeInFrame);
    state.songFadeInFrame = null;
  }
  state.songFadeInActive = false;
  state.songFadeInTrackKey = null;
  state.songFadeInOfficial = false;
  const songAudio = document.querySelector('#song-audio');
  if (resetVolume && songAudio) songAudio.volume = 1;
  const hostAudio = document.querySelector('#host-audio');
  if (hostAudio && hostAudio.dataset.voicePriming !== 'true') hostAudio.volume = 1;
}

function isSongFadeInPreparedForTrack(track = {}) {
  const songAudio = document.querySelector('#song-audio');
  if (!songAudio || !track?.playUrl || songAudio.ended) return false;
  if (!audioHasTrackSource(songAudio, track)) return false;
  const fadeKey = getSongFadeTrackKey(track);
  return state.songFadeInTrackKey === fadeKey || state.songFadeInActive || !songAudio.paused;
}

function clearSongAudioHandlers({ reset = false, preserveFade = false } = {}) {
  if (!preserveFade) cancelSongFadeIn({ resetVolume: true });
  const songAudio = document.querySelector('#song-audio');
  if (!songAudio) return;
  stopCommentDanmaku({ clearLayer: true });
  stopProgressAnimation();
  songAudio.onended = null;
  songAudio.onerror = null;
  songAudio.onplay = null;
  songAudio.ontimeupdate = null;
  if (reset) {
    songAudio.pause();
    try { songAudio.currentTime = 0; } catch {}
  }
}

function pauseCurrentPlaybackForTransition() {
  invalidateActivePlaybackEvents();
  stopCommentDanmaku({ clearLayer: true, invalidate: true });
  stopVisualizer();
  setPlaybackToggleState(false);
  interruptPendingHostSpeech();
  const songAudio = document.querySelector('#song-audio');
  if (songAudio) songAudio.pause();
  clearSongAudioHandlers();
  return api('/api/player/stop', { method: 'POST', body: {} }).catch(() => null);
}

function canUseRadioQueueWarmup() {
  return !state.aiMusicMode && state.radioMode !== 'concert' && !state.activeConcert && !state.schedulePlanning;
}

function clearRadioPrefetchRetry() {
  if (state.radioPrefetchRetryTimer) {
    clearTimeout(state.radioPrefetchRetryTimer);
    state.radioPrefetchRetryTimer = null;
  }
  state.radioPrefetchRetryDepth = 0;
}

function getRadioPrefetchActiveCount(result = {}) {
  const queued = Number(result.queued) || 0;
  const pending = Number(result.pending) || 0;
  return queued + pending;
}

function maybeScheduleRadioPrefetchRetry(result = {}, retryDepth = 0) {
  if (!canUseRadioQueueWarmup()) {
    clearRadioPrefetchRetry();
    return;
  }
  if (getRadioPrefetchActiveCount(result) >= RADIO_PREFETCH_TARGET_ACTIVE) {
    clearRadioPrefetchRetry();
    return;
  }
  if (retryDepth >= RADIO_PREFETCH_MAX_RETRIES || state.radioPrefetchRetryTimer) return;
  state.radioPrefetchRetryDepth = retryDepth + 1;
  state.radioPrefetchRetryTimer = setTimeout(() => {
    state.radioPrefetchRetryTimer = null;
    scheduleRadioPrefetch({ retryDepth: retryDepth + 1 });
  }, RADIO_PREFETCH_RETRY_DELAY_MS);
}

function maybeWarmRadioQueueFromResponse(data = {}) {
  if (!data.track || !canUseRadioQueueWarmup()) return;
  void scheduleRadioPrefetch();
}

function scheduleRadioPrefetch({ force = false, retryDepth = 0 } = {}) {
  if (!canUseRadioQueueWarmup()) {
    clearRadioPrefetchRetry();
    return Promise.resolve(null);
  }
  if (retryDepth === 0) clearRadioPrefetchRetry();
  if (state.radioPrefetchPromise && !force) return state.radioPrefetchPromise;
  const sessionId = ensureSessionId();
  state.radioPrefetchPromise = api('/api/radio/prefetch', {
    method: 'POST',
    body: { sessionId, force }
  })
    .then((result) => {
      console.debug('[radio queue prefetch]', result);
      maybeScheduleRadioPrefetchRetry(result, retryDepth);
      return result;
    })
    .catch((error) => {
      console.warn('[radio queue prefetch failed]', error?.message || error);
      return null;
    })
    .finally(() => {
      state.radioPrefetchPromise = null;
    });
  return state.radioPrefetchPromise;
}

async function startRadio() {
  const radioTurn = beginRadioTurn();
  primeVoicePlayback();
  const sessionId = ensureSessionId();
  setAvatarState('searching');
  setRadioButtonState('loading');
  appendChat({
    role: 'user',
    text: state.aiMusicMode
      ? '开启 AI 原创模式'
      : state.preferences?.scheduleAwareEnabled
        ? '按接下来的日程安排一段音乐'
        : '启动电台'
  });
  const loading = startLoadingMessages(state.aiMusicMode ? 'aiMusic' : 'music');
  attachRadioTurnLoading(radioTurn, loading);
  try {
    await loadPreferences().catch(() => null);
    if (!isActiveRadioTurn(radioTurn)) return;
    const useSchedulePlanning = !state.aiMusicMode && state.preferences?.scheduleAwareEnabled === true;
    state.schedulePlanning = useSchedulePlanning;
    if (useSchedulePlanning) {
      state.radioMode = 'concert';
      clearRadioPrefetchRetry();
      state.concertStatus = 'loading';
      state.activeConcert = null;
      renderConcertConsole();
    }
    const data = state.aiMusicMode
      ? await requestAiMusicTrack({ sessionId, trigger: 'start', signal: radioTurnSignal(radioTurn) })
      : useSchedulePlanning
        ? await api('/api/radio/playlist/start', {
            method: 'POST',
            body: { sessionId, planning: { source: 'schedule', refresh: true } },
            signal: radioTurnSignal(radioTurn)
          })
        : await api('/api/radio/start', { method: 'POST', body: { sessionId }, signal: radioTurnSignal(radioTurn) });
    handleRadioResponse(data, { loading, radioTurn });
  } catch (e) {
    if (isInterruptedRadioTurn(radioTurn, e)) {
      stopLoadingMessages({ remove: true, loading });
      clearRadioTurnLoading(radioTurn, loading);
      return;
    }
    if (state.aiMusicMode) {
      try {
        const fallback = await api('/api/radio/start', { method: 'POST', body: { sessionId }, signal: radioTurnSignal(radioTurn) });
        handleRadioResponse(withAiMusicFallbackNotice(fallback, e), { loading, radioTurn });
        return;
      } catch (fallbackError) {
        e = fallbackError;
      }
    }
    if (isInterruptedRadioTurn(radioTurn, e)) {
      stopLoadingMessages({ remove: true, loading });
      clearRadioTurnLoading(radioTurn, loading);
      return;
    }
    clearRadioTurnLoading(radioTurn, loading);
    stopLoadingMessages({ loading });
    replaceLoadingMessage({ text: '启动电台时出了一点问题：' + e.message, loading });
    setAvatarState('idle');
    setRadioButtonState(state.current?.track ? 'active' : 'idle');
    setPlayerStatus(e.message, 'error');
  }
}

function normalizeConcertSettingsClient(raw = {}) {
  const length = [5, 8, 12].includes(Number(raw.length)) ? Number(raw.length) : 5;
  const genres = Array.isArray(raw.genres) ? [...new Set(raw.genres.filter(value => value && value !== '自动'))].slice(0, 2) : [];
  return {
    length,
    genres,
    mood: raw.mood || '自动',
    scene: raw.scene || '自动',
    audiencePreset: raw.audiencePreset || '温暖',
    note: String(raw.note || '').trim().slice(0, 80)
  };
}

function openConcertSetup() {
  const panel = document.querySelector('#concert-setup-panel');
  if (!panel) return;
  panel.hidden = false;
  syncConcertSetupControls();
  document.querySelector('#concert-note')?.focus();
}

function closeConcertSetup() {
  const panel = document.querySelector('#concert-setup-panel');
  if (panel) panel.hidden = true;
}

function bindConcertSetupInteractions() {
  const panel = document.querySelector('#concert-setup-panel');
  if (!panel) return;
  document.querySelector('#concert-setup-close')?.addEventListener('click', closeConcertSetup);
  document.querySelector('#concert-create-btn')?.addEventListener('click', async () => {
    await pauseCurrentPlaybackForTransition();
    startConcertRadio({ settings: readConcertSetupSettings() });
  });
  panel.querySelectorAll('[data-concert-choice]').forEach(group => {
    group.addEventListener('click', event => {
      const button = closestButtonFromEvent(event);
      if (!button?.dataset.value) return;
      const kind = group.dataset.concertChoice;
      if (kind === 'length') {
        group.querySelectorAll('button').forEach(item => item.classList.toggle('is-selected', item === button));
        return;
      }
      if (button.dataset.value === '自动') {
        group.querySelectorAll('button').forEach(item => item.classList.toggle('is-selected', item === button));
        return;
      }
      group.querySelector('[data-value="自动"]')?.classList.remove('is-selected');
      button.classList.toggle('is-selected');
      const selected = [...group.querySelectorAll('button.is-selected')];
      if (selected.length > 2) selected[0].classList.remove('is-selected');
      if (!group.querySelector('button.is-selected')) group.querySelector('[data-value="自动"]')?.classList.add('is-selected');
    });
  });
  const note = document.querySelector('#concert-note');
  note?.addEventListener('input', () => {
    const count = document.querySelector('#concert-note-count');
    if (count) count.textContent = `${note.value.length} / 80`;
  });
}

function syncConcertSetupControls() {
  const settings = normalizeConcertSettingsClient(state.concertSettings);
  document.querySelectorAll('[data-concert-choice="length"] button').forEach(button => {
    button.classList.toggle('is-selected', Number(button.dataset.value) === settings.length);
  });
  document.querySelectorAll('[data-concert-choice="genres"] button').forEach(button => {
    button.classList.toggle('is-selected', button.dataset.value === '自动' ? !settings.genres.length : settings.genres.includes(button.dataset.value));
  });
  const mood = document.querySelector('#concert-mood');
  const scene = document.querySelector('#concert-scene');
  const audience = document.querySelector('#concert-audience-preset');
  const note = document.querySelector('#concert-note');
  if (mood) mood.value = settings.mood;
  if (scene) scene.value = settings.scene;
  if (audience) audience.value = settings.audiencePreset;
  if (note) note.value = settings.note;
  const count = document.querySelector('#concert-note-count');
  if (count) count.textContent = `${settings.note.length} / 80`;
}

function readConcertSetupSettings() {
  const length = Number(document.querySelector('[data-concert-choice="length"] button.is-selected')?.dataset.value || 5);
  const genres = [...document.querySelectorAll('[data-concert-choice="genres"] button.is-selected')]
    .map(button => button.dataset.value)
    .filter(value => value && value !== '自动');
  return normalizeConcertSettingsClient({
    length,
    genres,
    mood: document.querySelector('#concert-mood')?.value,
    scene: document.querySelector('#concert-scene')?.value,
    audiencePreset: document.querySelector('#concert-audience-preset')?.value,
    note: document.querySelector('#concert-note')?.value
  });
}

async function startConcertRadio({ settings = state.concertSettings, message = '' } = {}) {
  const radioTurn = beginRadioTurn();
  primeVoicePlayback();
  const sessionId = ensureSessionId();
  const userMessage = String(message || '').trim();
  state.concertSettings = normalizeConcertSettingsClient(settings);
  state.schedulePlanning = false;
  state.radioMode = 'concert';
  clearRadioPrefetchRetry();
  state.concertStatus = 'loading';
  state.activeConcert = null;
  closeConcertSetup();
  renderConcertConsole();
  renderSessionConstraintBar();
  setAvatarState('searching');
  setRadioButtonState('loading');
  if (state.aiMusicMode) setAiMusicMode(false, { announce: false });
  if (userMessage) appendChat({ role: 'user', text: userMessage });
  if (!userMessage) {
    appendChat({ role: 'user', text: `生成一场 ${state.concertSettings.length} 首音乐会` });
  }
  const loading = startLoadingMessages('concert');
  attachRadioTurnLoading(radioTurn, loading);
  try {
    await loadPreferences().catch(() => null);
    if (!isActiveRadioTurn(radioTurn)) return;
    const data = await api('/api/radio/concert/start', {
      method: 'POST',
      body: { sessionId, settings: state.concertSettings, message: userMessage },
      signal: radioTurnSignal(radioTurn)
    });
    state.radioMode = 'concert';
    handleRadioResponse(data, { loading, radioTurn });
  } catch (e) {
    if (isInterruptedRadioTurn(radioTurn, e)) {
      stopLoadingMessages({ remove: true, loading });
      clearRadioTurnLoading(radioTurn, loading);
      return;
    }
    clearRadioTurnLoading(radioTurn, loading);
    stopLoadingMessages({ loading });
    replaceLoadingMessage({ text: '编排音乐会时出了一点问题：' + e.message, loading });
    setAvatarState(getContextualAvatarState());
    setRadioButtonState(state.current?.track ? 'active' : 'idle');
    setPlayerStatus(e.message, 'error');
  }
}

async function nextTrack({ skipCurrent = true, silent = false, forceFresh = false } = {}) {
  if (state.radioMode === 'concert' && state.activeConcert) {
    return advanceConcertPlayback({ skipCurrent, silent });
  }
  const storedNext = forceFresh ? null : getNextPlaybackItem(playbackSequenceState());
  if (storedNext?.track) {
    applyPlaybackSequence(movePlaybackCursor(playbackSequenceState(), 1));
    await playPlaybackSequenceItem(storedNext, { direction: 'next', skipCurrent, silent });
    return;
  }

  const radioTurn = beginRadioTurn();
  const stopCurrentPromise = skipCurrent ? pauseCurrentPlaybackForTransition() : null;
  primeVoicePlayback();
  const sessionId = ensureSessionId();
  setAvatarState('searching');
  setPlaybackToggleState(false);
  if (skipCurrent) await reportFeedback('skip');
  if (stopCurrentPromise) await stopCurrentPromise;
  if (!isActiveRadioTurn(radioTurn)) return;
  if (!silent) {
    appendChat({ role: 'user', text: state.aiMusicMode ? '生成此刻歌曲' : state.radioMode === 'concert' ? '音乐会下一首' : '下一首' });
  }
  const loading = startLoadingMessages(state.aiMusicMode ? 'aiMusic' : state.radioMode === 'concert' ? 'concertNext' : 'music');
  attachRadioTurnLoading(radioTurn, loading);
  try {
    await loadPreferences().catch(() => null);
    if (!isActiveRadioTurn(radioTurn)) return;
    const scheduleActive = state.schedulePlanning && state.preferences?.scheduleAwareEnabled === true;
    if (state.schedulePlanning && !scheduleActive) state.schedulePlanning = false;
    const schedulePlanning = getSchedulePlanningForNextTurn();
    const data = state.aiMusicMode
      ? await requestAiMusicTrack({ sessionId, trigger: 'next', signal: radioTurnSignal(radioTurn) })
      : state.radioMode === 'concert'
      ? await api(scheduleActive ? '/api/radio/playlist/next' : '/api/radio/concert/next', {
          method: 'POST',
          body: { sessionId, ...(schedulePlanning ? { planning: schedulePlanning } : {}) },
          signal: radioTurnSignal(radioTurn)
        })
      : await api('/api/radio/next', { method: 'POST', body: { sessionId }, signal: radioTurnSignal(radioTurn) });
    handleRadioResponse(data, { loading, radioTurn });
  } catch (e) {
    if (isInterruptedRadioTurn(radioTurn, e)) {
      stopLoadingMessages({ remove: true, loading });
      clearRadioTurnLoading(radioTurn, loading);
      return;
    }
    if (state.aiMusicMode) {
      try {
        const fallback = await api('/api/radio/next', { method: 'POST', body: { sessionId }, signal: radioTurnSignal(radioTurn) });
        handleRadioResponse(withAiMusicFallbackNotice(fallback, e), { loading, radioTurn });
        return;
      } catch (fallbackError) {
        e = fallbackError;
      }
    }
    if (isInterruptedRadioTurn(radioTurn, e)) {
      stopLoadingMessages({ remove: true, loading });
      clearRadioTurnLoading(radioTurn, loading);
      return;
    }
    clearRadioTurnLoading(radioTurn, loading);
    stopLoadingMessages({ loading });
    replaceLoadingMessage({ text: '抱歉，刚才找歌时出了一点问题：' + e.message, loading });
    setAvatarState(getContextualAvatarState());
    setPlayerStatus(e.message, 'error');
  }
}

async function advanceConcertPlayback({ skipCurrent = true, silent = false } = {}) {
  const concert = state.activeConcert;
  const items = Array.isArray(concert?.items) ? concert.items : [];
  if (!concert || !items.length) return;
  const currentTrackId = String(state.current?.track?.id || '');
  const matchedIndex = items.findIndex(item => String(item.track?.id || '') === currentTrackId);
  const currentIndex = matchedIndex >= 0 ? matchedIndex : Number(concert.currentIndex || 0);
  const nextIndex = currentIndex + 1;
  const hostEvent = (concert.hostEvents || []).find(event => {
    if (event.status !== 'pending') return false;
    if (nextIndex >= items.length) return event.type === 'curtain';
    return event.type === 'interlude' && Number(event.beforeIndex) === nextIndex;
  });
  const radioTurn = beginRadioTurn();
  const stopCurrentPromise = pauseCurrentPlaybackForTransition();
  primeVoicePlayback();
  setAvatarState('searching');
  setPlaybackToggleState(false);
  if (skipCurrent) await reportFeedback('skip');
  await stopCurrentPromise;
  if (!isActiveRadioTurn(radioTurn)) return;

  if (hostEvent) {
    return requestConcertHostEvent(hostEvent.id, {
      replay: false,
      continueToNext: hostEvent.type === 'interlude',
      radioTurn
    });
  }
  if (nextIndex >= items.length) {
    setPlayerStatus(['curtain', 'finished'].includes(concert.phase) ? '音乐会已谢幕' : '等待谢幕', '');
    return;
  }

  const loading = startLoadingMessages('concertNext');
  attachRadioTurnLoading(radioTurn, loading);
  try {
    const data = await api('/api/radio/concert/next', {
      method: 'POST',
      body: { sessionId: ensureSessionId() },
      signal: radioTurnSignal(radioTurn)
    });
    handleRadioResponse(data, { loading, radioTurn });
  } catch (error) {
    if (isInterruptedRadioTurn(radioTurn, error)) return;
    stopLoadingMessages({ loading });
    replaceLoadingMessage({ text: `切换音乐会曲目失败：${error.message}`, loading });
    setAvatarState(getContextualAvatarState());
  }
}

async function requestConcertHostEvent(eventId, { replay = false, continueToNext = false, resumeAfter = false, radioTurn = null } = {}) {
  const turn = radioTurn || beginRadioTurn({ interruptPlayback: !resumeAfter });
  const loading = startLoadingMessages('concert');
  attachRadioTurnLoading(turn, loading);
  try {
    const data = await api('/api/radio/concert/host', {
      method: 'POST',
      body: { sessionId: ensureSessionId(), eventId, replay },
      signal: radioTurnSignal(turn)
    });
    handleRadioResponse(data, {
      loading,
      radioTurn: turn,
      afterHostSpeech: () => {
        if (continueToNext) nextTrack({ skipCurrent: false, silent: true });
        else if (resumeAfter) resumePlayback();
      }
    });
  } catch (error) {
    if (isInterruptedRadioTurn(turn, error)) return;
    stopLoadingMessages({ loading });
    replaceLoadingMessage({ text: `播放音乐会串词失败：${error.message}`, loading });
    if (continueToNext) nextTrack({ skipCurrent: false, silent: true });
    else if (resumeAfter) resumePlayback();
  }
}

async function replayConcertHostEvent(eventId) {
  const event = state.activeConcert?.hostEvents?.find(item => item.id === eventId);
  if (!event || event.status !== 'played') return;
  const songAudio = document.querySelector('#song-audio');
  const resumeAfter = Boolean(songAudio?.src && !songAudio.paused && !songAudio.ended && event.type !== 'curtain');
  if (resumeAfter) await pausePlayback();
  primeVoicePlayback();
  return requestConcertHostEvent(eventId, { replay: true, resumeAfter });
}

function getSchedulePlanningForNextTurn() {
  if (!state.schedulePlanning || state.preferences?.scheduleAwareEnabled !== true) return null;
  const items = Array.isArray(state.activeConcert?.items) ? state.activeConcert.items : [];
  const currentIndex = Number(state.activeConcert?.currentIndex ?? -1);
  const atSegmentBoundary = items.length === 0 || currentIndex >= items.length - 1;
  return atSegmentBoundary ? { source: 'schedule', refresh: true } : null;
}

async function jumpConcertTo(index) {
  if (state.radioMode !== 'concert' || !state.activeConcert) return;
  const item = state.activeConcert.items?.[index];
  if (!item || item.status !== 'pending') return;
  const radioTurn = beginRadioTurn();
  const stopCurrentPromise = pauseCurrentPlaybackForTransition();
  primeVoicePlayback();
  const sessionId = ensureSessionId();
  setAvatarState('searching');
  setPlaybackToggleState(false);
  await reportFeedback('skip');
  await stopCurrentPromise;
  if (!isActiveRadioTurn(radioTurn)) return;
  appendChat({ role: 'user', text: `跳到音乐会第 ${index + 1} 首` });
  const loading = startLoadingMessages('concertNext');
  attachRadioTurnLoading(radioTurn, loading);
  try {
    const data = await api('/api/radio/concert/jump', {
      method: 'POST',
      body: { sessionId, index },
      signal: radioTurnSignal(radioTurn)
    });
    state.radioMode = 'concert';
    handleRadioResponse(data, { loading, radioTurn });
  } catch (e) {
    if (isInterruptedRadioTurn(radioTurn, e)) {
      stopLoadingMessages({ remove: true, loading });
      clearRadioTurnLoading(radioTurn, loading);
      return;
    }
    clearRadioTurnLoading(radioTurn, loading);
    stopLoadingMessages({ loading });
    replaceLoadingMessage({ text: '跳转音乐会歌曲时出了一点问题：' + e.message, loading });
    setAvatarState(getContextualAvatarState());
    setPlayerStatus(e.message, 'error');
  }
}

async function requestAiMusicTrack({ sessionId, trigger, signal }) {
  setPlayerStatus('灿灿正在根据状态生成音乐', '');
  const currentTrack = state.current?.track
    ? {
      id: state.current.track.id,
      name: state.current.track.name,
      artists: state.current.track.artists || [],
      album: state.current.track.album || ''
    }
    : null;
  return api('/api/ai-music/generate', {
    method: 'POST',
    signal,
    body: {
      sessionId,
      trigger,
      preferences: state.preferences || {},
      currentTrack
    }
  });
}

function withAiMusicFallbackNotice(data = {}, error = {}) {
  return {
    ...data,
    chatText: `AI 原创生成暂时失败，先切回普通推荐。${data.chatText || data.hostText || ''}`,
    ttsUrl: null,
    ttsStatus: 'disabled',
    speech: { shouldSpeak: false, mode: 'off' },
    aiMusic: {
      enabled: true,
      status: 'fallback',
      error: error?.message || String(error || '')
    }
  };
}

function buildScenePromptMessage(scene) {
  return `\u6211\u6b63\u5728${scene}\uff0c\u8bf7\u5e2e\u6211\u63a8\u8350\u9002\u5408${scene}\u7684\u6b4c`;
}

function handleScenePrompt(scene) {
  const message = buildScenePromptMessage(scene);
  if (state.radioMode === 'concert') {
    api('/api/player/stop', { method: 'POST', body: {} }).catch(() => {});
    startConcertRadio({ settings: { ...state.concertSettings, scene }, message });
    return;
  }
  setRadioMode('single');
  sendChat(message);
}

async function sendChat(msg) {
  const radioTurn = beginRadioTurn({ interruptPlayback: false });
  primeVoicePlayback();
  const sessionId = ensureSessionId();
  appendChat({ role: 'user', text: msg });
  const loading = startLoadingMessages('chat');
  attachRadioTurnLoading(radioTurn, loading);
  try {
    await loadPreferences().catch(() => null);
    if (!isActiveRadioTurn(radioTurn)) return;
    const data = await api('/api/radio/chat', {
      method: 'POST',
      body: { sessionId, message: msg },
      signal: radioTurnSignal(radioTurn)
    });
    handleRadioResponse(data, { loading, radioTurn });
  } catch (e) {
    if (isInterruptedRadioTurn(radioTurn, e)) {
      stopLoadingMessages({ remove: true, loading });
      clearRadioTurnLoading(radioTurn, loading);
      return;
    }
    clearRadioTurnLoading(radioTurn, loading);
    stopLoadingMessages({ loading });
    setAvatarState(getContextualAvatarState());
    replaceLoadingMessage({ text: '抱歉，出了一点问题：' + e.message, loading });
  }
}

async function resetMode() {
  await api('/api/radio/chat', { method: 'POST', body: { sessionId: state.sessionId, message: '恢复正常推荐，取消所有偏好模式' } });
  document.querySelector('#mode-reset-btn').style.display = 'none';
  appendChat({ role: 'dj', text: '好的，恢复正常推荐模式。' });
}

function playResponseAudio(data, { radioTurn = null, afterHostSpeech = null } = {}) {
  if (!data?.track) return false;
  setPlayerStatus('歌曲就绪', 'playing');
  const startTrack = () => {
    if (!isActiveRadioTurn(radioTurn)) return;
    startSongPlayback(radioTurn);
    afterHostSpeech?.();
  };
  if (responseShouldSpeak(data)) playHostSpeech(data, startTrack, { radioTurn });
  else startTrack();
  return true;
}

function handleRadioResponse(data, { loading = null, radioTurn = null, afterHostSpeech = null } = {}) {
  if (isInterruptedRadioTurn(radioTurn)) {
    stopLoadingMessages({ remove: true, loading });
    clearRadioTurnLoading(radioTurn, loading);
    return false;
  }
  const suppressConcertHostBubble = Boolean(data.concertMode && data.hostPolicy === 'none' && data.track && !data.chatText);
  stopLoadingMessages({ loading, remove: suppressConcertHostBubble });
  clearRadioTurnLoading(radioTurn, loading);
  state.sessionId = data.sessionId || state.sessionId;
  if (data.sessionConstraints) state.sessionConstraints = data.sessionConstraints;
  if (data.interpretation?.visible && data.interpretation.text) {
    appendChat({ role: 'dj', text: data.interpretation.text });
  }
  if (data.scheduleContext) {
    state.scheduleStatus = {
      ...(state.scheduleStatus || {}),
      context: data.scheduleContext,
      fetchedAt: data.scheduleContext.fetchedAt || state.scheduleStatus?.fetchedAt || null
    };
  }
  if (data.concertMode) {
    clearRadioPrefetchRetry();
    state.radioMode = 'concert';
    state.activeConcert = data.concert || null;
    state.concertStatus = data.concert ? data.concert.phase || 'ready' : 'empty';
  } else if (data.track) {
    state.radioMode = state.aiMusicMode ? 'single' : state.radioMode === 'concert' ? 'single' : state.radioMode;
    state.activeConcert = null;
    state.concertStatus = 'idle';
  }
  setRadioButtonState(state.sessionId || data.track || state.current?.track ? 'active' : 'idle');
  renderConcertConsole(data);
  renderSessionConstraintBar();
  if (data.track) {
    stopVisualizer();
    rememberPlaybackRecommendation(data, { truncateFuture: true });
    state.current = data;
    updatePlayer(data, false);
    maybeWarmRadioQueueFromResponse(data);
  }

  if (!suppressConcertHostBubble) {
    replaceLoadingMessage({
      text: data.chatText || data.hostText || '',
      track: data.track,
      explanation: data.explanation,
      loading
    });
  }
  scheduleUsageInsightsRefresh(data.track ? 800 : 3200);

  // Show/hide mode reset button
  const hasMode = data.mode?.genre;
  document.querySelector('#mode-reset-btn').style.display = hasMode ? '' : 'none';

  if (data.switchRequested && data.stopCurrent && !data.track) {
    void nextTrack({ skipCurrent: true, silent: true, forceFresh: true });
    return true;
  }

  if (!data.track) {
    if (data.concertEvent === 'curtain') {
      setPlaybackToggleState(false);
      setPlayerStatus('音乐会已谢幕', '');
      setAvatarState('idle');
    } else {
      setPlayerStatus(state.current?.track ? '继续播放中' : '等待中', '');
    }
    if (responseShouldSpeak(data)) {
      playHostSpeech(data, () => {
        if (!isActiveRadioTurn(radioTurn)) return;
        setAvatarState(getContextualAvatarState());
        switchVisualizerTo(state.current?.track ? 'song' : 'off');
        afterHostSpeech?.();
      }, { radioTurn });
    } else afterHostSpeech?.();
    return true;
  }

  return playResponseAudio(data, { radioTurn, afterHostSpeech });
}

function playbackSequenceState() {
  return {
    sequence: state.playbackSequence,
    cursor: state.playbackCursor
  };
}

function applyPlaybackSequence(nextState = {}) {
  state.playbackSequence = Array.isArray(nextState.sequence) ? nextState.sequence : [];
  state.playbackCursor = Number.isInteger(nextState.cursor) ? nextState.cursor : -1;
  updatePreviousButtonState();
}

function rememberPlaybackRecommendation(data = {}, { truncateFuture = true } = {}) {
  if (!data?.track?.id) return;
  applyPlaybackSequence(addPlaybackItem(
    playbackSequenceState(),
    clonePlaybackItem(data),
    { truncateFuture }
  ));
}

function clonePlaybackItem(item) {
  try {
    return structuredClone(item);
  } catch {
    return JSON.parse(JSON.stringify(item));
  }
}

function updatePreviousButtonState() {
  const button = document.querySelector('#previous-btn');
  if (!button) return;
  const hasPrevious = canMovePlaybackPrevious(playbackSequenceState());
  button.disabled = !hasPrevious;
  const label = hasPrevious ? '上一首' : '没有上一首';
  button.title = label;
  button.setAttribute('aria-label', label);
}

async function playPlaybackSequenceItem(item, { direction = 'previous', skipCurrent = false, silent = false } = {}) {
  if (!item?.track) return false;
  const radioTurn = beginRadioTurn();
  const stopCurrentPromise = skipCurrent ? pauseCurrentPlaybackForTransition() : null;
  primeVoicePlayback();
  if (skipCurrent) await reportFeedback('skip');
  if (stopCurrentPromise) await stopCurrentPromise;
  if (!isActiveRadioTurn(radioTurn)) return false;
  stopVisualizer();
  setAvatarState('searching');
  setPlaybackToggleState(false);
  document.querySelector('#host-audio')?.pause();
  clearSongAudioHandlers({ reset: true });
  try {
    await api('/api/player/stop', { method: 'POST', body: {} });
  } catch {
    // Browser playback can still continue even if the external player was not running.
  }

  if (!isActiveRadioTurn(radioTurn)) return false;
  const replayItem = clonePlaybackItem(item);
  state.current = replayItem;
  updatePlayer(replayItem, false);
  if (!silent) {
    const isPrevious = direction === 'previous';
    appendChat({ role: 'user', text: isPrevious ? '上一首' : '下一首' });
    appendChat({
      role: 'dj',
      text: isPrevious
        ? `回到上一首：《${replayItem.track.name || '这首歌'}》。`
        : `继续播放顺序：《${replayItem.track.name || '这首歌'}》。`,
      track: replayItem.track,
      explanation: replayItem.explanation
    });
  }
  setPlayerStatus(direction === 'previous' ? '回到上一首' : '继续播放顺序', 'playing');
  startSongPlayback(radioTurn);
  return true;
}

async function previousTrack() {
  const previous = getPreviousPlaybackItem(playbackSequenceState());
  if (!previous?.track) {
    setPlayerStatus('没有上一首', '');
    updatePreviousButtonState();
    return;
  }

  applyPlaybackSequence(movePlaybackCursor(playbackSequenceState(), -1));
  await playPlaybackSequenceItem(previous, { direction: 'previous' });
}

function responseShouldSpeak(data = {}) {
  if (typeof data.speech?.shouldSpeak === 'boolean') return data.speech.shouldSpeak;
  if (data.speech?.mode === 'off' || data.voiceMode === 'off') return false;
  if (data.speech?.mode === 'all' || data.voiceMode === 'all') return true;
  const localVoiceMode = state.preferences?.voiceMode;
  if (localVoiceMode === 'off') return false;
  if (localVoiceMode === 'all') return true;
  return Boolean(data.track);
}

function estimateAvatarSpeechMs(text = '') {
  const compactLength = String(text || '').replace(/\s+/g, '').length;
  const estimatedMs = compactLength * 95;
  return Math.min(AVATAR_MAX_TALKING_MS, Math.max(AVATAR_MIN_TALKING_MS, estimatedMs));
}

function maybeStartSongFadeInDuringHost(data, radioTurn, hostAudio) {
  const track = data?.track;
  if (!isActiveRadioTurn(radioTurn) || !track?.playUrl || !data?.ttsUrl || !hostAudio) return false;
  const songAudio = document.querySelector('#song-audio');
  const fadeKey = getSongFadeTrackKey(track);
  if (!songAudio || isSongFadeInPreparedForTrack(track)) return false;
  if (state.songFadeInActive && state.songFadeInTrackKey === fadeKey) return false;

  const duration = Number(hostAudio.duration);
  const currentTime = Number(hostAudio.currentTime);
  if (!Number.isFinite(duration) || !Number.isFinite(currentTime) || duration <= 0) return false;
  const remainingMs = (duration - currentTime) * 1000;
  if (remainingMs > TTS_SONG_OVERLAP_MS || remainingMs < -250) return false;

  if (!audioHasTrackSource(songAudio, track)) {
    songAudio.crossOrigin = 'anonymous';
    songAudio.src = track.playUrl;
  }

  const startedAt = performance.now();
  state.songFadeInActive = true;
  state.songFadeInTrackKey = fadeKey;
  state.songFadeInOfficial = false;
  try { songAudio.currentTime = 0; } catch {}
  songAudio.volume = 0;

  const step = (now) => {
    if (!state.songFadeInActive || state.songFadeInTrackKey !== fadeKey || !isActiveRadioTurn(radioTurn)) {
      cancelSongFadeIn({ resetVolume: true });
      return;
    }
    const ratio = Math.min(1, Math.max(0, (now - startedAt) / SONG_FADE_IN_MS));
    songAudio.volume = ratio;
    hostAudio.volume = 1 - ((1 - HOST_TTS_DUCK_VOLUME) * ratio);
    if (ratio < 1) {
      state.songFadeInFrame = requestAnimationFrame(step);
      return;
    }
    state.songFadeInActive = false;
    state.songFadeInFrame = null;
    state.songFadeInTrackKey = null;
    state.songFadeInOfficial = false;
    songAudio.volume = 1;
    hostAudio.volume = HOST_TTS_DUCK_VOLUME;
  };

  songAudio.play()
    .then(() => {
      if (!state.songFadeInActive || state.songFadeInTrackKey !== fadeKey) return;
      state.songFadeInFrame = requestAnimationFrame(step);
    })
    .catch((error) => {
      console.warn('[song fade-in skipped]', error?.message || error);
      cancelSongFadeIn({ resetVolume: true });
    });
  return true;
}

function playHostSpeech(data, onEnd, { radioTurn = null } = {}) {
  const text = data.chatText || data.hostText || '';
  const hostAudio = document.querySelector('#host-audio');
  if (!responseShouldSpeak(data) || !text) {
    if (hostAudio) hostAudio.src = '';
    if (!isActiveRadioTurn(radioTurn)) return;
    onEnd?.();
    return;
  }

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (hostAudio) {
      hostAudio.onended = null;
      hostAudio.onplay = null;
      hostAudio.ontimeupdate = null;
      hostAudio.volume = 1;
    }
    if (!isActiveRadioTurn(radioTurn)) return;
    onEnd?.();
  };

  const visualSpeechMs = estimateAvatarSpeechMs(text);
  const finishAfterVisualHold = () => {
    setTimeout(finish, visualSpeechMs);
  };

  setAvatarState('talking');
  switchVisualizerTo('host');
  if (data.track) setPlaybackToggleState(true);

  if (!data.ttsUrl || !hostAudio) {
    if (hostAudio) hostAudio.src = '';
    console.warn('[tts skipped]', data.ttsError || data.ttsStatus || 'no synthesized audio');
    finishAfterVisualHold();
    return;
  }

  try {
    hostAudio.muted = false;
    hostAudio.volume = 1;
    hostAudio.src = data.ttsUrl;
    hostAudio.onended = finish;
    hostAudio.ontimeupdate = () => {
      maybeStartSongFadeInDuringHost(data, radioTurn, hostAudio);
    };
    hostAudio.onplay = () => {
      if (!isActiveRadioTurn(radioTurn)) return;
      setAvatarState('talking');
      ensureVisualizerAnalysis('host');
      switchVisualizerTo('host');
      if (data.track) setPlaybackToggleState(true);
      maybeStartSongFadeInDuringHost(data, radioTurn, hostAudio);
    };
    hostAudio.play().catch((error) => {
      console.warn('[tts skipped]', error?.message || error);
      hostAudio.ontimeupdate = null;
      hostAudio.volume = 1;
      cancelSongFadeIn({ resetVolume: true });
      finishAfterVisualHold();
    });
  } catch (error) {
    console.warn('[tts skipped]', error?.message || error);
    if (hostAudio) hostAudio.volume = 1;
    cancelSongFadeIn({ resetVolume: true });
    finishAfterVisualHold();
  }
}

function primeVoicePlayback() {
  const hostAudio = document.querySelector('#host-audio');
  if (!hostAudio || hostAudio.dataset.voicePrimed === 'true') return;
  if (hostAudio.src && !hostAudio.paused && !hostAudio.ended) return;

  const previousSrc = hostAudio.getAttribute('src') || '';
  const previousMuted = hostAudio.muted;
  hostAudio.dataset.voicePriming = 'true';
  hostAudio.muted = true;
  hostAudio.src = SILENT_AUDIO_DATA_URI;
  hostAudio.play()
    .then(() => {
      hostAudio.pause();
      hostAudio.currentTime = 0;
      hostAudio.dataset.voicePrimed = 'true';
      if (previousSrc) hostAudio.src = previousSrc;
      else {
        hostAudio.removeAttribute('src');
        hostAudio.load();
      }
    })
    .catch(() => {
      if (previousSrc) hostAudio.src = previousSrc;
      else hostAudio.removeAttribute('src');
    })
    .finally(() => {
      hostAudio.muted = previousMuted;
      delete hostAudio.dataset.voicePriming;
    });
}

function appendChat({ role, text, track, explanation, loading = false }) {
  if (!text && !track && !loading) return null;
  const container = document.querySelector('#chat-messages');
  container?.querySelector('[data-initial-chat]')?.remove();
  const cls = role === 'user' ? 'user-msg' : 'dj-msg';

  let html = `<div class="chat-msg ${cls}${loading ? ' loading-msg' : ''}"${loading ? ' aria-live="polite"' : ''}></div>`;
  container.insertAdjacentHTML('beforeend', html);
  const el = container.lastElementChild;
  if (loading) {
    el.innerHTML = `
      <p class="loading-chat-line">
        <span class="loading-signal" aria-hidden="true"></span>
        <span data-loading-text></span>
      </p>
    `;
  } else {
    renderChatMessageContent(el, { text, track, explanation });
  }
  scrollChatToBottom();
  return el;
}

function renderChatMessageContent(el, { text, track, explanation }) {
  if (!el) return;
  let html = '';
  if (text) html += `<p>${escapeHtml(text)}</p>`;
  if (track?.name) html += buildTrackCardHTML(track, explanation);
  el.innerHTML = html;
}

function buildTrackCardHTML(track, explanation = null) {
  const reasonHtml = buildExplanationHTML(explanation);
  return `<div class="track-card" onclick="document.querySelector('#song-audio')?.play()">
    <img src="${escapeAttr(track.coverUrl || '/assets/cover-1.svg')}" alt="" />
    <div class="track-card-text">
      <h4>${escapeHtml(track.name)}</h4>
      <p>${escapeHtml((track.artists || []).join(' / '))}</p>
      ${reasonHtml}
    </div>
  </div>`;
}

function renderConcertConsole(response = {}) {
  const panel = document.querySelector('#concert-console-panel');
  if (!panel) return;
  const isConcertMode = state.radioMode === 'concert';
  panel.hidden = !isConcertMode;
  panel.classList.toggle('is-active', isConcertMode);
  if (!isConcertMode) {
    panel.innerHTML = '';
    return;
  }

  const concert = state.activeConcert;
  const items = Array.isArray(concert?.items) ? concert.items : [];
  if (!concert || !items.length) {
    const isEmpty = state.concertStatus === 'empty';
    const requestedLength = Number(response.requestedLength || state.concertSettings.length || 5);
    const fallbackLengths = Array.isArray(response.fallbackLengths) ? response.fallbackLengths : [];
    panel.innerHTML = `
      <div class="playlist-queue-head">
        <span>${requestedLength} TRACK CONCERT</span>
        <strong>${isEmpty ? '暂未开场' : '音乐会编排中'}</strong>
        <small>${isEmpty ? `这次只确认到 ${Number(response.availableCount || 0)} 首稳定可播歌曲` : '正在确认节目单、分幕和主持词'}</small>
      </div>
      ${fallbackLengths.length ? `<div class="concert-fallback-actions">${fallbackLengths.map(length => `<button type="button" data-concert-fallback-length="${length}">降级为 ${length} 首</button>`).join('')}</div>` : ''}
      <div class="playlist-queue-list" aria-label="音乐会准备中">
        ${Array.from({ length: requestedLength }, (_, index) => `
          <div class="playlist-queue-item is-waiting${isEmpty ? ' is-empty' : ''}">
            <span class="playlist-queue-index">${index + 1}</span>
            <span class="playlist-queue-copy">
              <strong>${isEmpty ? '未锁定曲目' : '待确认曲目'}</strong>
              <small>${isEmpty ? 'NO SIGNAL' : 'STANDBY'}</small>
            </span>
          </div>
        `).join('')}
      </div>
    `;
    return;
  }

  const current = Number(concert.currentIndex || 0) + 1;
  const total = items.length;
  const actMap = new Map((concert.acts || []).map(act => [Number(act.startIndex), act]));
  const hostEvents = Array.isArray(concert.hostEvents) ? concert.hostEvents : [];
  const hostEventsByIndex = new Map();
  hostEvents.forEach(event => {
    const beforeIndex = Number(event.beforeIndex || 0);
    if (!hostEventsByIndex.has(beforeIndex)) hostEventsByIndex.set(beforeIndex, []);
    hostEventsByIndex.get(beforeIndex).push(event);
  });
  const phaseLabel = concert.phase === 'curtain' ? 'CURTAIN CALL' : concert.phase === 'encore' ? 'ENCORE' : concert.phase === 'finished' ? 'SHOW COMPLETE' : 'ON AIR';
  panel.innerHTML = `
    <div class="playlist-queue-head">
      <span>${total} TRACK CONCERT · ${phaseLabel}</span>
      <strong>${escapeHtml(concert.title || '灿灿音乐会')}</strong>
      <small>${escapeHtml(concert.summary || `第 ${current} / ${total} 首`)}</small>
    </div>
    <div class="concert-console-controls" aria-label="弹幕来源">
      <button type="button" class="${state.concertDanmaku.ai ? 'is-active' : ''}" data-danmaku-source="ai">AI 观众 ${state.concertDanmaku.ai ? 'ON' : 'OFF'}</button>
      <button type="button" class="${state.concertDanmaku.real ? 'is-active' : ''}" data-danmaku-source="real">真实热评 ${state.concertDanmaku.real ? 'ON' : 'OFF'}</button>
    </div>
    <div class="playlist-queue-progress" aria-hidden="true">
      <span style="width:${Math.min(100, Math.max(0, (current / Math.max(1, total)) * 100))}%"></span>
    </div>
    <div class="playlist-queue-list" aria-label="当前音乐会节目单">
      ${items.map((item) => `${(hostEventsByIndex.get(Number(item.index)) || []).map(buildConcertHostEventHTML).join('')}${actMap.has(Number(item.index)) ? `<div class="concert-act-divider">${escapeHtml(actMap.get(Number(item.index)).title || `第 ${actMap.get(Number(item.index)).index + 1} 幕`)}</div>` : ''}${buildConcertQueueItemHTML(item)}`).join('')}
      ${(hostEventsByIndex.get(total) || []).map(buildConcertHostEventHTML).join('')}
    </div>
    ${['curtain', 'finished'].includes(concert.phase) ? `
      <div class="concert-ending-actions">
        ${concert.phase === 'curtain' && !concert.encoreUsed ? '<button type="button" data-concert-encore>返场一首</button>' : ''}
        <button type="button" data-concert-new>生成新场次</button>
      </div>
    ` : ''}
  `;
}

function buildConcertHostEventHTML(event = {}) {
  const labels = { intro: '开场白', interlude: `第 ${Number(event.actIndex || 0) + 1} 幕串词`, curtain: '谢幕词' };
  const played = event.status === 'played';
  const skipped = event.status === 'skipped';
  const statusText = played ? '可重播' : skipped ? '已越过' : event.type === 'curtain' ? '待谢幕' : '待播';
  return `
    <button
      type="button"
      class="concert-host-event is-${escapeAttr(event.type || 'interlude')} ${played ? 'is-played' : skipped ? 'is-skipped' : 'is-pending'}"
      data-concert-host-event="${escapeAttr(event.id || '')}"
      ${played ? '' : 'disabled'}
      title="${played ? '重新播放这段串词' : '播放到这里后自动播出'}"
    >
      <span class="concert-host-signal">HOST</span>
      <span class="concert-host-copy">
        <strong>${escapeHtml(labels[event.type] || '主持串词')}</strong>
        <small>${escapeHtml(String(event.text || '').slice(0, 42))}${String(event.text || '').length > 42 ? '…' : ''}</small>
      </span>
      <span class="concert-host-status">${statusText}</span>
    </button>
  `;
}

function renderSessionConstraintBar() {
  const bar = document.querySelector('#session-constraint-bar');
  if (!bar) return;
  const rules = Array.isArray(state.sessionConstraints?.rules) ? state.sessionConstraints.rules : [];
  bar.hidden = !rules.length;
  if (!rules.length) {
    bar.innerHTML = '';
    return;
  }
  bar.innerHTML = `
    <span class="session-constraint-title">本次对话禁听</span>
    <div class="session-constraint-rules">
      ${rules.map(rule => `
        <button type="button" data-constraint-label="${escapeAttr(rule.label || rule.value || '')}" title="取消这项临时限制">
          <span>${escapeHtml(rule.label || rule.value || '限制')}</span>
          <small>剩 ${Number(rule.remainingTracks || 0)} 首</small>
          <b aria-hidden="true">×</b>
        </button>
      `).join('')}
    </div>
  `;
}

function buildConcertQueueItemHTML(item = {}) {
  const track = item.track || {};
  const status = ['current', 'played', 'skipped', 'pending'].includes(item.status) ? item.status : 'pending';
  const index = Number(item.index || 0);
  const artists = Array.isArray(track.artists) ? track.artists.join(' / ') : '';
  const statusText = {
    current: 'ON AIR',
    pending: '可跳播',
    played: '已播',
    skipped: '已跳过'
  }[status] || '待播';
  const disabled = status !== 'pending';
  const title = track.name || '待确认曲目';
  return `
    <button
      type="button"
      class="playlist-queue-item is-${escapeAttr(status)}"
      data-concert-index="${index}"
      ${disabled ? 'disabled' : ''}
      title="${disabled ? escapeAttr(statusText) : `跳到第 ${index + 1} 首`}"
    >
      <span class="playlist-queue-index">${index + 1}</span>
      <span class="playlist-queue-cover">
        <img src="${escapeAttr(track.coverUrl || '/assets/cover-1.svg')}" alt="" />
      </span>
      <span class="playlist-queue-copy">
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(artists || item.reason || '灿灿推荐')}</small>
        ${item.reason ? `<em>${escapeHtml(item.reason)}</em>` : ''}
      </span>
      <span class="playlist-queue-status">${escapeHtml(statusText)}</span>
    </button>
  `;
}

function buildExplanationHTML(explanation = null) {
  const factors = Array.isArray(explanation?.factors)
    ? explanation.factors.flatMap(normalizeExplanationFactor).filter(Boolean)
      .filter(factor => !isInternalExplanationFactor(factor))
      .filter(uniqueExplanationFactor)
    : [];
  if (!factors.length) return '';
  const factorHtml = `<div class="track-explanation-factors">${factors.map(text =>
    buildExplanationFactorHTML(text)
  ).join('')}</div>`;
  return `
    <details class="track-explanation" onclick="event.stopPropagation()">
      <summary>推荐依据</summary>
      ${factorHtml}
    </details>
  `;
}

function normalizeExplanationFactor(factor) {
  if (!factor) return [];
  if (typeof factor === 'string') return splitExplanationText(factor);
  const label = String(factor.label || '').trim();
  const value = sanitizeExplanationValue(factor.value || '');
  if (label && value) return [{ label, value }];
  return splitExplanationText(String(factor.text || '').trim());
}

function splitExplanationText(text = '') {
  const value = sanitizeExplanationValue(text);
  if (!value) return null;
  if (/最近表达[：:]|偏好线索[：:]/.test(value) && !value.match(/^([^：:]{2,10})[：:]\s*(.+)$/)) {
    return splitLegacyMixedExplanation(value);
  }
  const match = value.match(/^([^：:]{2,10})[：:]\s*(.+)$/);
  if (!match) return [{ label: '', value }];
  const label = match[1].trim();
  const content = sanitizeExplanationValue(match[2]);
  return content ? [{ label, value: content }] : [];
}

function splitLegacyMixedExplanation(value = '') {
  const factors = [];
  const state = sanitizeExplanationValue(value.split(/最近表达[：:]|偏好线索[：:]/)[0]);
  const recent = value.match(/最近表达[：:]\s*(.*?)(?=，?\s*(偏好线索[：:]|$))/);
  const hints = value.match(/偏好线索[：:]\s*(.*)$/);
  if (state) factors.push({ label: '当前状态', value: state });
  if (recent?.[1]) factors.push({ label: '最近表达', value: sanitizeExplanationValue(recent[1]) });
  if (hints?.[1]) factors.push({ label: '音乐线索', value: sanitizeExplanationValue(hints[1]) });
  return factors.length ? factors : [{ label: '', value }];
}

function sanitizeExplanationValue(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/AI 原创电台模式已开启[，。；;]*/g, '')
    .replace(/对话分析[：:].*?(?=当前偏好状态[：:]|用户备注[：:]|生成方式[：:]|$)/g, '')
    .replace(/当前偏好状态[：:][^，。；;]*/g, '')
    .replace(/用户备注[：:][^，。；;]*/g, '')
    .replace(/生成方式[：:][^，。；;]*/g, '')
    .replace(/Music-2\.6(?:-free)?/gi, '')
    .replace(/[，,]\s*[，,]+/g, '，')
    .replace(/^[，,。；;\s]+|[，,。；;\s]+$/g, '')
    .trim()
    .slice(0, 80);
}

function isInternalExplanationFactor(factor) {
  const text = `${factor?.label || ''} ${factor?.value || ''}`.trim();
  if (!text) return false;
  return /LLM|profile_fallback|same_artist_fallback|fallback|playable source|stable playback/i.test(text) ||
    /没有确认到|未确认到|稳定播放源|可播放源|兜底|原来想找|更稳的一首|改用当前账号/.test(text);
}

function buildExplanationFactorHTML(factor) {
  if (!factor?.label) return `<span>${escapeHtml(factor?.value || '')}</span>`;
  return `<span class="is-structured"><strong>${escapeHtml(factor.label)}</strong><em>${escapeHtml(factor.value)}</em></span>`;
}

function scrollChatToBottom() {
  const container = document.querySelector('#chat-messages');
  if (!container) return;
  const scroll = () => {
    container.scrollTop = container.scrollHeight;
  };
  scroll();
  requestAnimationFrame(scroll);
  setTimeout(scroll, 120);
}

async function replanConcert(message) {
  const radioTurn = beginRadioTurn({ interruptPlayback: false });
  const sessionId = ensureSessionId();
  appendChat({ role: 'user', text: message });
  const loading = startLoadingMessages('concert');
  attachRadioTurnLoading(radioTurn, loading);
  try {
    const data = await api('/api/radio/concert/replan', {
      method: 'POST',
      body: { sessionId, message },
      signal: radioTurnSignal(radioTurn)
    });
    handleRadioResponse(data, { loading, radioTurn });
  } catch (error) {
    if (isInterruptedRadioTurn(radioTurn, error)) return;
    stopLoadingMessages({ loading });
    replaceLoadingMessage({ text: `调整后半场失败：${error.message}`, loading });
  }
}

async function startConcertEncore() {
  if (!state.activeConcert || state.activeConcert.encoreUsed) return;
  const radioTurn = beginRadioTurn();
  primeVoicePlayback();
  const loading = startLoadingMessages('concert');
  attachRadioTurnLoading(radioTurn, loading);
  appendChat({ role: 'user', text: '返场一首' });
  try {
    const data = await api('/api/radio/concert/encore', {
      method: 'POST',
      body: { sessionId: ensureSessionId() },
      signal: radioTurnSignal(radioTurn)
    });
    handleRadioResponse(data, { loading, radioTurn });
  } catch (error) {
    if (isInterruptedRadioTurn(radioTurn, error)) return;
    stopLoadingMessages({ loading });
    replaceLoadingMessage({ text: `返场准备失败：${error.message}`, loading });
  }
}

function toggleConcertDanmakuSource(source) {
  if (!['ai', 'real'].includes(source)) return;
  state.concertDanmaku[source] = !state.concertDanmaku[source];
  renderConcertConsole();
  if (state.current?.track) prepareCommentDanmakuForTrack(state.current.track);
}

function uniqueExplanationFactor(factor, index, factors) {
  const key = `${factor?.label || ''}\u0000${factor?.value || ''}`;
  return factors.findIndex(item => `${item?.label || ''}\u0000${item?.value || ''}` === key) === index;
}

async function updatePlayer(data, autoplay) {
  const track = data.track || {};
  document.querySelector('#track-title').textContent = track.name || '灿灿校园电台';
  document.querySelector('#track-artist').textContent = (track.artists || []).join(' / ') || '等待启动';
  updateAiMusicDownload(track);
  buildLyricDOM(data.track?.lyric || '', { syncMode: data.track?.lyricSync || 'timed' });
  prepareCommentDanmakuForTrack(track);

  const songAudio = document.querySelector('#song-audio');
  if (track.playUrl) {
    // Don't reset src if already playing this URL (e.g. navigating back to player page)
    if (songAudio.getAttribute('src') !== track.playUrl) {
      clearSongAudioHandlers();
      songAudio.crossOrigin = 'anonymous';
      songAudio.src = track.playUrl;
    }
    songAudio.style.display = '';
  } else {
    clearSongAudioHandlers();
    songAudio.removeAttribute('src');
    songAudio.load?.();
    songAudio.style.display = 'none';
  }
  // Reset progress bar for new track
  const fill = document.querySelector('#progress-fill');
  const current = document.querySelector('#progress-current');
  const duration = document.querySelector('#progress-duration');
  if (fill) setProgressBarVisual(0);
  if (current) current.textContent = '00:00';
  if (duration) duration.textContent = '00:00';
}

function prepareCommentDanmakuForTrack(track = {}) {
  const songId = getTrackNeteaseSongId(track);
  const trackId = String(track?.id || '');
  stopCommentDanmaku({ clearLayer: true, invalidate: true });
  danmakuState.activeTrackId = trackId || null;
  danmakuState.activeSongId = songId || null;
  danmakuState.comments = [];
  danmakuState.remainingComments = [];
  const token = danmakuState.token;

  const realEnabled = state.radioMode !== 'concert' || state.concertDanmaku.real;
  const realPromise = realEnabled && songId
    ? danmakuState.realCache.has(songId)
      ? Promise.resolve(danmakuState.realCache.get(songId))
      : api(`/api/track-comments?songId=${encodeURIComponent(songId)}`)
        .then(data => (Array.isArray(data.comments) ? data.comments : []).map(comment => ({
          ...comment,
          source: 'real',
          persona: '',
          displayName: comment.nickname || '网易云听众'
        })))
        .catch(() => [])
        .then(comments => (danmakuState.realCache.set(songId, comments), comments))
    : Promise.resolve([]);

  const aiPromise = state.radioMode === 'concert' && state.concertDanmaku.ai && trackId
    ? danmakuState.aiCache.has(trackId)
      ? Promise.resolve(danmakuState.aiCache.get(trackId))
      : api('/api/radio/concert/audience', {
        method: 'POST',
        body: { sessionId: ensureSessionId(), trackId }
      }).then(data => Array.isArray(data.comments) ? data.comments : [])
        .catch(() => [])
        .then(comments => (danmakuState.aiCache.set(trackId, comments), comments))
    : Promise.resolve([]);

  Promise.all([aiPromise, realPromise]).then(([aiComments, realComments]) => {
    if (token !== danmakuState.token || danmakuState.activeTrackId !== trackId) return;
    setCommentDanmakuComments(mixConcertComments(aiComments, realComments));
    maybeStartCommentDanmaku({ initial: true });
    prefetchNextConcertAudience(trackId);
  });
}

function setCommentDanmakuComments(comments = []) {
  const safeComments = Array.isArray(comments) ? comments.filter(comment => comment?.content) : [];
  danmakuState.comments = safeComments;
  danmakuState.remainingComments = shuffledComments(safeComments);
}

function stopCommentDanmaku({ clearLayer = false, invalidate = false } = {}) {
  if (danmakuState.timer) {
    clearTimeout(danmakuState.timer);
    danmakuState.timer = null;
  }
  if (invalidate) danmakuState.token += 1;
  if (clearLayer) {
    const layer = document.querySelector('.player-danmaku-layer');
    if (layer) layer.innerHTML = '';
  }
}

function maybeStartCommentDanmaku({ initial = false } = {}) {
  if (!danmakuState.remainingComments.length || !isCurrentTrackPlaying()) return;
  if (danmakuState.timer) return;
  const delay = initial
    ? DANMAKU_INITIAL_DELAY_MS
    : randomBetween(DANMAKU_MIN_DELAY_MS, DANMAKU_MAX_DELAY_MS);
  danmakuState.timer = setTimeout(() => {
    danmakuState.timer = null;
    if (!danmakuState.remainingComments.length || !isCurrentTrackPlaying()) return;
    spawnCommentDanmaku();
    maybeStartCommentDanmaku();
  }, delay);
}

function isCurrentTrackPlaying() {
  const track = state.current?.track;
  if (!track?.id) return false;
  const songAudio = document.querySelector('#song-audio');
  if (track.playUrl && songAudio?.src) return !songAudio.paused && !songAudio.ended;
  return state.activePlayback?.trackId === track.id &&
    document.querySelector('#play-toggle-btn')?.classList.contains('is-playing');
}

function spawnCommentDanmaku() {
  const layer = ensureCommentDanmakuLayer();
  if (!layer) return;
  const comment = danmakuState.remainingComments.shift();
  if (!comment) return;
  while (layer.children.length >= DANMAKU_MAX_VISIBLE) {
    layer.firstElementChild?.remove();
  }

  const bullet = document.createElement('div');
  const source = comment.source === 'ai' ? 'ai' : 'real';
  bullet.className = `player-danmaku-bullet is-${source}`;
  bullet.style.setProperty('--danmaku-y', `${Math.round(randomBetween(8, 76))}%`);
  const displayName = comment.displayName || comment.nickname || comment.persona || '';
  const nickname = displayName ? `<em>${escapeHtml(displayName)}</em>` : '';
  const sourceLabel = source === 'ai' ? `AI · ${comment.persona || '虚拟观众'}` : '真实热评';
  bullet.innerHTML = `<b>${escapeHtml(sourceLabel)}</b><span>${escapeHtml(comment.content || '')}</span>${nickname}`;
  layer.appendChild(bullet);
  const width = Math.max(120, bullet.scrollWidth || bullet.getBoundingClientRect().width || 240);
  const distance = Math.ceil(layer.clientWidth + width + 48);
  const duration = Math.min(30, Math.max(13, distance / 58));
  bullet.style.setProperty('--danmaku-duration', `${duration.toFixed(1)}s`);
  bullet.style.setProperty('--danmaku-distance', `-${distance}px`);
  bullet.addEventListener('animationend', () => bullet.remove(), { once: true });
  setTimeout(() => bullet.remove(), Math.ceil(duration * 1000) + 1000);
}

function ensureCommentDanmakuLayer() {
  const panel = document.querySelector('.now-panel');
  if (!panel) return null;
  let layer = panel.querySelector('.player-danmaku-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'player-danmaku-layer';
    layer.setAttribute('aria-hidden', 'true');
    panel.appendChild(layer);
  }
  return layer;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function shuffledComments(comments = []) {
  const items = [...comments];
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function buildLyricDOM(lrcText, { syncMode = 'timed' } = {}) {
  const container = document.querySelector('#lyric');
  if (!container) return;

  container.innerHTML = '';

  if (!lrcText) {
    container.innerHTML = '<p class="lyric-empty">暂无歌词</p>';
    state.lyricLines = [];
    state.activeLyricIndex = -1;
    return;
  }

  const lines = [];
  const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/g;
  let match;
  while ((match = regex.exec(lrcText)) !== null) {
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const ms = parseInt(match[3].padEnd(3, '0'), 10);
    const time = minutes * 60 + seconds + ms / 1000;
    const text = match[4].trim();
    if (text) lines.push({ time, text });
  }

  state.lyricLines = lines;
  state.activeLyricIndex = -1;

  const viewport = document.createElement('div');
  viewport.className = 'lyric-viewport';

  if (!lines.length && syncMode === 'plain') {
    viewport.classList.add('lyric-viewport-plain');
    const plainLines = String(lrcText)
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    plainLines.forEach((line) => {
      const el = document.createElement('p');
      const isSection = /^\[[^\]]+\]$/.test(line);
      el.className = isSection ? 'lyric-section-label' : 'lyric-line lyric-line-plain';
      el.textContent = line.replace(/^\[|\]$/g, '');
      viewport.appendChild(el);
    });
    if (!plainLines.length) viewport.innerHTML = '<p class="lyric-empty">暂无歌词</p>';
  } else if (!lines.length) {
    viewport.innerHTML = '<p class="lyric-empty">纯音乐，请欣赏</p>';
  } else {
    lines.forEach((line, i) => {
      const el = document.createElement('p');
      el.className = 'lyric-line';
      el.textContent = line.text;
      el.dataset.index = i;
      el.dataset.time = line.time;
      viewport.appendChild(el);
    });
  }

  container.appendChild(viewport);
  updateLyricCenterPadding(viewport);
}

function renderLyricStandby() {
  const container = document.querySelector('#lyric');
  if (!container) return;

  state.lyricLines = [];
  state.activeLyricIndex = -1;
  container.innerHTML = `
    <div class="lyric-standby" aria-label="CanCan radio standby">
      <div class="lyric-standby-signal" aria-hidden="true">
        <span class="lyric-standby-line"></span>
        <span class="lyric-standby-pulse"></span>
      </div>
      <div class="lyric-standby-copy">
        <span class="lyric-standby-kicker">PRIVATE FREQUENCY</span>
        <strong>READY</strong>
        <p>CanCan is waiting on this channel</p>
      </div>
    </div>
  `;
}

function syncLyricTime(currentTimeSec, { forceCenter = false } = {}) {
  const lines = state.lyricLines;
  if (!lines.length) return;

  let activeIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= currentTimeSec) {
      activeIndex = i;
    } else {
      break;
    }
  }

  if (activeIndex === state.activeLyricIndex && !forceCenter) return;
  state.activeLyricIndex = activeIndex;

  const viewport = document.querySelector('.lyric-viewport');
  if (!viewport) return;
  if (forceCenter) viewport.classList.add('is-seeking');

  viewport.querySelectorAll('.lyric-line').forEach((el, i) => {
    const dist = Math.abs(i - activeIndex);
    el.classList.remove('active', 'near', 'far');
    if (dist === 0) el.classList.add('active');
    else if (dist === 1) el.classList.add('near');
    else if (dist > 2) el.classList.add('far');
  });

  if (activeIndex >= 0) {
    const activeEl = viewport.querySelector(`.lyric-line[data-index="${activeIndex}"]`);
    if (activeEl) {
      centerLyricLine(viewport, activeEl, { stabilize: forceCenter, immediate: forceCenter });
    }
  }

  if (forceCenter) {
    setTimeout(() => {
      if (viewport.isConnected) viewport.classList.remove('is-seeking');
    }, 180);
  }
}

function applyLyricCenter(viewport, lineEl) {
  if (!viewport?.isConnected || !lineEl?.isConnected) return;
  updateLyricCenterPadding(viewport, lineEl);
  const viewportRect = viewport.getBoundingClientRect();
  const lineRect = lineEl.getBoundingClientRect();
  const targetTop = viewport.scrollTop
    + (lineRect.top + lineRect.height / 2)
    - (viewportRect.top + viewportRect.height / 2);
  const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  viewport.scrollTo({
    top: Math.min(maxTop, Math.max(0, targetTop)),
    behavior: 'auto'
  });
}

function centerLyricLine(viewport, lineEl, { stabilize = false, immediate = false } = {}) {
  const center = () => requestAnimationFrame(() => applyLyricCenter(viewport, lineEl));
  if (immediate) applyLyricCenter(viewport, lineEl);
  center();
  if (stabilize) {
    setTimeout(center, 48);
    setTimeout(center, 140);
    setTimeout(center, 320);
  }
}

function updateLyricCenterPadding(viewport, lineEl = null) {
  if (!viewport?.isConnected) return;
  if (viewport.classList.contains('lyric-viewport-plain')) return;
  const sampleLine = lineEl || viewport.querySelector('.lyric-line');
  const viewportHeight = viewport.getBoundingClientRect().height || viewport.clientHeight;
  const lineHeight = sampleLine?.getBoundingClientRect().height || 52;
  const centerPadding = Math.max(28, Math.round((viewportHeight - lineHeight) / 2));
  viewport.style.setProperty('--lyric-center-padding', `${centerPadding}px`);
}

function scheduleLyricResyncToCurrentPlayback() {
  const sync = () => {
    const songAudio = document.querySelector('#song-audio');
    if (!songAudio) return;
    syncLyricTime(Number(songAudio.currentTime) || 0, { forceCenter: true });
  };
  requestAnimationFrame(sync);
  setTimeout(sync, 120);
}

async function startSongPlayback(radioTurn = null) {
  if (!isActiveRadioTurn(radioTurn)) return;
  const track = state.current?.track;
  const songAudio = document.querySelector('#song-audio');
  const prewarmed = isSongFadeInPreparedForTrack(track);
  const playbackToken = ++state.playbackTokenSeq;
  state.activePlaybackToken = playbackToken;
  clearSongAudioHandlers({ preserveFade: prewarmed });

  // If we have a direct URL, play it in browser
  if (track?.playUrl) {
    let playbackActivated = false;
    const activateBrowserPlayback = () => {
      if (playbackActivated || !isCurrentPlaybackTurn(radioTurn, track, playbackToken)) return;
      playbackActivated = true;
      if (state.songFadeInTrackKey === getSongFadeTrackKey(track)) state.songFadeInOfficial = true;
      markPlaybackStarted(track, 'browser');
      maybeStartCommentDanmaku({ initial: true });
      startProgressAnimation();
      setAvatarState('listening');
      ensureVisualizerAnalysis('song');
      if (visualizerState.mode !== 'song') switchVisualizerTo('song');
      updateProgressBar();
      maybeWarmRadioQueueFromResponse({ track });
      api('/api/play/report', { method: 'POST', body: { trackId: track.id, playType: 'play' } }).catch(() => {});
    };

    setPlayerStatus(`正在播放：${track.name || '未知歌曲'}`, 'playing');
    setAvatarState('listening');
    setPlaybackToggleState(true);
    switchVisualizerTo('song');
    songAudio.onerror = () => {
      if (!isCurrentPlaybackTurn(radioTurn, track, playbackToken)) return;
      cancelSongFadeIn({ resetVolume: true });
      handleBrowserPlaybackIssue(radioTurn, track, playbackToken);
    };
    songAudio.onended = async () => {
      if (!isCurrentPlaybackTurn(radioTurn, track, playbackToken)) return;
      cancelSongFadeIn({ resetVolume: true });
      stopCommentDanmaku({ clearLayer: true });
      stopProgressAnimation();
      stopVisualizer();
      setAvatarState('searching');
      setPlaybackToggleState(false);
      await reportFeedback('complete');
      if (!isCurrentPlaybackTurn(radioTurn, track, playbackToken)) return;
      nextTrack({ skipCurrent: false });
    };
    songAudio.onplay = activateBrowserPlayback;
    songAudio.ontimeupdate = () => {
      if (!isCurrentPlaybackTurn(radioTurn, track, playbackToken)) return;
      if (!progressSeekState.dragging) syncLyricTime(songAudio.currentTime);
      updateProgressBar();
    };
    if (prewarmed) {
      activateBrowserPlayback();
      return;
    }
    songAudio.volume = 1;
    songAudio.play()
      .then(activateBrowserPlayback)
      .catch(() => handleBrowserPlaybackIssue(radioTurn, track, playbackToken));
    return;
  }

  if (!shouldUseServerPlayerFallback()) {
    handleBrowserPlaybackIssue(radioTurn, track, playbackToken);
    return;
  }

  // Local desktop fallback only: ncm-cli is not available for the public web demo.
  setAvatarState('listening');
  setPlaybackToggleState(true);
  switchVisualizerTo('song');
  playCurrentTrack(radioTurn, playbackToken);
}

function shouldUseServerPlayerFallback() {
  const host = window.location.hostname;
  return !host || host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function handleBrowserPlaybackIssue(radioTurn, track, playbackToken = null) {
  if (!isCurrentPlaybackTurn(radioTurn, track, playbackToken)) return;
  cancelSongFadeIn({ resetVolume: true });
  if (shouldUseServerPlayerFallback()) {
    playCurrentTrack(radioTurn, playbackToken);
    return;
  }
  stopCommentDanmaku({ clearLayer: true });
  stopVisualizer();
  setPlaybackToggleState(false);
  setAvatarState('searching');
  setPlayerStatus('这首暂时无法在网页播放，正在换下一首', '');
  setTimeout(() => {
    if (!isCurrentPlaybackTurn(radioTurn, track, playbackToken)) return;
    nextTrack({ skipCurrent: true, silent: true });
  }, 420);
}

function markPlaybackStarted(track, source) {
  if (!track?.id) return;
  const startedAt = Date.now();
  state.activePlayback = {
    trackId: track.id,
    source,
    startedAt,
    durationMs: Number(track.durationMs) || 0,
    completed: false
  };
  persistDeviceHistoryEvent({
    type: 'play',
    track,
    playedAt: new Date(startedAt).toISOString(),
    source
  });
}

async function reportFeedback(eventType) {
  const track = state.current?.track;
  if (!track?.id) return;
  const playback = state.activePlayback?.trackId === track.id ? state.activePlayback : null;
  const dedupeId = `${track.id}:${eventType}:${playback?.startedAt || 'manual'}`;
  if (state.feedbackSent.has(dedupeId)) return;

  const elapsedMs = playback ? Date.now() - playback.startedAt : 0;
  state.feedbackSent.add(dedupeId);
  if (eventType === 'complete' && playback) playback.completed = true;
  const feedbackEvent = {
    type: 'feedback',
    track,
    eventType,
    createdAt: new Date().toISOString(),
    sessionId: state.sessionId,
    elapsedMs,
    durationMs: track.durationMs || playback?.durationMs || 0,
    source: playback?.source || 'ui'
  };
  persistDeviceHistoryEvent(feedbackEvent);

  try {
    const result = await api('/api/feedback', {
      method: 'POST',
      body: {
        trackId: track.id,
        eventType,
        sessionId: state.sessionId,
        elapsedMs,
        durationMs: track.durationMs || playback?.durationMs || 0,
        source: playback?.source || 'ui',
        constraintEventId: dedupeId
      }
    });
    applyUsageInsights(result);
  } catch {
    state.feedbackSent.delete(dedupeId);
  }
}

function maybeReportInferredComplete() {
  const playback = state.activePlayback;
  const track = state.current?.track;
  if (!playback || playback.completed || !track?.id || playback.trackId !== track.id) return;
  if (playback.source !== 'ncm-cli') return;

  const elapsedMs = Date.now() - playback.startedAt;
  const threshold = playback.durationMs ? playback.durationMs * 0.7 : 180000;
  if (elapsedMs >= threshold) reportFeedback('complete');
}

function applyUsageInsights(data = {}) {
  if (data.feedbackSummary) state.feedbackSummary = data.feedbackSummary;
  if (Array.isArray(data.memories)) state.memories = data.memories;
  if (data.preferences) applyLowDistractionVisualMode(data.preferences);
  persistDeviceSnapshot({
    preferences: state.preferences,
    memories: state.memories,
    feedbackSummary: state.feedbackSummary
  });
  if (data.sessionConstraints) {
    state.sessionConstraints = data.sessionConstraints;
    renderSessionConstraintBar();
  }
  refreshMixerUsagePanels();
}

async function refreshUsageInsights() {
  if (!isUsageInsightsRoute()) return;
  try {
    const [prefData, memoryData, moodStatsData] = await Promise.all([
      api('/api/preferences'),
      api('/api/memories').catch(() => ({ memories: state.memories || [] })),
      api('/api/mood-stats').catch(() => state.moodStats || { total: 0, buckets: [] })
    ]);
    state.feedbackSummary = prefData.feedbackSummary || state.feedbackSummary || {};
    state.preferences = prefData.preferences || state.preferences;
    state.memories = memoryData.memories || state.memories || [];
    state.moodStats = moodStatsData || state.moodStats;
    applyLowDistractionVisualMode(state.preferences);
    await restoreDeviceSnapshotIfNeeded({
      preferences: state.preferences,
      memories: state.memories,
      feedbackSummary: state.feedbackSummary,
      moodStats: state.moodStats
    });
    refreshMixerUsagePanels();
  } catch {
    // Usage panels should not interrupt playback or chat.
  }
}

function scheduleUsageInsightsRefresh(delayMs = 2200) {
  if (!isUsageInsightsRoute()) return;
  setTimeout(() => refreshUsageInsights(), delayMs);
}

function isUsageInsightsRoute() {
  return location.pathname === '/diary' || location.pathname === '/mixer';
}

function startMixerUsageAutoRefresh() {
  if (state.mixerRefreshTimer) clearInterval(state.mixerRefreshTimer);
  state.mixerRefreshTimer = setInterval(() => {
    if (!isUsageInsightsRoute()) {
      clearInterval(state.mixerRefreshTimer);
      state.mixerRefreshTimer = null;
      return;
    }
    refreshUsageInsights();
  }, 12000);
}

function refreshMixerUsagePanels() {
  const feedback = state.feedbackSummary;
  const memories = state.memories || [];
  const feedbackMeterEl = document.querySelector('[data-feedback-meter]');
  const feedbackTracksEl = document.querySelector('[data-feedback-tracks]');
  const memoryListEl = document.querySelector('[data-memory-list]');
  const moodPanelEl = document.querySelector('[data-mood-stats]');

  if (feedback && feedbackMeterEl) feedbackMeterEl.innerHTML = feedbackMeter(feedback);
  if (feedback && feedbackTracksEl) feedbackTracksEl.innerHTML = feedbackTracks(feedback);
  if (moodPanelEl) moodPanelEl.innerHTML = moodStatsPanel(state.moodStats || {});
  if (memoryListEl) memoryListEl.innerHTML = memories.length
    ? memories.slice(0, 12).map(memorySummaryItem).join('')
    : '<p class="muted memory-empty">暂时还没有长期记忆。继续和灿灿聊天后，这里会出现稳定偏好、需求和边界。</p>';
}

function setHostText(text) {
  const el = document.querySelector('#host-text');
  if (el) el.textContent = text;
}

function setPlayerStatus(text, kind = '') {
  if (statusLocked) return;
  stopLoadingMessages();
  // Status text goes to the progress time display
  const el = document.querySelector('#progress-current');
  if (!el) return;
  if (kind === 'error') {
    el.textContent = text;
    el.style.color = '#ff6b8a';
  } else {
    el.textContent = text || '';
    el.style.color = '';
  }
}

function formatPlaybackErrorMessage(error) {
  const message = String(error?.message || error || '').trim();
  if (/ncm-cli|@music163\/ncm-cli/i.test(message)) {
    return '这首暂时无法在网页播放，正在换下一首';
  }
  return message || '播放暂时失败';
}

// --- Progress bar ---
function updateProgressBar() {
  const songAudio = document.querySelector('#song-audio');
  const current = document.querySelector('#progress-current');
  const duration = document.querySelector('#progress-duration');
  if (!songAudio || !current || !duration) return;

  const dur = songAudio.duration;
  const cur = songAudio.currentTime;

  if (dur && !isNaN(dur)) {
    if (progressSeekState.dragging) {
      duration.textContent = formatTime(dur);
      return;
    }
    const pct = (cur / dur) * 100;
    setProgressBarVisual(pct);
    setProgressThumbA11y(cur, dur);
    duration.textContent = formatTime(dur);
  } else {
    setProgressBarVisual(0);
    setProgressThumbA11y(0, 0);
    duration.textContent = '00:00';
  }
  current.textContent = formatTime(cur);
}

function formatTime(sec) {
  if (!sec || isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function clampProgressPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric));
}

function setProgressBarVisual(percent) {
  const pct = clampProgressPercent(percent);
  const bar = document.querySelector('#progress-bar');
  const fill = document.querySelector('#progress-fill');
  if (bar) bar.style.setProperty('--progress-pct', `${pct}%`);
  if (fill) fill.style.width = `${pct}%`;
}

function setProgressThumbA11y(currentTimeSec, durationSec) {
  const thumb = document.querySelector('#progress-thumb');
  if (!thumb) return;
  const duration = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  const current = Number.isFinite(currentTimeSec) ? Math.max(0, Math.min(duration || currentTimeSec, currentTimeSec)) : 0;
  thumb.setAttribute('aria-valuemax', String(Math.round(duration)));
  thumb.setAttribute('aria-valuenow', String(Math.round(current)));
  thumb.setAttribute('aria-valuetext', duration ? `${formatTime(current)} / ${formatTime(duration)}` : '00:00');
}

function previewProgressSeek(targetTime, duration) {
  setProgressBarVisual((targetTime / duration) * 100);
  setProgressThumbA11y(targetTime, duration);
  const current = document.querySelector('#progress-current');
  const total = document.querySelector('#progress-duration');
  if (current) current.textContent = formatTime(targetTime);
  if (total) total.textContent = formatTime(duration);
}

function seekProgressToTime(targetTimeSec, { commit = true, syncLyrics = true } = {}) {
  const songAudio = document.querySelector('#song-audio');
  if (!songAudio?.duration || isNaN(songAudio.duration)) return false;
  const duration = songAudio.duration;
  const targetTime = Math.max(0, Math.min(duration, Number(targetTimeSec) || 0));
  progressSeekState.previewTime = targetTime;
  previewProgressSeek(targetTime, duration);
  if (commit) {
    songAudio.currentTime = targetTime;
    if (syncLyrics) syncLyricTime(targetTime, { forceCenter: true });
  }
  return true;
}

function seekProgressFromClientX(clientX, options = {}) {
  const songAudio = document.querySelector('#song-audio');
  const bar = document.querySelector('#progress-bar');
  if (!songAudio?.duration || isNaN(songAudio.duration) || !bar) return false;
  const rect = bar.getBoundingClientRect();
  if (!rect.width) return false;
  const pct = clampProgressPercent(((clientX - rect.left) / rect.width) * 100);
  return seekProgressToTime((pct / 100) * songAudio.duration, options);
}

function finishProgressDrag(event = null) {
  if (!progressSeekState.dragging) return;
  const thumb = document.querySelector('#progress-thumb');
  const bar = document.querySelector('#progress-bar');
  progressSeekState.dragging = false;
  bar?.classList.remove('is-dragging');
  if (typeof event?.clientX === 'number') {
    seekProgressFromClientX(event.clientX, { commit: true, syncLyrics: true });
  } else if (progressSeekState.previewTime !== null) {
    seekProgressToTime(progressSeekState.previewTime, { commit: true, syncLyrics: true });
  }
  try { thumb?.releasePointerCapture?.(progressSeekState.pointerId); } catch {}
  progressSeekState.pointerId = null;
  progressSeekState.previewTime = null;
  setTimeout(() => {
    progressSeekState.suppressClick = false;
  }, 0);
}

function ensureProgressDragDocumentListeners() {
  if (progressSeekState.documentListenersReady) return;
  progressSeekState.documentListenersReady = true;
  document.addEventListener('pointerup', finishProgressDrag);
  document.addEventListener('pointercancel', finishProgressDrag);
  window.addEventListener('blur', () => finishProgressDrag());
}

function startProgressAnimation() {
  if (progressAnimationFrame) return;
  const tick = () => {
    progressAnimationFrame = null;
    updateProgressBar();
    const songAudio = document.querySelector('#song-audio');
    if (songAudio && !songAudio.paused && !songAudio.ended) {
      progressAnimationFrame = requestAnimationFrame(tick);
    }
  };
  progressAnimationFrame = requestAnimationFrame(tick);
}

function stopProgressAnimation() {
  if (progressAnimationFrame) {
    cancelAnimationFrame(progressAnimationFrame);
    progressAnimationFrame = null;
  }
  updateProgressBar();
}

function initProgressBar() {
  const bar = document.querySelector('#progress-bar');
  const thumb = document.querySelector('#progress-thumb');
  if (!bar) return;
  ensureProgressDragDocumentListeners();
  bar.addEventListener('click', (e) => {
    if (progressSeekState.suppressClick || e.target === thumb) return;
    seekProgressFromClientX(e.clientX, { commit: true, syncLyrics: true });
  });
  if (!thumb) return;

  thumb.addEventListener('pointerdown', (event) => {
    const songAudio = document.querySelector('#song-audio');
    if (!songAudio?.duration || isNaN(songAudio.duration)) return;
    event.preventDefault();
    progressSeekState.dragging = true;
    progressSeekState.suppressClick = true;
    progressSeekState.pointerId = event.pointerId;
    bar.classList.add('is-dragging');
    try { thumb.setPointerCapture?.(event.pointerId); } catch {}
    seekProgressFromClientX(event.clientX, { commit: false, syncLyrics: false });
  });
  thumb.addEventListener('pointermove', (event) => {
    if (!progressSeekState.dragging) return;
    event.preventDefault();
    seekProgressFromClientX(event.clientX, { commit: false, syncLyrics: false });
  });
  thumb.addEventListener('pointerup', finishProgressDrag);
  thumb.addEventListener('pointercancel', finishProgressDrag);
  thumb.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  thumb.addEventListener('keydown', (event) => {
    const songAudio = document.querySelector('#song-audio');
    if (!songAudio?.duration || isNaN(songAudio.duration)) return;
    const step = event.shiftKey ? 15 : 5;
    let target = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') target = songAudio.currentTime - step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') target = songAudio.currentTime + step;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = songAudio.duration;
    if (target === null) return;
    event.preventDefault();
    seekProgressToTime(target, { commit: true, syncLyrics: true });
  });
  updateProgressBar();
  const songAudio = document.querySelector('#song-audio');
  if (songAudio && !songAudio.paused && !songAudio.ended) startProgressAnimation();
}

async function playCurrentTrack(radioTurn = null, playbackToken = null) {
  const track = state.current?.track;
  if (!isCurrentPlaybackTurn(radioTurn, track, playbackToken)) return;
  if (!track?.id) {
    setPlayerStatus('没有可播放的歌曲', 'error');
    return;
  }
  setPlayerStatus(`正在调用 ncm-cli 播放：${track.name || track.id}`, 'playing');
  try {
    const result = await api('/api/player/play', { method: 'POST', body: { trackId: track.id, maxSkips: 0 }, signal: radioTurnSignal(radioTurn) });
    if (!isCurrentPlaybackTurn(radioTurn, track, playbackToken)) return;
    if (result.track && result.track.id !== track.id) {
      throw new Error(`播放器返回了另一首歌：${result.track.name || result.track.id}`);
    }
    markPlaybackStarted(track, 'ncm-cli');
    setAvatarState('listening');
    setPlaybackToggleState(true);
    maybeStartCommentDanmaku({ initial: true });
    setPlayerStatus(`正在播放：${track.name}`, 'playing');
    api('/api/play/report', { method: 'POST', body: { trackId: track.id, playType: 'play' } }).catch(() => {});
  } catch (error) {
    if (isInterruptedRadioTurn(radioTurn, error) || !isCurrentPlaybackTurn(radioTurn, track, playbackToken)) return;
    setPlaybackToggleState(false);
    setPlayerStatus(formatPlaybackErrorMessage(error), 'error');
  }
}

async function pausePlayback() {
  stopCommentDanmaku({ clearLayer: true });
  stopVisualizer();
  cancelSongFadeIn({ resetVolume: true });
  setAvatarState('idle');
  setPlaybackToggleState(false);
  const hostAudio = document.querySelector('#host-audio');
  if (hostAudio) {
    hostAudio.ontimeupdate = null;
    hostAudio.pause();
  }
  document.querySelector('#song-audio')?.pause();
  window.speechSynthesis?.cancel?.();
  try {
    await api('/api/player/pause', { method: 'POST', body: {} });
  } catch {}
  setPlayerStatus('已暂停', '');
}

async function resumePlayback() {
  const songAudio = document.querySelector('#song-audio');
  if (songAudio?.src && state.current?.track?.playUrl) {
    startSongPlayback();
    return;
  }
  if (songAudio?.src) {
    setAvatarState('listening');
    setPlaybackToggleState(true);
    switchVisualizerTo('song');
    maybeStartCommentDanmaku({ initial: true });
    songAudio.play().catch(() => {});
    setPlayerStatus('继续播放', 'playing');
    return;
  }
  try {
    await api('/api/player/resume', { method: 'POST', body: {} });
    setAvatarState('listening');
    setPlaybackToggleState(true);
    maybeStartCommentDanmaku({ initial: true });
    setPlayerStatus('继续播放', 'playing');
  } catch (error) {
    setPlayerStatus(formatPlaybackErrorMessage(error), 'error');
  }
}

async function stopPlayback() {
  invalidateActivePlaybackEvents();
  stopCommentDanmaku({ clearLayer: true, invalidate: true });
  stopVisualizer();
  cancelSongFadeIn({ resetVolume: true });
  setAvatarState('idle');
  setPlaybackToggleState(false);
  const hostAudio = document.querySelector('#host-audio');
  if (hostAudio) {
    hostAudio.ontimeupdate = null;
    hostAudio.pause();
  }
  const songAudio = document.querySelector('#song-audio');
  clearSongAudioHandlers({ reset: true });
  if (songAudio) songAudio.src = '';
  window.speechSynthesis?.cancel?.();
  try {
    await api('/api/player/stop', { method: 'POST', body: {} });
  } catch {}
  setPlayerStatus('已停止', '');
}

function startPlayerPolling() {
  if (state.playerPollTimer) clearInterval(state.playerPollTimer);
  pollPlayerState();
  state.playerPollTimer = setInterval(pollPlayerState, 5000);
}

async function pollPlayerState() {
  if (statusLocked) return;
  try {
    const data = await api('/api/player/state');
    const status = data.state?.status || data.state?.playerState || 'unknown';
    if (status === 'playing') maybeReportInferredComplete();
    else if (state.activePlayback?.source === 'ncm-cli') stopCommentDanmaku({ clearLayer: true });
  } catch {
    // State polling should not interrupt the radio UI.
  }
}

async function renderLibrary() {
  const data = await api('/api/library');
  state.library = data;
  state.profileSelectionDirty = profileSelectionNeedsUpdate(data);
  const isDemoGuestLibrary = data.account?.source === 'guest';
  const structured = data.profile?.structured || {};
  view.innerHTML = `
    <section class="page-panel">
      <p class="eyebrow">Library</p>
      <h1 class="page-title">私人曲库</h1>
      <div class="grid" style="margin: 0 0 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));">
        ${profileBlock('Top 流派', structured.genres)}
        ${profileBlock('Top 情绪', structured.moods)}
        ${profileBlock('常听艺人', structured.artists)}
        ${profileBlock('推荐场景', structured.scenes)}
        ${profileBlock('探索方向', structured.discoveryDirections)}
      </div>
      <p class="muted">长期画像只基于当前音乐账号同步的歌单，不使用电台推荐、在线搜索、播放记录或最近播放。</p>
      <p class="reason" style="white-space: pre-wrap; line-height: 1.85">${escapeHtml(data.profile.summary)}</p>
      <div class="tags">${(data.profile.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
      ${libraryAccountNotice(data)}
      <div class="stats">
        <div class="stat"><span class="muted">当前账号歌曲</span><strong>${data.totalTracks || data.tracks.length}</strong></div>
        <div class="stat"><span class="muted">当前账号歌单</span><strong>${data.playlists.length}</strong></div>
        <div class="stat"><span class="muted">最近播放</span><strong>${data.recent.length}</strong></div>
      </div>
      <div class="library-actions">
        <button id="sync-btn" class="primary" ${isDemoGuestLibrary ? 'disabled' : ''}>同步音乐</button>
        <button id="profile-update-btn" class="ghost profile-update-btn">更新音乐画像</button>
      </div>
      <div id="library-sync-progress" class="library-sync-progress" hidden></div>
      ${profilePlaylistSelector(data)}
    </section>
    <section class="grid" style="margin-top:16px">
      ${data.tracks.slice(0, 50).map(trackItem).join('')}
    </section>
  `;
  document.querySelector('#sync-btn').addEventListener('click', async () => {
    if (isDemoGuestLibrary) return;
    const btn = document.querySelector('#sync-btn');
    const status = document.querySelector('#library-selection-status');
    return handleLibrarySyncClick(btn, status);
    btn.textContent = '同步中...';
    btn.disabled = true;
    state.librarySyncNotice = '';
    if (status) status.textContent = '正在同步音乐歌单...';
    try {
      const result = await api('/api/library/sync', { method: 'POST', body: {} });
      state.profileSelectionDirty = false;
      state.librarySyncNotice = librarySyncNotice(result);
      renderLibrary();
    } catch (error) {
      btn.disabled = false;
      btn.textContent = '同步音乐';
      state.librarySyncNotice = `同步失败：${error.message}`;
      if (status) status.textContent = state.librarySyncNotice;
    }
  });
  bindProfilePlaylistSelection();
  refreshLibrarySyncStatus({ resumePolling: true }).catch(() => {});
}

async function handleLibrarySyncClick(btn, status) {
  if (btn) {
    btn.textContent = '同步中...';
    btn.disabled = true;
  }
  state.librarySyncNotice = '';
  if (status) status.textContent = '正在启动音乐同步任务...';
  try {
    const syncStatus = await api('/api/library/sync', { method: 'POST', body: {} });
    updateLibrarySyncUI(syncStatus);
    startLibrarySyncPolling();
  } catch (error) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '同步音乐';
    }
    state.librarySyncNotice = `同步失败：${error.message}`;
    if (status) status.textContent = state.librarySyncNotice;
  }
}

function startLibrarySyncPolling() {
  if (state.librarySyncTimer) clearInterval(state.librarySyncTimer);
  state.librarySyncTimer = setInterval(() => {
    refreshLibrarySyncStatus().catch(() => {});
  }, 1000);
}

async function refreshLibrarySyncStatus({ resumePolling = false } = {}) {
  const syncStatus = await api('/api/library/sync/status');
  const previousStatus = state.librarySyncStatus?.status;
  state.librarySyncStatus = syncStatus;
  updateLibrarySyncUI(syncStatus);
  if (syncStatus.status === 'running') {
    if (resumePolling && !state.librarySyncTimer) startLibrarySyncPolling();
    return syncStatus;
  }
  if (state.librarySyncTimer) {
    clearInterval(state.librarySyncTimer);
    state.librarySyncTimer = null;
  }
  if (syncStatus.status === 'success') {
    state.profileSelectionDirty = false;
    state.librarySyncNotice = librarySyncNotice(syncStatus.result || {
      playlists: syncStatus.totalPlaylists,
      tracks: syncStatus.syncedTracks,
      errors: syncStatus.errors
    });
    if (previousStatus === 'running' && location.pathname === '/library') renderLibrary();
  }
  return syncStatus;
}

function updateLibrarySyncUI(syncStatus = {}) {
  const btn = document.querySelector('#sync-btn');
  const statusEl = document.querySelector('#library-selection-status');
  const progressEl = document.querySelector('#library-sync-progress');
  if (btn) {
    btn.disabled = syncStatus.status === 'running';
    btn.textContent = syncStatus.status === 'running' ? '同步中...' : '同步音乐';
  }
  if (statusEl) statusEl.textContent = librarySyncStatusText(syncStatus);
  updateProfilePlaylistFailureUI(syncStatus);
  if (!progressEl) return;
  if (syncStatus.status === 'idle') {
    progressEl.hidden = true;
    progressEl.innerHTML = '';
    return;
  }
  progressEl.hidden = false;
  progressEl.innerHTML = librarySyncProgressHTML(syncStatus);
}

function librarySyncStatusText(syncStatus = {}) {
  if (syncStatus.status === 'running') return librarySyncRunningText(syncStatus);
  if (syncStatus.status === 'success') return librarySyncNotice(syncStatus.result || { playlists: syncStatus.totalPlaylists, tracks: syncStatus.syncedTracks, errors: syncStatus.errors });
  if (syncStatus.status === 'failed') return `同步失败：${formatLibrarySyncError((syncStatus.errors || [])[0])}`;
  return state.librarySyncNotice || '';
}

function librarySyncRunningText(syncStatus = {}) {
  const source = librarySyncSourceLabel(syncStatus.source);
  if (syncStatus.phase === 'checking_login') return '正在校验音乐登录状态...';
  if (syncStatus.phase === 'fetching_playlists') return `正在通过${source}读取歌单列表...`;
  if (syncStatus.phase === 'updating_profile') return '正在更新音乐画像...';
  const index = Number(syncStatus.currentPlaylistIndex || 0);
  const total = Number(syncStatus.totalPlaylists || 0);
  const name = syncStatus.currentPlaylistName || '歌单';
  const synced = Number(syncStatus.currentPlaylistSynced || 0);
  const count = syncStatus.currentPlaylistTotal === null || syncStatus.currentPlaylistTotal === undefined
    ? `${synced} 首`
    : `${synced} / ${Number(syncStatus.currentPlaylistTotal) || 0} 首`;
  if (index && total) return `正在通过${source}同步第 ${index} / ${total} 个歌单：${name}，${count}`;
  return `正在通过${source}同步音乐...`;
}

function librarySyncSourceLabel(source) {
  if (source === 'cookie') return '音乐扫码登录';
  if (source === 'openapi') return 'OpenAPI';
  if (source === 'demo') return 'Demo';
  return '音乐';
}

function librarySyncProgressHTML(syncStatus = {}) {
  const percent = syncStatus.totalPlaylists
    ? Math.min(100, Math.round((Number(syncStatus.currentPlaylistIndex || syncStatus.syncedPlaylists || 0) / Number(syncStatus.totalPlaylists)) * 100))
    : (syncStatus.status === 'success' ? 100 : 8);
  const completed = Number(syncStatus.syncedPlaylists || 0);
  const total = Number(syncStatus.totalPlaylists || 0);
  const playlistSummary = total ? `已完成 ${completed} / 共 ${total} 个歌单` : `已完成 ${completed} 个歌单`;
  const trackSummary = `${Number(syncStatus.syncedTracks || 0)} 首去重歌曲`;
  return `
    <div class="library-sync-meter"><span style="width:${percent}%"></span></div>
    <div class="library-sync-line">
      <span>${escapeHtml(`${librarySyncSourceLabel(syncStatus.source)} · ${playlistSummary} · ${trackSummary}`)}</span>
    </div>
  `;
}

function updateProfilePlaylistFailureUI(syncStatus = state.librarySyncStatus) {
  const rows = [...document.querySelectorAll('[data-profile-playlist-row-id]')];
  if (!rows.length) return;
  rows.forEach((row) => {
    const failure = playlistSyncFailureFor({
      id: row.dataset.profilePlaylistRowId,
      name: row.dataset.profilePlaylistName
    }, syncStatus);
    row.classList.toggle('sync-failed', Boolean(failure));
    const slot = row.querySelector('[data-playlist-sync-error]');
    if (slot) slot.innerHTML = failure ? `<span title="${escapeAttr(failure)}">同步失败</span>` : '';
  });
}

function libraryAccountNotice(data = {}) {
  const account = data.account || {};
  if (!account.needsSync && !account.accountMismatch) return '';
  return `
    <div class="library-account-warning">
      当前登录账号 ${escapeHtml(account.nickname || account.userId || '音乐用户')} 尚未完成歌单同步，请重新同步音乐。
    </div>
  `;
}

function neteaseAccountCard(status = {}, label = '音乐') {
  const readable = Boolean(status.profileReadable);
  const title = readable
    ? `${label}已登录：${status.nickname || '音乐用户'}`
    : ((status.hasCookie || status.hasToken) ? `${label}登录状态异常` : `${label}尚未登录`);
  const detail = readable
    ? `userId: ${status.userId}`
    : (status.message || '请使用音乐 App 扫码登录');
  return `
    <div class="netease-account-card ${readable ? 'ok' : 'warn'}">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(detail)}</span>
    </div>
  `;
}

function neteaseTrialLoginCard(status = {}) {
  const readable = Boolean(status.profileReadable);
  const hasLogin = Boolean(status.hasCookie || status.hasToken);
  const stateClass = readable ? 'ok' : (hasLogin ? 'warn' : 'idle');
  const stateText = readable ? '已连接' : (hasLogin ? '需重新登录' : '待扫码');
  const name = readable ? (status.nickname || '音乐用户') : '音乐';
  const detail = readable ? `userId ${status.userId}` : (status.message || '尚未扫码登录音乐');
  return `
    <div class="trial-account-card ${stateClass}">
      <div class="trial-account-led" aria-hidden="true"></div>
      <div>
        <span>${escapeHtml(stateText)}</span>
        <strong>${escapeHtml(name)}</strong>
        <p>${escapeHtml(detail)}</p>
      </div>
    </div>
  `;
}

async function renderDiary() {
  const selectedDate = new URLSearchParams(location.search).get('date') || '';
  view.innerHTML = `
    <section class="diary-shell diary-loading" aria-live="polite">
      <div class="diary-loading-signal" aria-hidden="true"></div>
      <p>正在读取音乐回顾</p>
    </section>
  `;
  try {
    const query = new URLSearchParams({ days: '7' });
    if (selectedDate) query.set('date', selectedDate);
    let [overview, prefData, moodStatsData] = await Promise.all([
      api(`/api/diary/overview?${query.toString()}`),
      api('/api/preferences').catch(() => ({ preferences: state.preferences || {}, feedbackSummary: state.feedbackSummary || {} })),
      api('/api/mood-stats').catch(() => state.moodStats || { total: 0, buckets: [] })
    ]);
    if (location.pathname !== '/diary') return;
    state.diaryOverview = overview;
    state.preferences = prefData.preferences || state.preferences || {};
    state.feedbackSummary = prefData.feedbackSummary || state.feedbackSummary || {};
    state.moodStats = moodStatsData || state.moodStats || { total: 0, buckets: [] };
    const restoreResult = await restoreDeviceSnapshotIfNeeded({
      preferences: state.preferences,
      feedbackSummary: state.feedbackSummary,
      moodStats: state.moodStats,
      diaryOverview: overview
    });
    if (restoreResult?.restored?.history > 0 && location.pathname === '/diary') {
      overview = await api(`/api/diary/overview?${query.toString()}`);
      state.diaryOverview = overview;
      if (restoreResult.feedbackSummary) state.feedbackSummary = restoreResult.feedbackSummary;
    }
    persistDeviceSnapshot({
      preferences: state.preferences,
      feedbackSummary: state.feedbackSummary,
      moodStats: state.moodStats
    });
    renderDiaryOverview(overview, {
      feedback: state.feedbackSummary,
      moodStats: state.moodStats
    });
  } catch (error) {
    if (location.pathname !== '/diary') return;
    view.innerHTML = `
      <section class="diary-shell diary-empty-state">
        <p class="eyebrow">PRIVATE FREQUENCY ARCHIVE</p>
        <h1>音乐回顾暂时无法读取</h1>
        <p>${escapeHtml(error.message)}</p>
        <a class="diary-primary-action" href="/" data-link>返回电台</a>
      </section>
    `;
  }
}

function mixConcertComments(aiComments = [], realComments = []) {
  if (state.radioMode !== 'concert') return shuffledComments(realComments);
  const ai = state.concertDanmaku.ai ? shuffledComments(aiComments) : [];
  const real = state.concertDanmaku.real ? shuffledComments(realComments) : [];
  const mixed = [];
  while (ai.length || real.length) {
    if (ai.length) mixed.push(ai.shift());
    if (ai.length) mixed.push(ai.shift());
    if (ai.length) mixed.push(ai.shift());
    if (real.length) mixed.push(real.shift());
    if (real.length) mixed.push(real.shift());
  }
  return mixed;
}

function prefetchNextConcertAudience(currentTrackId) {
  if (state.radioMode !== 'concert' || !state.activeConcert || !state.concertDanmaku.ai) return;
  const currentIndex = state.activeConcert.items.findIndex(item => String(item.track?.id || '') === String(currentTrackId || ''));
  const nextTrack = state.activeConcert.items[currentIndex + 1]?.track;
  if (!nextTrack?.id || danmakuState.aiCache.has(String(nextTrack.id))) return;
  api('/api/radio/concert/audience', {
    method: 'POST',
    body: { sessionId: ensureSessionId(), trackId: nextTrack.id }
  }).then(data => {
    danmakuState.aiCache.set(String(nextTrack.id), Array.isArray(data.comments) ? data.comments : []);
  }).catch(() => {});
}

function renderDiaryOverview(overview = {}, insights = {}) {
  const detail = overview.detail || {};
  const timeline = Array.isArray(overview.timeline) ? overview.timeline : [];
  view.innerHTML = `
    <section class="diary-shell">
      <header class="diary-header">
        <div>
          <p class="eyebrow">PRIVATE FREQUENCY ARCHIVE</p>
          <h1>音乐回顾</h1>
          <p>基于播放、完整收听、跳过和喜欢记录生成，不使用推测性日记。</p>
        </div>
        ${detail.hasActivity ? `<button class="diary-primary-action" type="button" data-diary-radio="${escapeAttr(detail.date || overview.selectedDate || '')}">生成相似电台</button>` : ''}
      </header>

      <div class="diary-workspace">
        <aside class="diary-timeline" aria-label="最近七天音乐回顾">
          <div class="diary-section-heading">
            <span>最近七天</span>
            <small>${escapeHtml(overview.timeZone || '')}</small>
          </div>
          <div class="diary-date-list">
            ${timeline.map(day => diaryDateButton(day, overview.selectedDate)).join('')}
          </div>
        </aside>

        <main class="diary-detail">
          ${detail.hasActivity ? diaryDetailHTML(detail) : diaryEmptyDetailHTML(detail)}
        </main>
      </div>
      ${diaryFrequencyPanel(insights.feedback || {}, insights.moodStats || {})}
    </section>
  `;
  bindDiaryInteractions();
  startMixerUsageAutoRefresh();
}

function diaryFrequencyPanel(feedback = {}, moodStats = {}) {
  return `
    <section class="diary-frequency-section" aria-label="近期频率趋势">
      <div class="diary-section-heading diary-frequency-heading">
        <div>
          <p class="eyebrow">Frequency Trace</p>
          <span>近期频率趋势</span>
        </div>
        <small>从历史播放、跳过、喜欢和氛围记录中整理</small>
      </div>
      <div class="diary-frequency-grid">
        <article class="mixer-mood-panel diary-frequency-panel">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Atmosphere</p>
              <h2>电台氛围记录</h2>
            </div>
            <span class="mood-window">近 ${Number(moodStats.windowDays || 30)} 天</span>
          </div>
          <div data-mood-stats>
            ${moodStatsPanel(moodStats)}
          </div>
        </article>
        <article class="mixer-meter-panel diary-frequency-panel">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Feedback</p>
              <h2>近期反馈趋势</h2>
            </div>
          </div>
          <div data-feedback-meter>
            ${feedbackMeter(feedback)}
          </div>
          <div class="feedback-track-list" data-feedback-tracks>
            ${feedbackTracks(feedback)}
          </div>
        </article>
      </div>
    </section>
  `;
}

function diaryDateButton(day = {}, selectedDate = '') {
  const metrics = day.metrics || {};
  const selected = day.date === selectedDate;
  return `
    <button class="diary-date-row${selected ? ' is-selected' : ''}${day.hasActivity ? '' : ' is-empty'}" type="button" data-diary-date="${escapeAttr(day.date || '')}" aria-pressed="${selected}">
      <span class="diary-date-main">
        <strong>${escapeHtml(formatDiaryDate(day.date))}</strong>
        <small>${day.isToday ? '进行中' : day.dominantPeriod?.label || (day.hasActivity ? '有记录' : '无记录')}</small>
      </span>
      <span class="diary-date-counts">
        <b>${Number(metrics.plays || 0)}</b>
        <small>播放</small>
        <b>${Number(metrics.completed || 0)}</b>
        <small>完整</small>
        <b>${Number(metrics.skipped || 0)}</b>
        <small>跳过</small>
      </span>
    </button>
  `;
}

function diaryDetailHTML(detail = {}) {
  const metrics = detail.metrics || {};
  const periods = Array.isArray(detail.periods) ? detail.periods : [];
  const signals = Array.isArray(detail.signals) ? detail.signals : [];
  const tracks = Array.isArray(detail.tracks) ? detail.tracks : [];
  const periodMax = Math.max(1, ...periods.map(period => Number(period.count || 0)));
  return `
    <section class="diary-day-header">
      <div>
        <p class="eyebrow">${detail.isToday ? 'LIVE RECORD' : 'DAILY RECORD'}</p>
        <h2>${escapeHtml(formatDiaryDate(detail.date))}</h2>
      </div>
      <span class="diary-record-state">${detail.isToday ? '进行中' : '已归档'}</span>
    </section>

    <section class="diary-metrics" aria-label="核心指标">
      ${diaryMetric('播放', metrics.plays, '首')}
      ${diaryMetric('完整播放', metrics.completed, '次')}
      ${diaryMetric('跳过', metrics.skipped, '次')}
      ${diaryMetric('喜欢', metrics.liked, '次')}
    </section>

    <section class="diary-section diary-period-section">
      <div class="diary-section-heading">
        <span>收听时间分布</span>
        <small>${detail.dominantPeriod?.label ? `主要时段：${escapeHtml(detail.dominantPeriod.label)}` : '暂无主要时段'}</small>
      </div>
      <div class="diary-period-grid">
        ${periods.map(period => `
          <div class="diary-period-row">
            <span>${escapeHtml(period.label)}</span>
            <div class="diary-period-track"><i style="width:${Math.round((Number(period.count || 0) / periodMax) * 100)}%"></i></div>
            <strong>${Number(period.count || 0)}</strong>
          </div>
        `).join('')}
      </div>
    </section>

    <section class="diary-section">
      <div class="diary-section-heading">
        <span>可验证趋势</span>
        <small>${signals.length ? `${signals.filter(signal => signal.effective).length} 项仍在参考` : '证据不足时不生成结论'}</small>
      </div>
      <div class="diary-signal-list">
        ${signals.length ? signals.map(diarySignalHTML).join('') : '<p class="diary-inline-empty">当前记录不足以形成稳定趋势。</p>'}
      </div>
    </section>

    <section class="diary-section">
      <div class="diary-section-heading">
        <span>歌曲记录</span>
        <small>${tracks.length} 首</small>
      </div>
      <div class="diary-track-list">
        ${tracks.length ? tracks.map(diaryTrackHTML).join('') : '<p class="diary-inline-empty">暂无歌曲记录。</p>'}
      </div>
    </section>
  `;
}

function diaryMetric(label, value, unit) {
  return `<div class="diary-metric"><span>${escapeHtml(label)}</span><strong>${Number(value || 0)}</strong><small>${escapeHtml(unit)}</small></div>`;
}

function diarySignalHTML(signal = {}) {
  const disabled = signal.status === 'disabled';
  const inaccurate = signal.status === 'inaccurate';
  const accurate = signal.status === 'accurate';
  return `
    <article class="diary-signal${disabled ? ' is-disabled' : ''}${inaccurate ? ' is-inaccurate' : ''}">
      <div class="diary-signal-copy">
        <div class="diary-signal-title">
          <span>${escapeHtml(signal.label || '趋势')}</span>
          <small>${Math.round(Number(signal.confidence || 0) * 100)}% 依据强度</small>
        </div>
        <strong>${escapeHtml(signal.text || '')}</strong>
        <ul>${(signal.evidence || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>
      <div class="diary-signal-actions" role="group" aria-label="趋势反馈">
        <button type="button" data-diary-feedback="accurate" data-signal-id="${escapeAttr(signal.id)}" data-signal-type="${escapeAttr(signal.type)}" class="${accurate ? 'is-active' : ''}" ${disabled ? 'disabled' : ''}>准确</button>
        <button type="button" data-diary-feedback="inaccurate" data-signal-id="${escapeAttr(signal.id)}" data-signal-type="${escapeAttr(signal.type)}" class="${inaccurate ? 'is-active' : ''}" ${disabled ? 'disabled' : ''}>不准确</button>
        <button type="button" data-diary-feedback="${disabled ? 'restore' : 'disable'}" data-signal-id="${escapeAttr(signal.id)}" data-signal-type="${escapeAttr(signal.type)}" class="${disabled ? 'is-active' : ''}">${disabled ? '恢复参考' : '不再参考'}</button>
      </div>
    </article>
  `;
}

function diaryTrackHTML(track = {}) {
  const labels = { played: '播放', complete: '完整播放', skip: '跳过', like: '喜欢', dislike: '不喜欢' };
  return `
    <article class="diary-track-row">
      <img src="${escapeAttr(track.coverUrl || '/assets/cover-1.svg')}" alt="" />
      <div>
        <strong>${escapeHtml(track.name || '未知歌曲')}</strong>
        <span>${escapeHtml((track.artists || []).join(' / ') || '未知艺人')}</span>
      </div>
      <div class="diary-track-events">${(track.events || []).map(event => `<span class="event-${escapeAttr(event)}">${escapeHtml(labels[event] || event)}</span>`).join('')}</div>
      <time>${escapeHtml(track.localTime || '')}</time>
    </article>
  `;
}

function diaryEmptyDetailHTML(detail = {}) {
  return `
    <section class="diary-empty-state">
      <p class="eyebrow">NO VALID RECORD</p>
      <h2>${escapeHtml(formatDiaryDate(detail.date))}</h2>
      <strong>暂无有效记录</strong>
      <p>当天没有足够的播放或反馈数据，因此不会生成趋势结论。</p>
      <a class="diary-primary-action" href="/" data-link>返回电台</a>
    </section>
  `;
}

function bindDiaryInteractions() {
  view.querySelectorAll('[data-diary-date]').forEach(button => {
    button.addEventListener('click', () => loadDiaryDate(button.dataset.diaryDate));
  });
  view.querySelectorAll('[data-diary-feedback]').forEach(button => {
    button.addEventListener('click', () => submitDiaryFeedback(button));
  });
  view.querySelector('[data-diary-radio]')?.addEventListener('click', event => startDiaryRadio(event.currentTarget));
}

async function loadDiaryDate(date) {
  if (!date) return;
  history.replaceState({}, '', `/diary?date=${encodeURIComponent(date)}`);
  await renderDiary();
}

async function submitDiaryFeedback(button) {
  const date = state.diaryOverview?.detail?.date;
  if (!date || button.disabled) return;
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = '处理中';
  try {
    const result = await api('/api/diary/feedback', {
      method: 'POST',
      body: {
        date,
        signalId: button.dataset.signalId,
        signalType: button.dataset.signalType,
        action: button.dataset.diaryFeedback
      }
    });
    state.diaryOverview = result.overview;
    renderDiaryOverview(result.overview, {
      feedback: state.feedbackSummary || {},
      moodStats: state.moodStats || {}
    });
  } catch (error) {
    button.disabled = false;
    button.textContent = previousText;
    setPlayerStatus(error.message, 'error');
  }
}

async function startDiaryRadio(button) {
  const date = button.dataset.diaryRadio;
  if (!date) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = '正在生成';
  primeVoicePlayback();
  try {
    const data = await api('/api/diary/radio', {
      method: 'POST',
      body: { sessionId: ensureSessionId(), date }
    });
    state.radioMode = 'concert';
    history.pushState({}, '', '/');
    await render();
    handleRadioResponse(data);
  } catch (error) {
    button.disabled = false;
    button.textContent = originalText;
    setPlayerStatus(error.message, 'error');
  }
}

async function loadDiaryRadioEntry() {
  const container = document.querySelector('#chat-messages');
  if (!container || container.querySelector('[data-diary-radio-entry]')) return;
  const overview = await api('/api/diary/overview?days=7');
  if (location.pathname !== '/' || !document.querySelector('#chat-messages')) return;
  const todayIndex = overview.timeline.findIndex(day => day.isToday);
  const yesterday = todayIndex > 0 ? overview.timeline[todayIndex - 1] : null;
  if (!yesterday?.hasActivity) return;
  const dismissKey = `mymusic:diary-entry-dismissed:${overview.today}`;
  try {
    if (localStorage.getItem(dismissKey) === 'yes') return;
  } catch {}
  const signal = (yesterday.signals || []).find(item => item.effective);
  const summary = signal?.text || `昨日播放 ${Number(yesterday.metrics?.plays || 0)} 首歌曲`;
  const html = `
    <aside class="diary-radio-entry" data-diary-radio-entry>
      <div>
        <span>昨日回顾</span>
        <strong>${escapeHtml(summary)}</strong>
      </div>
      <a href="/diary?date=${encodeURIComponent(yesterday.date)}" data-link>查看回顾</a>
      <button type="button" data-dismiss-diary-entry aria-label="关闭昨日回顾" title="关闭">×</button>
    </aside>
  `;
  const liveContainer = document.querySelector('#chat-messages');
  const initial = liveContainer?.querySelector('[data-initial-chat]');
  if (initial) initial.insertAdjacentHTML('afterend', html);
  else liveContainer?.insertAdjacentHTML('afterbegin', html);
  liveContainer?.querySelector('[data-dismiss-diary-entry]')?.addEventListener('click', () => {
    try { localStorage.setItem(dismissKey, 'yes'); } catch {}
    liveContainer.querySelector('[data-diary-radio-entry]')?.remove();
  });
}

function formatDiaryDate(value = '') {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value || '未知日期';
  return `${Number(match[2])} 月 ${Number(match[3])} 日`;
}

async function renderMixer() {
  const [prefData, memoryData] = await Promise.all([
    api('/api/preferences'),
    api('/api/memories').catch(() => ({ memories: [] }))
  ]);
  const preferences = prefData.preferences || {};
  state.preferences = preferences;
  let memories = (memoryData.memories || []).slice(0, 12);
  state.memories = memories;
  applyLowDistractionVisualMode(preferences);
  await restoreDeviceSnapshotIfNeeded({ preferences, memories });
  memories = (state.memories || memories || []).slice(0, 12);

  view.innerHTML = `
    <section class="mixer-hero page-panel">
      <div>
        <p class="eyebrow">Control Surface</p>
        <h1 class="page-title">调音台</h1>
        <p class="mixer-subtitle">调灿灿的聊天、接歌、语音和情绪场景，让电台更像你的私人频率。</p>
      </div>
      <div class="mixer-status-card">
        <span class="mixer-led"></span>
        <div>
          <strong id="mixer-mode-summary">${escapeHtml(mixerModeSummary(preferences))}</strong>
          <p id="mixer-save-status" class="muted">${preferences.lowDistractionMode ? 'LOW DISTRACTION' : 'SIGNAL LOCKED'}</p>
        </div>
      </div>
    </section>
    <section class="mixer-console">
      <div class="mixer-rack">
        ${lowDistractionControl(preferences)}
        ${mixerControl('chatMusicBalance', '聊天 vs 推歌比例', '控制灿灿先像朋友聊，还是更积极接歌。', preferences)}
        ${mixerControl('recommendationFrequency', '主动推荐频率', '决定普通聊天中灿灿多久自然接一首歌。', preferences)}
        ${mixerControl('voiceMode', '语音播报', '控制灿灿什么时候把文字变成主持语音。', preferences)}
        ${mixerControl('moodMode', '当前情绪模式', '给这段电台会话一个临时氛围方向。', preferences)}
        <article class="mixer-control mixer-note-control">
          <div class="mixer-control-head">
            <div>
              <h2>灿灿行为补充说明</h2>
              <p class="muted">最多 500 字，会参与聊天和推荐判断。</p>
            </div>
            <button id="mixer-note-save" class="ghost">保存说明</button>
          </div>
          <textarea id="mixer-note" maxlength="500" placeholder="例如：多像朋友一样聊天，少一点生硬安慰；晚上偏安静，别太频繁切歌。">${escapeHtml(preferences.note || '')}</textarea>
        </article>
      </div>
      <aside class="mixer-side">
        <article class="mixer-memory-panel">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Memory</p>
              <h2>灿灿记忆管理</h2>
            </div>
            <a class="ghost-link" href="/settings" data-link>危险操作</a>
          </div>
          <div class="memory-list compact" data-memory-list>
            ${memories.length ? memories.map(memorySummaryItem).join('') : '<p class="muted memory-empty">暂时还没有长期记忆。继续和灿灿聊天后，这里会出现稳定偏好、需求和边界。</p>'}
          </div>
        </article>
      </aside>
    </section>
  `;

  bindMixerControls(preferences);
  bindMemoryManagement();
  startMixerUsageAutoRefresh();
}

async function renderSettings() {
  const [status, cookieLogin, neteaseLogin, memoryData, preferenceData, scheduleStatus] = await Promise.all([
    api('/api/config/status'),
    api('/api/auth/netease-cookie/status').catch(() => ({ configured: true, hasCookie: false, profileReadable: false, source: 'cookie', message: '试用版登录状态读取失败' })),
    api('/api/auth/netease/token-status').catch(() => ({ configured: false, hasToken: false, profileReadable: false, message: '登录状态读取失败' })),
    api('/api/memories').catch(() => ({ memories: [] })),
    api('/api/preferences').catch(() => ({ preferences: state.preferences || {} })),
    api('/api/context/schedule/status').catch(() => ({ configured: false, connected: false, status: 'unavailable', errorCode: 'status_unavailable', context: null }))
  ]);
  let memories = memoryData.memories || [];
  const preferences = preferenceData.preferences || state.preferences || {};
  state.preferences = preferences;
  state.memories = memories;
  state.scheduleStatus = scheduleStatus;
  await restoreDeviceSnapshotIfNeeded({ preferences, memories });
  memories = state.memories || memories || [];
  const demoGuestMode = Boolean(status.demo?.guestMode);
  view.innerHTML = `
    <section class="page-panel">
      <p class="eyebrow">Settings</p>
      <h1 class="page-title">本地配置</h1>
      <table class="settings-table">
        ${statusRow('LLM', status.llm.configured, status.llm.model)}
        ${statusRow('TTS', status.tts.configured, status.tts.provider)}
        ${statusRow('天气城市', status.weather.configured, status.weather.city)}
        ${statusRow('日程 MCP', status.schedule?.configured, status.schedule?.provider || 'feishu')}
      </table>
      <div class="netease-login-console trial-login-console ${cookieLogin.profileReadable ? 'is-online' : 'is-offline'}">
        <div class="trial-login-main">
          <div class="trial-login-title-row">
            <div>
              <p class="eyebrow">Trial Login</p>
              <h2>音乐账号</h2>
            </div>
            <span class="trial-login-badge">${cookieLogin.profileReadable ? 'ONLINE' : 'OFFLINE'}</span>
          </div>
          ${neteaseTrialLoginCard(cookieLogin)}
          <div class="trial-login-signal" aria-hidden="true">
            <span></span><span></span><span></span><span></span>
          </div>
          <div class="trial-login-caption">
            <strong>本地试用通道</strong>
            <span>Cookie 仅保存在当前设备</span>
          </div>
        </div>
        <div class="netease-login-actions trial-login-dock">
          <div class="trial-qr-frame">
            <div class="trial-qr-idle" aria-hidden="true">
              <span>QR</span>
              <small>READY</small>
            </div>
            <img id="cookie-qr-img" class="qr-img" src="" alt="试用版登录二维码" style="display:none" />
          </div>
          <button id="cookie-qr-btn" class="trial-login-primary" ${demoGuestMode ? 'disabled' : ''}>扫码登录音乐</button>
          <button id="cookie-logout-btn" class="ghost trial-login-secondary" ${cookieLogin.hasCookie && !demoGuestMode ? '' : 'disabled'}>退出登录</button>
          <p id="cookie-qr-status" class="muted"></p>
        </div>
      </div>
    </section>
    ${scheduleSettingsPanel(scheduleStatus, preferences)}
    <section class="page-panel self-check-panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Demo Check</p>
          <h2>运行自检</h2>
        </div>
        <button id="demo-self-check-btn" class="primary small" ${state.demoSelfCheckRunning ? 'disabled' : ''}>
          ${state.demoSelfCheckRunning ? '检查中...' : '运行自检'}
        </button>
      </div>
      <p class="muted">演示前检查 LLM、TTS、音乐登录、歌单同步和当前播放源。</p>
      <div id="demo-self-check-content" class="self-check-content">
        ${buildDemoSelfCheckHTML(state.demoSelfCheck, state.demoSelfCheckRunning)}
      </div>
    </section>
    <section class="page-panel radio-debug-panel">
      <details>
        <summary>
          <span>
            <span class="eyebrow">Radio Debug</span>
            <strong>电台调试</strong>
          </span>
          <span class="debug-session">session: ${escapeHtml(state.sessionId || '无')}</span>
        </summary>
        <div class="radio-debug-actions">
          <button id="radio-debug-refresh" class="ghost" type="button">刷新调试信息</button>
          <span id="radio-debug-status" class="muted">用于排查推荐、队列、搜索和 TTS。</span>
        </div>
        <div id="radio-debug-content" class="radio-debug-content">
          <p class="muted">打开电台并刷新后，这里会显示当前音乐上下文和预取队列。</p>
        </div>
      </details>
    </section>
    <section class="page-panel danger-zone">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Danger Zone</p>
          <h2>危险操作</h2>
        </div>
        <div class="danger-actions">
          <button id="clear-memories-btn" class="ghost danger" ${memories.length ? '' : 'disabled'}>清空记忆</button>
          ${demoGuestMode ? '<button id="reset-device-data-btn" class="ghost danger">重置本设备数据</button>' : ''}
        </div>
      </div>
      <p class="muted">长期记忆共有 ${memories.length} 条。重置本设备会删除当前浏览器的聊天、历史、偏好、画像、记忆和日记，但不会影响共享曲库、网易云账号或其他访客。</p>
    </section>
    <section class="page-panel developer-login-panel">
      <details class="openapi-login-advanced">
        <summary>
          <span>
            <span class="eyebrow">Developer Only</span>
            <strong>OpenAPI 开发者登录备用</strong>
          </span>
          <small>普通用户不需要扫描这里</small>
        </summary>
        <p class="developer-login-note">这里只给开发者调试 OpenAPI 使用。朋友试用和比赛演示请使用页面上方的“扫码登录音乐”，不要扫描这里的二维码。</p>
        ${neteaseAccountCard(neteaseLogin, 'OpenAPI')}
        <table class="developer-config-grid">
          ${statusRow('OpenAPI appId', status.netease.appId)}
          ${statusRow('OpenAPI RSA 私钥', status.netease.privateKey)}
          ${statusRow('OpenAPI token', status.neteaseToken)}
        </table>
        <div class="netease-login compact">
          <button id="qr-btn" class="ghost" ${demoGuestMode ? 'disabled' : ''}>开发者 OpenAPI 扫码</button>
          <button id="qr-refresh-btn" class="ghost" ${demoGuestMode ? 'disabled' : ''}>刷新 OpenAPI token</button>
          <p id="qr-status"></p>
          <img id="qr-img" class="qr-img" src="" alt="OpenAPI 登录二维码" style="display:none" />
        </div>
      </details>
    </section>
  `;
  document.querySelector('#cookie-qr-btn')?.addEventListener('click', () => startCookieQrLogin());
  document.querySelector('#cookie-logout-btn')?.addEventListener('click', async () => {
    const statusEl = document.querySelector('#cookie-qr-status');
    if (statusEl) statusEl.textContent = '正在退出音乐登录...';
    await api('/api/auth/netease-cookie/logout', { method: 'POST', body: {} });
    renderSettings();
  });
  document.querySelector('#qr-btn')?.addEventListener('click', () => startQrLogin());
  document.querySelector('#demo-self-check-btn')?.addEventListener('click', () => runDemoSelfCheck());
  document.querySelector('#radio-debug-refresh')?.addEventListener('click', () => refreshRadioDebugPanel());
  document.querySelector('#schedule-aware-toggle')?.addEventListener('click', () => toggleScheduleAwareness());
  document.querySelector('#schedule-refresh-btn')?.addEventListener('click', () => refreshScheduleContext());
  document.querySelector('#qr-refresh-btn')?.addEventListener('click', async () => {
    const statusEl = document.querySelector('#qr-status');
    statusEl.textContent = '正在续期...';
    const res = await api('/api/auth/netease/refresh', { method: 'POST', body: {} });
    statusEl.textContent = res.ok ? 'token 已续期（7天内有效）' : '续期失败，请重新扫码';
  });
  document.querySelector('#clear-memories-btn')?.addEventListener('click', async () => {
    if (!memories.length) return;
    if (!confirm('清空灿灿的全部长期记忆？聊天历史不会被删除。')) return;
    await api('/api/memories', { method: 'DELETE' });
    state.memories = [];
    persistDeviceSnapshot({ memories: [] }, { replaceEmptyMemories: true });
    renderSettings();
  });
  document.querySelector('#reset-device-data-btn')?.addEventListener('click', async () => {
    if (!confirm('重置本设备的全部数据？这会删除当前浏览器的聊天、历史、偏好、画像、记忆和日记，且无法恢复。')) return;
    const previousDeviceId = ensureDemoVisitorId();
    await api('/api/demo/guest/reset', { method: 'POST', body: {} });
    clearDeviceSnapshot(previousDeviceId);
    rotateDemoDeviceId();
    location.reload();
  });
}

function scheduleSettingsPanel(status = {}, preferences = {}) {
  const enabled = preferences.scheduleAwareEnabled === true;
  const connection = status.connected
    ? { label: 'CONNECTED', className: 'is-online' }
    : status.configured
      ? { label: status.status === 'error' ? 'DEGRADED' : 'READY', className: status.status === 'error' ? 'is-error' : 'is-ready' }
      : { label: 'NOT CONFIGURED', className: 'is-offline' };
  return `
    <section class="page-panel schedule-context-panel ${connection.className}">
      <div class="schedule-context-header">
        <div>
          <p class="eyebrow">Schedule Context</p>
          <h2>日程感知电台</h2>
        </div>
        <span id="schedule-connection-badge" class="schedule-status-badge">${connection.label}</span>
      </div>
      <div class="schedule-context-layout">
        <div class="schedule-context-copy">
          <p>在播放开始和一段歌单结束时按需读取近期忙闲，只用空档长度和本地分类安排下一段音乐。</p>
          <div class="schedule-context-actions">
            <button id="schedule-aware-toggle" class="switch-control ${enabled ? 'is-on' : ''}" type="button" role="switch" aria-checked="${enabled}">
              <span class="switch-track" aria-hidden="true"><span></span></span>
              <strong>${enabled ? '已开启' : '已关闭'}</strong>
            </button>
            <button id="schedule-refresh-btn" class="ghost" type="button" ${status.configured ? '' : 'disabled'}>重新安排下一段</button>
          </div>
          <p id="schedule-action-status" class="muted">${scheduleRefreshLabel(status)}</p>
        </div>
        <div id="schedule-context-summary" class="schedule-context-summary">
          ${scheduleContextSummary(status.context)}
        </div>
      </div>
      <div class="schedule-privacy-note">
        <strong>本地脱敏</strong>
        <span>不读取或保存会议正文、参与者和附件；标题仅在服务端分类后立即丢弃，课程表不会进入长期记忆。</span>
      </div>
    </section>
  `;
}

function scheduleContextSummary(context = null) {
  if (!context?.fingerprint) {
    return '<p class="muted">尚无可用的脱敏日程摘要。开启后会在需要规划音乐时读取。</p>';
  }
  const categoryLabels = { class: '课程', exam: '考试', meeting: '会议', commute: '通勤', personal: '个人', unknown: '未知' };
  const loadLabels = { light: '轻', medium: '中', heavy: '高' };
  const transitionLabels = { busy: '安排进行中', pre_event: '即将进入安排', between_events: '安排间隙', commute: '通勤转换', open_block: '开放时段' };
  const nextEvent = context.nextEventMinutes == null ? '暂无' : `${context.nextEventMinutes} 分钟后`;
  return `
    <dl class="schedule-metrics">
      <div><dt>可用空档</dt><dd>${Number(context.freeWindowMinutes || 0)} 分钟</dd></div>
      <div><dt>下一安排</dt><dd>${escapeHtml(nextEvent)}</dd></div>
      <div><dt>本地分类</dt><dd>${escapeHtml(categoryLabels[context.nextEventCategory] || '未知')}</dd></div>
      <div><dt>当日负载</dt><dd>${escapeHtml(loadLabels[context.dayLoad] || context.dayLoad || '未知')}</dd></div>
      <div><dt>转换状态</dt><dd>${escapeHtml(transitionLabels[context.transitionType] || context.transitionType || '未知')}</dd></div>
      <div><dt>情境指纹</dt><dd><code>${escapeHtml(context.fingerprint)}</code></dd></div>
    </dl>
  `;
}

function scheduleRefreshLabel(status = {}) {
  if (status.errorCode) return `最近状态：${escapeHtml(status.errorCode)}`;
  if (!status.cachedAt) return status.configured ? '等待首次按需刷新' : '需要在服务端配置飞书 MCP 凭据';
  const time = new Date(status.cachedAt);
  return Number.isNaN(time.getTime()) ? '已有缓存摘要' : `最近刷新：${time.toLocaleString('zh-CN', { hour12: false })}`;
}

async function toggleScheduleAwareness() {
  const button = document.querySelector('#schedule-aware-toggle');
  if (!button) return;
  const nextEnabled = button.getAttribute('aria-checked') !== 'true';
  button.disabled = true;
  try {
    const result = await api('/api/preferences', { method: 'PUT', body: { scheduleAwareEnabled: nextEnabled } });
    state.preferences = result.preferences || { ...(state.preferences || {}), scheduleAwareEnabled: nextEnabled };
    persistDeviceSnapshot({ preferences: state.preferences }, { replaceDefaultPreferences: true });
    state.schedulePlanning = nextEnabled;
    button.classList.toggle('is-on', nextEnabled);
    button.setAttribute('aria-checked', String(nextEnabled));
    const label = button.querySelector('strong');
    if (label) label.textContent = nextEnabled ? '已开启' : '已关闭';
  } catch (error) {
    const status = document.querySelector('#schedule-action-status');
    if (status) status.textContent = `开关保存失败：${error.message}`;
  } finally {
    button.disabled = false;
  }
}

async function refreshScheduleContext() {
  const button = document.querySelector('#schedule-refresh-btn');
  const statusEl = document.querySelector('#schedule-action-status');
  if (!button) return;
  button.disabled = true;
  if (statusEl) statusEl.textContent = '正在读取脱敏日程并安排下一段...';
  try {
    const result = await api('/api/context/schedule/refresh', {
      method: 'POST',
      body: { ...(state.sessionId ? { sessionId: state.sessionId } : {}) }
    });
    state.scheduleStatus = result;
    if (state.preferences?.scheduleAwareEnabled) state.schedulePlanning = true;
    const summary = document.querySelector('#schedule-context-summary');
    if (summary) summary.innerHTML = scheduleContextSummary(result.context);
    if (statusEl) statusEl.textContent = result.refreshed
      ? `已刷新，下一段将使用新情境${result.changed ? '（日程有变化）' : ''}`
      : `暂未刷新：${result.errorCode || '当前无可用日程'}`;
  } catch (error) {
    if (statusEl) statusEl.textContent = `刷新失败，电台将继续使用普通推荐：${error.message}`;
  } finally {
    button.disabled = false;
  }
}

async function runDemoSelfCheck() {
  const button = document.querySelector('#demo-self-check-btn');
  const content = document.querySelector('#demo-self-check-content');
  state.demoSelfCheckRunning = true;
  if (button) {
    button.disabled = true;
    button.textContent = '检查中...';
  }
  if (content) content.innerHTML = buildDemoSelfCheckHTML(state.demoSelfCheck, true);
  try {
    const result = await api('/api/diagnostics/self-check', {
      method: 'POST',
      body: {
        sessionId: state.sessionId,
        trackId: state.current?.track?.id || ''
      }
    });
    state.demoSelfCheck = result;
    if (content) content.innerHTML = buildDemoSelfCheckHTML(result, false);
  } catch (error) {
    state.demoSelfCheck = {
      ok: false,
      summary: '自检请求失败。',
      checks: [{
        id: 'request',
        label: '自检请求',
        status: 'fail',
        detail: error.message || '请求失败'
      }]
    };
    if (content) content.innerHTML = buildDemoSelfCheckHTML(state.demoSelfCheck, false);
  } finally {
    state.demoSelfCheckRunning = false;
    if (button) {
      button.disabled = false;
      button.textContent = '运行自检';
    }
  }
}

function buildDemoSelfCheckHTML(result = null, loading = false) {
  if (loading) {
    return `
      <div class="self-check-placeholder">
        <strong>正在检查演示链路...</strong>
        <span>这会实际测试模型、语音、音乐登录和播放源。</span>
      </div>
    `;
  }
  if (!result) {
    return `
      <div class="self-check-placeholder">
        <strong>尚未运行自检</strong>
        <span>点击右上角按钮，在演示前确认关键服务是否可用。</span>
      </div>
    `;
  }
  const checks = Array.isArray(result.checks) ? result.checks : [];
  return `
    <div class="self-check-summary ${result.ok ? 'ok' : 'warn'}">
      <strong>${escapeHtml(result.summary || (result.ok ? '核心演示链路正常。' : '发现需要处理的问题。'))}</strong>
      <span>${escapeHtml(result.checkedAt || '')}</span>
    </div>
    <div class="self-check-grid">
      ${checks.map(selfCheckCardHTML).join('')}
    </div>
  `;
}

function selfCheckCardHTML(check = {}) {
  const status = ['ok', 'warn', 'fail', 'skip'].includes(check.status) ? check.status : 'warn';
  const labels = { ok: 'OK', warn: 'WARN', fail: 'FAIL', skip: 'SKIP' };
  return `
    <article class="self-check-card ${status}">
      <div>
        <span>${escapeHtml(check.label || check.id || '检查项')}</span>
        <strong>${escapeHtml(labels[status])}</strong>
      </div>
      <p>${escapeHtml(check.detail || '')}</p>
      ${check.action ? `<small>${escapeHtml(check.action)}</small>` : ''}
      ${typeof check.ms === 'number' ? `<em>${escapeHtml(String(check.ms))}ms</em>` : ''}
    </article>
  `;
}

async function refreshRadioDebugPanel() {
  const statusEl = document.querySelector('#radio-debug-status');
  const contentEl = document.querySelector('#radio-debug-content');
  if (!statusEl || !contentEl) return;
  if (!state.sessionId) {
    statusEl.textContent = '当前没有电台 session。';
    contentEl.innerHTML = '<p class="muted">先回到电台页启动或聊天一次，再刷新调试信息。</p>';
    return;
  }
  statusEl.textContent = '正在读取调试信息...';
  try {
    const debug = await api(`/api/radio/debug?sessionId=${encodeURIComponent(state.sessionId)}`);
    statusEl.textContent = `已刷新：${debug.updatedAt || '刚刚'}`;
    contentEl.innerHTML = buildRadioDebugHTML(debug);
  } catch (error) {
    statusEl.textContent = '调试信息读取失败：' + error.message;
  }
}

function buildRadioDebugHTML(debug = {}) {
  const metrics = debug.queueMetrics || {};
  const hit = Number(metrics.queueHitCount || 0);
  const miss = Number(metrics.queueMissCount || 0);
  const hitRate = hit + miss ? Math.round((hit / (hit + miss)) * 100) + '%' : '暂无';
  const context = debug.musicContext || {};
  return `
    <div class="debug-grid">
      ${debugMetricCard('队首命中率', hitRate, `命中 ${hit} / miss ${miss}`)}
      ${debugMetricCard('同步兜底', metrics.syncFallbackCount || 0, metrics.lastMissReason || '无')}
      ${debugMetricCard('抢占', `${metrics.hardPreemptCount || 0}/${metrics.softPreemptCount || 0}`, 'hard / soft')}
      ${debugMetricCard('TTS 失败', metrics.ttsFailedCount || 0, debug.lastTtsDiagnostics?.status || '无')}
    </div>
    <div class="debug-section">
      <h3>音乐上下文</h3>
      <p>${escapeHtml([
        `mood=${context.mood || 'none'}`,
        `energy=${context.energy || 'none'}`,
        `intent=${context.musicIntent || 'none'}`,
        `version=${context.version || 0}`
      ].join(' · '))}</p>
      <p class="muted">${escapeHtml([...(context.searchHints || []), ...(context.avoidHints || [])].join(' / ') || '暂无 hints')}</p>
    </div>
    <div class="debug-section">
      <h3>预取队列</h3>
      ${(debug.queue || []).length ? debug.queue.map(debugQueueItemHTML).join('') : '<p class="muted">队列为空。</p>'}
    </div>
    <div class="debug-section">
      <h3>LLM 候选</h3>
      ${debug.lastSongPlan?.picks?.length ? debug.lastSongPlan.picks.map((pick, index) => `
        <div class="debug-line"><strong>${index + 1}. ${escapeHtml(pick.name)}</strong><span>${escapeHtml((pick.artists || []).join(' / '))}</span><em>${escapeHtml(pick.reason || '')}</em></div>
      `).join('') : '<p class="muted">暂无候选记录。</p>'}
    </div>
    <div class="debug-section">
      <h3>搜索命中</h3>
      ${(debug.lastSearchDiagnostics || []).length ? debug.lastSearchDiagnostics.map(debugSearchHTML).join('') : '<p class="muted">暂无搜索诊断。</p>'}
    </div>
  `;
}

function debugMetricCard(label, value, detail) {
  return `<article class="debug-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong><small>${escapeHtml(String(detail || ''))}</small></article>`;
}

function debugQueueItemHTML(item = {}) {
  const track = item.track ? `${item.track.name || ''} - ${(item.track.artists || []).join(' / ')}` : '未定歌';
  return `
    <div class="debug-line queue-${escapeAttr(item.status || 'unknown')}">
      <strong>${escapeHtml(item.status || 'unknown')}</strong>
      <span>${escapeHtml(track)}</span>
      <em>${escapeHtml(item.reason || item.failedStage || item.staleReason || '')}</em>
    </div>
  `;
}

function debugSearchHTML(item = {}) {
  const hits = (item.hits || []).slice(0, 4);
  return `
    <div class="debug-search">
      <p><strong>${escapeHtml(item.pick?.name || '未知候选')}</strong><span>${escapeHtml((item.queries || []).join(' / '))}</span></p>
      ${hits.length ? hits.map(hit => `
        <div class="debug-line">
          <strong>${escapeHtml(hit.track?.name || '')}</strong>
          <span>${escapeHtml((hit.track?.artists || []).join(' / '))}</span>
          <em>${escapeHtml(`${hit.score || 0} · ${hit.playable === null ? (hit.filterReason || '') : (hit.playable ? 'playable' : hit.filterReason || 'not playable')}`)}</em>
        </div>
      `).join('') : `<p class="muted">${escapeHtml(item.failedReason || '无命中')}</p>`}
    </div>
  `;
}

async function startQrLogin() {
  const statusEl = document.querySelector('#qr-status');
  const img = document.querySelector('#qr-img');
  statusEl.textContent = '获取二维码...';
  try {
    const data = await api('/api/auth/netease/qrcode', { method: 'POST', body: {} });
    const info = data.data || data;
    const qrUrl = info.qrCodeUrl || info.qrCode || info.qrurl || '';
    const key = info.qrCodeKey || info.uniKey || info.unikey || info.key;
    const qrImage = info.qrImage || info.qrimg || '';
    if (qrImage) {
      img.src = qrImage;
      img.style.display = 'block';
    } else if (qrUrl) {
      img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(qrUrl);
      img.style.display = 'block';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
    }
    if (!key) {
      statusEl.textContent = '二维码 key 缺失，请重试';
      return;
    }
    statusEl.textContent = '请用音乐 App 扫码';
    pollQrStatus(key, statusEl);
  } catch (error) {
    statusEl.textContent = '获取失败: ' + error.message;
  }
}

async function startCookieQrLogin() {
  const statusEl = document.querySelector('#cookie-qr-status');
  const img = document.querySelector('#cookie-qr-img');
  if (!statusEl || !img) return;
  statusEl.textContent = '正在获取试用版登录二维码...';
  try {
    const data = await api('/api/auth/netease-cookie/qrcode', { method: 'POST', body: {} });
    const info = data.data || data;
    const qrUrl = info.qrCodeUrl || info.qrCode || info.qrurl || '';
    const key = info.qrCodeKey || info.uniKey || info.unikey || info.key;
    const qrImage = info.qrImage || info.qrimg || '';
    if (qrImage) {
      img.src = qrImage;
      img.style.display = 'block';
    } else if (qrUrl) {
      img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(qrUrl);
      img.style.display = 'block';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
    }
    if (!key) {
      statusEl.textContent = '二维码 key 缺失，请重试';
      return;
    }
    statusEl.textContent = '请用音乐 App 扫码';
    pollCookieQrStatus(key, statusEl);
  } catch (error) {
    statusEl.textContent = '获取失败: ' + error.message;
  }
}

async function pollCookieQrStatus(key, statusEl) {
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    try {
      const res = await api('/api/auth/netease-cookie/qrcode/check', { method: 'POST', body: { key } });
      const data = res.data || res;
      const code = Number(data.code || res.code || 0);
      if (code === 803) {
        if (res.loggedIn === true || data.loggedIn === true) {
          const nickname = res.nickname || data.nickname || '音乐用户';
          const userId = res.userId || data.userId || '';
          statusEl.textContent = (res.autoSyncStarted || data.autoSyncStarted)
            ? `扫码成功：${nickname}${userId ? ` (${userId})` : ''}，账号已切换，正在自动同步歌单...`
            : `扫码成功，已保存登录信息：${nickname}${userId ? ` (${userId})` : ''}`;
          if (res.syncStatus || data.syncStatus) {
            state.librarySyncStatus = res.syncStatus || data.syncStatus;
            state.librarySyncNotice = '账号已切换，正在自动同步音乐歌单...';
            startLibrarySyncPolling();
          }
          const img = document.querySelector('#cookie-qr-img');
          if (img) img.style.display = 'none';
          setTimeout(() => renderSettings(), 600);
          return;
        }
        statusEl.textContent = res.loginMessage || data.loginMessage || '授权已确认，但没有拿到音乐登录 cookie，请重新扫码';
        return;
      }
      if (code === 802) { statusEl.textContent = '已扫码，请在手机上确认授权...'; continue; }
      if (code === 801) { statusEl.textContent = '等待扫码...'; continue; }
      if (code === 800) { statusEl.textContent = '二维码已过期，请重新获取'; return; }
      statusEl.textContent = '状态：' + (data.msg || data.message || code);
    } catch {
      // Keep polling while the login endpoint is transiently unavailable.
    }
  }
  statusEl.textContent = '超时，请重新获取二维码';
}

async function pollQrStatus(key, statusEl) {
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    try {
      const res = await api('/api/auth/netease/qrcode/check', { method: 'POST', body: { key } });
      const data = res.data || res;
      const code = data.code || data.status || 0;
      if (code === 803) {
        if (res.loggedIn === true || data.loggedIn === true) {
          const nickname = res.nickname || data.nickname || '音乐用户';
          const userId = res.userId || data.userId || '';
          statusEl.textContent = `扫码成功，已登录：${nickname}${userId ? ` (${userId})` : ''}`;
          document.querySelector('#qr-img').style.display = 'none';
          setTimeout(() => renderSettings(), 600);
          return;
          statusEl.textContent = '扫码成功！已保存登录信息。';
          document.querySelector('#qr-img').style.display = 'none';
        } else {
          statusEl.textContent = res.loginMessage || data.loginMessage || '授权已确认，但无法读取音乐账号信息，请重新扫码';
          return;
          statusEl.textContent = '授权已确认，但没有拿到登录 token，请重新扫码';
        }
        return;
      }
      if (code === 802) { statusEl.textContent = '已扫码，请在手机上确认授权...'; continue; }
      if (code === 801) { statusEl.textContent = '等待扫码...'; continue; }
      if (code === 800) { statusEl.textContent = '二维码已过期，请重新获取'; return; }
      statusEl.textContent = '状态: ' + (data.msg || data.message || code);
    } catch {
      // keep polling
    }
  }
  statusEl.textContent = '超时，请重新获取二维码';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function profileBlock(title, items = []) {
  const values = (items || [])
    .map(item => typeof item === 'string' ? { name: item } : item)
    .filter(item => item?.name)
    .slice(0, 6);
  const tags = values.length
    ? values.map(item => `<span class="tag">${escapeHtml(item.name)}</span>`).join('')
    : '<span class="muted">暂无明显信号</span>';
  return `
    <article class="list-item" style="align-items:flex-start">
      <div>
        <h3>${escapeHtml(title)}</h3>
        <div class="tags">${tags}</div>
      </div>
    </article>
  `;
}

function profilePlaylistSelector(data = {}) {
  const playlists = data.playlists || [];
  const selection = data.profileSelection || {};
  const stateText = state.profileSelectionDirty ? '画像待更新' : '已同步选择';
  const stateClass = state.profileSelectionDirty ? 'dirty' : 'synced';
  if (!playlists.length) {
    return `
      <section class="profile-playlist-selector">
        <div class="profile-playlist-head">
          <div>
            <h2>画像歌单</h2>
            <p class="muted">当前音乐账号尚未同步歌单。同步完成后，可以选择哪些歌单参与长期音乐画像。</p>
          </div>
          <span id="library-profile-state" class="profile-state-chip synced">等待同步</span>
        </div>
      </section>
    `;
  }
  return `
    <section class="profile-playlist-selector">
      <div class="profile-playlist-head">
        <div>
          <h2>画像歌单</h2>
          <p class="muted">已选择 ${selection.selectedCount ?? playlists.filter(p => p.profileSelected).length} / ${selection.totalCount ?? playlists.length} 个当前账号歌单，只用勾选的歌单生成音乐画像。</p>
        </div>
        <div class="profile-playlist-badges">
          <span id="library-profile-state" class="profile-state-chip ${stateClass}">${stateText}</span>
          <span class="tag subtle">播放历史不参与</span>
        </div>
      </div>
      <div class="profile-playlist-list">
        ${playlists.map((playlist) => {
          const failure = playlistSyncFailureFor(playlist);
          return `
          <label
            class="profile-playlist-row ${failure ? 'sync-failed' : ''}"
            data-profile-playlist-row-id="${escapeAttr(playlist.id)}"
            data-profile-playlist-name="${escapeAttr(playlist.name)}"
          >
            <span class="profile-playlist-info">
              <strong>${escapeHtml(playlist.name)}</strong>
              <span>${escapeHtml(playlistKindLabel(playlist.kind))} · ${escapeHtml(playlistSyncSummary(playlist))}</span>
            </span>
            <span class="profile-playlist-status-stack">
              <span data-playlist-sync-error class="playlist-error-chip">${failure ? `<span title="${escapeAttr(failure)}">同步失败</span>` : ''}</span>
              ${playlist.syncComplete ? '' : '<span class="playlist-sync-chip">未完整</span>'}
            </span>
            <input
              type="checkbox"
              data-profile-playlist-id="${escapeAttr(playlist.id)}"
              ${playlist.profileSelected ? 'checked' : ''}
              aria-label="是否参与画像：${escapeAttr(playlist.name)}"
            />
          </label>
        `;
        }).join('')}
      </div>
    </section>
  `;
}

function bindProfilePlaylistSelection() {
  const inputs = [...document.querySelectorAll('[data-profile-playlist-id]')];
  const status = document.querySelector('#library-selection-status');
  const updateButton = document.querySelector('#profile-update-btn');
  const stateChip = document.querySelector('#library-profile-state');
  const setDisabled = (disabled) => {
    inputs.forEach((input) => { input.disabled = disabled; });
    if (updateButton) updateButton.disabled = disabled;
  };
  const setProfileState = (mode, text) => {
    if (!stateChip) return;
    stateChip.className = `profile-state-chip ${mode}`;
    stateChip.textContent = text;
  };
  const setUpdateReady = () => {
    setProfileState(state.profileSelectionDirty ? 'dirty' : 'synced', state.profileSelectionDirty ? '画像待更新' : '已同步选择');
    if (updateButton) updateButton.classList.toggle('attention', state.profileSelectionDirty);
  };
  setUpdateReady();

  inputs.forEach((input) => {
    input.addEventListener('change', async () => {
      const previousChecked = input.checked;
      const selectedPlaylistIds = inputs
        .filter((item) => item.checked)
        .map((item) => item.dataset.profilePlaylistId);
      setDisabled(true);
      if (status) status.textContent = '正在保存选择...';
      try {
        const data = await api('/api/library/profile-playlists', {
          method: 'PUT',
          body: { selectedPlaylistIds }
        });
        state.library = data;
        state.profileSelectionDirty = profileSelectionNeedsUpdate(data);
        if (status) status.textContent = state.profileSelectionDirty ? '选择已保存，画像待更新' : '选择已保存，画像已同步';
        setDisabled(false);
        setUpdateReady();
      } catch (error) {
        input.checked = !previousChecked;
        setDisabled(false);
        if (status) status.textContent = `保存失败：${error.message}`;
        setUpdateReady();
      }
    });
  });

  updateButton?.addEventListener('click', async () => {
    setDisabled(true);
    setProfileState('busy', '正在更新');
    if (status) status.textContent = '正在更新音乐画像...';
    try {
      const data = await api('/api/library/profile/update', { method: 'POST', body: {} });
      state.library = data;
      state.profileSelectionDirty = false;
      renderLibrary();
    } catch (error) {
      setDisabled(false);
      state.profileSelectionDirty = true;
      setProfileState('dirty', '画像待更新');
      if (status) status.textContent = `更新失败：${error.message}`;
      if (updateButton) updateButton.classList.add('attention');
    }
  });
}

function librarySyncNotice(result = {}) {
  const errors = Array.isArray(result.errors) ? result.errors.filter(Boolean).map(formatLibrarySyncError) : [];
  const total = Number(result.playlists ?? result.totalPlaylists ?? 0) || 0;
  const completed = Number(result.syncedPlaylists ?? total) || 0;
  const tracks = Number(result.tracks ?? result.syncedTracks ?? 0) || 0;
  if (errors.length) {
    const firstError = errors[0].replace(/^star: |^subscribed: |^created: |^recent: /, '');
    const label = total > 0 ? '同步部分失败' : '同步失败';
    const progress = total > 0 ? `已同步 ${completed} / ${total} 个歌单，${tracks} 首去重歌曲；` : '';
    return `${label}：${progress}${firstError}${errors.length > 1 ? `（另有 ${errors.length - 1} 个错误）` : ''}`;
  }
  return `同步完成：${completed || total} 个歌单，${tracks} 首去重歌曲`;
}

function formatLibrarySyncError(error) {
  const text = String(error || '').trim();
  if (!text) return '未知错误';
  const legacyPlaylistMatch = text.match(/^playlist\s+([^:：]+)\s*[:：]\s*(undefined|null|)$/i);
  if (legacyPlaylistMatch) {
    return `歌单 ID ${legacyPlaylistMatch[1]} 同步失败：音乐接口没有返回明确原因，可能是歌单权限限制、歌单不可访问或接口临时失败`;
  }
  return text
    .replace(/^playlist\s+([^:：]+)\s*[:：]\s*/i, '歌单 ID $1 同步失败：')
    .replace(/[:：]\s*(undefined|null)$/i, '：音乐接口没有返回明确原因，可能是歌单权限限制、歌单不可访问或接口临时失败');
}

function playlistSyncFailureFor(playlist = {}, syncStatus = state.librarySyncStatus) {
  const errors = Array.isArray(syncStatus?.errors) ? syncStatus.errors : [];
  if (!errors.length) return '';
  const id = String(playlist.id || '').trim();
  const name = String(playlist.name || '').trim();
  for (const rawError of errors) {
    const raw = String(rawError || '');
    const formatted = formatLibrarySyncError(raw);
    if (id && (
      new RegExp(`^playlist\\s+${escapeRegExp(id)}\\s*[:：]`, 'i').test(raw) ||
      formatted.includes(`歌单 ID ${id} `) ||
      formatted.includes(`歌单 ID ${id}同步失败`)
    )) {
      return formatted;
    }
    if (name && formatted.includes(`《${name}》同步失败`)) {
      return formatted;
    }
  }
  return '';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function profileSelectionNeedsUpdate(data = {}) {
  const selectedIds = normalizeStringList(data.profileSelection?.selectedIds);
  const profileIds = normalizeStringList(data.profile?.structured?.selectedPlaylistIds);
  if (!selectedIds.length && !profileIds.length) return false;
  return !sameStringList(selectedIds, profileIds);
}

function normalizeStringList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))]
    .sort();
}

function sameStringList(left = [], right = []) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function playlistSyncSummary(playlist = {}) {
  const synced = Number(playlist.syncedTrackCount ?? playlist.trackCount ?? 0) || 0;
  const total = Number(playlist.trackCount ?? 0) || 0;
  if (!total || synced >= total) return `已同步 ${synced || total} 首`;
  return `已同步 ${synced} / 共 ${total} 首`;
}

function playlistKindLabel(kind) {
  return {
    star: '红心歌单',
    created: '创建歌单',
    subscribed: '收藏歌单',
    playlist: '歌单'
  }[kind] || kind || '歌单';
}

function mixerControl(key, title, description, preferences = {}) {
  const options = mixerOptions[key] || [];
  return `
    <article class="mixer-control" data-pref-control="${escapeAttr(key)}">
      <div class="mixer-control-head">
        <div>
          <h2>${escapeHtml(title)}</h2>
          <p class="muted">${escapeHtml(description)}</p>
        </div>
        <span class="mixer-value">${escapeHtml(activeMixerLabel(key, preferences[key]))}</span>
      </div>
      <div class="segmented-control" role="group" aria-label="${escapeAttr(title)}">
        ${options.map((option) => `
          <button
            type="button"
            class="${isMixerOptionActive(key, preferences[key], option.value) ? 'active' : ''}"
            data-pref-key="${escapeAttr(key)}"
            data-pref-value="${escapeAttr(option.value)}"
          >
            <span>${escapeHtml(option.label)}</span>
            <small>${escapeHtml(option.detail)}</small>
          </button>
        `).join('')}
      </div>
    </article>
  `;
}

function lowDistractionControl(preferences = {}) {
  const active = Boolean(preferences.lowDistractionMode);
  return `
    <article class="mixer-control low-distraction-control ${active ? 'is-active' : ''}" data-pref-control="lowDistractionMode">
      <div class="mixer-control-head">
        <div>
          <h2>宿舍 / 自习室低打扰</h2>
          <p class="muted">文字优先、减少口播和主动接歌，推荐更偏安静专注。</p>
        </div>
        <button
          id="low-distraction-toggle"
          class="switch-control ${active ? 'is-on' : ''}"
          type="button"
          role="switch"
          aria-checked="${active ? 'true' : 'false'}"
          data-pref-key="lowDistractionMode"
          data-pref-value="${active ? 'false' : 'true'}"
        >
          <span class="switch-track" aria-hidden="true"><span></span></span>
          <strong>${active ? 'LOW DISTRACTION' : 'NORMAL SIGNAL'}</strong>
        </button>
      </div>
      <div class="low-distraction-strip" aria-hidden="true">
        <span>LOW VOICE</span>
        <span>SOFT MOTION</span>
        <span>QUIET PICKS</span>
      </div>
    </article>
  `;
}

function bindMixerControls(initialPreferences = {}) {
  let preferences = { ...initialPreferences };
  const controls = [...document.querySelectorAll('[data-pref-key]')];
  const statusEl = document.querySelector('#mixer-save-status');
  const summaryEl = document.querySelector('#mixer-mode-summary');
  const note = document.querySelector('#mixer-note');
  const noteSave = document.querySelector('#mixer-note-save');

  const refresh = () => {
    for (const key of Object.keys(mixerOptions)) {
      const valueEl = document.querySelector(`[data-pref-control="${key}"] .mixer-value`);
      if (valueEl) valueEl.textContent = activeMixerLabel(key, preferences[key]);
      document.querySelectorAll(`[data-pref-key="${key}"]`).forEach((button) => {
        button.classList.toggle('active', isMixerOptionActive(key, preferences[key], button.dataset.prefValue));
      });
    }
    const lowToggle = document.querySelector('#low-distraction-toggle');
    const lowPanel = document.querySelector('[data-pref-control="lowDistractionMode"]');
    const lowActive = Boolean(preferences.lowDistractionMode);
    if (lowToggle) {
      lowToggle.classList.toggle('is-on', lowActive);
      lowToggle.setAttribute('aria-checked', lowActive ? 'true' : 'false');
      lowToggle.dataset.prefValue = lowActive ? 'false' : 'true';
      const label = lowToggle.querySelector('strong');
      if (label) label.textContent = lowActive ? 'LOW DISTRACTION' : 'NORMAL SIGNAL';
    }
    if (lowPanel) lowPanel.classList.toggle('is-active', lowActive);
    if (summaryEl) summaryEl.textContent = mixerModeSummary(preferences);
    applyLowDistractionVisualMode(preferences);
  };

  const save = async (patch) => {
    const previous = { ...preferences };
    preferences = { ...preferences, ...patch };
    refresh();
    setMixerStatus('正在保存频率...', '');
    setMixerDisabled(true);
    try {
      const result = await api('/api/preferences', { method: 'PUT', body: preferences });
      preferences = result.preferences || preferences;
      state.preferences = preferences;
      persistDeviceSnapshot({ preferences }, { replaceDefaultPreferences: true });
      refresh();
      setMixerStatus(preferences.lowDistractionMode ? 'LOW DISTRACTION' : '已保存到灿灿的运行参数', 'ok');
    } catch (error) {
      preferences = previous;
      if (note) note.value = previous.note || '';
      refresh();
      setMixerStatus(error.message, 'error');
    } finally {
      setMixerDisabled(false);
    }
  };

  controls.forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.prefKey;
      const value = key === 'lowDistractionMode'
        ? button.dataset.prefValue === 'true'
        : button.dataset.prefValue;
      if (!key || value === undefined || preferences[key] === value) return;
      save({ [key]: value });
    });
  });

  noteSave?.addEventListener('click', () => save({ note: note?.value || '' }));

  function setMixerStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('status-ok', kind === 'ok');
    statusEl.classList.toggle('status-miss', kind === 'error');
  }

  function setMixerDisabled(disabled) {
    [...controls, noteSave].filter(Boolean).forEach((el) => { el.disabled = disabled; });
  }
}

function activeMixerLabel(key, value) {
  const normalized = key === 'moodMode' && (!value || value === 'auto') ? 'random' : value;
  return mixerOptions[key]?.find((option) => option.value === normalized)?.label || '未设置';
}

function isMixerOptionActive(key, storedValue, optionValue) {
  const normalized = key === 'moodMode' && (!storedValue || storedValue === 'auto') ? 'random' : storedValue;
  return normalized === optionValue;
}

function mixerModeSummary(preferences = {}) {
  const parts = [
    activeMixerLabel('chatMusicBalance', preferences.chatMusicBalance),
    activeMixerLabel('recommendationFrequency', preferences.recommendationFrequency),
    activeMixerLabel('voiceMode', preferences.voiceMode),
    activeMixerLabel('moodMode', preferences.moodMode)
  ];
  if (preferences.lowDistractionMode) parts.push('低打扰');
  return parts.join(' / ');
}

function moodStatsPanel(stats = {}) {
  const buckets = Array.isArray(stats.buckets) ? stats.buckets : [];
  const total = Number(stats.total || 0);
  if (!total || !buckets.some(bucket => Number(bucket.count || 0) > 0)) {
    return `
      <div class="mood-empty">
        <strong>还没有足够的电台氛围记录</strong>
        <span>和灿灿聊几轮后，这里会显示最近更常出现的专注、放松、深夜等状态。</span>
      </div>
    `;
  }
  return `
    <div class="mood-ribbon" aria-label="电台氛围分布">
      ${buckets.map(bucket => `
        <span class="mood-${escapeAttr(bucket.id || 'random')}" style="width:${Math.max(2, Number(bucket.ratio || 0) * 100)}%" title="${escapeAttr(`${bucket.label} ${bucket.count} 次`)}"></span>
      `).join('')}
    </div>
    <div class="mood-grid">
      ${buckets.map(bucket => moodBucket(bucket, total)).join('')}
    </div>
    <p class="muted mixer-impact">这些只是电台氛围记录，用来帮助灿灿调整聊天和接歌节奏。</p>
  `;
}

function moodBucket(bucket = {}, total = 1) {
  const count = Number(bucket.count || 0);
  const percent = Math.round((count / Math.max(1, total)) * 100);
  return `
    <article class="mood-bucket mood-${escapeAttr(bucket.id || 'random')}">
      <span>${escapeHtml(bucket.label || '随机探索')}</span>
      <strong>${count}</strong>
      <small>${percent}%</small>
    </article>
  `;
}

function feedbackMeter(feedback = {}) {
  const totals = feedback.totals || {};
  const like = Number(totals.likes || 0);
  const complete = Number(totals.completions || 0);
  const skip = Number(totals.skips || 0);
  const dislike = Number(totals.dislikes || 0);
  const total = Math.max(1, like + complete + skip + dislike);
  return `
    <div class="feedback-grid">
      ${feedbackStat('喜欢', like, 'positive')}
      ${feedbackStat('完整播放', complete, 'positive')}
      ${feedbackStat('跳过', skip, 'negative')}
      ${feedbackStat('不喜欢', dislike, 'negative')}
    </div>
    <div class="feedback-meter" aria-label="反馈趋势">
      <span class="like" style="width:${(like / total) * 100}%"></span>
      <span class="complete" style="width:${(complete / total) * 100}%"></span>
      <span class="skip" style="width:${(skip / total) * 100}%"></span>
      <span class="dislike" style="width:${(dislike / total) * 100}%"></span>
    </div>
    <p class="muted mixer-impact">${escapeHtml(feedbackImpactText({ like, complete, skip, dislike }))}</p>
  `;
}

function feedbackStat(label, value, tone) {
  return `
    <div class="feedback-stat ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${Number(value || 0)}</strong>
    </div>
  `;
}

function feedbackImpactText({ like, complete, skip, dislike }) {
  if (!like && !complete && !skip && !dislike) return '还没有足够反馈。喜欢、跳过和完整播放会逐步改变后续排序。';
  if (skip + dislike > like + complete) return '最近负反馈更强，灿灿会降低相似歌曲和重复艺人的权重。';
  if (like + complete > skip + dislike) return '最近正反馈更强，灿灿会更相信这些歌曲附近的风格和艺人信号。';
  return '正负反馈接近，灿灿会继续探索但减少短时间重复。';
}

function feedbackTracks(feedback = {}) {
  const tracks = (feedback.tracks || []).slice(0, 8);
  if (!tracks.length) return '<p class="muted memory-empty">还没有反馈曲目。点喜欢、不喜欢、下一首或完整播放后，这里会出现影响排序的歌曲。</p>';
  return tracks.map((track) => `
    <article class="feedback-track">
      <img src="${escapeAttr(track.coverUrl || '/assets/cover-1.svg')}" alt="" />
      <div>
        <h3>${escapeHtml(track.name || track.trackId)}</h3>
        <p>${escapeHtml((track.artists || []).join(' / ') || '未知艺人')}</p>
      </div>
      <span>${feedbackScore(track)}</span>
    </article>
  `).join('');
}

function feedbackScore(track = {}) {
  const score = Number(track.likes || 0) * 3
    + Number(track.completions || 0)
    - Number(track.dislikes || 0) * 2
    - Number(track.skips || 0);
  return score > 0 ? `+${score}` : String(score);
}

function memorySummaryItem(memory) {
  const confidence = Math.round(Number(memory.confidence || 0) * 100);
  return `
    <article class="memory-item compact" data-memory-id="${escapeAttr(memory.id)}">
      <div class="memory-main">
        <div class="memory-meta">
          <span class="tag">${escapeHtml(memoryKindLabel(memory.kind))}</span>
          <span class="muted">置信 ${confidence}%</span>
        </div>
        <p data-memory-content>${escapeHtml(memory.content || '')}</p>
        <textarea class="memory-editor" data-memory-editor maxlength="180" hidden>${escapeHtml(memory.content || '')}</textarea>
        <div class="memory-actions">
          <button class="ghost tiny" type="button" data-memory-edit>编辑</button>
          <button class="ghost tiny" type="button" data-memory-save hidden>保存</button>
          <button class="ghost tiny" type="button" data-memory-cancel hidden>取消</button>
          <button class="ghost tiny danger" type="button" data-memory-delete>删除</button>
        </div>
      </div>
    </article>
  `;
}

function bindMemoryManagement() {
  const list = document.querySelector('[data-memory-list]');
  if (!list) return;
  list.addEventListener('click', async (event) => {
    const button = closestButtonFromEvent(event);
    if (!button) return;
    const item = button.closest('[data-memory-id]');
    if (!item) return;
    const id = item.dataset.memoryId;
    const content = item.querySelector('[data-memory-content]');
    const editor = item.querySelector('[data-memory-editor]');
    const edit = item.querySelector('[data-memory-edit]');
    const save = item.querySelector('[data-memory-save]');
    const cancel = item.querySelector('[data-memory-cancel]');
    const del = item.querySelector('[data-memory-delete]');
    const setEditing = (editing) => {
      if (content) content.hidden = editing;
      if (editor) editor.hidden = !editing;
      if (edit) edit.hidden = editing;
      if (save) save.hidden = !editing;
      if (cancel) cancel.hidden = !editing;
      if (del) del.disabled = editing;
      if (editing) editor?.focus();
    };
    if (button.matches('[data-memory-edit]')) {
      setEditing(true);
      return;
    }
    if (button.matches('[data-memory-cancel]')) {
      if (editor && content) editor.value = content.textContent || '';
      setEditing(false);
      return;
    }
    if (button.matches('[data-memory-save]')) {
      const nextContent = editor?.value?.trim() || '';
      if (!nextContent) return;
      setMemoryBusy(item, true);
      try {
        const result = await api(`/api/memories/${encodeURIComponent(id)}`, { method: 'PUT', body: { content: nextContent } });
        const memory = result.memory;
        if (memory) {
          state.memories = (state.memories || []).map((item) => String(item.id) === String(id) ? memory : item);
          persistDeviceSnapshot({ memories: state.memories }, { replaceEmptyMemories: true });
          item.outerHTML = memorySummaryItem(memory);
        } else if (content) {
          content.textContent = nextContent;
          state.memories = (state.memories || []).map((item) => String(item.id) === String(id) ? { ...item, content: nextContent } : item);
          persistDeviceSnapshot({ memories: state.memories }, { replaceEmptyMemories: true });
          setEditing(false);
        }
      } catch (error) {
        setMixerInlineError(item, error.message);
      } finally {
        setMemoryBusy(item, false);
      }
      return;
    }
    if (button.matches('[data-memory-delete]')) {
      setMemoryBusy(item, true);
      try {
        await api(`/api/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
        state.memories = (state.memories || []).filter((memory) => String(memory.id) !== String(id));
        persistDeviceSnapshot({ memories: state.memories }, { replaceEmptyMemories: true });
        item.remove();
        if (!list.querySelector('[data-memory-id]')) {
          list.innerHTML = '<p class="muted memory-empty">暂时还没有长期记忆。继续和灿灿聊天后，这里会出现稳定偏好、需求和边界。</p>';
        }
      } catch (error) {
        setMixerInlineError(item, error.message);
        setMemoryBusy(item, false);
      }
    }
  });
}

function setMemoryBusy(item, busy) {
  item.querySelectorAll('button, textarea').forEach((el) => { el.disabled = busy; });
}

function setMixerInlineError(item, message) {
  let error = item.querySelector('[data-memory-error]');
  if (!error) {
    error = document.createElement('p');
    error.className = 'memory-error';
    error.dataset.memoryError = 'true';
    item.querySelector('.memory-main')?.appendChild(error);
  }
  error.textContent = message || '操作失败';
}

function trackItem(track) {
  return `
    <article class="list-item">
      <img src="${escapeAttr(track.coverUrl || '/assets/cover-1.svg')}" alt="" />
      <div>
        <h3>${escapeHtml(track.name)}</h3>
        <p>${escapeHtml((track.artists || []).join(' / ') || track.album || '')}</p>
      </div>
    </article>
  `;
}

function memoryKindLabel(kind) {
  return {
    emotion_pattern: '情绪模式',
    need: '需求',
    preference: '偏好',
    boundary: '边界',
    life_context: '生活上下文',
    music_preference: '音乐偏好'
  }[kind] || kind || '记忆';
}

function formatDateTime(value) {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function statusRow(label, ok, detail = '') {
  return `
    <tr>
      <td>${escapeHtml(label)}</td>
      <td class="${ok ? 'status-ok' : 'status-miss'}">${ok ? '已配置' : '未配置'} ${detail ? `· ${escapeHtml(detail)}` : ''}</td>
    </tr>
  `;
}

async function api(path, options = {}) {
  const headers = {
    'X-Demo-Visitor-Id': ensureDemoVisitorId(),
    ...clientEnvironmentHeaders()
  };
  if (options.body) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal
  });
  const data = await response.json();
  if (!response.ok || data.ok === false || data.__error) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function clientEnvironmentHeaders() {
  const headers = {};
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZone) headers['X-Demo-Time-Zone'] = timeZone;
  } catch {}
  try {
    if (navigator.language) headers['X-Demo-Locale'] = navigator.language;
  } catch {}
  return headers;
}

async function loadPreferences({ force = false } = {}) {
  if (state.preferences && !force) return state.preferences;
  if (!preferencesLoadPromise || force) {
    preferencesLoadPromise = api('/api/preferences')
      .then((data) => {
        state.preferences = data.preferences || state.preferences || {};
        if (data.feedbackSummary) state.feedbackSummary = data.feedbackSummary;
        applyLowDistractionVisualMode(state.preferences);
        persistDeviceSnapshot({
          preferences: state.preferences,
          feedbackSummary: state.feedbackSummary
        });
        return state.preferences;
      })
      .finally(() => { preferencesLoadPromise = null; });
  }
  return preferencesLoadPromise;
}

function applyLowDistractionVisualMode(preferences = state.preferences || {}) {
  document.body.classList.toggle('low-distraction-mode', Boolean(preferences?.lowDistractionMode));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
