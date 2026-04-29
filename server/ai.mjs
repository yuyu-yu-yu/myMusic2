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
  if (!config.provider || !config.baseUrl || !config.apiKey || !text) return null;
  if (config.provider.toLowerCase() !== 'openai') return null;

  const cacheDir = path.join(rootDir, 'cache', 'tts');
  fs.mkdirSync(cacheDir, { recursive: true });
  const id = crypto.createHash('sha256').update(`${config.provider}:${config.model}:${config.voice}:${text}`).digest('hex');
  const outputPath = path.join(cacheDir, `${id}.mp3`);
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

export async function getWeatherSummary(config) {
  if (!config.city) return '未配置城市，按本地时间推荐。';
  if (!config.apiKey) return `${config.city}，未配置天气 API Key，按城市和时间推荐。`;
  try {
    const url = new URL('https://api.openweathermap.org/data/2.5/weather');
    url.searchParams.set('q', config.city);
    url.searchParams.set('appid', config.apiKey);
    url.searchParams.set('units', 'metric');
    url.searchParams.set('lang', 'zh_cn');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`weather HTTP ${response.status}`);
    const json = await response.json();
    const desc = json.weather?.[0]?.description || '未知天气';
    return `${config.city} ${desc}，${Math.round(json.main?.temp ?? 0)} 摄氏度`;
  } catch (error) {
    return `${config.city}，天气获取失败：${error.message}`;
  }
}
