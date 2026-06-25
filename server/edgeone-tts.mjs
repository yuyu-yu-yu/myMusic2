import crypto from 'node:crypto';
import { enforceQuota } from './edgeone-quota.mjs';

export async function synthesizeEdgeSpeech({ config = {}, text = '', store, quota = null } = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText || !config.provider) return null;
  if (quota) await enforceQuota({ ...quota, store, kind: 'tts' });

  const provider = String(config.provider || '').toLowerCase();
  const id = crypto.createHash('sha256')
    .update(JSON.stringify({ provider, voice: config.voice || config.volcengine?.voiceType || '', text: cleanText }))
    .digest('hex');
  const key = `tts/${id}.mp3`;
  const cached = await store.getBytes(key);
  if (cached?.length) return `/api/tts/${id}.mp3`;

  const bytes = provider === 'volcengine'
    ? await synthesizeVolcengineV3(config, cleanText)
    : provider === 'openai'
      ? await synthesizeOpenAi(config, cleanText)
      : null;
  if (!bytes?.length) return null;
  await store.setBytes(key, bytes, { contentType: 'audio/mpeg', createdAt: new Date().toISOString() });
  return `/api/tts/${id}.mp3`;
}

async function synthesizeOpenAi(config, text) {
  if (!config.baseUrl || !config.apiKey) return null;
  const response = await fetchWithTimeout(new URL('/v1/audio/speech', config.baseUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model || 'tts-1',
      voice: config.voice || 'alloy',
      input: text,
      format: 'mp3'
    })
  }, config.timeoutMs || 8000);
  if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function synthesizeVolcengineV3(config, text) {
  const volc = config.volcengine || {};
  const endpoint = volc.endpoint || 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse';
  const accessKey = volc.accessKey || volc.accessToken || '';
  const voiceType = volc.voiceType || config.voice || '';
  if (!accessKey || !voiceType) return null;
  const resourceIds = uniqueNonEmpty([volc.resourceId || '', 'seed-tts-2.0', 'volc.service_type.10029']);
  for (const resourceId of resourceIds) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: buildVolcengineV3Headers(volc, accessKey, resourceId),
        body: JSON.stringify({
          user: { uid: 'cancan-edgeone' },
          req_params: {
            text: limitUtf8Bytes(text, 1024),
            speaker: voiceType,
            audio_params: {
              format: 'mp3',
              sample_rate: 24000,
              speech_rate: toPercentRate(volc.speedRatio, 1),
              loudness_rate: toPercentRate(volc.volumeRatio, 1)
            }
          }
        })
      }, config.timeoutMs || 8000);
      if (!response.ok) throw new Error(`Volcengine TTS V3 HTTP ${response.status}`);
      const bytes = await readVolcengineV3Audio(response);
      if (bytes.length) return bytes;
    } catch (error) {
      console.warn(`[edgeone tts fallback] ${resourceId}: ${error.message}`);
    }
  }
  return null;
}

function buildVolcengineV3Headers(volc, accessKey, resourceId) {
  const headers = {
    'content-type': 'application/json',
    'x-api-resource-id': resourceId,
    'x-api-request-id': crypto.randomUUID(),
    accept: 'application/json'
  };
  if ((volc.authType || 'api-key') === 'legacy') {
    headers.authorization = `Bearer;${accessKey}`;
    headers['x-api-app-id'] = volc.appId || '';
    headers['x-api-access-key'] = accessKey;
    headers['x-api-app-key'] = volc.appKey || 'aGjiRDfUWi';
  } else {
    headers['x-api-key'] = accessKey;
  }
  return headers;
}

async function readVolcengineV3Audio(response) {
  const text = await response.text();
  const chunks = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const jsonText = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (!jsonText || jsonText === '[DONE]') continue;
    let item;
    try {
      item = JSON.parse(jsonText);
    } catch {
      continue;
    }
    const code = Number(item.code ?? 0);
    if (code > 0 && code !== 20000000) throw new Error(`Volcengine TTS V3 ${code}: ${item.message || item.msg || 'unknown error'}`);
    if (item.data) chunks.push(Buffer.from(item.data, 'base64'));
  }
  return Buffer.concat(chunks);
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function toPercentRate(value, base) {
  return Math.round((Number(value || base) - base) * 100);
}

function limitUtf8Bytes(text, maxBytes) {
  let result = '';
  for (const char of String(text || '')) {
    const next = result + char;
    if (Buffer.byteLength(next, 'utf8') > maxBytes) break;
    result = next;
  }
  return result;
}

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}
