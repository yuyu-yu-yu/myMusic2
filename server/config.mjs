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
  const localDevUnlockDemo = parseBoolean(env.LOCAL_DEV_UNLOCK_DEMO);
  return {
    server: {
      port: Number(env.PORT || 3000),
      host: env.HOST || '127.0.0.1'
    },
    app: {
      timeZone: env.APP_TIME_ZONE || 'Asia/Shanghai'
    },
    demo: {
      guestMode: parseBoolean(env.DEMO_GUEST_MODE) && !localDevUnlockDemo,
      guestTtlHours: Math.max(1, Number(env.DEMO_GUEST_TTL_HOURS || 720) || 720),
      localDevUnlock: localDevUnlockDemo
    },
    playback: {
      requireBrowserPlayUrl: parseBoolean(env.REQUIRE_BROWSER_PLAY_URL) && !localDevUnlockDemo
    },
    recommendation: {
      pipeline: normalizeRecommendationPipeline(env.RECOMMENDATION_PIPELINE),
      discoveryRatio: clampNumber(env.RECOMMENDATION_DISCOVERY_RATIO, 0, 1, 0.5),
      discoveryTimeoutMs: Math.max(1, Number(env.RECOMMENDATION_DISCOVERY_TIMEOUT_MS || 1200) || 1200),
      discoveryCacheTtlMs: Math.max(0, Number(env.RECOMMENDATION_DISCOVERY_CACHE_TTL_MS || 1800000) || 1800000),
      styleSearchTimeoutMs: Math.max(1, Number(env.RECOMMENDATION_STYLE_SEARCH_TIMEOUT_MS || 1500) || 1500),
      styleSearchLimit: parseNonNegativeNumber(env.RECOMMENDATION_STYLE_SEARCH_LIMIT, 30),
      strictStyle: env.RECOMMENDATION_STRICT_STYLE === undefined ? true : parseBoolean(env.RECOMMENDATION_STRICT_STYLE),
      promptArtistLimit: parseNonNegativeNumber(env.RECOMMENDATION_PROMPT_ARTIST_LIMIT, 5),
      artistDensityWindow: parseNonNegativeNumber(env.RECOMMENDATION_ARTIST_DENSITY_WINDOW, 8),
      artistDensityMax: parseNonNegativeNumber(env.RECOMMENDATION_ARTIST_DENSITY_MAX, 3),
      genreDensityWindow: parseNonNegativeNumber(env.RECOMMENDATION_GENRE_DENSITY_WINDOW, 6),
      genreDensityMax: parseNonNegativeNumber(env.RECOMMENDATION_GENRE_DENSITY_MAX, 3),
      genreEnergyStreakMax: parseNonNegativeNumber(env.RECOMMENDATION_GENRE_ENERGY_STREAK_MAX, 2)
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
      model: env.LLM_MODEL || '',
      timeoutMs: Math.max(500, Number(env.LLM_REQUEST_TIMEOUT_MS || 12000) || 12000)
    },
    minimax: {
      baseUrl: env.MINIMAX_MUSIC_BASE_URL || env.MINIMAX_BASE_URL || 'https://api.minimaxi.com',
      apiKey: env.MINIMAX_API_KEY || env.MINIMAX_MUSIC_API_KEY || '',
      model: env.MINIMAX_MUSIC_MODEL || 'music-2.6-free',
      requestTimeoutMs: Math.max(1000, Number(env.MINIMAX_MUSIC_TIMEOUT_MS || env.MINIMAX_REQUEST_TIMEOUT_MS || 180000) || 180000),
      allowPaidMusic: String(env.MINIMAX_ALLOW_PAID_MUSIC || '').toLowerCase() === 'true'
    },
    tts: {
      provider: env.TTS_PROVIDER || '',
      baseUrl: env.TTS_BASE_URL || '',
      apiKey: env.TTS_API_KEY || '',
      model: env.TTS_MODEL || '',
      voice: env.TTS_VOICE || '',
      timeoutMs: Math.max(500, Number(env.TTS_REQUEST_TIMEOUT_MS || 8000) || 8000),
      volcengine: {
        appId: env.VOLCENGINE_TTS_APP_ID || '',
        accessToken: env.VOLCENGINE_TTS_ACCESS_TOKEN || '',
        accessKey: env.VOLCENGINE_TTS_ACCESS_KEY || env.VOLCENGINE_TTS_API_KEY || '',
        authType: env.VOLCENGINE_TTS_AUTH_TYPE || 'api-key',
        cluster: env.VOLCENGINE_TTS_CLUSTER || 'volcano_tts',
        voiceType: env.VOLCENGINE_TTS_VOICE_TYPE || '',
        version: env.VOLCENGINE_TTS_VERSION || 'v3',
        endpoint: env.VOLCENGINE_TTS_ENDPOINT || 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse',
        resourceId: env.VOLCENGINE_TTS_RESOURCE_ID || 'seed-tts-2.0',
        appKey: env.VOLCENGINE_TTS_APP_KEY || 'aGjiRDfUWi',
        speedRatio: env.VOLCENGINE_TTS_SPEED_RATIO || '1',
        volumeRatio: env.VOLCENGINE_TTS_VOLUME_RATIO || '1',
        pitchRatio: env.VOLCENGINE_TTS_PITCH_RATIO || '1',
        language: env.VOLCENGINE_TTS_LANGUAGE || 'cn'
      }
    },
    weather: {
      provider: env.WEATHER_PROVIDER || (env.WEATHER_API_KEY ? 'openweathermap' : 'openmeteo'),
      city: env.WEATHER_CITY || '上海',
      countryCode: env.WEATHER_COUNTRY_CODE || 'CN',
      apiKey: env.WEATHER_API_KEY || '',
      timeZone: env.WEATHER_TIME_ZONE || env.APP_TIME_ZONE || 'Asia/Shanghai'
    },
    ipGeo: {
      provider: env.IP_GEO_PROVIDER || 'ip-api',
      timeoutMs: Math.max(500, Number(env.IP_GEO_TIMEOUT_MS || 2500) || 2500),
      cacheMs: Math.max(60000, Number(env.IP_GEO_CACHE_MS || 10 * 60 * 1000) || 10 * 60 * 1000)
    },
    schedule: buildScheduleConfig(env)
  };
}

function buildScheduleConfig(env) {
  const enabled = parseBoolean(env.SCHEDULE_MCP_ENABLED);
  const allowedTools = parseStringArray(env.SCHEDULE_MCP_ALLOWED_TOOLS_JSON, [
    'calendar.v4.calendar.primary',
    'calendar.v4.calendarEvent.list',
    'calendar.v4.freebusy.list'
  ]);
  const explicitArgs = parseStringArray(env.SCHEDULE_MCP_ARGS_JSON, []);
  const hasFeishuCredentials = Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET);
  const defaultArgs = hasFeishuCredentials
    ? [
        '-y',
        '@larksuiteoapi/lark-mcp',
        'mcp',
        '-a',
        '${FEISHU_APP_ID}',
        '-s',
        '${FEISHU_APP_SECRET}',
        '--token-mode',
        'auto',
        '-t',
        allowedTools.join(',')
      ]
    : [];
  return {
    enabled,
    provider: env.SCHEDULE_MCP_PROVIDER || 'feishu',
    command: env.SCHEDULE_MCP_COMMAND || (enabled ? 'npx' : ''),
    args: explicitArgs.length ? explicitArgs : defaultArgs,
    cwd: env.SCHEDULE_MCP_CWD || '',
    env: parseStringMap(env.SCHEDULE_MCP_ENV_JSON),
    allowedTools,
    timeoutMs: Math.max(250, Number(env.SCHEDULE_MCP_TIMEOUT_MS || 2500) || 2500),
    cacheMs: Math.max(1000, Number(env.SCHEDULE_MCP_CACHE_MS || 5 * 60 * 1000) || 5 * 60 * 1000),
    failureCacheMs: Math.max(1000, Number(env.SCHEDULE_MCP_FAILURE_CACHE_MS || 30 * 60 * 1000) || 30 * 60 * 1000),
    lookaheadHours: Math.max(1, Math.min(72, Number(env.SCHEDULE_MCP_LOOKAHEAD_HOURS || 24) || 24))
  };
}

function parseStringArray(value, fallback = []) {
  if (!value) return [...fallback];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(item => String(item || '').trim()).filter(Boolean) : [...fallback];
  } catch {
    return [...fallback];
  }
}

function parseStringMap(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [String(key), String(item ?? '')]));
  } catch {
    return {};
  }
}

export function publicConfigStatus(config) {
  const ttsProvider = (config.tts.provider || '').toLowerCase();
  const volcengineTts = config.tts.volcengine || {};
  const ttsConfigured = ttsProvider === 'openai'
    ? Boolean(config.tts.baseUrl && config.tts.apiKey)
    : ttsProvider === 'volcengine'
      ? Boolean((volcengineTts.accessKey || volcengineTts.accessToken) && volcengineTts.voiceType)
      : false;
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
    minimax: {
      configured: Boolean(config.minimax?.apiKey),
      model: config.minimax?.model || null
    },
    tts: {
      configured: ttsConfigured,
      provider: config.tts.provider || null,
      voice: config.tts.voice || volcengineTts.voiceType || null
    },
    weather: {
      configured: Boolean(config.weather.city),
      provider: config.weather.provider || null,
      city: config.weather.city || null,
      timeZone: config.weather.timeZone || config.app?.timeZone || null
    },
    demo: {
      guestMode: Boolean(config.demo?.guestMode),
      guestTtlHours: config.demo?.guestTtlHours || 720,
      localDevUnlock: Boolean(config.demo?.localDevUnlock)
    },
    playback: {
      requireBrowserPlayUrl: Boolean(config.playback?.requireBrowserPlayUrl)
    },
    recommendation: {
      pipeline: config.recommendation?.pipeline || 'hybrid',
      promptArtistLimit: config.recommendation?.promptArtistLimit ?? 5,
      artistDensityWindow: config.recommendation?.artistDensityWindow ?? 8,
      artistDensityMax: config.recommendation?.artistDensityMax ?? 3,
      genreDensityWindow: config.recommendation?.genreDensityWindow ?? 6,
      genreDensityMax: config.recommendation?.genreDensityMax ?? 3,
      genreEnergyStreakMax: config.recommendation?.genreEnergyStreakMax ?? 2
    },
    schedule: {
      enabled: Boolean(config.schedule?.enabled),
      configured: Boolean(config.schedule?.enabled && config.schedule?.command && config.schedule?.args?.length),
      provider: config.schedule?.provider || 'feishu',
      timeoutMs: config.schedule?.timeoutMs || 2500,
      cacheMs: config.schedule?.cacheMs || 300000
    }
  };
}

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normalizeRecommendationPipeline(value) {
  return String(value || '').trim().toLowerCase() === 'legacy' ? 'legacy' : 'hybrid';
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function parseNonNegativeNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, number);
}
