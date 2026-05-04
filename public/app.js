const state = {
  sessionId: null,
  current: null,
  library: null,
  playerPollTimer: null,
  feedbackSent: new Set(),
  activePlayback: null
};

const view = document.querySelector('#view');
const template = document.querySelector('#player-template');

window.addEventListener('popstate', render);
document.addEventListener('click', (event) => {
  const link = event.target.closest('[data-link]');
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

async function startRadio() {
  appendChat({ role: 'user', text: '启动电台' });
  setPlayerStatus('灿灿正在准备...', 'playing');
  try {
    const data = await api('/api/radio/start', { method: 'POST', body: {} });
    handleRadioResponse(data);
  } catch (e) { setPlayerStatus(e.message, 'error'); }
}

async function nextTrack({ skipCurrent = true } = {}) {
  if (skipCurrent) await reportFeedback('skip');
  appendChat({ role: 'user', text: '下一首' });
  setPlayerStatus('灿灿正在想...', 'playing');
  try {
    const data = await api('/api/radio/next', { method: 'POST', body: { sessionId: state.sessionId } });
    handleRadioResponse(data);
  } catch (e) { setPlayerStatus(e.message, 'error'); }
}

async function sendChat(msg) {
  appendChat({ role: 'user', text: msg });
  setPlayerStatus('灿灿正在回复...', 'playing');
  try {
    const data = await api('/api/radio/chat', { method: 'POST', body: { sessionId: state.sessionId, message: msg } });
    handleRadioResponse(data);
  } catch (e) {
    appendChat({ role: 'dj', text: '抱歉，出了一点问题：' + e.message });
  }
}

async function resetMode() {
  await api('/api/radio/chat', { method: 'POST', body: { sessionId: state.sessionId, message: '恢复正常推荐，取消所有偏好模式' } });
  document.querySelector('#mode-reset-btn').style.display = 'none';
  appendChat({ role: 'dj', text: '好的，恢复正常推荐模式。' });
}

function handleRadioResponse(data) {
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
      hostAudio.play();
    } else {
      speakText(data.chatText || data.hostText, () => startSongPlayback());
    }
  } catch {
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
  document.querySelector('#lyric').textContent = data.track?.lyric || '';

  const songAudio = document.querySelector('#song-audio');
  if (track.playUrl) {
    songAudio.src = track.playUrl;
    songAudio.style.display = '';
  } else {
    songAudio.style.display = 'none';
  }
}

async function startSongPlayback() {
  const track = state.current?.track;
  const songAudio = document.querySelector('#song-audio');

  // If we have a direct URL, play it in browser
  if (track?.playUrl) {
    markPlaybackStarted(track, 'browser');
    setPlayerStatus(`正在播放：${track.name || '未知歌曲'}`, 'playing');
    songAudio.play().catch(() => {});
    songAudio.onended = async () => {
      await reportFeedback('complete');
      nextTrack({ skipCurrent: false });
    };
    songAudio.onplay = () => {
      api('/api/play/report', { method: 'POST', body: { trackId: track.id, playType: 'play' } }).catch(() => {});
    };
    return;
  }

  // No direct URL, try ncm-cli via server
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
  const el = document.querySelector('#player-status');
  if (!el) return;
  el.textContent = text || 'ncm-cli 播放器待命';
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
