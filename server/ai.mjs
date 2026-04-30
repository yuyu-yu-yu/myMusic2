import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export async function generateChatCompletion(config, messages, fallback) {
  if (!config.baseUrl || !config.apiKey || !config.model) return fallback();
  const url = new URL('/v1/chat/completions', config.baseUrl);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.8
      })
    });
    if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);
    const json = await response.json();
    return json.choices?.[0]?.message?.content?.trim() || fallback();
  } catch (error) {
    console.warn('[llm fallback]', error.message);
    return fallback();
  }
}

export async function synthesizeSpeech(config, text, rootDir = process.cwd()) {
  if (!config.provider || !text) return null;
  const provider = config.provider.toLowerCase();
  if (provider === 'openai') return synthesizeOpenAiSpeech(config, text, rootDir);
  if (provider === 'volcengine') return synthesizeVolcengineSpeech(config, text, rootDir);
  return null;
}

async function synthesizeOpenAiSpeech(config, text, rootDir) {
  if (!config.baseUrl || !config.apiKey) return null;
  const { id, outputPath } = prepareTtsCache(config, text, rootDir);
  if (fs.existsSync(outputPath)) return `/api/tts/${id}.mp3`;

  try {
    const url = new URL('/v1/audio/speech', config.baseUrl);
    const response = await fetch(url, {
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
    });
    if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, bytes);
    return `/api/tts/${id}.mp3`;
  } catch (error) {
    console.warn('[tts fallback]', error.message);
    return null;
  }
}

async function synthesizeVolcengineSpeech(config, text, rootDir) {
  const volc = config.volcengine || {};
  const endpoint = volc.endpoint || 'https://openspeech.bytedance.com/api/v1/tts';
  const appId = volc.appId || '';
  const accessToken = volc.accessToken || '';
  const accessKey = volc.accessKey || '';
  const cluster = volc.cluster || 'volcano_tts';
  const voiceType = volc.voiceType || config.voice || '';
  if (volc.version === 'v3' || endpoint.includes('/api/v3/') || accessKey) {
    return synthesizeVolcengineV3Speech(config, text, rootDir);
  }
  if (!appId || !accessToken || !voiceType) return null;

  const { id, outputPath } = prepareTtsCache(config, text, rootDir);
  if (fs.existsSync(outputPath)) return `/api/tts/${id}.mp3`;

  try {
    const reqid = crypto.randomUUID();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer;${accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        app: {
          appid: appId,
          token: accessToken,
          cluster
        },
        user: {
          uid: 'mymusic-local'
        },
        audio: {
          voice_type: voiceType,
          encoding: 'mp3',
          rate: 24000,
          speed_ratio: Number(volc.speedRatio || 1),
          volume_ratio: Number(volc.volumeRatio || 1),
          pitch_ratio: Number(volc.pitchRatio || 1),
          language: volc.language || 'cn'
        },
        request: {
          reqid,
          text: limitUtf8Bytes(text, 1024),
          text_type: 'plain',
          operation: 'query',
          silence_duration: 125
        }
      })
    });
    if (!response.ok) throw new Error(`Volcengine TTS HTTP ${response.status}`);
    const json = await response.json();
    if (json.code !== 3000 || !json.data) {
      throw new Error(`Volcengine TTS ${json.code || 'unknown'}: ${json.message || 'no audio data'}`);
    }
    const bytes = Buffer.from(json.data, 'base64');
    if (!bytes.length) throw new Error('Volcengine TTS returned empty audio');
    fs.writeFileSync(outputPath, bytes);
    return `/api/tts/${id}.mp3`;
  } catch (error) {
    console.warn('[tts fallback]', error.message);
    return null;
  }
}

async function synthesizeVolcengineV3Speech(config, text, rootDir) {
  const volc = config.volcengine || {};
  const endpoint = volc.endpoint || 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
  const appId = volc.appId || '';
  const accessKey = volc.accessKey || volc.accessToken || '';
  const voiceType = volc.voiceType || config.voice || 'zh_female_vv_uranus_bigtts';
  if (!accessKey || !voiceType) return null;

  const { id, outputPath } = prepareTtsCache(config, text, rootDir);
  if (fs.existsSync(outputPath)) return `/api/tts/${id}.mp3`;

  const resourceIds = uniqueNonEmpty([
    volc.resourceId || '',
    'seed-tts-2.0',
    'volc.service_type.10029'
  ]);

  for (const resourceId of resourceIds) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: buildVolcengineV3Headers(volc, accessKey, appId, resourceId),
        body: JSON.stringify({
          user: {
            uid: 'mymusic-local'
          },
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
      });
      if (!response.ok) throw new Error(`Volcengine TTS V3 HTTP ${response.status}`);
      const bytes = await readVolcengineV3Audio(response);
      if (!bytes.length) throw new Error('Volcengine TTS V3 returned empty audio');
      fs.writeFileSync(outputPath, bytes);
      return `/api/tts/${id}.mp3`;
    } catch (error) {
      console.warn(`[tts fallback] V3 resource ${resourceId}:`, error.message);
    }
  }

  return null;
}

function buildVolcengineV3Headers(volc, accessKey, appId, resourceId) {
  const headers = {
    'content-type': 'application/json',
    'x-api-resource-id': resourceId,
    'x-api-request-id': crypto.randomUUID(),
    accept: 'application/json'
  };
  if ((volc.authType || 'api-key') === 'legacy') {
    headers.authorization = `Bearer;${accessKey}`;
    headers['x-api-app-id'] = appId;
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
    if (code > 0 && code !== 20000000) {
      throw new Error(`Volcengine TTS V3 ${code}: ${item.message || item.msg || 'unknown error'}`);
    }
    if (item.data) chunks.push(Buffer.from(item.data, 'base64'));
  }
  return Buffer.concat(chunks);
}

function toPercentRate(value, base) {
  return Math.round((Number(value || base) - base) * 100);
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function prepareTtsCache(config, text, rootDir) {
  const cacheDir = path.join(rootDir, 'cache', 'tts');
  fs.mkdirSync(cacheDir, { recursive: true });
  const volc = config.volcengine || {};
  const id = crypto.createHash('sha256')
    .update([
      config.provider,
      config.model || '',
      config.voice || '',
      volc.endpoint || '',
      volc.appId || '',
      volc.accessKey ? 'v3' : 'v1',
      volc.resourceId || '',
      volc.cluster || '',
      volc.voiceType || '',
      text
    ].join(':'))
    .digest('hex');
  return { id, outputPath: path.join(cacheDir, `${id}.mp3`) };
}

function limitUtf8Bytes(text, maxBytes) {
  let output = '';
  let bytes = 0;
  for (const char of String(text)) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > maxBytes) break;
    output += char;
    bytes += size;
  }
  return output;
}

export async function getWeatherSummary(config) {
  const city = config.city || '上海';
  const provider = (config.provider || 'openmeteo').toLowerCase();
  if (provider === 'openweathermap') return getOpenWeatherMapSummary(config, city);
  return getOpenMeteoSummary(config, city);
}

async function getOpenMeteoSummary(config, city) {
  try {
    const location = await geocodeOpenMeteo(city, config.countryCode || 'CN');
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(location.latitude));
    url.searchParams.set('longitude', String(location.longitude));
    url.searchParams.set('current', [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'precipitation',
      'rain',
      'weather_code',
      'wind_speed_10m'
    ].join(','));
    url.searchParams.set('timezone', 'auto');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Open-Meteo forecast HTTP ${response.status}`);
    const json = await response.json();
    const current = json.current || {};
    const weather = describeWeatherCode(current.weather_code);
    const temp = roundNumber(current.temperature_2m);
    const apparent = roundNumber(current.apparent_temperature);
    const humidity = roundNumber(current.relative_humidity_2m);
    const wind = describeWind(current.wind_speed_10m);
    const precipitation = describePrecipitation(current.precipitation, current.rain);
    return `${location.name || city} ${weather}，${temp}°C，体感 ${apparent}°C，湿度 ${humidity}%，${wind}，${precipitation}`;
  } catch (error) {
    return `${city}，天气获取失败：${error.message}。按当前时间和本地音乐画像推荐。`;
  }
}

async function geocodeOpenMeteo(city, countryCode) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', city);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'zh');
  url.searchParams.set('format', 'json');
  if (countryCode) url.searchParams.set('countryCode', countryCode);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo geocoding HTTP ${response.status}`);
  const json = await response.json();
  const location = json.results?.[0];
  if (!location) throw new Error(`未找到城市 ${city}`);
  return location;
}

async function getOpenWeatherMapSummary(config, city) {
  if (!config.apiKey) return `${city}，未配置天气 API Key。按当前时间和本地音乐画像推荐。`;
  try {
    const url = new URL('https://api.openweathermap.org/data/2.5/weather');
    url.searchParams.set('q', city);
    url.searchParams.set('appid', config.apiKey);
    url.searchParams.set('units', 'metric');
    url.searchParams.set('lang', 'zh_cn');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`OpenWeatherMap HTTP ${response.status}`);
    const json = await response.json();
    const desc = json.weather?.[0]?.description || '未知天气';
    const temp = roundNumber(json.main?.temp);
    const apparent = roundNumber(json.main?.feels_like);
    const humidity = roundNumber(json.main?.humidity);
    return `${city} ${desc}，${temp}°C，体感 ${apparent}°C，湿度 ${humidity}%`;
  } catch (error) {
    return `${city}，天气获取失败：${error.message}。按当前时间和本地音乐画像推荐。`;
  }
}

function roundNumber(value) {
  return Math.round(Number(value ?? 0));
}

function describePrecipitation(precipitation, rain) {
  const amount = Number(precipitation ?? rain ?? 0);
  if (amount <= 0) return '当前无降水';
  if (amount < 2.5) return `小雨 ${amount.toFixed(1)}mm`;
  if (amount < 8) return `中雨 ${amount.toFixed(1)}mm`;
  return `降水较强 ${amount.toFixed(1)}mm`;
}

function describeWind(speed) {
  const kmh = Number(speed ?? 0);
  if (kmh < 6) return '微风';
  if (kmh < 20) return '有风';
  if (kmh < 39) return '风较大';
  return '大风';
}

function describeWeatherCode(code) {
  const value = Number(code);
  if (value === 0) return '晴';
  if ([1, 2].includes(value)) return '多云';
  if (value === 3) return '阴';
  if ([45, 48].includes(value)) return '雾';
  if ([51, 53, 55, 56, 57].includes(value)) return '毛毛雨';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(value)) return '雨';
  if ([71, 73, 75, 77, 85, 86].includes(value)) return '雪';
  if ([95, 96, 99].includes(value)) return '雷阵雨';
  return '天气未明';
}
