import { generateChatCompletion } from './ai.mjs';
import { getCookieStatus, getCookieUserProfile, resolveCommunityApiFile } from './community.mjs';
import { synthesizeEdgeSpeech } from './edgeone-tts.mjs';

const CHECK_TIMEOUT_MS = 9000;

export async function runEdgeOneSelfCheck({
  config = {},
  store,
  ctx,
  session = null,
  trackId = '',
  getSharedLibrary,
  getSyncStatus,
  resolveTrack
} = {}) {
  const checkedAt = new Date().toISOString();
  const checks = [];
  checks.push(await timedCheck('llm', 'LLM', () => checkLlm(config.llm || {})));
  checks.push(await timedCheck('tts', 'TTS', () => checkTts({ config: config.tts || {}, store })));
  checks.push(await timedCheck('netease_cookie', 'NetEase Cookie', () => checkCookie()));
  checks.push(await timedCheck('community_api', 'NeteaseCloudMusicApi', () => checkCommunityApi()));
  checks.push(await timedCheck('library', 'Shared Library', () => checkLibrary({ getSharedLibrary, getSyncStatus })));
  checks.push(await timedCheck('storage', 'EdgeOne KV/Blob', () => checkStorage(store)));
  checks.push(await timedCheck('play_source', 'Play Source', () => checkPlaySource({ trackId, ctx, getSharedLibrary, resolveTrack })));
  checks.push(await timedCheck('ai_music', 'AI Music', () => checkAiMusic(config.minimax || {})));
  checks.push(checkRecentFailure(session));
  return {
    ok: !checks.some(check => check.status === 'fail'),
    runtime: 'edgeone',
    checkedAt,
    summary: summarizeChecks(checks),
    checks
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
      detail: sanitizeDetail(result?.detail || ''),
      action: result?.action ? sanitizeDetail(result.action) : null,
      ms: Date.now() - started
    };
  } catch (error) {
    return {
      id,
      label,
      status: 'fail',
      detail: sanitizeDetail(error?.message || String(error || '')),
      action: null,
      ms: Date.now() - started
    };
  }
}

async function checkLlm(llmConfig) {
  if (!llmConfig?.baseUrl || !llmConfig?.apiKey || !llmConfig?.model) {
    return { status: 'fail', detail: 'LLM is not fully configured.', action: 'Configure LLM_BASE_URL / LLM_API_KEY / LLM_MODEL in EdgeOne environment variables.' };
  }
  const fallback = '__EDGEONE_LLM_FALLBACK__';
  const text = await withTimeout(generateChatCompletion(llmConfig, [
    { role: 'system', content: 'Reply with OK only.' },
    { role: 'user', content: 'Health check.' }
  ], () => fallback), CHECK_TIMEOUT_MS, '__TIMEOUT__');
  if (text === '__TIMEOUT__') return { status: 'fail', detail: 'LLM check timed out.', action: 'Check provider network, model name, or quota.' };
  if (!text || text === fallback) return { status: 'fail', detail: 'LLM returned fallback or empty content.', action: 'Verify model and API key.' };
  return { status: 'ok', detail: `Model responded: ${llmConfig.model}` };
}

async function checkTts({ config, store }) {
  if (!isTtsConfigured(config)) {
    return { status: 'warn', detail: 'TTS is not fully configured.', action: 'Configure TTS provider keys if host voice is required.' };
  }
  const url = await withTimeout(synthesizeEdgeSpeech({
    config,
    text: 'CanCan EdgeOne TTS check.',
    store
  }), CHECK_TIMEOUT_MS, '__TIMEOUT__');
  if (url === '__TIMEOUT__') return { status: 'fail', detail: 'TTS check timed out.', action: 'Check TTS network and quota.' };
  if (!url) return { status: 'fail', detail: 'TTS did not return audio.', action: 'Verify voice, model, and provider credentials.' };
  return { status: 'ok', detail: 'TTS generated and stored an audio blob.' };
}

async function checkCookie() {
  const status = getCookieStatus();
  if (!status.hasCookie) return { status: 'warn', detail: 'NETEASE_COOKIE is not loaded.', action: 'Configure NETEASE_COOKIE for shared library sync and play source checks.' };
  const profile = await withTimeout(getCookieUserProfile(), CHECK_TIMEOUT_MS, null);
  if (!profile?.userId) return { status: 'fail', detail: 'Cookie exists but account profile could not be read.', action: 'Refresh the demo NetEase cookie.' };
  return { status: 'ok', detail: `Cookie account is readable: ${profile.nickname || profile.userId}` };
}

async function checkCommunityApi() {
  const file = resolveCommunityApiFile('main.js');
  return { status: 'ok', detail: `Community API package is loadable: ${shortPath(file)}` };
}

async function checkLibrary({ getSharedLibrary, getSyncStatus }) {
  const library = await getSharedLibrary();
  const status = await getSyncStatus();
  const count = Number(library?.tracks?.length || 0);
  if (!count) return { status: 'fail', detail: 'Shared library has no tracks.', action: 'Run admin sync or import a library snapshot.' };
  const playlistCount = Number(library?.playlists?.length || 0);
  const syncText = status?.status ? ` Sync: ${status.status}.` : '';
  return { status: 'ok', detail: `${count} tracks and ${playlistCount} playlists are available.${syncText}` };
}

async function checkStorage(store) {
  if (!store?.setJson || !store?.getJson || !store?.setBytes || !store?.getBytes) {
    return { status: 'fail', detail: 'Store does not expose JSON and bytes APIs.', action: 'Check EdgeOne Blob/KV binding.' };
  }
  const key = `diagnostics/${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await store.setJson(`${key}.json`, { ok: true });
  const json = await store.getJson(`${key}.json`, null);
  await store.setBytes(`${key}.bin`, Buffer.from('ok'), { contentType: 'application/octet-stream' });
  const bytes = await store.getBytes(`${key}.bin`);
  await store.delete?.(`${key}.json`);
  await store.delete?.(`${key}.bin`);
  if (!json?.ok || Buffer.from(bytes || []).toString('utf8') !== 'ok') {
    return { status: 'fail', detail: 'Store read/write verification failed.', action: 'Check EdgeOne storage permissions.' };
  }
  return { status: 'ok', detail: 'JSON and Blob read/write succeeded.' };
}

async function checkPlaySource({ trackId, ctx, getSharedLibrary, resolveTrack }) {
  const library = await getSharedLibrary();
  const recentId = (ctx?.state?.plays || []).slice().reverse().find(play => play.trackId)?.trackId;
  const id = trackId || recentId || library.tracks?.[0]?.id || '';
  const track = library.tracks?.find(item => String(item.id) === String(id) || String(item.originalId) === String(id)) || library.tracks?.[0];
  if (!track) return { status: 'skip', detail: 'No track is available for play source check.' };
  const resolved = await withTimeout(resolveTrack(track), CHECK_TIMEOUT_MS, null);
  if (!resolved?.playable) return { status: 'warn', detail: `Could not resolve a playable URL for ${track.name}.`, action: 'Check NETEASE_COOKIE or use another track.' };
  return { status: 'ok', detail: `Playable source resolved for ${resolved.name || track.name}.` };
}

async function checkAiMusic(minimax) {
  if (!minimax?.apiKey) return { status: 'warn', detail: 'MiniMax music key is not configured.', action: 'Configure MINIMAX_API_KEY to enable AI original music.' };
  return { status: 'ok', detail: `MiniMax music configured with model ${minimax.model || 'music-2.6-free'}.` };
}

function checkRecentFailure(session = {}) {
  const failure = session?.radioDebug?.lastRecommendationFailure || null;
  return {
    id: 'recent_failure',
    label: 'Recent Recommendation Failure',
    status: failure ? 'warn' : 'ok',
    detail: failure ? sanitizeDetail(failure.message || 'Recent recommendation had a failure.') : 'No recent recommendation failure recorded.',
    action: failure ? 'Open the radio debug panel for queue and candidate details.' : null,
    ms: 0
  };
}

function summarizeChecks(checks) {
  const failed = checks.filter(check => check.status === 'fail').length;
  const warned = checks.filter(check => check.status === 'warn').length;
  if (failed) return `${failed} required check(s) failed. Fix them before competition demo.`;
  if (warned) return `${warned} warning check(s). Core demo can continue, but verify before sharing.`;
  return 'Core EdgeOne demo checks passed.';
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

function sanitizeDetail(value = '') {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/MUSIC_U=[^;\s]+/gi, 'MUSIC_U=[redacted]')
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/g, '[redacted-token]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/gi, 'sk-[redacted]')
    .slice(0, 240);
}

function shortPath(filePath) {
  const parts = String(filePath || '').split(/[\\/]/).filter(Boolean);
  return parts.slice(-3).join('/');
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
