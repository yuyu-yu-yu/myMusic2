import { animate } from '/vendor/anime.esm.min.js';

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
  profileSelectionDirty: false,
  librarySyncNotice: '',
  radioPrefetchPromise: null
};

// Module-level mutable state — MUST be declared before render() call at line ~30
let statusLocked = false;
let btnFeedbackReady = false;
let loadingMsgIndex = 0;
let loadingMsgTimer = null;
let loadingMessageEl = null;
let savedChatHTML = '';
let avatarRestoreTimer = null;
let preferencesLoadPromise = null;

const avatarMotionMap = {
  idle: '/avatar/webm/idle.webm',
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

function initVisualizer() {
  const fallback = document.querySelector('#equalizer-fallback');
  if (!fallback) return;
  for (let i = 0; i < 20; i++) {
    const bar = document.createElement('span');
    bar.className = 'bar';
    bar.style.animationDelay = (i * 0.07) + 's';
    bar.style.animationDuration = (0.5 + Math.random() * 0.8) + 's';
    fallback.appendChild(bar);
  }
}

function buildAudioGraph() {
  if (visualizerBuilt) return;
  const hostAudio = document.querySelector('#host-audio');
  const songAudio = document.querySelector('#song-audio');
  if (!hostAudio || !songAudio) return;
  try {
    hostAudio.crossOrigin = 'anonymous';
    songAudio.crossOrigin = 'anonymous';
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sourceCache.set(hostAudio, audioCtx.createMediaElementSource(hostAudio));
    sourceCache.set(songAudio, audioCtx.createMediaElementSource(songAudio));
    visualizerBuilt = true;
    console.log('[viz] graph built, sources cached:', sourceCache.size);
  } catch(e) {
    console.warn('[viz] Web Audio not available:', e.message);
    visualizerBuilt = false;
  }
}

function switchVisualizerTo(kind) {
  console.log('[viz] switchVisualizerTo(' + kind + ') built:', visualizerBuilt);
  if (!visualizerBuilt) {
    const canvas = document.querySelector('#visualizer-canvas');
    const fb = document.querySelector('#equalizer-fallback');
    if (kind === 'off') {
      if (canvas) canvas.style.display = 'none';
      if (fb) fb.style.display = 'none';
    } else {
      if (canvas) canvas.style.display = 'none';
      if (fb) fb.style.display = 'flex';
    }
    return;
  }

  if (audioCtx.state === 'suspended') audioCtx.resume();

  for (const src of sourceCache.values()) {
    try { src.disconnect(); } catch {}
  }
  if (analyser) { try { analyser.disconnect(); } catch {} analyser = null; }

  if (kind === 'off') {
    stopDrawLoop();
    const canvas = document.querySelector('#visualizer-canvas');
    const fb = document.querySelector('#equalizer-fallback');
    if (canvas) { canvas.style.display = 'none'; canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); }
    if (fb) fb.style.display = 'none';
    return;
  }

  const audioEl = kind === 'host'
    ? document.querySelector('#host-audio')
    : document.querySelector('#song-audio');
  const source = sourceCache.get(audioEl);
  console.log('[viz] source for ' + kind + ':', !!source, 'el src:', (audioEl?.src || '').slice(-40));
  if (!source) return;

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 64;
  analyser.smoothingTimeConstant = 0.7;
  source.connect(analyser);
  analyser.connect(audioCtx.destination);

  const canvas = document.querySelector('#visualizer-canvas');
  const fb = document.querySelector('#equalizer-fallback');
  if (canvas) canvas.style.display = 'block';
  if (fb) fb.style.display = 'none';

  stopDrawLoop();
  startDrawLoop(canvas);
}

let _drawFrameCount = 0;
let _drawLogged = false;

function startDrawLoop(canvas) {
  if (visualizerAnimId || !canvas) return;
  console.log('[viz] startDrawLoop, analyser:', !!analyser, 'built:', visualizerBuilt);
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
    if (!_drawLogged && _drawFrameCount % 30 === 0) {
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
  return avatarMotionMap[normalized] ? normalized : 'idle';
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

  const video = document.querySelector('#avatar-video');
  const image = document.querySelector('#avatar-image');
  const src = avatarMotionMap[normalized];

  if (image) image.src = '/avatar/source/cancan.png';
  if (video && src) {
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
    } else {
      if (video.readyState >= 2) {
        root.classList.remove('is-fallback');
        video.hidden = false;
        if (image) image.hidden = true;
        video.play().catch(() => {});
      }
    }
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
  const nextBtn = document.querySelector('#next-btn');
  const playToggleBtn = document.querySelector('#play-toggle-btn');
  const chatForm = document.querySelector('#chat-form');
  const modeResetBtn = document.querySelector('#mode-reset-btn');
  const { likeBtn, dislikeBtn } = ensureFeedbackButtons();

  startBtn.addEventListener('click', () => {
    api('/api/player/stop', { method: 'POST', body: {} }).catch(() => {});
    startRadio();
  });
  nextBtn.addEventListener('click', () => nextTrack({ skipCurrent: true }));
  playToggleBtn?.addEventListener('click', () => {
    if (playToggleBtn.classList.contains('is-playing')) pausePlayback();
    else resumePlayback();
  });
  modeResetBtn.addEventListener('click', () => resetMode());
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
  setAvatarState(state.avatarState || getContextualAvatarState());
  setRadioButtonState(state.sessionId || state.current?.track ? 'active' : 'idle');
  startPlayerPolling();
  initButtonFeedback();
  initVisualizer();
  initProgressBar();
  scheduleRadioPrefetch();
  // Build audio graph on first user gesture (start button click)
  document.querySelector('#start-btn').addEventListener('click', () => {
    if (!visualizerBuilt) buildAudioGraph();
  }, { once: true });
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

const chatLoadingMessages = [
  '灿灿正在回复...',
  '灿灿正在读你的消息...',
  '灿灿正在想怎么跟你说...',
];

function startLoadingMessages(kind = 'music') {
  const messages = kind === 'chat' ? chatLoadingMessages : loadingMessages;
  loadingMsgIndex = 0;
  statusLocked = true;
  setAvatarState(kind === 'chat' ? 'reading' : 'searching');
  if (loadingMessageEl?.isConnected) loadingMessageEl.remove();
  loadingMessageEl = appendChat({ role: 'dj', loading: true });
  showLoadingMessage(messages);
  loadingMsgTimer = setInterval(() => {
    loadingMsgIndex = (loadingMsgIndex + 1) % messages.length;
    showLoadingMessage(messages);
  }, kind === 'chat' ? 1600 : 2800);
}

function showLoadingMessage(messages = loadingMessages) {
  const el = loadingMessageEl?.isConnected
    ? loadingMessageEl.querySelector('[data-loading-text]')
    : null;
  if (!el) return;
  const msg = messages[loadingMsgIndex] || messages[0] || '';
  el.innerHTML = `
    <span class="glitch-text" data-text="${escapeAttr(msg)}">${escapeHtml(msg)}</span>
    <span class="loading-dots">
      <span></span><span></span><span></span>
    </span>
  `;
  el.style.color = 'var(--cyan)';
}

function stopLoadingMessages({ remove = false } = {}) {
  statusLocked = false;
  if (loadingMsgTimer) { clearInterval(loadingMsgTimer); loadingMsgTimer = null; }
  if (remove && loadingMessageEl?.isConnected) loadingMessageEl.remove();
  if (remove || !loadingMessageEl?.isConnected) loadingMessageEl = null;
}

function replaceLoadingMessage({ text, track }) {
  if (!loadingMessageEl?.isConnected) {
    return appendChat({ role: 'dj', text, track });
  }
  renderChatMessageContent(loadingMessageEl, { text, track });
  loadingMessageEl.classList.remove('loading-msg');
  loadingMessageEl.removeAttribute('aria-live');
  loadingMessageEl = null;
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

function scheduleRadioPrefetch({ force = false } = {}) {
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
  primeVoicePlayback();
  const sessionId = ensureSessionId();
  setAvatarState('on_air');
  setRadioButtonState('loading');
  appendChat({ role: 'user', text: '启动电台' });
  startLoadingMessages();
  try {
    await loadPreferences().catch(() => null);
    const data = await api('/api/radio/start', { method: 'POST', body: { sessionId } });
    handleRadioResponse(data);
  } catch (e) {
    stopLoadingMessages();
    replaceLoadingMessage({ text: '启动电台时出了一点问题：' + e.message });
    setAvatarState('idle');
    setRadioButtonState(state.current?.track ? 'active' : 'idle');
    setPlayerStatus(e.message, 'error');
  }
}

async function nextTrack({ skipCurrent = true } = {}) {
  primeVoicePlayback();
  const sessionId = ensureSessionId();
  setAvatarState('searching');
  setPlaybackToggleState(false);
  if (skipCurrent) await reportFeedback('skip');
  appendChat({ role: 'user', text: '下一首' });
  startLoadingMessages();
  try {
    await loadPreferences().catch(() => null);
    const data = await api('/api/radio/next', { method: 'POST', body: { sessionId } });
    handleRadioResponse(data);
  } catch (e) {
    stopLoadingMessages();
    replaceLoadingMessage({ text: '抱歉，刚才找歌时出了一点问题：' + e.message });
    setAvatarState(getContextualAvatarState());
    setPlayerStatus(e.message, 'error');
  }
}

async function sendChat(msg) {
  primeVoicePlayback();
  const sessionId = ensureSessionId();
  appendChat({ role: 'user', text: msg });
  startLoadingMessages('chat');
  try {
    await loadPreferences().catch(() => null);
    const data = await api('/api/radio/chat', { method: 'POST', body: { sessionId, message: msg } });
    handleRadioResponse(data);
  } catch (e) {
    stopLoadingMessages();
    setAvatarState(getContextualAvatarState());
    replaceLoadingMessage({ text: '抱歉，出了一点问题：' + e.message });
  }
}

async function resetMode() {
  await api('/api/radio/chat', { method: 'POST', body: { sessionId: state.sessionId, message: '恢复正常推荐，取消所有偏好模式' } });
  document.querySelector('#mode-reset-btn').style.display = 'none';
  appendChat({ role: 'dj', text: '好的，恢复正常推荐模式。' });
}

function handleRadioResponse(data) {
  stopLoadingMessages();
  state.sessionId = data.sessionId || state.sessionId;
  setRadioButtonState(state.sessionId || data.track || state.current?.track ? 'active' : 'idle');
  if (data.track) {
    stopVisualizer();
    state.current = data;
    updatePlayer(data, false);
  }

  replaceLoadingMessage({
    text: data.chatText || data.hostText || '',
    track: data.track
  });
  scheduleUsageInsightsRefresh(data.track ? 800 : 3200);

  // Show/hide mode reset button
  const hasMode = data.mode?.genre;
  document.querySelector('#mode-reset-btn').style.display = hasMode ? '' : 'none';

  if (!data.track) {
    setPlayerStatus(state.current?.track ? '继续播放中' : '等待中', '');
    if (responseShouldSpeak(data)) {
      playHostSpeech(data, () => {
        setAvatarState(getContextualAvatarState());
        switchVisualizerTo(state.current?.track ? 'song' : 'off');
      });
    }
    return;
  }

  setPlayerStatus('歌曲就绪', 'playing');
  if (responseShouldSpeak(data)) playHostSpeech(data, () => startSongPlayback());
  else startSongPlayback();
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

function playHostSpeech(data, onEnd) {
  const text = data.chatText || data.hostText || '';
  const hostAudio = document.querySelector('#host-audio');
  if (!responseShouldSpeak(data) || !text) {
    if (hostAudio) hostAudio.src = '';
    onEnd?.();
    return;
  }

  const finish = () => {
    if (hostAudio) {
      hostAudio.onended = null;
      hostAudio.onplay = null;
    }
    onEnd?.();
  };

  setAvatarState('talking');
  switchVisualizerTo('host');
  if (data.track) setPlaybackToggleState(true);

  try {
    if (data.ttsUrl && hostAudio) {
      hostAudio.muted = false;
      hostAudio.src = data.ttsUrl;
      hostAudio.onended = finish;
      hostAudio.onplay = () => {
        setAvatarState('talking');
        switchVisualizerTo('host');
        if (data.track) setPlaybackToggleState(true);
      };
      hostAudio.play().catch((error) => {
        console.warn('[tts play fallback]', error?.message || error);
        speakText(text, finish);
      });
    } else {
      if (hostAudio) hostAudio.src = '';
      speakText(text, finish);
    }
  } catch {
    speakText(text, finish);
  }
}

function primeVoicePlayback() {
  const hostAudio = document.querySelector('#host-audio');
  if (!hostAudio || hostAudio.dataset.voicePrimed === 'true') {
    primeSpeechSynthesis();
    return;
  }
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
  primeSpeechSynthesis();
}

function primeSpeechSynthesis() {
  if (!('speechSynthesis' in window) || window.__speechSynthesisPrimed) return;
  try {
    const utterance = new SpeechSynthesisUtterance(' ');
    utterance.volume = 0;
    utterance.rate = 1;
    speechSynthesis.speak(utterance);
    window.__speechSynthesisPrimed = true;
  } catch {}
}

function appendChat({ role, text, track, loading = false }) {
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
    renderChatMessageContent(el, { text, track });
  }
  scrollChatToBottom();
  return el;
}

function renderChatMessageContent(el, { text, track }) {
  if (!el) return;
  let html = '';
  if (text) html += `<p>${escapeHtml(text)}</p>`;
  if (track?.name) html += buildTrackCardHTML(track);
  el.innerHTML = html;
}

function buildTrackCardHTML(track) {
  return `<div class="track-card" onclick="document.querySelector('#song-audio')?.play()">
    <img src="${escapeAttr(track.coverUrl || '/assets/cover-1.svg')}" alt="" />
    <div class="track-card-text">
      <h4>${escapeHtml(track.name)}</h4>
      <p>${escapeHtml((track.artists || []).join(' / '))}</p>
    </div>
  </div>`;
}

function scrollChatToBottom() {
  const container = document.querySelector('#chat-messages');
  if (container) container.scrollTop = container.scrollHeight;
}

async function updatePlayer(data, autoplay) {
  const track = data.track || {};
  document.querySelector('#track-title').textContent = track.name || 'myMusic';
  document.querySelector('#track-artist').textContent = (track.artists || []).join(' / ') || '等待启动';
  buildLyricDOM(data.track?.lyric || '');

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

function buildLyricDOM(lrcText) {
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

  if (!lines.length) {
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
      activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}

async function startSongPlayback() {
  const track = state.current?.track;
  const songAudio = document.querySelector('#song-audio');

  // If we have a direct URL, play it in browser
  if (track?.playUrl) {
    markPlaybackStarted(track, 'browser');
    setPlayerStatus(`正在播放：${track.name || '未知歌曲'}`, 'playing');
    setAvatarState('listening');
    setPlaybackToggleState(true);
    switchVisualizerTo('song');
    songAudio.play().catch(() => playCurrentTrack());
    songAudio.onerror = () => playCurrentTrack();
    songAudio.onended = async () => {
      stopVisualizer();
      setAvatarState('searching');
      setPlaybackToggleState(false);
      await reportFeedback('complete');
      nextTrack({ skipCurrent: false });
    };
    songAudio.onplay = () => {
      setAvatarState('listening');
      api('/api/play/report', { method: 'POST', body: { trackId: track.id, playType: 'play' } }).catch(() => {});
    };
    songAudio.ontimeupdate = () => { syncLyricTime(songAudio.currentTime); updateProgressBar(); };
    return;
  }

  // No direct URL, try ncm-cli via server
  setAvatarState('listening');
  setPlaybackToggleState(true);
  switchVisualizerTo('song');
  playCurrentTrack();
}

function speakText(text, onEnd) {
  if (!text || !('speechSynthesis' in window)) {
    onEnd?.();
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 0.96;
  utterance.onend = () => onEnd?.();
  speechSynthesis.speak(utterance);
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

async function playCurrentTrack() {
  const track = state.current?.track;
  if (!track?.id) {
    setPlayerStatus('没有可播放的歌曲', 'error');
    return;
  }
  setPlayerStatus(`正在调用 ncm-cli 播放：${track.name || track.id}`, 'playing');
  try {
    const result = await api('/api/player/play', { method: 'POST', body: { trackId: track.id, maxSkips: 0 } });
    if (result.track && result.track.id !== track.id) {
      throw new Error(`播放器返回了另一首歌：${result.track.name || result.track.id}`);
    }
    markPlaybackStarted(track, 'ncm-cli');
    setAvatarState('listening');
    setPlaybackToggleState(true);
    setPlayerStatus(`正在播放：${track.name}`, 'playing');
    api('/api/play/report', { method: 'POST', body: { trackId: track.id, playType: 'play' } }).catch(() => {});
  } catch (error) {
    setPlaybackToggleState(false);
    setPlayerStatus(error.message, 'error');
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
    setPlayerStatus(error.message, 'error');
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
      <p class="muted">长期画像只基于用户主动同步的网易云歌单，不使用电台推荐、在线搜索、播放记录或最近播放。</p>
      <p class="reason" style="white-space: pre-wrap; line-height: 1.85">${escapeHtml(data.profile.summary)}</p>
      <div class="tags">${(data.profile.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
      <div class="stats">
        <div class="stat"><span class="muted">歌曲</span><strong>${data.totalTracks || data.tracks.length}</strong></div>
        <div class="stat"><span class="muted">歌单</span><strong>${data.playlists.length}</strong></div>
        <div class="stat"><span class="muted">最近播放</span><strong>${data.recent.length}</strong></div>
      </div>
      <div class="library-actions">
        <button id="sync-btn" class="primary">同步网易云音乐</button>
        <button id="profile-update-btn" class="ghost profile-update-btn">更新音乐画像</button>
        <span id="library-selection-status" class="muted">${escapeHtml(state.librarySyncNotice || '')}</span>
      </div>
      ${profilePlaylistSelector(data)}
    </section>
    <section class="grid" style="margin-top:16px">
      ${data.tracks.slice(0, 50).map(trackItem).join('')}
    </section>
  `;
  document.querySelector('#sync-btn').addEventListener('click', async () => {
    const btn = document.querySelector('#sync-btn');
    const status = document.querySelector('#library-selection-status');
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
  const [status, memoryData] = await Promise.all([
    api('/api/config/status'),
    api('/api/memories').catch(() => ({ memories: [] }))
  ]);
  const memories = memoryData.memories || [];
  view.innerHTML = `
    <section class="page-panel">
      <p class="eyebrow">Settings</p>
      <h1 class="page-title">本地配置</h1>
      <table class="settings-table">
        ${statusRow('网易云 appId', status.netease.appId)}
        ${statusRow('网易云 RSA 私钥', status.netease.privateKey)}
        ${statusRow('网易云 登录状态', status.neteaseToken)}
        ${statusRow('LLM', status.llm.configured, status.llm.model)}
        ${statusRow('TTS', status.tts.configured, status.tts.provider)}
        ${statusRow('天气城市', status.weather.configured, status.weather.city)}
      </table>
      <p class="muted">真实密钥只读取本地 .env.local，前端不会接收密钥内容。</p>
      <div class="netease-login">
        <button id="qr-btn">扫码登录网易云</button>
        <button id="qr-refresh-btn" class="ghost">刷新 token</button>
        <p id="qr-status"></p>
        <img id="qr-img" class="qr-img" src="" alt="登录二维码" style="display:none" />
      </div>
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
  `;
  document.querySelector('#qr-btn').addEventListener('click', () => startQrLogin());
  document.querySelector('#qr-refresh-btn').addEventListener('click', async () => {
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

async function pollQrStatus(key, statusEl) {
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    try {
      const res = await api('/api/auth/netease/qrcode/check', { method: 'POST', body: { key } });
      const data = res.data || res;
      const code = data.code || data.status || 0;
      if (code === 803) {
        statusEl.textContent = '扫码成功！已保存登录信息。';
        document.querySelector('#qr-img').style.display = 'none';
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
            <p class="muted">同步网易云后，可以选择哪些歌单参与长期音乐画像。</p>
          </div>
          <span id="library-profile-state" class="profile-state-chip synced">等待歌单</span>
        </div>
      </section>
    `;
  }
  return `
    <section class="profile-playlist-selector">
      <div class="profile-playlist-head">
        <div>
          <h2>画像歌单</h2>
          <p class="muted">已选择 ${selection.selectedCount ?? playlists.filter(p => p.profileSelected).length} / ${selection.totalCount ?? playlists.length} 个歌单，只用勾选的歌单生成音乐画像。</p>
        </div>
        <div class="profile-playlist-badges">
          <span id="library-profile-state" class="profile-state-chip ${stateClass}">${stateText}</span>
          <span class="tag subtle">播放历史不参与</span>
        </div>
      </div>
      <div class="profile-playlist-list">
        ${playlists.map((playlist) => `
          <label class="profile-playlist-row">
            <span class="profile-playlist-info">
              <strong>${escapeHtml(playlist.name)}</strong>
              <span>${escapeHtml(playlistKindLabel(playlist.kind))} · ${escapeHtml(playlistSyncSummary(playlist))}</span>
            </span>
            ${playlist.syncComplete ? '' : '<span class="playlist-sync-chip">未完整</span>'}
            <input
              type="checkbox"
              data-profile-playlist-id="${escapeAttr(playlist.id)}"
              ${playlist.profileSelected ? 'checked' : ''}
              aria-label="是否参与画像：${escapeAttr(playlist.name)}"
            />
          </label>
        `).join('')}
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
  const errors = Array.isArray(result.errors) ? result.errors.filter(Boolean) : [];
  if (errors.length) {
    const firstError = errors[0].replace(/^star: |^subscribed: |^created: |^recent: /, '');
    const label = Number(result.playlists) > 0 ? '同步部分失败' : '同步失败';
    return `${label}：${firstError}${errors.length > 1 ? `（另有 ${errors.length - 1} 个错误）` : ''}`;
  }
  return `同步完成：${Number(result.playlists) || 0} 个歌单，${Number(result.tracks) || 0} 首歌`;
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
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok || data.ok === false || data.__error) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
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
