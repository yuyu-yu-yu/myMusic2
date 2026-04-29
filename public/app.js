const state = {
  sessionId: null,
  current: null,
  library: null
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
  const chatForm = document.querySelector('#chat-form');
  const songAudio = document.querySelector('#song-audio');

  startBtn.addEventListener('click', () => runRadio('/api/radio/start', {}));
  nextBtn.addEventListener('click', () => runRadio('/api/radio/next', { sessionId: state.sessionId }));
  pauseBtn.addEventListener('click', () => {
    document.querySelector('#host-audio').pause();
    songAudio.pause();
  });
  chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.querySelector('#chat-input');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    runRadio('/api/radio/chat', { sessionId: state.sessionId, message });
  });
  songAudio.addEventListener('ended', () => runRadio('/api/radio/next', { sessionId: state.sessionId }));
  songAudio.addEventListener('play', () => {
    if (state.current?.track?.id) {
      api('/api/play/report', { method: 'POST', body: { trackId: state.current.track.id, playType: 'play' } }).catch(() => {});
    }
  });

  if (state.current) updatePlayer(state.current, false);
}

async function runRadio(path, body) {
  setHostText('正在为你组织下一段电台...');
  const data = await api(path, { method: 'POST', body });
  state.sessionId = data.sessionId || state.sessionId;
  state.current = data;
  updatePlayer(data, true);
}

async function updatePlayer(data, autoplay) {
  const track = data.track || {};
  document.querySelector('#cover').src = track.coverUrl || '/assets/cover-1.svg';
  document.querySelector('#track-title').textContent = track.name || '未知歌曲';
  document.querySelector('#track-artist').textContent = (track.artists || []).join(' / ') || track.album || '未知艺人';
  document.querySelector('#reason').textContent = data.reason || '';
  document.querySelector('#host-text').textContent = data.hostText || '';
  document.querySelector('#lyric').textContent = data.track?.lyric || '';

  const songAudio = document.querySelector('#song-audio');
  const hostAudio = document.querySelector('#host-audio');
  songAudio.src = track.playUrl || '';
  hostAudio.src = data.ttsUrl || '';

  if (!autoplay) return;
  try {
    if (data.ttsUrl) {
      hostAudio.onended = () => songAudio.play().catch(() => {});
      await hostAudio.play();
    } else {
      speakText(data.hostText, () => songAudio.play().catch(() => {}));
    }
  } catch {
    speakText(data.hostText, () => songAudio.play().catch(() => {}));
  }
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

function setHostText(text) {
  const el = document.querySelector('#host-text');
  if (el) el.textContent = text;
}

async function renderLibrary() {
  const data = await api('/api/library');
  state.library = data;
  view.innerHTML = `
    <section class="page-panel">
      <p class="eyebrow">Library</p>
      <h1 class="page-title">私人曲库</h1>
      <p class="reason">${escapeHtml(data.profile.summary)}</p>
      <div class="tags">${(data.profile.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
      <div class="stats">
        <div class="stat"><span class="muted">歌曲</span><strong>${data.tracks.length}</strong></div>
        <div class="stat"><span class="muted">歌单</span><strong>${data.playlists.length}</strong></div>
        <div class="stat"><span class="muted">最近播放</span><strong>${data.recent.length}</strong></div>
      </div>
      <button id="sync-btn" class="primary">同步网易云音乐</button>
    </section>
    <section class="grid" style="margin-top:16px">
      ${data.tracks.slice(0, 24).map(trackItem).join('')}
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
