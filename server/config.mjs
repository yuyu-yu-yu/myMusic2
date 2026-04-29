import fs from 'node:fs';
import path from 'node:path';

export function loadEnv(rootDir = process.cwd()) {
  const files = ['.env', '.env.local'];
  for (const file of files) {
    const fullPath = path.join(rootDir, file);
    if (!fs.existsSync(fullPath)) continue;
    const text = fs.readFileSync(fullPath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const index = line.indexOf('=');
      if (index < 0) continue;
      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      value = value.replace(/\\n/g, '\n');
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

export function getConfig() {
  const env = process.env;
  return {
    server: {
      port: Number(env.PORT || 3000),
      host: env.HOST || '127.0.0.1'
    },
    netease: {
      baseUrl: env.NETEASE_BASE_URL || 'https://openapi.music.163.com',
      appId: env.NETEASE_APP_ID || '',
      appSecret: env.NETEASE_APP_SECRET || '',
      privateKey: env.NETEASE_PRIVATE_KEY || '',
      accessToken: env.NETEASE_ACCESS_TOKEN || '',
      device: {
        channel: env.NETEASE_DEVICE_CHANNEL || 'netease',
        deviceId: env.NETEASE_DEVICE_ID || 'mymusiclocal001',
        deviceType: env.NETEASE_DEVICE_TYPE || 'andrcar',
        appVer: env.NETEASE_DEVICE_APP_VER || '6.0.0',
        os: env.NETEASE_DEVICE_OS || 'andrcar',
        osVer: env.NETEASE_DEVICE_OS_VER || '14',
        brand: env.NETEASE_DEVICE_BRAND || 'netease',
        model: env.NETEASE_DEVICE_MODEL || 'myMusic',
        clientIp: env.NETEASE_DEVICE_CLIENT_IP || '127.0.0.1',
        netStatus: env.NETEASE_DEVICE_NET_STATUS || 'wifi',
        flowFlag: env.NETEASE_DEVICE_FLOW_FLAG || 'init'
      }
    },
    llm: {
      baseUrl: env.LLM_BASE_URL || '',
      apiKey: env.LLM_API_KEY || '',
      model: env.LLM_MODEL || ''
    },
    tts: {
      provider: env.TTS_PROVIDER || '',
      baseUrl: env.TTS_BASE_URL || '',
      apiKey: env.TTS_API_KEY || '',
      model: env.TTS_MODEL || '',
      voice: env.TTS_VOICE || ''
    },
    weather: {
      city: env.WEATHER_CITY || '',
      apiKey: env.WEATHER_API_KEY || ''
    }
  };
}

export function publicConfigStatus(config) {
  return {
    netease: {
      appId: Boolean(config.netease.appId),
      privateKey: Boolean(config.netease.privateKey),
      accessToken: Boolean(config.netease.accessToken),
      deviceId: Boolean(config.netease.device.deviceId)
    },
    neteaseToken: null, // populated by index.mjs
    llm: {
      configured: Boolean(config.llm.baseUrl && config.llm.apiKey && config.llm.model),
      model: config.llm.model || null
    },
    tts: {
      configured: Boolean(config.tts.provider && config.tts.baseUrl && config.tts.apiKey),
      provider: config.tts.provider || null,
      voice: config.tts.voice || null
    },
    weather: {
      configured: Boolean(config.weather.city),
      city: config.weather.city || null
    }
  };
}
