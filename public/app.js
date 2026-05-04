const state = {
  sessionId: null,
  current: null,
  library: null,
  playerPollTimer: null,
  feedbackSent: new Set(),
  activePlayback: null,
  lyricLines: [],
  activeLyricIndex: -1
};

// Module-level mutable state — MUST be declared before render() call at line ~30
let statusLocked = false;
let btnFeedbackReady = false;
let loadingMsgIndex = 0;
let loadingMsgTimer = null;

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
  document.querySelectorAll('.nav a').forEach((link) => {
    link.classList.toggle('active', new URL(link.href).pathname === location.pathname);
  });
  if (location.pathname === '/library') return renderLibrary();
  if (location.pathname === '/diary') return renderDiary();
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
// --- Button press feedback ---

function initButtonFeedback() {
  if (btnFeedbackReady) return;
  btnFeedbackReady = true;

  document.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    btn.classList.add('btn-pressed');
  });
  document.addEventListener('mouseup', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    btn.classList.remove('btn-pressed');
  });
  document.addEventListener('mouseleave', (e) => {
    const btn = e.target.closest('button');
    if (btn) btn.classList.remove('btn-pressed');
  }, true);
  document.addEventListener('touchstart', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    btn.classList.add('btn-pressed');
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    btn.classList.remove('btn-pressed');
  });
}

function renderPlayer() {
  view.innerHTML = '';
  view.append(template.content.cloneNode(true));
  const startBtn = document.querySelector('#start-btn');
  const nextBtn = document.querySelector('#next-btn');
  const pauseBtn = document.querySelector('#pause-btn');
  const resumeBtn = document.querySelector('#resume-btn');
  const chatForm = document.querySelector('#chat-form');
  const modeResetBtn = document.querySelector('#mode-reset-btn');
  const { likeBtn, dislikeBtn } = ensureFeedbackButtons();

  startBtn.addEventListener('click', () => {
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

  if (state.current) updatePlayer(state.current, false);
  startPlayerPolling();
  initButtonFeedback();
  initVisualizer();
  // Build audio graph on first user gesture (start button click)
  document.querySelector('#start-btn').addEventListener('click', () => {
    if (!visualizerBuilt) buildAudioGraph();
  }, { once: true });
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

function startLoadingMessages() {
  loadingMsgIndex = 0;
  statusLocked = true;
  showLoadingMessage();
  loadingMsgTimer = setInterval(() => {
    loadingMsgIndex = (loadingMsgIndex + 1) % loadingMessages.length;
    showLoadingMessage();
  }, 2800);
}

function showLoadingMessage() {
  const el = document.querySelector('#player-status');
  if (!el) return;
  const msg = loadingMessages[loadingMsgIndex];
  el.innerHTML = `
    <span class="glitch-text" data-text="${escapeHtml(msg)}">${escapeHtml(msg)}</span>
    <span class="loading-dots">
      <span></span><span></span><span></span>
    </span>
  `;
  el.classList.add('playing');
}

function stopLoadingMessages() {
  statusLocked = false;
  if (loadingMsgTimer) { clearInterval(loadingMsgTimer); loadingMsgTimer = null; }
}

async function startRadio() {
  appendChat({ role: 'user', text: '启动电台' });
  startLoadingMessages();
  try {
    const data = await api('/api/radio/start', { method: 'POST', body: {} });
    handleRadioResponse(data);
  } catch (e) { stopLoadingMessages(); setPlayerStatus(e.message, 'error'); }
}

async function nextTrack({ skipCurrent = true } = {}) {
  if (skipCurrent) await reportFeedback('skip');
  appendChat({ role: 'user', text: '下一首' });
  startLoadingMessages();
  try {
    const data = await api('/api/radio/next', { method: 'POST', body: { sessionId: state.sessionId } });
    handleRadioResponse(data);
  } catch (e) { stopLoadingMessages(); setPlayerStatus(e.message, 'error'); }
}

async function sendChat(msg) {
  appendChat({ role: 'user', text: msg });
  startLoadingMessages();
  try {
    const data = await api('/api/radio/chat', { method: 'POST', body: { sessionId: state.sessionId, message: msg } });
    handleRadioResponse(data);
  } catch (e) {
    stopLoadingMessages();
    appendChat({ role: 'dj', text: '抱歉，出了一点问题：' + e.message });
  }
}

async function resetMode() {
  await api('/api/radio/chat', { method: 'POST', body: { sessionId: state.sessionId, message: '恢复正常推荐，取消所有偏好模式' } });
  document.querySelector('#mode-reset-btn').style.display = 'none';
  appendChat({ role: 'dj', text: '好的，恢复正常推荐模式。' });
}

function handleRadioResponse(data) {
  stopLoadingMessages();
  stopVisualizer();
  state.sessionId = data.sessionId || state.sessionId;
  if (data.track) {
    state.current = data;
    updatePlayer(data, false);
  }

  // Show DJ chat bubble with optional track card
  appendChat({
    role: 'dj',
    text: data.chatText || data.hostText || '',
    track: data.track
  });

  // Show/hide mode reset button
  const hasMode = data.mode?.genre;
  document.querySelector('#mode-reset-btn').style.display = hasMode ? '' : 'none';

  // Only play if there's a track
  if (!data.track) {
    setPlayerStatus(state.current?.track ? '继续播放中' : '等待中', '');
    return;
  }

  const hostAudio = document.querySelector('#host-audio');
  hostAudio.src = data.ttsUrl || '';
  setPlayerStatus('歌曲就绪', 'playing');
  try {
    if (data.ttsUrl) {
      hostAudio.onended = () => startSongPlayback();
      hostAudio.onplay = () => switchVisualizerTo('host');
      hostAudio.play();
    } else {
      switchVisualizerTo('host');  // show fallback for SpeechSynthesis
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
  const cls = role === 'user' ? 'user-msg' : 'dj-msg';

  let html = `<div class="chat-msg ${cls}">`;
  if (text) html += `<p>${escapeHtml(text)}</p>`;
  if (track?.name) {
    html += `<div class="track-card" onclick="document.querySelector('#song-audio')?.play()">
      <img src="${escapeAttr(track.coverUrl || '/assets/cover-1.svg')}" alt="" />
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

async function updatePlayer(data, autoplay) {
  const track = data.track || {};
  document.querySelector('#cover').src = track.coverUrl || '/assets/cover-1.svg';
  document.querySelector('#track-title').textContent = track.name || 'myMusic';
  document.querySelector('#track-artist').textContent = (track.artists || []).join(' / ') || '等待启动';
  buildLyricDOM(data.track?.lyric || '');

  const songAudio = document.querySelector('#song-audio');
  if (track.playUrl) {
    songAudio.crossOrigin = 'anonymous';
    songAudio.src = track.playUrl;
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

  // No direct URL, try ncm-cli via server
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

function setHostText(text) {
  const el = document.querySelector('#host-text');
  if (el) el.textContent = text;
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
  setPlayerStatus(`正在调用 ncm-cli 播放：${track.name || track.id}`, 'playing');
  try {
    const result = await api('/api/player/play', { method: 'POST', body: { trackId: track.id, maxSkips: 6 } });
    if (result.track && result.track.id !== track.id) {
      state.current.track = result.track;
      updatePlayer(state.current, false);
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
    startVisualizer(songAudio);
    songAudio.play().catch(() => {});
    setPlayerStatus('继续播放', 'playing');
    return;
  }
  try {
    await api('/api/player/resume', { method: 'POST', body: {} });
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

async function renderLibrary() {
  const data = await api('/api/library');
  state.library = data;
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
      <button id="sync-btn" class="primary">同步网易云音乐</button>
    </section>
    <section class="grid" style="margin-top:16px">
      ${data.tracks.slice(0, 50).map(trackItem).join('')}
    </section>
  `;
  document.querySelector('#sync-btn').addEventListener('click', async () => {
    const btn = document.querySelector('#sync-btn');
    btn.textContent = '同步中...';
    await api('/api/library/sync', { method: 'POST', body: {} });
    renderLibrary();
  });
}

async function renderDiary() {
  const todayEntry = await api('/api/diary/today');
  const list = await api('/api/diary');
  const entries = [todayEntry, ...list.filter((entry) => entry.date !== todayEntry.date)];
  view.innerHTML = `
    <section class="page-panel">
      <p class="eyebrow">Diary</p>
      <h1 class="page-title">音乐日记</h1>
      <button id="diary-btn" class="primary">刷新今天的日记</button>
      <div class="diary-list">
        ${entries.map(diaryItem).join('')}
      </div>
    </section>
  `;
  document.querySelector('#diary-btn').addEventListener('click', async () => {
    await api('/api/diary/generate', { method: 'POST', body: {} });
    renderDiary();
  });
}

async function renderSettings() {
  const status = await api('/api/config/status');
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
  `;
  document.querySelector('#qr-btn').addEventListener('click', () => startQrLogin());
  document.querySelector('#qr-refresh-btn').addEventListener('click', async () => {
    const statusEl = document.querySelector('#qr-status');
    statusEl.textContent = '正在续期...';
    const res = await api('/api/auth/netease/refresh', { method: 'POST', body: {} });
    statusEl.textContent = res.ok ? 'token 已续期（7天内有效）' : '续期失败，请重新扫码';
  });
}

async function startQrLogin() {
  const statusEl = document.querySelector('#qr-status');
  const img = document.querySelector('#qr-img');
  statusEl.textContent = '获取二维码...';
  try {
    const data = await api('/api/auth/netease/qrcode', { method: 'POST', body: {} });
    const info = data.data || data;
    const qrUrl = info.qrCodeUrl || info.qrCode || '';
    const key = info.qrCodeKey;
    if (qrUrl) {
      // Use Google Chart API to render QR code image
      img.src = 'https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=' + encodeURIComponent(qrUrl);
      img.style.display = 'block';
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

function diaryItem(entry) {
  return `
    <article class="diary-card">
      <h2>${escapeHtml(entry.title)}</h2>
      <div class="tags">${(entry.moodTags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
      <p>${escapeHtml(entry.content)}</p>
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
