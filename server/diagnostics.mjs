import { generateChatCompletion, synthesizeSpeech } from './ai.mjs';
import { getCookieStatus, getCookieUserProfile, resolveCommunityApiFile } from './community.mjs';
import { getTrackById, listRecentPlays } from './db.mjs';
import { getLibrary, resolvePlayableTrack } from './library.mjs';

const SELF_CHECK_TIMEOUT_MS = 9000;
const COMMUNITY_HTTP_TIMEOUT_MS = 2500;

export async function runDemoSelfCheck({
  db,
  config,
  netease,
  rootDir,
  sessionId = '',
  trackId = '',
  syncStatus = null,
  accountContext = null
} = {}) {
  const checkedAt = new Date().toISOString();
  const checks = [];

  checks.push(await timedCheck('llm', 'LLM', () => checkLlm(config?.llm || {})));
  checks.push(await timedCheck('tts', 'TTS', () => checkTts(config?.tts || {}, rootDir)));
  checks.push(await timedCheck('netease_cookie', '音乐扫码登录', () => checkCookie()));
  checks.push(await timedCheck('community_api', 'NeteaseCloudMusicApi', () => checkCommunityApi()));
  checks.push(await timedCheck('library', '当前账号歌单', () => checkLibrary(db, syncStatus, accountContext)));
  checks.push(await timedCheck('play_source', '当前播放源', () => checkPlaySource(db, config, netease, trackId, accountContext)));

  const recentFailure = getRecentRecommendationFailure(db, sessionId, accountContext);
  checks.push({
    id: 'recent_failure',
    label: '最近推荐失败',
    status: recentFailure ? 'warn' : 'ok',
    detail: recentFailure ? recentFailure.message : '暂无推荐失败记录',
    action: recentFailure ? '可在电台调试面板查看候选与搜索命中。' : null
  });

  return {
    ok: !checks.some(check => check.status === 'fail'),
    checkedAt,
    summary: summarizeChecks(checks),
    checks,
    recentFailure
  };
}

async function timedCheck(id, label, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    return {
      id,
      label,
      status: result?.status || 'ok',
      detail: result?.detail || '',
      action: result?.action || null,
      ms: Date.now() - started
    };
  } catch (error) {
    return {
      id,
      label,
      status: 'fail',
      detail: String(error?.message || error).slice(0, 220),
      action: null,
      ms: Date.now() - started
    };
  }
}

async function checkLlm(llmConfig) {
  if (!llmConfig?.baseUrl || !llmConfig?.apiKey || !llmConfig?.model) {
    return { status: 'fail', detail: 'LLM 未配置完整，推荐和聊天会退回规则兜底。', action: '检查 .env.local 里的 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL。' };
  }
  const fallback = '__SELF_CHECK_LLM_FALLBACK__';
  const text = await withTimeout(generateChatCompletion(llmConfig, [
    { role: 'system', content: '你是 myMusic 的自检程序。只回复 OK。' },
    { role: 'user', content: '检查 LLM 是否可用。' }
  ], () => fallback), SELF_CHECK_TIMEOUT_MS, '__SELF_CHECK_TIMEOUT__');
  if (text === '__SELF_CHECK_TIMEOUT__') {
    return { status: 'fail', detail: 'LLM 自检超时。', action: '演示前检查网络或模型服务。' };
  }
  if (!text || text === fallback) {
    return { status: 'fail', detail: 'LLM 没有返回有效内容。', action: '确认模型名和 API key 是否可用。' };
  }
  return { status: 'ok', detail: `模型可响应：${llmConfig.model}` };
}

async function checkTts(ttsConfig, rootDir) {
  if (!isTtsConfigured(ttsConfig)) {
    return { status: 'fail', detail: 'TTS 未配置完整，导播语音无法合成。', action: '检查 TTS_PROVIDER、音色和服务密钥。' };
  }
  const url = await withTimeout(synthesizeSpeech(ttsConfig, '灿灿电台自检。', rootDir), SELF_CHECK_TIMEOUT_MS, '__SELF_CHECK_TIMEOUT__');
  if (url === '__SELF_CHECK_TIMEOUT__') {
    return { status: 'fail', detail: 'TTS 自检超时。', action: '演示前检查 TTS 服务网络和额度。' };
  }
  if (!url) {
    return { status: 'fail', detail: 'TTS 没有生成音频。', action: '检查音色、鉴权和服务额度。' };
  }
  return { status: 'ok', detail: 'TTS 已生成测试语音缓存。' };
}

async function checkCookie() {
  const status = getCookieStatus();
  if (!status.hasCookie) {
    return { status: 'warn', detail: '尚未扫码登录音乐试用通道。', action: '在设置页扫码登录音乐。' };
  }
  const profile = await withTimeout(getCookieUserProfile(), SELF_CHECK_TIMEOUT_MS, null);
  if (!profile?.userId) {
    return { status: 'fail', detail: '已保存 cookie，但无法读取音乐账号。', action: '退出后重新扫码。' };
  }
  return { status: 'ok', detail: `已登录：${profile.nickname || profile.userId}（${profile.userId}）` };
}

async function checkCommunityApi() {
  let apiFile = '';
  try {
    apiFile = resolveCommunityApiFile('main.js');
  } catch (error) {
    return { status: 'fail', detail: error.message, action: '安装 NeteaseCloudMusicApi 或重新打包。' };
  }

  const baseUrl = process.env.COMMUNITY_API_BASE_URL || `http://127.0.0.1:${process.env.COMMUNITY_API_PORT || 4000}`;
  try {
    const response = await fetchWithTimeout(`${baseUrl.replace(/\/$/, '')}/login/status?timestamp=${Date.now()}`, COMMUNITY_HTTP_TIMEOUT_MS);
    if (!response.ok) {
      return { status: 'warn', detail: `模块存在，但本地 HTTP 服务返回 ${response.status}。`, action: '如播放/搜索异常，重启应用。' };
    }
    return { status: 'ok', detail: `模块可加载，本地服务可访问。${shortPath(apiFile)}` };
  } catch {
    return { status: 'warn', detail: `模块可加载，但本地 HTTP 服务不可访问。${shortPath(apiFile)}`, action: '如果播放源解析异常，请确认启动脚本已拉起社区 API。' };
  }
}

async function checkLibrary(db, syncStatus, accountContext) {
  const library = getLibrary(db, accountContext);
  const account = library.account || {};
  if (account.accountMismatch) {
    return { status: 'fail', detail: '当前登录账号与已同步账号不一致。', action: '重新同步当前音乐账号歌单。' };
  }
  if (syncStatus?.status === 'running') {
    return { status: 'warn', detail: `正在同步歌单：${syncStatus.currentPlaylistIndex || 0} / ${syncStatus.totalPlaylists || 0}`, action: '等待同步完成后再演示推荐。' };
  }
  if (account.needsSync || !library.playlists?.length) {
    return { status: 'warn', detail: '当前账号尚未同步歌单。', action: '点击“同步音乐”。' };
  }
  if (!library.totalTracks) {
    return { status: 'warn', detail: `已同步 ${library.playlists.length} 个歌单，但没有可用歌曲。`, action: '检查歌单权限或重新同步。' };
  }
  return { status: 'ok', detail: `已同步 ${library.playlists.length} 个歌单，${library.totalTracks} 首去重歌曲。` };
}

async function checkPlaySource(db, config, netease, trackId, accountContext) {
  let track = trackId ? getTrackById(db, trackId) : null;
  if (!track) {
    const recent = listRecentPlays(db, 1, accountContext?.accountId)[0];
    track = recent || null;
  }
  if (!track) {
    return { status: 'skip', detail: '暂无当前歌曲或最近播放记录。' };
  }
  const resolved = await withTimeout(resolvePlayableTrack(db, netease, track, {
    includeLyric: false,
    requireBrowserPlayUrl: Boolean(config?.playback?.requireBrowserPlayUrl)
  }), SELF_CHECK_TIMEOUT_MS, null);
  if (!resolved?.playable) {
    return { status: 'fail', detail: `《${track.name || track.id}》当前无法解析播放源。`, action: '重新同步歌单或换一首歌测试。' };
  }
  return { status: 'ok', detail: `《${resolved.name || track.name}》播放源可用。` };
}

function getRecentRecommendationFailure(db, sessionId, accountContext) {
  const id = String(sessionId || '').trim();
  if (!id) return null;
  const row = accountContext?.accountId
    ? db.prepare('SELECT context_json AS contextJson FROM radio_sessions WHERE id = ? AND account_id = ?').get(id, accountContext.accountId)
    : db.prepare('SELECT context_json AS contextJson FROM radio_sessions WHERE id = ?').get(id);
  if (!row) return null;
  const context = safeJson(row.contextJson, {});
  const debug = context.radioDebug || {};
  if (debug.lastRecommendationFailure) return sanitizeFailure(debug.lastRecommendationFailure);

  const diagnostics = Array.isArray(debug.lastSearchDiagnostics) ? debug.lastSearchDiagnostics : [];
  const failed = diagnostics.find(item => item?.failedReason || (item?.hits || []).every(hit => !hit.accepted));
  if (failed) {
    return sanitizeFailure({
      stage: 'netease_search',
      message: `候选《${failed.pick?.name || '未知歌曲'}》没有确认到可播放命中。`,
      failedPicks: failed.pick ? [failed.pick] : [],
      updatedAt: debug.updatedAt
    });
  }
  if (context.queueMetrics?.lastMissReason) {
    return sanitizeFailure({
      stage: 'queue',
      message: `队列未命中：${context.queueMetrics.lastMissReason}`,
      failedPicks: [],
      updatedAt: context.queueMetrics.lastQueueHitAt || debug.updatedAt
    });
  }
  return null;
}

function sanitizeFailure(failure = {}) {
  return {
    stage: String(failure.stage || 'unknown').slice(0, 40),
    message: String(failure.message || '最近推荐失败').slice(0, 180),
    failedPicks: Array.isArray(failure.failedPicks)
      ? failure.failedPicks.map(pick => ({
        name: String(pick?.name || '').slice(0, 60),
        artists: Array.isArray(pick?.artists) ? pick.artists.map(String).slice(0, 4) : []
      })).slice(0, 6)
      : [],
    updatedAt: failure.updatedAt || null
  };
}

function summarizeChecks(checks) {
  const failed = checks.filter(check => check.status === 'fail').length;
  const warned = checks.filter(check => check.status === 'warn').length;
  if (failed) return `发现 ${failed} 个失败项，建议修复后再演示。`;
  if (warned) return `有 ${warned} 个警告项，核心功能可继续排查。`;
  return '核心演示链路看起来正常。';
}

function isTtsConfigured(config = {}) {
  const provider = String(config.provider || '').toLowerCase();
  if (provider === 'openai') return Boolean(config.baseUrl && config.apiKey);
  if (provider === 'volcengine') {
    const volc = config.volcengine || {};
    return Boolean((volc.accessKey || volc.accessToken) && (volc.voiceType || config.voice));
  }
  return false;
}

function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

function withTimeout(promise, timeoutMs, timeoutValue) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise(resolve => {
      timer = setTimeout(() => resolve(timeoutValue), timeoutMs);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function shortPath(filePath) {
  const value = String(filePath || '');
  if (!value) return '';
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.length > 3 ? parts.slice(-3).join('/') : value;
}
