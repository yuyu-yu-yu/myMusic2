import { animate } from '/vendor/anime.esm.min.js';

const AI_MUSIC_MODE_STORAGE_KEY = 'mymusic:aiMusicMode';
const DEMO_VISITOR_STORAGE_KEY = 'mymusic:demoVisitorId';

let fallbackDemoVisitorId = null;

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
  mixerRefreshTimer: null,
  librarySyncTimer: null,
  librarySyncStatus: null,
  profileSelectionDirty: false,
  librarySyncNotice: '',
  radioPrefetchPromise: null,
  playbackHistory: [],
  demoSelfCheck: null,
  demoSelfCheckRunning: false,
  radioTurnSeq: 0,
  activeRadioTurn: null,
  aiMusicMode: readStoredAiMusicMode()
};

function ensureDemoVisitorId() {
  try {
    let id = sessionStorage.getItem(DEMO_VISITOR_STORAGE_KEY);
    if (!id) {
      id = createDemoVisitorId();
      sessionStorage.setItem(DEMO_VISITOR_STORAGE_KEY, id);
    }
    return id;
  } catch {
    fallbackDemoVisitorId ||= createDemoVisitorId();
    return fallbackDemoVisitorId;
  }
}

function createDemoVisitorId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
let preferencesLoadPromise = null;
const FALLBACK_BAR_COUNT = 44;
const VISUALIZER_DEBUG = false;

function makeAvatarFrameSequence(stateName, durations) {
  return {
    spriteSrc: `/avatar/sprites/${stateName}.png`,
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
  happy: makeAvatarFrameSequence('happy', [160, 160, 170, 180, 180, 170, 160, 220]),
  on_air: makeAvatarFrameSequence('on_air', [233, 233, 233, 233, 233, 233, 233, 233, 233, 233, 233, 237])
};

const avatarMotionMap = {
  listening: '/avatar/webm/listening.webm',
  talking: '/avatar/webm/talking.webm',
  searching: '/avatar/webm/searching_music.webm',
  reading: '/avatar/webm/reading_book.webm',
  happy: '/avatar/webm/happy.webm',
  on_air: '/avatar/webm/on_air.webm'
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
  happy: 'HAPPY',
  on_air: 'ON AIR'
};
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

  if (location.pathname === '/diary') {
    history.replaceState({}, '', '/mixer');
  }
  if (state.mixerRefreshTimer && location.pathname !== '/mixer') {
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
  if (location.pathname === '/mixer') return renderMixer();
  if (location.pathname === '/settings') return renderSettings();
  return renderPlayer();
}


// --- Audio visualizer ---
// One persistent AudioContext. Sources created once per audio element and
// cached. Switching disconnects old connections and reconnects the desired
// source to a fresh analyser. No gain nodes.
let audioCtx = null;
let analyser = null;
let visualizerAnimId = null;
let visualizerBuilt = false;
const sourceCache = new Map();

function visualizerLog(...args) {
  if (VISUALIZER_DEBUG) console.log('[viz]', ...args);
}

function initVisualizer() {
  const fallback = document.querySelector('#equalizer-fallback');
  if (!fallback) return;
  if (fallback.dataset.visualizerReady === 'true') return;
  fallback.replaceChildren();
  for (let i = 0; i < FALLBACK_BAR_COUNT; i++) {
    const bar = document.createElement('span');
    bar.className = 'bar';
    bar.style.animationDelay = (i * 0.035) + 's';
    bar.style.animationDuration = (0.55 + (i % 7) * 0.08) + 's';
    bar.style.setProperty('--fallback-height', `${18 + ((i * 13) % 34)}px`);
    fallback.appendChild(bar);
  }
  fallback.dataset.visualizerReady = 'true';
}

function getOrCreateMediaSource(audioEl) {
  if (!audioCtx || !audioEl) return null;
  const cached = sourceCache.get(audioEl);
  if (cached?.ctx === audioCtx && cached.source) return cached.source;
  const source = audioCtx.createMediaElementSource(audioEl);
  sourceCache.set(audioEl, { ctx: audioCtx, source });
  return source;
}

function buildAudioGraph() {
  if (visualizerBuilt) return true;
  const hostAudio = document.querySelector('#host-audio');
  const songAudio = document.querySelector('#song-audio');
  if (!hostAudio || !songAudio) return false;
  try {
    hostAudio.crossOrigin = 'anonymous';
    songAudio.crossOrigin = 'anonymous';
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return false;
    if (!audioCtx) audioCtx = new AudioContextCtor();
    const hostSource = getOrCreateMediaSource(hostAudio);
    const songSource = getOrCreateMediaSource(songAudio);
    visualizerBuilt = Boolean(hostSource && songSource);
    visualizerLog('graph ready, sources cached:', sourceCache.size);
    return visualizerBuilt;
  } catch(e) {
    console.warn('[viz] Web Audio not available:', e.message);
    visualizerBuilt = false;
    return false;
  }
}

function disconnectVisualizerGraph() {
  for (const entry of sourceCache.values()) {
    try { entry.source.disconnect(); } catch {}
  }
  if (analyser) {
    try { analyser.disconnect(); } catch {}
    analyser = null;
  }
}

function switchVisualizerTo(kind) {
  visualizerLog('switchVisualizerTo(' + kind + ') built:', visualizerBuilt);
  const canvas = document.querySelector('#visualizer-canvas');
  const fb = document.querySelector('#equalizer-fallback');

  const hideAll = () => {
    stopDrawLoop();
    disconnectVisualizerGraph();
    if (canvas) { canvas.style.display = 'none'; canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); }
    if (fb) fb.style.display = 'none';
  };
  const showFallback = () => {
    initVisualizer();
    stopDrawLoop();
    disconnectVisualizerGraph();
    if (canvas) { canvas.style.display = 'none'; canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); }
    if (fb) fb.style.display = 'flex';
  };

  if (kind === 'off') {
    hideAll();
    return;
  }

  const audioEl = kind === 'host'
    ? document.querySelector('#host-audio')
    : document.querySelector('#song-audio');
  const hasBrowserAudio = kind === 'host'
    ? Boolean(audioEl?.currentSrc || audioEl?.src)
    : Boolean(state.current?.track?.playUrl && (audioEl?.currentSrc || audioEl?.src));
  if (!hasBrowserAudio || !buildAudioGraph()) {
    showFallback();
    return;
  }

  if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {});

  disconnectVisualizerGraph();

  const source = getOrCreateMediaSource(audioEl);
  visualizerLog('source for ' + kind + ':', !!source, 'el src:', (audioEl?.src || '').slice(-40));
  if (!source) {
    showFallback();
    return;
  }

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 64;
  analyser.smoothingTimeConstant = 0.7;
  source.connect(analyser);
  analyser.connect(audioCtx.destination);

  if (canvas) canvas.style.display = 'block';
  if (fb) fb.style.display = 'none';

  stopDrawLoop();
  startDrawLoop(canvas);
}

let _drawFrameCount = 0;
let _drawLogged = false;

function startDrawLoop(canvas) {
  if (visualizerAnimId || !canvas) return;
  visualizerLog('startDrawLoop, analyser:', !!analyser, 'built:', visualizerBuilt);
  _drawFrameCount = 0;
  _drawLogged = false;
  function frame() {
    visualizerAnimId = requestAnimationFrame(frame);
    if (!visualizerBuilt || !analyser) return;
    _drawFrameCount++;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);
    if (VISUALIZER_DEBUG && !_drawLogged && _drawFrameCount % 30 === 0) {
      const maxVal = Math.max(...dataArray);
      console.log('[viz] frame #' + _drawFrameCount, 'max freq:', maxVal, 'first 5:', [...dataArray.slice(0, 5)]);
      if (_drawFrameCount >= 120) _drawLogged = true;
    }
    ctx.clearRect(0, 0, W, H);

    const barCount = Math.min(bufferLength, 18);
    const barWidth = (W / barCount) - 2;
    let x = 1;
    for (let i = 0; i < barCount; i++) {
      const barHeight = Math.max(2, (dataArray[i] / 255) * (H - 4));
      const gradient = ctx.createLinearGradient(0, H, 0, H - barHeight);
      gradient.addColorStop(0, '#00f0ff');
      gradient.addColorStop(1, '#ff00ff');
      ctx.fillStyle = gradient;
      ctx.fillRect(x, H - barHeight - 1, barWidth, barHeight);
      x += barWidth + 2;
    }
  }
  visualizerAnimId = requestAnimationFrame(frame);
}

function stopDrawLoop() {
  if (visualizerAnimId) { cancelAnimationFrame(visualizerAnimId); visualizerAnimId = null; }
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

function playAvatarVideoOrFallback(root, video, image, src) {
  root.classList.remove('is-frame-sequence');
  root.classList.remove('is-sprite-sequence');
  const sprite = root.querySelector('#avatar-sprite');
  if (sprite) sprite.hidden = true;
  if (image) image.src = '/avatar/source/cancan.png';

  if (!video || !src) {
    root.classList.add('is-fallback');
    if (video) video.hidden = true;
    if (image) image.hidden = false;
    return;
  }

  video.onerror = () => {
    root.classList.add('is-fallback');
    video.hidden = true;
    if (image) image.hidden = false;
  };
  video.onloadeddata = () => {
    root.classList.remove('is-fallback');
    video.hidden = false;
    if (image) image.hidden = true;
    video.play().catch(() => {});
  };

  if (video.getAttribute('src') !== src) {
    video.hidden = true;
    if (image) image.hidden = false;
    root.classList.add('is-fallback');
    video.src = src;
    video.load();
  } else if (video.readyState >= 2) {
    root.classList.remove('is-fallback');
    video.hidden = false;
    if (image) image.hidden = true;
    video.play().catch(() => {});
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

function playAvatarFrameSequence(root, video, image, sequence, fallbackSrc) {
  if (!image || !sequence?.frames?.length) {
    playAvatarVideoOrFallback(root, video, image, fallbackSrc);
    return;
  }

  stopAvatarFrameSequence();
  const token = avatarFrameSequenceToken;
  let index = 0;
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
  if (video) {
    video.pause();
    video.hidden = true;
    video.onerror = null;
    video.onloadeddata = null;
  }
  image.hidden = true;
  sprite.hidden = false;
  strip.style.width = `${sequence.frames.length * 100}%`;
  strip.style.transform = 'translate3d(0, 0, 0)';

  strip.onerror = () => {
    if (token !== avatarFrameSequenceToken) return;
    root.classList.remove('is-sprite-sequence');
    sprite.hidden = true;
    image.hidden = false;
    playAvatarImageFrameSequence(root, video, image, sequence, fallbackSrc, token);
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

function playAvatarImageFrameSequence(root, video, image, sequence, fallbackSrc, token) {
  let index = 0;
  image.onerror = () => {
    if (token !== avatarFrameSequenceToken) return;
    stopAvatarFrameSequence();
    playAvatarVideoOrFallback(root, video, image, fallbackSrc);
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

  if (avatarRestoreTimer) {
    clearTimeout(avatarRestoreTimer);
    avatarRestoreTimer = null;
  }

  const root = document.querySelector('#ai-dj-avatar');
  if (!root) return;

  root.dataset.state = normalized;
  const status = root.querySelector('.avatar-status');
  if (status) status.textContent = avatarStateLabels[normalized] || 'ON AIR';

  const video = document.querySelector('#avatar-video');
  const image = document.querySelector('#avatar-image');
  const src = avatarMotionMap[normalized];
  const sequence = avatarFrameSequences[normalized];

  if (sequence) {
    playAvatarFrameSequence(root, video, image, sequence, src);
  } else {
    stopAvatarFrameSequence();
    playAvatarVideoOrFallback(root, video, image, src);
  }

  if (options.temporaryMs) {
    const restoreState = options.restoreState || getContextualAvatarState();
    avatarRestoreTimer = setTimeout(() => {
      setAvatarState(restoreState);
    }, options.temporaryMs);
  }
}

function getContextualAvatarState() {
  const hostAudio = document.querySelector('#host-audio');
  const songAudio = document.querySelector('#song-audio');
  if (hostAudio?.src && !hostAudio.paused && !hostAudio.ended) return 'talking';
  if (songAudio?.src && !songAudio.paused && !songAudio.ended) return 'listening';
  if (state.current?.track) return 'on_air';
  return 'idle';
}

function setRadioButtonState(mode = 'idle') {
  const startBtn = document.querySelector('#start-btn');
  if (!startBtn) return;
  startBtn.dataset.radioState = mode;
  if (mode === 'loading') startBtn.textContent = '电台启动中';
  else if (mode === 'active') startBtn.textContent = '电台已启动';
  else startBtn.textContent = '启动电台';
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

function renderPlayer() {
  view.innerHTML = '';
  view.append(template.content.cloneNode(true));
  loadPreferences().catch(() => {});

  // Move persistent audio elements into the player layout
  const leftCol = document.querySelector('.left-col');
  const audioLayer = document.querySelector('#audio-layer');
  const audioEls = ['#host-audio', '#song-audio', '#visualizer-canvas', '#equalizer-fallback'];
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
  const previousBtn = document.querySelector('#previous-btn');
  const nextBtn = document.querySelector('#next-btn');
  const playToggleBtn = document.querySelector('#play-toggle-btn');
  const chatForm = document.querySelector('#chat-form');
  const modeResetBtn = document.querySelector('#mode-reset-btn');
  const aiMusicToggle = document.querySelector('#ai-music-toggle');
  const aiMusicDownload = document.querySelector('#ai-music-download');
  const { likeBtn, dislikeBtn } = ensureFeedbackButtons();

  startBtn.addEventListener('click', () => {
    api('/api/player/stop', { method: 'POST', body: {} }).catch(() => {});
    startRadio();
  });
  previousBtn?.addEventListener('click', () => previousTrack());
  nextBtn.addEventListener('click', () => nextTrack({ skipCurrent: true }));
  playToggleBtn?.addEventListener('click', () => {
    if (playToggleBtn.classList.contains('is-playing')) pausePlayback();
    else resumePlayback();
  });
  modeResetBtn.addEventListener('click', () => resetMode());
  aiMusicToggle?.addEventListener('click', () => setAiMusicMode(!state.aiMusicMode));
  aiMusicDownload?.addEventListener('click', (event) => {
    if (aiMusicDownload.getAttribute('aria-disabled') === 'true') event.preventDefault();
  });
  likeBtn.addEventListener('click', () => {
    setAvatarState('happy', { temporaryMs: 1400 });
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

  // Restore saved chat messages
  if (savedChatHTML) {
    const chatMessages = document.querySelector('#chat-messages');
    if (chatMessages) chatMessages.innerHTML = savedChatHTML;
    savedChatHTML = '';
  }

  if (state.current) updatePlayer(state.current, false);
  updatePreviousButtonState();
  setAvatarState(state.avatarState || getContextualAvatarState());
  setRadioButtonState(state.sessionId || state.current?.track ? 'active' : 'idle');
  startPlayerPolling();
  initButtonFeedback();
  initVisualizer();
  initProgressBar();
  updateAiMusicToggle();
  updateAiMusicDownload(state.current?.track || null);
  scheduleRadioPrefetch();
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
  try {
    localStorage.setItem(AI_MUSIC_MODE_STORAGE_KEY, state.aiMusicMode ? 'on' : 'off');
  } catch {
    // Storage failures should not block the local playback mode switch.
  }
  updateAiMusicToggle();
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
  await reportFeedback('dislike');
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

function beginRadioTurn() {
  if (state.activeRadioTurn?.controller && !state.activeRadioTurn.controller.signal.aborted) {
    state.activeRadioTurn.controller.abort();
  }
  if (state.activeRadioTurn?.loading) {
    stopLoadingMessages({ remove: true, loading: state.activeRadioTurn.loading });
  }
  interruptPendingHostSpeech();
  suppressCurrentSongAutoAdvance();

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

function isCurrentPlaybackTurn(radioTurn, track) {
  return isActiveRadioTurn(radioTurn) && (!track?.id || state.current?.track?.id === track.id);
}

function interruptPendingHostSpeech() {
  const hostAudio = document.querySelector('#host-audio');
  if (hostAudio && hostAudio.dataset.voicePriming !== 'true') {
    hostAudio.onended = null;
    hostAudio.onplay = null;
    hostAudio.pause();
  }
  window.speechSynthesis?.cancel?.();
}

function suppressCurrentSongAutoAdvance() {
  const songAudio = document.querySelector('#song-audio');
  if (!songAudio) return;
  songAudio.onended = null;
}

function scheduleRadioPrefetch({ force = false } = {}) {
  if (state.aiMusicMode) return Promise.resolve(null);
  if (state.radioPrefetchPromise && !force) return state.radioPrefetchPromise;
  const sessionId = ensureSessionId();
  state.radioPrefetchPromise = api('/api/radio/prefetch', {
    method: 'POST',
    body: { sessionId, force }
  })
    .then((result) => {
      console.debug('[radio queue prefetch]', result);
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
  appendChat({ role: 'user', text: state.aiMusicMode ? '开启 AI 原创模式' : '启动电台' });
  const loading = startLoadingMessages(state.aiMusicMode ? 'aiMusic' : 'music');
  attachRadioTurnLoading(radioTurn, loading);
  try {
    await loadPreferences().catch(() => null);
    if (!isActiveRadioTurn(radioTurn)) return;
    const data = state.aiMusicMode
      ? await requestAiMusicTrack({ sessionId, trigger: 'start', signal: radioTurnSignal(radioTurn) })
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

async function nextTrack({ skipCurrent = true, silent = false } = {}) {
  const radioTurn = beginRadioTurn();
  primeVoicePlayback();
  const sessionId = ensureSessionId();
  setAvatarState('searching');
  setPlaybackToggleState(false);
  if (skipCurrent) await reportFeedback('skip');
  if (!isActiveRadioTurn(radioTurn)) return;
  if (!silent) {
    appendChat({ role: 'user', text: state.aiMusicMode ? '生成此刻歌曲' : '下一首' });
  }
  const loading = startLoadingMessages(state.aiMusicMode ? 'aiMusic' : 'music');
  attachRadioTurnLoading(radioTurn, loading);
  try {
    await loadPreferences().catch(() => null);
    if (!isActiveRadioTurn(radioTurn)) return;
    const data = state.aiMusicMode
      ? await requestAiMusicTrack({ sessionId, trigger: 'next', signal: radioTurnSignal(radioTurn) })
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

async function sendChat(msg) {
  primeVoicePlayback();
  const sessionId = ensureSessionId();
  appendChat({ role: 'user', text: msg });
  const loading = startLoadingMessages('chat');
  try {
    await loadPreferences().catch(() => null);
    const data = await api('/api/radio/chat', { method: 'POST', body: { sessionId, message: msg } });
    handleRadioResponse(data, { loading });
  } catch (e) {
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

function handleRadioResponse(data, { loading = null, radioTurn = null } = {}) {
  if (isInterruptedRadioTurn(radioTurn)) {
    stopLoadingMessages({ remove: true, loading });
    clearRadioTurnLoading(radioTurn, loading);
    return false;
  }
  stopLoadingMessages({ loading });
  clearRadioTurnLoading(radioTurn, loading);
  state.sessionId = data.sessionId || state.sessionId;
  setRadioButtonState(state.sessionId || data.track || state.current?.track ? 'active' : 'idle');
  if (data.track) {
    stopVisualizer();
    rememberCurrentForHistory(data);
    state.current = data;
    updatePlayer(data, false);
  }

  replaceLoadingMessage({
    text: data.chatText || data.hostText || '',
    track: data.track,
    explanation: data.explanation,
    loading
  });
  scheduleUsageInsightsRefresh(data.track ? 800 : 3200);

  // Show/hide mode reset button
  const hasMode = data.mode?.genre;
  document.querySelector('#mode-reset-btn').style.display = hasMode ? '' : 'none';

  if (!data.track) {
    setPlayerStatus(state.current?.track ? '继续播放中' : '等待中', '');
    if (responseShouldSpeak(data)) {
      playHostSpeech(data, () => {
        if (!isActiveRadioTurn(radioTurn)) return;
        setAvatarState(getContextualAvatarState());
        switchVisualizerTo(state.current?.track ? 'song' : 'off');
      }, { radioTurn });
    }
    return true;
  }

  setPlayerStatus('歌曲就绪', 'playing');
  if (responseShouldSpeak(data)) playHostSpeech(data, () => {
    if (!isActiveRadioTurn(radioTurn)) return;
    startSongPlayback(radioTurn);
  }, { radioTurn });
  else startSongPlayback(radioTurn);
  return true;
}

function rememberCurrentForHistory(nextData = {}) {
  const current = state.current;
  const currentTrackId = current?.track?.id;
  const nextTrackId = nextData?.track?.id;
  if (!currentTrackId || !nextTrackId || currentTrackId === nextTrackId) return;

  const last = state.playbackHistory.at(-1);
  if (last?.track?.id !== currentTrackId) {
    state.playbackHistory.push(clonePlaybackItem(current));
    if (state.playbackHistory.length > 20) state.playbackHistory.shift();
  }
  updatePreviousButtonState();
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
  const hasPrevious = state.playbackHistory.length > 0;
  button.disabled = !hasPrevious;
  const label = hasPrevious ? '上一首' : '没有上一首';
  button.title = label;
  button.setAttribute('aria-label', label);
}

async function previousTrack() {
  const previous = state.playbackHistory.pop();
  updatePreviousButtonState();
  if (!previous?.track) {
    setPlayerStatus('没有上一首', '');
    return;
  }

  const radioTurn = beginRadioTurn();
  primeVoicePlayback();
  stopVisualizer();
  setAvatarState('searching');
  setPlaybackToggleState(false);
  document.querySelector('#host-audio')?.pause();
  const songAudio = document.querySelector('#song-audio');
  if (songAudio) {
    songAudio.pause();
    songAudio.currentTime = 0;
  }
  try {
    await api('/api/player/stop', { method: 'POST', body: {} });
  } catch {
    // Browser playback can still continue even if the external player was not running.
  }

  state.current = previous;
  updatePlayer(previous, false);
  appendChat({ role: 'user', text: '上一首' });
  appendChat({
    role: 'dj',
    text: `回到上一首：《${previous.track.name || '这首歌'}》。`,
    track: previous.track,
    explanation: previous.explanation
  });
  setPlayerStatus('回到上一首', 'playing');
  startSongPlayback(radioTurn);
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
    hostAudio.src = data.ttsUrl;
    hostAudio.onended = finish;
    hostAudio.onplay = () => {
      if (!isActiveRadioTurn(radioTurn)) return;
      setAvatarState('talking');
      switchVisualizerTo('host');
      if (data.track) setPlaybackToggleState(true);
    };
    hostAudio.play().catch((error) => {
      console.warn('[tts skipped]', error?.message || error);
      finishAfterVisualHold();
    });
  } catch (error) {
    console.warn('[tts skipped]', error?.message || error);
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

function buildExplanationHTML(explanation = null) {
  const factors = Array.isArray(explanation?.factors)
    ? explanation.factors.flatMap(normalizeExplanationFactor).filter(Boolean)
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

async function updatePlayer(data, autoplay) {
  const track = data.track || {};
  document.querySelector('#track-title').textContent = track.name || 'myMusic';
  document.querySelector('#track-artist').textContent = (track.artists || []).join(' / ') || '等待启动';
  updateAiMusicDownload(track);
  buildLyricDOM(data.track?.lyric || '', { syncMode: data.track?.lyricSync || 'timed' });

  const songAudio = document.querySelector('#song-audio');
  if (track.playUrl) {
    // Don't reset src if already playing this URL (e.g. navigating back to player page)
    if (songAudio.src !== track.playUrl) {
      songAudio.crossOrigin = 'anonymous';
      songAudio.src = track.playUrl;
    }
    songAudio.style.display = '';
  } else {
    songAudio.style.display = 'none';
  }
  // Reset progress bar for new track
  const fill = document.querySelector('#progress-fill');
  const current = document.querySelector('#progress-current');
  const duration = document.querySelector('#progress-duration');
  if (fill) fill.style.width = '0%';
  if (current) current.textContent = '00:00';
  if (duration) duration.textContent = '00:00';
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

function syncLyricTime(currentTimeSec) {
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

  if (activeIndex === state.activeLyricIndex) return;
  state.activeLyricIndex = activeIndex;

  const viewport = document.querySelector('.lyric-viewport');
  if (!viewport) return;

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
      centerLyricLine(viewport, activeEl);
    }
  }
}

function centerLyricLine(viewport, lineEl) {
  requestAnimationFrame(() => {
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
  });
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

async function startSongPlayback(radioTurn = null) {
  if (!isActiveRadioTurn(radioTurn)) return;
  const track = state.current?.track;
  const songAudio = document.querySelector('#song-audio');

  // If we have a direct URL, play it in browser
  if (track?.playUrl) {
    markPlaybackStarted(track, 'browser');
    setPlayerStatus(`正在播放：${track.name || '未知歌曲'}`, 'playing');
    setAvatarState('listening');
    setPlaybackToggleState(true);
    switchVisualizerTo('song');
    songAudio.play().catch(() => handleBrowserPlaybackIssue(radioTurn, track));
    songAudio.onerror = () => {
      if (!isCurrentPlaybackTurn(radioTurn, track)) return;
      handleBrowserPlaybackIssue(radioTurn, track);
    };
    songAudio.onended = async () => {
      if (!isCurrentPlaybackTurn(radioTurn, track)) return;
      stopVisualizer();
      setAvatarState('searching');
      setPlaybackToggleState(false);
      await reportFeedback('complete');
      if (!isCurrentPlaybackTurn(radioTurn, track)) return;
      nextTrack({ skipCurrent: false });
    };
    songAudio.onplay = () => {
      if (!isCurrentPlaybackTurn(radioTurn, track)) return;
      setAvatarState('listening');
      api('/api/play/report', { method: 'POST', body: { trackId: track.id, playType: 'play' } }).catch(() => {});
    };
    songAudio.ontimeupdate = () => {
      if (!isCurrentPlaybackTurn(radioTurn, track)) return;
      syncLyricTime(songAudio.currentTime);
      updateProgressBar();
    };
    return;
  }

  if (!shouldUseServerPlayerFallback()) {
    handleBrowserPlaybackIssue(radioTurn, track);
    return;
  }

  // Local desktop fallback only: ncm-cli is not available for the public web demo.
  setAvatarState('listening');
  setPlaybackToggleState(true);
  switchVisualizerTo('song');
  playCurrentTrack(radioTurn);
}

function shouldUseServerPlayerFallback() {
  const host = window.location.hostname;
  return !host || host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function handleBrowserPlaybackIssue(radioTurn, track) {
  if (!isCurrentPlaybackTurn(radioTurn, track)) return;
  if (shouldUseServerPlayerFallback()) {
    playCurrentTrack(radioTurn);
    return;
  }
  stopVisualizer();
  setPlaybackToggleState(false);
  setAvatarState('searching');
  setPlayerStatus('这首暂时无法在网页播放，正在换下一首', '');
  setTimeout(() => {
    if (!isCurrentPlaybackTurn(radioTurn, track)) return;
    nextTrack({ skipCurrent: true, silent: true });
  }, 420);
}

function markPlaybackStarted(track, source) {
  if (!track?.id) return;
  state.activePlayback = {
    trackId: track.id,
    source,
    startedAt: Date.now(),
    durationMs: Number(track.durationMs) || 0,
    completed: false
  };
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

  try {
    const result = await api('/api/feedback', {
      method: 'POST',
      body: {
        trackId: track.id,
        eventType,
        sessionId: state.sessionId,
        elapsedMs,
        durationMs: track.durationMs || playback?.durationMs || 0,
        source: playback?.source || 'ui'
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
  refreshMixerUsagePanels();
}

async function refreshUsageInsights() {
  if (location.pathname !== '/mixer') return;
  try {
    const [prefData, memoryData] = await Promise.all([
      api('/api/preferences'),
      api('/api/memories').catch(() => ({ memories: state.memories || [] }))
    ]);
    state.feedbackSummary = prefData.feedbackSummary || state.feedbackSummary || {};
    state.preferences = prefData.preferences || state.preferences;
    state.memories = memoryData.memories || state.memories || [];
    refreshMixerUsagePanels();
  } catch {
    // Usage panels should not interrupt playback or chat.
  }
}

function scheduleUsageInsightsRefresh(delayMs = 2200) {
  if (location.pathname !== '/mixer') return;
  setTimeout(() => refreshUsageInsights(), delayMs);
}

function startMixerUsageAutoRefresh() {
  if (state.mixerRefreshTimer) clearInterval(state.mixerRefreshTimer);
  state.mixerRefreshTimer = setInterval(() => {
    if (location.pathname !== '/mixer') {
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

  if (feedback && feedbackMeterEl) feedbackMeterEl.innerHTML = feedbackMeter(feedback);
  if (feedback && feedbackTracksEl) feedbackTracksEl.innerHTML = feedbackTracks(feedback);
  if (memoryListEl) memoryListEl.innerHTML = memories.length
    ? memories.slice(0, 8).map(memorySummaryItem).join('')
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
  const fill = document.querySelector('#progress-fill');
  const current = document.querySelector('#progress-current');
  const duration = document.querySelector('#progress-duration');
  if (!songAudio || !fill || !current || !duration) return;

  const dur = songAudio.duration;
  const cur = songAudio.currentTime;

  if (dur && !isNaN(dur)) {
    const pct = Math.min((cur / dur) * 100, 100);
    fill.style.width = pct + '%';
    duration.textContent = formatTime(dur);
  } else {
    fill.style.width = '0%';
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

function initProgressBar() {
  const bar = document.querySelector('#progress-bar');
  if (!bar) return;
  bar.addEventListener('click', (e) => {
    const songAudio = document.querySelector('#song-audio');
    if (!songAudio?.duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const targetTime = pct * songAudio.duration;
    // Animate seek with anime.js
    const fill = document.querySelector('#progress-fill');
    animate(fill, {
      width: (pct * 100) + '%',
      duration: 150,
      easing: 'easeOutQuad',
    });
    songAudio.currentTime = targetTime;
  });
}

async function playCurrentTrack(radioTurn = null) {
  const track = state.current?.track;
  if (!isCurrentPlaybackTurn(radioTurn, track)) return;
  if (!track?.id) {
    setPlayerStatus('没有可播放的歌曲', 'error');
    return;
  }
  setPlayerStatus(`正在调用 ncm-cli 播放：${track.name || track.id}`, 'playing');
  try {
    const result = await api('/api/player/play', { method: 'POST', body: { trackId: track.id, maxSkips: 0 }, signal: radioTurnSignal(radioTurn) });
    if (!isCurrentPlaybackTurn(radioTurn, track)) return;
    if (result.track && result.track.id !== track.id) {
      throw new Error(`播放器返回了另一首歌：${result.track.name || result.track.id}`);
    }
    markPlaybackStarted(track, 'ncm-cli');
    setAvatarState('listening');
    setPlaybackToggleState(true);
    setPlayerStatus(`正在播放：${track.name}`, 'playing');
    api('/api/play/report', { method: 'POST', body: { trackId: track.id, playType: 'play' } }).catch(() => {});
  } catch (error) {
    if (isInterruptedRadioTurn(radioTurn, error) || !isCurrentPlaybackTurn(radioTurn, track)) return;
    setPlaybackToggleState(false);
    setPlayerStatus(formatPlaybackErrorMessage(error), 'error');
  }
}

async function pausePlayback() {
  stopVisualizer();
  setAvatarState('idle');
  setPlaybackToggleState(false);
  document.querySelector('#host-audio')?.pause();
  document.querySelector('#song-audio')?.pause();
  window.speechSynthesis?.cancel?.();
  try {
    await api('/api/player/pause', { method: 'POST', body: {} });
  } catch {}
  setPlayerStatus('已暂停', '');
}

async function resumePlayback() {
  const songAudio = document.querySelector('#song-audio');
  if (songAudio?.src) {
    setAvatarState('listening');
    setPlaybackToggleState(true);
    switchVisualizerTo('song');
    songAudio.play().catch(() => {});
    setPlayerStatus('继续播放', 'playing');
    return;
  }
  try {
    await api('/api/player/resume', { method: 'POST', body: {} });
    setAvatarState('listening');
    setPlaybackToggleState(true);
    setPlayerStatus('继续播放', 'playing');
  } catch (error) {
    setPlayerStatus(formatPlaybackErrorMessage(error), 'error');
  }
}

async function stopPlayback() {
  stopVisualizer();
  setAvatarState('idle');
  setPlaybackToggleState(false);
  document.querySelector('#host-audio')?.pause();
  const songAudio = document.querySelector('#song-audio');
  songAudio?.pause();
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
      <p class="muted">长期画像只基于当前网易云账号同步的歌单，不使用电台推荐、在线搜索、播放记录或最近播放。</p>
      <p class="reason" style="white-space: pre-wrap; line-height: 1.85">${escapeHtml(data.profile.summary)}</p>
      <div class="tags">${(data.profile.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
      ${libraryAccountNotice(data)}
      <div class="stats">
        <div class="stat"><span class="muted">当前账号歌曲</span><strong>${data.totalTracks || data.tracks.length}</strong></div>
        <div class="stat"><span class="muted">当前账号歌单</span><strong>${data.playlists.length}</strong></div>
        <div class="stat"><span class="muted">最近播放</span><strong>${data.recent.length}</strong></div>
      </div>
      <div class="library-actions">
        <button id="sync-btn" class="primary" ${isDemoGuestLibrary ? 'disabled' : ''}>同步网易云音乐</button>
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
    if (status) status.textContent = '正在同步网易云歌单...';
    try {
      const result = await api('/api/library/sync', { method: 'POST', body: {} });
      state.profileSelectionDirty = false;
      state.librarySyncNotice = librarySyncNotice(result);
      renderLibrary();
    } catch (error) {
      btn.disabled = false;
      btn.textContent = '同步网易云音乐';
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
  if (status) status.textContent = '正在启动网易云同步任务...';
  try {
    const syncStatus = await api('/api/library/sync', { method: 'POST', body: {} });
    updateLibrarySyncUI(syncStatus);
    startLibrarySyncPolling();
  } catch (error) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '同步网易云音乐';
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
    btn.textContent = syncStatus.status === 'running' ? '同步中...' : '同步网易云音乐';
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
  if (syncStatus.phase === 'checking_login') return '正在校验网易云登录状态...';
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
  return `正在通过${source}同步网易云音乐...`;
}

function librarySyncSourceLabel(source) {
  if (source === 'cookie') return '网易云扫码登录';
  if (source === 'openapi') return 'OpenAPI';
  if (source === 'demo') return 'Demo';
  return '网易云';
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
      当前登录账号 ${escapeHtml(account.nickname || account.userId || '网易云用户')} 尚未完成歌单同步，请重新同步网易云音乐。
    </div>
  `;
}

function neteaseAccountCard(status = {}, label = '网易云') {
  const readable = Boolean(status.profileReadable);
  const title = readable
    ? `${label}已登录：${status.nickname || '网易云用户'}`
    : ((status.hasCookie || status.hasToken) ? `${label}登录状态异常` : `${label}尚未登录`);
  const detail = readable
    ? `userId: ${status.userId}`
    : (status.message || '请使用网易云音乐 App 扫码登录');
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
  const name = readable ? (status.nickname || '网易云用户') : '网易云音乐';
  const detail = readable ? `userId ${status.userId}` : (status.message || '尚未扫码登录网易云');
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

async function renderMixer() {
  const [prefData, memoryData] = await Promise.all([
    api('/api/preferences'),
    api('/api/memories').catch(() => ({ memories: [] }))
  ]);
  const preferences = prefData.preferences || {};
  state.preferences = preferences;
  const feedback = prefData.feedbackSummary || {};
  const memories = (memoryData.memories || []).slice(0, 8);
  state.feedbackSummary = feedback;
  state.memories = memories;

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
          <p id="mixer-save-status" class="muted">SIGNAL LOCKED</p>
        </div>
      </div>
    </section>
    <section class="mixer-console">
      <div class="mixer-rack">
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
        <article class="mixer-meter-panel">
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
        <article class="mixer-memory-panel">
          <div class="panel-header">
            <div>
              <p class="eyebrow">Memory</p>
              <h2>长期记忆摘要</h2>
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
  startMixerUsageAutoRefresh();
}

async function renderSettings() {
  const [status, cookieLogin, neteaseLogin, memoryData] = await Promise.all([
    api('/api/config/status'),
    api('/api/auth/netease-cookie/status').catch(() => ({ configured: true, hasCookie: false, profileReadable: false, source: 'cookie', message: '试用版登录状态读取失败' })),
    api('/api/auth/netease/token-status').catch(() => ({ configured: false, hasToken: false, profileReadable: false, message: '登录状态读取失败' })),
    api('/api/memories').catch(() => ({ memories: [] }))
  ]);
  const memories = memoryData.memories || [];
  const demoGuestMode = Boolean(status.demo?.guestMode);
  view.innerHTML = `
    <section class="page-panel">
      <p class="eyebrow">Settings</p>
      <h1 class="page-title">本地配置</h1>
      <table class="settings-table">
        ${statusRow('LLM', status.llm.configured, status.llm.model)}
        ${statusRow('TTS', status.tts.configured, status.tts.provider)}
        ${statusRow('天气城市', status.weather.configured, status.weather.city)}
      </table>
      <div class="netease-login-console trial-login-console ${cookieLogin.profileReadable ? 'is-online' : 'is-offline'}">
        <div class="trial-login-main">
          <div class="trial-login-title-row">
            <div>
              <p class="eyebrow">Trial Login</p>
              <h2>网易云音乐账号</h2>
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
          <button id="cookie-qr-btn" class="trial-login-primary" ${demoGuestMode ? 'disabled' : ''}>扫码登录网易云</button>
          <button id="cookie-logout-btn" class="ghost trial-login-secondary" ${cookieLogin.hasCookie && !demoGuestMode ? '' : 'disabled'}>退出登录</button>
          <p id="cookie-qr-status" class="muted"></p>
        </div>
      </div>
    </section>
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
      <p class="muted">演示前检查 LLM、TTS、网易云登录、歌单同步和当前播放源。</p>
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
        <button id="clear-memories-btn" class="ghost danger" ${memories.length ? '' : 'disabled'}>清空全部</button>
      </div>
      <p class="muted">长期记忆会影响灿灿后续聊天和推荐。当前共有 ${memories.length} 条；清空后不会删除聊天记录或曲库。</p>
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
        <p class="developer-login-note">这里只给开发者调试 OpenAPI 使用。朋友试用和比赛演示请使用页面上方的“扫码登录网易云”，不要扫描这里的二维码。</p>
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
    if (statusEl) statusEl.textContent = '正在退出网易云登录...';
    await api('/api/auth/netease-cookie/logout', { method: 'POST', body: {} });
    renderSettings();
  });
  document.querySelector('#qr-btn')?.addEventListener('click', () => startQrLogin());
  document.querySelector('#demo-self-check-btn')?.addEventListener('click', () => runDemoSelfCheck());
  document.querySelector('#radio-debug-refresh')?.addEventListener('click', () => refreshRadioDebugPanel());
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
    renderSettings();
  });
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
        <span>这会实际测试模型、语音、网易云登录和播放源。</span>
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
    statusEl.textContent = '请用网易云音乐 App 扫码';
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
    statusEl.textContent = '请用网易云音乐 App 扫码';
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
          const nickname = res.nickname || data.nickname || '网易云用户';
          const userId = res.userId || data.userId || '';
          statusEl.textContent = (res.autoSyncStarted || data.autoSyncStarted)
            ? `扫码成功：${nickname}${userId ? ` (${userId})` : ''}，账号已切换，正在自动同步歌单...`
            : `扫码成功，已保存登录信息：${nickname}${userId ? ` (${userId})` : ''}`;
          if (res.syncStatus || data.syncStatus) {
            state.librarySyncStatus = res.syncStatus || data.syncStatus;
            state.librarySyncNotice = '账号已切换，正在自动同步网易云歌单...';
            startLibrarySyncPolling();
          }
          const img = document.querySelector('#cookie-qr-img');
          if (img) img.style.display = 'none';
          setTimeout(() => renderSettings(), 600);
          return;
        }
        statusEl.textContent = res.loginMessage || data.loginMessage || '授权已确认，但没有拿到网易云登录 cookie，请重新扫码';
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
          const nickname = res.nickname || data.nickname || '网易云用户';
          const userId = res.userId || data.userId || '';
          statusEl.textContent = `扫码成功，已登录：${nickname}${userId ? ` (${userId})` : ''}`;
          document.querySelector('#qr-img').style.display = 'none';
          setTimeout(() => renderSettings(), 600);
          return;
          statusEl.textContent = '扫码成功！已保存登录信息。';
          document.querySelector('#qr-img').style.display = 'none';
        } else {
          statusEl.textContent = res.loginMessage || data.loginMessage || '授权已确认，但无法读取网易云账号信息，请重新扫码';
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
            <p class="muted">当前网易云账号尚未同步歌单。同步完成后，可以选择哪些歌单参与长期音乐画像。</p>
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
    return `歌单 ID ${legacyPlaylistMatch[1]} 同步失败：网易云接口没有返回明确原因，可能是歌单权限限制、歌单不可访问或接口临时失败`;
  }
  return text
    .replace(/^playlist\s+([^:：]+)\s*[:：]\s*/i, '歌单 ID $1 同步失败：')
    .replace(/[:：]\s*(undefined|null)$/i, '：网易云接口没有返回明确原因，可能是歌单权限限制、歌单不可访问或接口临时失败');
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
    if (summaryEl) summaryEl.textContent = mixerModeSummary(preferences);
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
      refresh();
      setMixerStatus('已保存到灿灿的运行参数', 'ok');
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
      const value = button.dataset.prefValue;
      if (!key || !value || preferences[key] === value) return;
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
  return [
    activeMixerLabel('chatMusicBalance', preferences.chatMusicBalance),
    activeMixerLabel('recommendationFrequency', preferences.recommendationFrequency),
    activeMixerLabel('voiceMode', preferences.voiceMode),
    activeMixerLabel('moodMode', preferences.moodMode)
  ].join(' / ');
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
    <article class="memory-item compact">
      <div class="memory-main">
        <div class="memory-meta">
          <span class="tag">${escapeHtml(memoryKindLabel(memory.kind))}</span>
          <span class="muted">置信 ${confidence}%</span>
        </div>
        <p>${escapeHtml(memory.content || '')}</p>
      </div>
    </article>
  `;
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
        return state.preferences;
      })
      .finally(() => { preferencesLoadPromise = null; });
  }
  return preferencesLoadPromise;
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
