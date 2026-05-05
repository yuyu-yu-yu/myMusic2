const state = {
  sessionId: null,
  current: null,
  library: null,
  playerPollTimer: null,
  feedbackSent: new Set(),
  activePlayback: null,
  lyricLines: [],
  activeLyricIndex: -1,
  activeRoute: location.pathname
};

let statusLocked = false;
let btnFeedbackReady = false;
let loadingMsgIndex = 0;
let loadingMsgTimer = null;
let savedChatHTML = '';
let cursorReady = false;
let routeReady = false;
let magneticReady = false;
let clockTimer = null;

const view = document.querySelector('#view');
const template = document.querySelector('#player-template');

window.addEventListener('popstate', () => render({ transition: true }));
document.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest('[data-link]') : null;
  if (!link) return;
  event.preventDefault();
  const nextPath = new URL(link.href).pathname;
  if (nextPath === location.pathname) return;
  history.pushState({}, '', link.href);
  render({ transition: true });
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

initCursorSpotlight();

async function render({ transition = false } = {}) {
  const chatEl = document.querySelector('#chat-messages');
  if (chatEl) savedChatHTML = chatEl.innerHTML;
  if (view.__audioCleanup) {
    view.__audioCleanup();
    view.__audioCleanup = null;
  }
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }

  if (location.pathname === '/diary') {
    history.replaceState({}, '', '/tuning');
  }

  setActiveNav();
  if (transition) await runRouteTransition();

  if (location.pathname === '/library') return renderLibrary();
  if (location.pathname === '/tuning') return renderTuning();
  if (location.pathname === '/settings') return renderSettings();
  return renderPlayer();
}

function setActiveNav() {
  document.querySelectorAll('.nav a').forEach((link) => {
    link.classList.toggle('active', new URL(link.href).pathname === location.pathname);
  });
}

async function runRouteTransition() {
  if (routeReady) return;
  routeReady = true;
  document.body.classList.add('route-changing');
  await sleep(260);
  document.body.classList.remove('route-changing');
  setTimeout(() => { routeReady = false; }, 220);
}

function initCursorSpotlight() {
  if (cursorReady || matchMedia('(pointer: coarse)').matches) return;
  cursorReady = true;
  const cursor = document.querySelector('#cursor-spotlight');
  if (!cursor) return;
  window.addEventListener('pointermove', (event) => {
    cursor.style.setProperty('--x', `${event.clientX}px`);
    cursor.style.setProperty('--y', `${event.clientY}px`);
  }, { passive: true });
}

function initMagneticControls(root = document) {
  if (magneticReady) return;
  magneticReady = true;
  document.addEventListener('pointermove', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-magnetic], button, .signal-tile, .archive-track, .control-card') : null;
    if (!target || matchMedia('(pointer: coarse)').matches) return;
    const rect = target.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 10;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 10;
    target.style.setProperty('--mx', `${x}px`);
    target.style.setProperty('--my', `${y}px`);
  }, { passive: true });
  document.addEventListener('pointerout', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-magnetic], button, .signal-tile, .archive-track, .control-card') : null;
    if (!target) return;
    target.style.removeProperty('--mx');
    target.style.removeProperty('--my');
  }, { passive: true });
  root.querySelectorAll('[data-reveal]').forEach((el, index) => {
    el.style.setProperty('--delay', `${index * 70}ms`);
  });
}

// --- Audio visualizer ---
let audioCtx = null;
let analyser = null;
let visualizerAnimId = null;
let visualizerBuilt = false;
let visualizerMode = 'idle';
const sourceCache = new Map();

function initSignalVisualizer() {
  const fallback = document.querySelector('#equalizer-fallback');
  if (fallback && !fallback.children.length) {
    for (let i = 0; i < 28; i += 1) {
      const bar = document.createElement('span');
      bar.className = 'bar';
      bar.style.animationDelay = `${i * 0.045}s`;
      fallback.appendChild(bar);
    }
  }
  const canvas = document.querySelector('#visualizer-canvas');
  if (canvas) {
    canvas.style.display = 'block';
    startDrawLoop(canvas);
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
  } catch (error) {
    console.warn('[viz] Web Audio not available:', error.message);
    visualizerBuilt = false;
  }
}

function switchVisualizerTo(kind) {
  visualizerMode = kind === 'off' ? 'idle' : kind;
  const canvas = document.querySelector('#visualizer-canvas');
  const fallback = document.querySelector('#equalizer-fallback');
  if (canvas) {
    canvas.style.display = 'block';
    startDrawLoop(canvas);
  }
  if (fallback) fallback.style.display = 'none';

  if (!visualizerBuilt || !audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  for (const src of sourceCache.values()) {
    try { src.disconnect(); } catch {}
  }
  if (analyser) {
    try { analyser.disconnect(); } catch {}
    analyser = null;
  }
  if (kind === 'off') return;

  const audioEl = kind === 'host'
    ? document.querySelector('#host-audio')
    : document.querySelector('#song-audio');
  const source = sourceCache.get(audioEl);
  if (!source) return;
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;
  analyser.smoothingTimeConstant = 0.72;
  source.connect(analyser);
  analyser.connect(audioCtx.destination);
}

function startDrawLoop(canvas) {
  if (visualizerAnimId || !canvas) return;
  const ctx = canvas.getContext('2d');
  const dataArray = new Uint8Array(64);
  let tick = 0;

  function frame() {
    visualizerAnimId = requestAnimationFrame(frame);
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(320, Math.floor(rect.width * dpr));
    const height = Math.max(220, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    tick += 1;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#06060e';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1 * dpr;
    const grid = 52 * dpr;
    for (let x = (tick % 52) * dpr; x < width; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();

    if (analyser) analyser.getByteFrequencyData(dataArray);
    const cx = width * 0.56;
    const cy = height * 0.5;
    const base = Math.min(width, height) * 0.18;
    const bars = 48;

    ctx.save();
    ctx.translate(cx, cy);
    for (let i = 0; i < bars; i += 1) {
      const value = analyser ? dataArray[i] / 255 : (0.28 + Math.sin(tick * 0.035 + i * 0.45) * 0.16);
      const angle = (Math.PI * 2 * i) / bars + tick * 0.0018;
      const inner = base + Math.sin(tick * 0.018 + i) * 8 * dpr;
      const outer = inner + (24 + value * 150) * dpr;
      ctx.strokeStyle = i % 5 === 0 ? '#00f0ff' : (i % 3 === 0 ? '#00f0ff' : '#e0e0ff');
      ctx.globalAlpha = analyser ? 0.78 : 0.38;
      ctx.lineWidth = (i % 5 === 0 ? 2 : 1) * dpr;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
    }

    for (let r = 0; r < 4; r += 1) {
      ctx.beginPath();
      ctx.strokeStyle = r === 1 ? '#ff00ff' : '#00f0ff';
      ctx.globalAlpha = 0.14 + r * 0.05;
      ctx.lineWidth = 1 * dpr;
      ctx.arc(0, 0, base + r * 55 * dpr + Math.sin(tick * 0.02 + r) * 10 * dpr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = '#00f0ff';
    ctx.font = `${12 * dpr}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    ctx.fillText(`MODE ${visualizerMode.toUpperCase()} / SIGNAL ${analyser ? 'LOCKED' : 'IDLE'}`, 24 * dpr, height - 28 * dpr);
    ctx.restore();
  }
  visualizerAnimId = requestAnimationFrame(frame);
}

function stopDrawLoop() {
  if (visualizerAnimId) {
    cancelAnimationFrame(visualizerAnimId);
    visualizerAnimId = null;
  }
}

function stopVisualizer() {
  switchVisualizerTo('off');
}

// --- Player route ---
function renderPlayer() {
  view.innerHTML = '';
  view.append(template.content.cloneNode(true));

  const visualSlot = document.querySelector('#signal-visual-slot');
  const audioLayer = document.querySelector('#audio-layer');
  const audioEls = ['#host-audio', '#song-audio', '#visualizer-canvas', '#equalizer-fallback'];
  const savedDisplay = [];
  audioEls.forEach((sel, index) => {
    const el = audioLayer.querySelector(sel) || document.querySelector(sel);
    if (!el) return;
    savedDisplay[index] = el.style.display;
    if (sel === '#visualizer-canvas') el.style.display = 'block';
    if (sel === '#equalizer-fallback') el.style.display = 'none';
    visualSlot.appendChild(el);
  });
  view.__audioCleanup = () => {
    audioEls.forEach((sel, index) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.style.display = savedDisplay[index] || '';
      audioLayer.appendChild(el);
    });
  };

  const startBtn = document.querySelector('#start-btn');
  const nextBtn = document.querySelector('#next-btn');
  const pauseBtn = document.querySelector('#pause-btn');
  const resumeBtn = document.querySelector('#resume-btn');
  const chatForm = document.querySelector('#chat-form');
  const modeResetBtn = document.querySelector('#mode-reset-btn');
  const { likeBtn, dislikeBtn } = ensureFeedbackButtons();

  startBtn.addEventListener('click', () => {
    buildAudioGraph();
    api('/api/player/stop', { method: 'POST', body: {} }).catch(() => {});
    startRadio();
  });
  nextBtn.addEventListener('click', () => nextTrack({ skipCurrent: true }));
  pauseBtn.addEventListener('click', () => pausePlayback());
  resumeBtn.addEventListener('click', () => resumePlayback());
  modeResetBtn.addEventListener('click', () => resetMode());
  likeBtn.addEventListener('click', () => reportFeedback('like'));
  dislikeBtn.addEventListener('click', () => reportFeedback('dislike'));

  chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.querySelector('#chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    sendChat(msg);
  });

  if (savedChatHTML) {
    const chatMessages = document.querySelector('#chat-messages');
    if (chatMessages) chatMessages.innerHTML = savedChatHTML;
    savedChatHTML = '';
  }

  if (state.current) updatePlayer(state.current, false);
  updateClock();
  clockTimer = setInterval(updateClock, 15000);
  startPlayerPolling();
  initButtonFeedback();
  initSignalVisualizer();
  initMagneticControls(view);
  revealCurrentView();
}

function ensureFeedbackButtons() {
  const transport = document.querySelector('.transport-mini');
  let likeBtn = document.querySelector('#like-btn');
  let dislikeBtn = document.querySelector('#dislike-btn');
  if (!likeBtn) {
    likeBtn = document.createElement('button');
    likeBtn.id = 'like-btn';
    likeBtn.type = 'button';
    likeBtn.title = '喜欢';
    likeBtn.textContent = '喜欢';
    transport?.insertBefore(likeBtn, document.querySelector('#next-btn'));
  }
  if (!dislikeBtn) {
    dislikeBtn = document.createElement('button');
    dislikeBtn.id = 'dislike-btn';
    dislikeBtn.type = 'button';
    dislikeBtn.title = '不喜欢';
    dislikeBtn.textContent = '不喜欢';
    transport?.insertBefore(dislikeBtn, document.querySelector('#next-btn'));
  }
  return { likeBtn, dislikeBtn };
}

function initButtonFeedback() {
  if (btnFeedbackReady) return;
  btnFeedbackReady = true;
  document.addEventListener('pointerdown', (event) => {
    const btn = event.target instanceof Element ? event.target.closest('button') : null;
    if (btn) btn.classList.add('btn-pressed');
  });
  document.addEventListener('pointerup', () => {
    document.querySelectorAll('.btn-pressed').forEach((btn) => btn.classList.remove('btn-pressed'));
  });
}

const loadingMessages = [
  '灿灿正在校准私人电台信号',
  '正在翻阅你的音乐画像',
  '正在把此刻的情绪变成候选池',
  '正在等待社区 API 回声',
  '正在筛掉不适合现在的歌',
  '正在调整主持词的温度'
];

function startLoadingMessages() {
  loadingMsgIndex = 0;
  statusLocked = true;
  showLoadingMessage();
  loadingMsgTimer = setInterval(() => {
    loadingMsgIndex = (loadingMsgIndex + 1) % loadingMessages.length;
    showLoadingMessage();
  }, 2400);
}

function showLoadingMessage() {
  const el = document.querySelector('#player-status');
  if (!el) return;
  const msg = loadingMessages[loadingMsgIndex];
  el.innerHTML = `<span class="glitch-text">${escapeHtml(msg)}</span><span class="loading-dots"><span></span><span></span><span></span></span>`;
  el.classList.add('playing');
}

function stopLoadingMessages() {
  statusLocked = false;
  if (loadingMsgTimer) {
    clearInterval(loadingMsgTimer);
    loadingMsgTimer = null;
  }
}

async function startRadio() {
  appendChat({ role: 'user', text: '启动电台' });
  startLoadingMessages();
  try {
    const data = await api('/api/radio/start', { method: 'POST', body: {} });
    handleRadioResponse(data);
  } catch (error) {
    stopLoadingMessages();
    setPlayerStatus(error.message, 'error');
  }
}

async function nextTrack({ skipCurrent = true } = {}) {
  if (skipCurrent) await reportFeedback('skip');
  appendChat({ role: 'user', text: '下一首' });
  startLoadingMessages();
  try {
    const data = await api('/api/radio/next', { method: 'POST', body: { sessionId: state.sessionId } });
    handleRadioResponse(data);
  } catch (error) {
    stopLoadingMessages();
    setPlayerStatus(error.message, 'error');
  }
}

async function sendChat(msg) {
  appendChat({ role: 'user', text: msg });
  startLoadingMessages();
  try {
    const data = await api('/api/radio/chat', { method: 'POST', body: { sessionId: state.sessionId, message: msg } });
    handleRadioResponse(data);
  } catch (error) {
    stopLoadingMessages();
    appendChat({ role: 'dj', text: `抱歉，出了一点问题：${error.message}` });
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
  if (data.track) {
    stopVisualizer();
    state.current = data;
    updatePlayer(data, false);
  }

  appendChat({
    role: 'dj',
    text: data.chatText || data.hostText || '',
    track: data.track
  });

  const modeResetBtn = document.querySelector('#mode-reset-btn');
  if (modeResetBtn) modeResetBtn.style.display = data.mode?.genre ? '' : 'none';

  if (!data.track) {
    setPlayerStatus(state.current?.track ? '继续播放中' : '等待启动', '');
    return;
  }

  const hostAudio = document.querySelector('#host-audio');
  hostAudio.src = data.ttsUrl || '';
  setPlayerStatus('主持信号就绪', 'playing');
  try {
    if (data.ttsUrl) {
      hostAudio.onended = () => startSongPlayback();
      hostAudio.onplay = () => switchVisualizerTo('host');
      hostAudio.play();
    } else {
      switchVisualizerTo('host');
      speakText(data.chatText || data.hostText, () => startSongPlayback());
    }
  } catch {
    switchVisualizerTo('host');
    speakText(data.chatText || data.hostText, () => startSongPlayback());
  }
}

function appendChat({ role, text, track }) {
  if (!text && !track) return;
  const container = document.querySelector('#chat-messages');
  if (!container) return;
  const cls = role === 'user' ? 'user-msg' : 'dj-msg';
  let html = `<div class="chat-msg ${cls}" data-magnetic>`;
  html += `<span class="msg-role">${role === 'user' ? 'YOU' : '灿灿'}</span>`;
  if (text) html += `<p>${escapeHtml(text)}</p>`;
  if (track?.name) {
    html += `<div class="track-card" onclick="document.querySelector('#song-audio')?.play()">
      ${signalTile(track.name)}
      <div class="track-card-text">
        <h4>${escapeHtml(track.name)}</h4>
        <p>${escapeHtml((track.artists || []).join(' / '))}</p>
      </div>
    </div>`;
  }
  html += '</div>';
  container.insertAdjacentHTML('beforeend', html);
  container.scrollTop = container.scrollHeight;
}

async function updatePlayer(data) {
  const track = data.track || {};
  const titleEl = document.querySelector('#track-title');
  const artistEl = document.querySelector('#track-artist');
  const initialEl = document.querySelector('#signal-initial');
  if (titleEl) titleEl.textContent = track.name || 'myMusic';
  if (artistEl) artistEl.textContent = (track.artists || []).join(' / ') || '等待启动';
  if (initialEl) initialEl.textContent = getInitial(track.name || 'M');
  buildLyricDOM(data.track?.lyric || '');

  const songAudio = document.querySelector('#song-audio');
  if (track.playUrl) {
    if (songAudio.src !== track.playUrl) {
      songAudio.crossOrigin = 'anonymous';
      songAudio.src = track.playUrl;
    }
    songAudio.style.display = '';
  } else {
    songAudio.style.display = 'none';
  }
}

function buildLyricDOM(lrcText) {
  const container = document.querySelector('#lyric');
  if (!container) return;
  container.innerHTML = '';
  if (!lrcText) {
    container.innerHTML = '<p class="lyric-empty">暂无歌词，信号保持开放。</p>';
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
    viewport.innerHTML = '<p class="lyric-empty">纯音乐片段。</p>';
  } else {
    lines.forEach((line, index) => {
      const el = document.createElement('p');
      el.className = 'lyric-line';
      el.textContent = line.text;
      el.dataset.index = index;
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
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].time <= currentTimeSec) activeIndex = i;
    else break;
  }
  if (activeIndex === state.activeLyricIndex) return;
  state.activeLyricIndex = activeIndex;
  const viewport = document.querySelector('.lyric-viewport');
  if (!viewport) return;
  viewport.querySelectorAll('.lyric-line').forEach((el, index) => {
    const dist = Math.abs(index - activeIndex);
    el.classList.remove('active', 'near', 'far');
    if (dist === 0) el.classList.add('active');
    else if (dist === 1) el.classList.add('near');
    else if (dist > 2) el.classList.add('far');
  });
  if (activeIndex >= 0) {
    viewport.querySelector(`.lyric-line[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

async function startSongPlayback() {
  const track = state.current?.track;
  const songAudio = document.querySelector('#song-audio');
  if (track?.playUrl) {
    markPlaybackStarted(track, 'browser');
    setPlayerStatus(`正在播放：${track.name || '未知歌曲'}`, 'playing');
    switchVisualizerTo('song');
    songAudio.play().catch(() => {});
    songAudio.onended = async () => {
      stopVisualizer();
      await reportFeedback('complete');
      nextTrack({ skipCurrent: false });
    };
    songAudio.onplay = () => {
      api('/api/play/report', { method: 'POST', body: { trackId: track.id, playType: 'play' } }).catch(() => {});
    };
    songAudio.ontimeupdate = () => syncLyricTime(songAudio.currentTime);
    return;
  }
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
  const dedupeId = eventType === 'complete' || eventType === 'skip'
    ? `${track.id}:${eventType}:${playback?.startedAt || 'manual'}`
    : `${track.id}:${eventType}`;
  if (state.feedbackSent.has(dedupeId)) return;

  const elapsedMs = playback ? Date.now() - playback.startedAt : 0;
  state.feedbackSent.add(dedupeId);
  if (eventType === 'complete' && playback) playback.completed = true;

  try {
    await api('/api/feedback', {
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

function setPlayerStatus(text, kind = '') {
  if (statusLocked) return;
  stopLoadingMessages();
  const el = document.querySelector('#player-status');
  if (!el) return;
  el.innerHTML = escapeHtml(text || 'ncm-cli 播放器待命');
  el.classList.toggle('error', kind === 'error');
  el.classList.toggle('playing', kind === 'playing');
}

async function playCurrentTrack() {
  const track = state.current?.track;
  if (!track?.id) {
    setPlayerStatus('没有可播放的歌曲', 'error');
    return;
  }
  setPlayerStatus(`正在调用 ncm-cli：${track.name || track.id}`, 'playing');
  try {
    const result = await api('/api/player/play', { method: 'POST', body: { trackId: track.id, maxSkips: 6 } });
    if (result.track && result.track.id !== track.id) {
      state.current.track = result.track;
      updatePlayer(state.current);
    }
    markPlaybackStarted(result.track || track, 'ncm-cli');
    const skipped = result.skipped?.length ? `，已跳过 ${result.skipped.length} 首不可播歌曲` : '';
    setPlayerStatus(`正在播放：${result.track?.name || track.name}${skipped}`, 'playing');
    api('/api/play/report', { method: 'POST', body: { trackId: result.track?.id || track.id, playType: 'play' } }).catch(() => {});
  } catch (error) {
    setPlayerStatus(error.message, 'error');
  }
}

async function pausePlayback() {
  stopVisualizer();
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
    switchVisualizerTo('song');
    songAudio.play().catch(() => {});
    setPlayerStatus('继续播放', 'playing');
    return;
  }
  try {
    await api('/api/player/resume', { method: 'POST', body: {} });
    switchVisualizerTo('song');
    setPlayerStatus('继续播放', 'playing');
  } catch (error) {
    setPlayerStatus(error.message, 'error');
  }
}

async function stopPlayback() {
  stopVisualizer();
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
  const statusEl = document.querySelector('#player-status');
  if (!statusEl || statusEl.classList.contains('error')) return;
  try {
    const data = await api('/api/player/state');
    const status = data.state?.status || data.state?.playerState || 'unknown';
    if (status === 'playing') maybeReportInferredComplete();
    if (status === 'playing') setPlayerStatus('ncm-cli 正在播放', 'playing');
    if (status === 'paused') setPlayerStatus('ncm-cli 已暂停', '');
    if (status === 'stopped') setPlayerStatus('ncm-cli 播放器待命', '');
  } catch {
    // State polling should not interrupt the radio UI.
  }
}

function updateClock() {
  const clock = document.querySelector('#stage-clock');
  if (!clock) return;
  clock.textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// --- Library ---
async function renderLibrary() {
  const data = await api('/api/library');
  state.library = data;
  const structured = data.profile?.structured || {};
  const summary = data.profile?.summary || '灿灿正在等待你的音乐信号。';
  view.innerHTML = `
    <section class="archive-page page-shell">
      <div class="page-marquee" data-reveal>
        <p class="eyebrow">Signal Archive</p>
        <h1 class="page-title">私人曲库</h1>
        <p>${escapeHtml(summary)}</p>
      </div>
      <div class="metadata-bands" data-reveal>
        ${profileBand('流派', structured.genres)}
        ${profileBand('情绪', structured.moods)}
        ${profileBand('艺人', structured.artists)}
        ${profileBand('场景', structured.scenes)}
        ${profileBand('探索', structured.discoveryDirections)}
      </div>
      <div class="archive-stats" data-reveal>
        <div><span>歌曲</span><strong>${data.totalTracks || data.tracks.length}</strong></div>
        <div><span>歌单</span><strong>${data.playlists.length}</strong></div>
        <div><span>最近</span><strong>${data.recent.length}</strong></div>
        <button id="sync-btn" class="primary">同步网易云音乐</button>
      </div>
      <div class="archive-grid" data-reveal>
        ${data.tracks.slice(0, 80).map(trackItem).join('')}
      </div>
    </section>
  `;
  document.querySelector('#sync-btn').addEventListener('click', async () => {
    const btn = document.querySelector('#sync-btn');
    btn.textContent = '同步中';
    await api('/api/library/sync', { method: 'POST', body: {} });
    renderLibrary();
  });
  initMagneticControls(view);
  revealCurrentView();
}

function profileBand(title, items = []) {
  const values = (items || [])
    .map(item => typeof item === 'string' ? { name: item } : item)
    .filter(item => item?.name)
    .slice(0, 8);
  return `
    <article class="meta-band">
      <span>${escapeHtml(title)}</span>
      <div>${values.length ? values.map(item => `<b>${escapeHtml(item.name)}</b>`).join('') : '<b>暂无信号</b>'}</div>
    </article>
  `;
}

function trackItem(track) {
  return `
    <article class="archive-track" data-magnetic>
      ${signalTile(track.name)}
      <div>
        <h3>${escapeHtml(track.name)}</h3>
        <p>${escapeHtml((track.artists || []).join(' / ') || track.album || '')}</p>
      </div>
    </article>
  `;
}

// --- Tuning ---
async function renderTuning() {
  const [prefsData, memoryData] = await Promise.all([
    api('/api/preferences'),
    api('/api/memories').catch(() => ({ memories: [] }))
  ]);
  const prefs = prefsData.preferences || {};
  const memories = (memoryData.memories || []).slice(0, 6);
  const feedback = prefsData.feedbackSummary || { totals: {}, tracks: [] };

  view.innerHTML = `
    <section class="tuning-page page-shell">
      <div class="page-marquee" data-reveal>
        <p class="eyebrow">Control Surface</p>
        <h1 class="page-title">调音台</h1>
        <p>这里不是说明书，是灿灿的操作台。聊天、推荐、播报和情绪模式都从这里校准。</p>
      </div>
      <div class="surface-grid" data-reveal>
        ${preferenceCard({
          number: '01',
          title: '聊天 / 推歌',
          name: 'chatMusicBalance',
          value: prefs.chatMusicBalance,
          options: [
            ['friend', '朋友', '先聊天'],
            ['balanced', '平衡', '适时接歌'],
            ['dj', 'DJ', '主动控场']
          ]
        })}
        ${preferenceCard({
          number: '02',
          title: '主动推荐',
          name: 'recommendationFrequency',
          value: prefs.recommendationFrequency,
          options: [
            ['low', '低', '少打断'],
            ['medium', '中', '默认'],
            ['high', '高', '电台感']
          ]
        })}
        ${preferenceCard({
          number: '03',
          title: '语音播报',
          name: 'voiceMode',
          value: prefs.voiceMode,
          options: [
            ['off', '关', '文字'],
            ['recommendations', '推荐', '主持词'],
            ['all', '全量', '每句']
          ]
        })}
        ${preferenceCard({
          number: '04',
          title: '情绪模式',
          name: 'moodMode',
          value: prefs.moodMode,
          options: [
            ['auto', '自动', '判断'],
            ['comfort', '陪伴', '安抚'],
            ['focus', '专注', '代码'],
            ['calm', '安静', '低刺激'],
            ['night', '夜间', '低能量'],
            ['random', '随机', '变化']
          ]
        })}
      </div>
      <div class="surface-bottom" data-reveal>
        <article class="operator-note">
          <div class="panel-title">
            <span>05</span>
            <h2>Operator Note</h2>
            <small id="pref-status">已加载</small>
          </div>
          <textarea id="pref-note" maxlength="500" placeholder="例如：低落时先陪我聊两句，不要马上切歌。">${escapeHtml(prefs.note || '')}</textarea>
        </article>
        <article class="memory-strip">
          <div class="panel-title">
            <span>06</span>
            <h2>Memory Signal</h2>
            <small>${memories.length} 条</small>
          </div>
          <div class="memory-chips">
            ${memories.length ? memories.map(tuningMemoryItem).join('') : '<p class="muted">暂无可用于调音的长期记忆。</p>'}
          </div>
        </article>
        <article class="feedback-summary">
          <div class="panel-title">
            <span>07</span>
            <h2>Feedback Trend</h2>
            <small>live</small>
          </div>
          <div class="feedback-stats">
            <div><strong>${Number(feedback.totals?.likes || 0)}</strong><span>喜欢</span></div>
            <div><strong>${Number(feedback.totals?.dislikes || 0)}</strong><span>不喜欢</span></div>
            <div><strong>${Number(feedback.totals?.skips || 0)}</strong><span>跳过</span></div>
            <div><strong>${Number(feedback.totals?.completions || 0)}</strong><span>听完</span></div>
          </div>
          <div class="feedback-list">
            ${(feedback.tracks || []).slice(0, 5).map(feedbackTrendItem).join('') || '<p class="muted">暂无反馈趋势。</p>'}
          </div>
        </article>
      </div>
    </section>
  `;

  document.querySelectorAll('[data-pref]').forEach((button) => {
    button.addEventListener('click', async () => {
      const name = button.getAttribute('data-pref');
      const value = button.getAttribute('data-value');
      await savePreferencePatch({ [name]: value });
      document.querySelectorAll(`[data-pref="${name}"]`).forEach((item) => item.classList.toggle('active', item === button));
    });
  });
  const note = document.querySelector('#pref-note');
  let noteTimer = null;
  note?.addEventListener('input', () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => savePreferencePatch({ note: note.value }), 450);
  });
  initMagneticControls(view);
  revealCurrentView();
}

function preferenceCard({ number, title, name, value, options }) {
  return `
    <article class="control-card" data-magnetic>
      <div class="control-head">
        <span>${escapeHtml(number)}</span>
        <h2>${escapeHtml(title)}</h2>
        <small>${escapeHtml(value || '')}</small>
      </div>
      <div class="control-dial" style="--dial:${Math.max(1, options.findIndex(([optionValue]) => optionValue === value) + 1) / options.length}"></div>
      <div class="segmented-list">
        ${options.map(([optionValue, label, description]) => `
          <button class="${optionValue === value ? 'active' : ''}" type="button" data-pref="${escapeAttr(name)}" data-value="${escapeAttr(optionValue)}">
            <strong>${escapeHtml(label)}</strong>
            <span>${escapeHtml(description)}</span>
          </button>
        `).join('')}
      </div>
    </article>
  `;
}

async function savePreferencePatch(patch) {
  const status = document.querySelector('#pref-status');
  if (status) status.textContent = '保存中';
  try {
    await api('/api/preferences', { method: 'PUT', body: patch });
    if (status) status.textContent = '已保存';
  } catch (error) {
    if (status) status.textContent = '保存失败';
    console.warn('[preferences] save failed:', error.message);
  }
}

function tuningMemoryItem(memory) {
  return `
    <div class="memory-chip">
      <span>${escapeHtml(memoryKindLabel(memory.kind))}</span>
      <p>${escapeHtml(memory.content || '')}</p>
    </div>
  `;
}

function feedbackTrendItem(track) {
  const artists = Array.isArray(track.artists) ? track.artists.join(' / ') : '';
  return `
    <div class="feedback-row">
      ${signalTile(track.name)}
      <div>
        <strong>${escapeHtml(track.name || track.trackId || '未知歌曲')}</strong>
        <span>${escapeHtml(artists)}</span>
      </div>
      <small>+${Number(track.likes || 0)} / -${Number(track.skips || 0) + Number(track.dislikes || 0)}</small>
    </div>
  `;
}

// --- Settings ---
async function renderSettings() {
  const [status, memoryData] = await Promise.all([
    api('/api/config/status'),
    api('/api/memories').catch(() => ({ memories: [] }))
  ]);
  const memories = memoryData.memories || [];
  view.innerHTML = `
    <section class="settings-page page-shell">
      <div class="page-marquee" data-reveal>
        <p class="eyebrow">System Bay</p>
        <h1 class="page-title">设置</h1>
        <p>系统维护区。这里保持安静，只处理配置、登录和记忆管理。</p>
      </div>
      <div class="settings-grid" data-reveal>
        <section class="system-panel">
          <div class="panel-title"><span>01</span><h2>本地配置</h2></div>
          <table class="settings-table">
            ${statusRow('网易云 appId', status.netease.appId)}
            ${statusRow('网易云 RSA 私钥', status.netease.privateKey)}
            ${statusRow('网易云登录', status.neteaseToken)}
            ${statusRow('LLM', status.llm.configured, status.llm.model)}
            ${statusRow('TTS', status.tts.configured, status.tts.provider)}
            ${statusRow('天气城市', status.weather.configured, status.weather.city)}
          </table>
          <div class="netease-login">
            <button id="qr-btn">扫码登录网易云</button>
            <button id="qr-refresh-btn" class="ghost">刷新 token</button>
            <p id="qr-status"></p>
            <div id="qr-slot" class="qr-slot"></div>
          </div>
        </section>
        <section class="system-panel memory-panel">
          <div class="panel-title">
            <span>02</span>
            <h2>灿灿的记忆</h2>
            <button id="clear-memories-btn" class="ghost danger compact" ${memories.length ? '' : 'disabled'}>清空</button>
          </div>
          <div class="memory-list">
            ${memories.length ? memories.map(memoryItem).join('') : '<p class="muted memory-empty">还没有长期记忆。</p>'}
          </div>
        </section>
      </div>
    </section>
  `;
  document.querySelector('#qr-btn').addEventListener('click', () => startQrLogin());
  document.querySelector('#qr-refresh-btn').addEventListener('click', async () => {
    const statusEl = document.querySelector('#qr-status');
    statusEl.textContent = '正在续期';
    const res = await api('/api/auth/netease/refresh', { method: 'POST', body: {} });
    statusEl.textContent = res.ok ? 'token 已续期' : '续期失败，请重新扫码';
  });
  document.querySelectorAll('[data-delete-memory]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-delete-memory');
      if (!confirm('删除这条记忆？')) return;
      await api(`/api/memories/${id}`, { method: 'DELETE' });
      renderSettings();
    });
  });
  document.querySelector('#clear-memories-btn')?.addEventListener('click', async () => {
    if (!memories.length) return;
    if (!confirm('清空灿灿的全部长期记忆？聊天历史不会被删除。')) return;
    await api('/api/memories', { method: 'DELETE' });
    renderSettings();
  });
  initMagneticControls(view);
  revealCurrentView();
}

async function startQrLogin() {
  const statusEl = document.querySelector('#qr-status');
  const slot = document.querySelector('#qr-slot');
  statusEl.textContent = '获取二维码';
  try {
    const data = await api('/api/auth/netease/qrcode', { method: 'POST', body: {} });
    const info = data.data || data;
    const qrUrl = info.qrCodeUrl || info.qrCode || '';
    const key = info.qrCodeKey;
    if (qrUrl) {
      let img = document.querySelector('#qr-img');
      if (!img) {
        img = document.createElement('img');
        img.id = 'qr-img';
        img.className = 'qr-img';
        img.alt = '登录二维码';
        slot.appendChild(img);
      }
      img.src = `https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodeURIComponent(qrUrl)}`;
      img.style.display = 'block';
    }
    statusEl.textContent = '请用网易云音乐 App 扫码';
    pollQrStatus(key, statusEl);
  } catch (error) {
    statusEl.textContent = `获取失败：${error.message}`;
  }
}

async function pollQrStatus(key, statusEl) {
  for (let i = 0; i < 60; i += 1) {
    await sleep(2000);
    try {
      const res = await api('/api/auth/netease/qrcode/check', { method: 'POST', body: { key } });
      const data = res.data || res;
      const code = data.code || data.status || 0;
      if (code === 803) {
        statusEl.textContent = '扫码成功，已保存登录信息。';
        document.querySelector('#qr-img')?.remove();
        return;
      }
      if (code === 802) { statusEl.textContent = '已扫码，请在手机上确认授权'; continue; }
      if (code === 801) { statusEl.textContent = '等待扫码'; continue; }
      if (code === 800) { statusEl.textContent = '二维码已过期'; return; }
      statusEl.textContent = `状态 ${data.msg || data.message || code}`;
    } catch {
      // keep polling
    }
  }
  statusEl.textContent = '超时，请重新获取二维码';
}

function memoryItem(memory) {
  const confidence = Math.round(Number(memory.confidence || 0) * 100);
  const importance = Math.round(Number(memory.importance || 0) * 100);
  return `
    <article class="memory-item">
      <div class="memory-main">
        <div class="memory-meta">
          <span class="tag">${escapeHtml(memoryKindLabel(memory.kind))}</span>
          <span class="muted">置信 ${confidence}% · 重要 ${importance}% · 证据 ${Number(memory.evidenceCount || 0)}</span>
        </div>
        <p>${escapeHtml(memory.content || '')}</p>
        <div class="tags">${(memory.tags || []).map((tag) => `<span class="tag subtle">${escapeHtml(tag)}</span>`).join('')}</div>
        <p class="muted memory-time">更新于 ${escapeHtml(formatDateTime(memory.updatedAt || memory.lastSeenAt))}</p>
      </div>
      <button class="ghost danger compact" data-delete-memory="${memory.id}">删除</button>
    </article>
  `;
}

function statusRow(label, ok, detail = '') {
  return `
    <tr>
      <td>${escapeHtml(label)}</td>
      <td class="${ok ? 'status-ok' : 'status-miss'}">${ok ? '已配置' : '未配置'} ${detail ? `· ${escapeHtml(detail)}` : ''}</td>
    </tr>
  `;
}

// --- Shared helpers ---
function signalTile(label = '') {
  const initial = getInitial(label);
  const seed = Array.from(String(label || 'M')).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return `<div class="signal-tile" style="--seed:${seed % 360}" aria-hidden="true"><span>${escapeHtml(initial)}</span></div>`;
}

function getInitial(label = '') {
  return String(label || 'M').trim().slice(0, 1).toUpperCase() || 'M';
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

function revealCurrentView() {
  view.querySelectorAll('[data-reveal], .signal-stage, .canchan-console, .transcript-ticker, .command-dock').forEach((el, index) => {
    el.style.setProperty('--delay', `${index * 80}ms`);
    el.classList.add('is-revealed');
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

render();
