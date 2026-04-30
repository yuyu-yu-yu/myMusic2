import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getWeatherSummary, synthesizeSpeech } from '../server/ai.mjs';

test('volcengine TTS V3 posts API-key headers and caches streamed mp3 chunks', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-ai-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const audioBytes = Buffer.from([0x49, 0x44, 0x33, 0x05]);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      async text() {
        return [
          JSON.stringify({ code: 0, data: audioBytes.slice(0, 2).toString('base64') }),
          JSON.stringify({ code: 0, data: audioBytes.slice(2).toString('base64') }),
          JSON.stringify({ code: 20000000, message: 'ok' })
        ].join('\n');
      }
    };
  };

  const config = {
    provider: 'volcengine',
    volcengine: {
      appId: 'app-123',
      accessKey: 'key-abc',
      authType: 'api-key',
      version: 'v3',
      resourceId: 'seed-tts-2.0',
      appKey: 'aGjiRDfUWi',
      voiceType: 'zh_female_vv_uranus_bigtts',
      endpoint: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse'
    }
  };

  const ttsUrl = await synthesizeSpeech(config, 'hello radio', rootDir);
  assert.match(ttsUrl, /^\/api\/tts\/[a-f0-9]{64}\.mp3$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse');
  assert.equal(calls[0].options.headers['x-api-key'], 'key-abc');
  assert.equal(calls[0].options.headers['x-api-resource-id'], 'seed-tts-2.0');
  assert.equal(calls[0].options.headers['x-api-app-id'], undefined);
  assert.equal(calls[0].options.headers['x-api-access-key'], undefined);

  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.req_params.text, 'hello radio');
  assert.equal(payload.req_params.speaker, 'zh_female_vv_uranus_bigtts');
  assert.equal(payload.req_params.audio_params.format, 'mp3');
  assert.equal(payload.req_params.audio_params.sample_rate, 24000);

  const fileName = path.basename(ttsUrl);
  const cachedBytes = fs.readFileSync(path.join(rootDir, 'cache', 'tts', fileName));
  assert.deepEqual(cachedBytes, audioBytes);
});

test('volcengine TTS posts expected payload and caches decoded mp3', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-ai-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const audioBytes = Buffer.from([0x49, 0x44, 0x33, 0x04]);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      async json() {
        return { code: 3000, message: 'Success', data: audioBytes.toString('base64') };
      }
    };
  };

  const config = {
    provider: 'volcengine',
    voice: '',
    volcengine: {
      appId: 'app-123',
      accessToken: 'token-abc',
      cluster: 'volcano_tts',
      voiceType: 'BV700_streaming',
      endpoint: 'https://openspeech.bytedance.com/api/v1/tts'
    }
  };

  const ttsUrl = await synthesizeSpeech(config, '现在开始私人电台。', rootDir);
  assert.match(ttsUrl, /^\/api\/tts\/[a-f0-9]{64}\.mp3$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openspeech.bytedance.com/api/v1/tts');
  assert.equal(calls[0].options.headers.authorization, 'Bearer;token-abc');

  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.app.appid, 'app-123');
  assert.equal(payload.app.token, 'token-abc');
  assert.equal(payload.app.cluster, 'volcano_tts');
  assert.equal(payload.audio.voice_type, 'BV700_streaming');
  assert.equal(payload.audio.encoding, 'mp3');
  assert.equal(payload.audio.rate, 24000);
  assert.equal(payload.request.text, '现在开始私人电台。');
  assert.equal(payload.request.text_type, 'plain');
  assert.equal(payload.request.operation, 'query');
  assert.match(payload.request.reqid, /^[0-9a-f-]{36}$/);

  const fileName = path.basename(ttsUrl);
  const cachedBytes = fs.readFileSync(path.join(rootDir, 'cache', 'tts', fileName));
  assert.deepEqual(cachedBytes, audioBytes);

  const cachedUrl = await synthesizeSpeech(config, '现在开始私人电台。', rootDir);
  assert.equal(cachedUrl, ttsUrl);
  assert.equal(calls.length, 1);
});

test('volcengine TTS failure falls back to null', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-ai-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { code: 3011, message: 'invalid text' };
    }
  });

  const ttsUrl = await synthesizeSpeech({
    provider: 'volcengine',
    volcengine: {
      appId: 'app-123',
      accessToken: 'token-abc',
      cluster: 'volcano_tts',
      voiceType: 'BV700_streaming'
    }
  }, '测试', rootDir);

  assert.equal(ttsUrl, null);
});

test('Open-Meteo weather geocodes city and returns Chinese summary', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls = [];
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.startsWith('https://geocoding-api.open-meteo.com/v1/search')) {
      return {
        ok: true,
        async json() {
          return {
            results: [
              { name: '上海', latitude: 31.22222, longitude: 121.45806 }
            ]
          };
        }
      };
    }
    return {
      ok: true,
      async json() {
        return {
          current: {
            temperature_2m: 23.2,
            apparent_temperature: 24.1,
            relative_humidity_2m: 68,
            precipitation: 0,
            rain: 0,
            weather_code: 3,
            wind_speed_10m: 4.5
          }
        };
      }
    };
  };

  const summary = await getWeatherSummary({
    provider: 'openmeteo',
    city: '上海',
    countryCode: 'CN'
  });

  assert.equal(summary, '上海 阴，23°C，体感 24°C，湿度 68%，微风，当前无降水');
  assert.equal(calls.length, 2);
  assert.match(calls[0], /geocoding-api\.open-meteo\.com\/v1\/search/);
  assert.match(calls[0], /name=%E4%B8%8A%E6%B5%B7/);
  assert.match(calls[0], /countryCode=CN/);
  assert.match(calls[1], /api\.open-meteo\.com\/v1\/forecast/);
  assert.match(calls[1], /current=temperature_2m%2Crelative_humidity_2m%2Capparent_temperature%2Cprecipitation%2Crain%2Cweather_code%2Cwind_speed_10m/);
});

test('Open-Meteo weather failure returns fallback summary', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => ({ ok: false, status: 500 });

  const summary = await getWeatherSummary({
    provider: 'openmeteo',
    city: '上海',
    countryCode: 'CN'
  });

  assert.match(summary, /^上海，天气获取失败：Open-Meteo geocoding HTTP 500。按当前时间和本地音乐画像推荐。$/);
});
