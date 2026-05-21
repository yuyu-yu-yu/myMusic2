import { getWeatherSummary } from './ai.mjs';

const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
const GEO_CACHE = new Map();
const WEATHER_CACHE = new Map();
const WEATHER_CACHE_MS = 10 * 60 * 1000;

export async function resolveRequestEnvironment(req, config = {}, { includeWeather = false } = {}) {
  const fallback = fallbackEnvironment(config);
  const clientHints = extractClientEnvironmentHints(req);
  const ip = extractClientIp(req);
  const geo = applyClientHints(await resolveIpGeo(ip, config.ipGeo, fallback), clientHints, fallback);
  const environment = {
    ...fallback,
    ...geo,
    clientTimeZone: clientHints.timeZone || undefined,
    ip: maskIp(ip),
    updatedAt: new Date().toISOString()
  };

  if (includeWeather) {
    environment.weather = await getCachedEnvironmentWeather(environment, config.weather);
  }

  return environment;
}

export function configWithEnvironment(config = {}, environment = {}) {
  const timeZone = environment.timeZone || config.weather?.timeZone || config.app?.timeZone || DEFAULT_TIME_ZONE;
  return {
    ...config,
    app: {
      ...(config.app || {}),
      timeZone
    },
    weather: {
      ...(config.weather || {}),
      city: environment.city || config.weather?.city || '上海',
      countryCode: environment.countryCode || config.weather?.countryCode || 'CN',
      timeZone,
      latitude: environment.latitude,
      longitude: environment.longitude
    }
  };
}

export function extractClientIp(req) {
  const headers = req?.headers || {};
  const forwarded = firstHeaderValue(headers['x-forwarded-for']);
  const realIp = firstHeaderValue(headers['x-real-ip']);
  const candidate = forwarded || realIp || req?.socket?.remoteAddress || '';
  return normalizeIp(candidate);
}

export function extractClientEnvironmentHints(req) {
  const headers = req?.headers || {};
  const timeZone = normalizeTimeZone(firstHeaderValue(headers['x-demo-time-zone']));
  const locale = firstHeaderValue(headers['x-demo-locale']).slice(0, 40);
  return { timeZone, locale };
}

function firstHeaderValue(value) {
  const text = Array.isArray(value) ? value[0] : value;
  return String(text || '').split(',')[0].trim();
}

function normalizeIp(value) {
  let ip = String(value || '').trim();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) ip = ip.slice('::ffff:'.length);
  if (ip.includes(':') && ip.includes('.')) ip = ip.split(':').pop();
  return ip;
}

async function resolveIpGeo(ip, ipGeoConfig = {}, fallback) {
  const provider = String(ipGeoConfig.provider || 'ip-api').toLowerCase();
  if (!isPublicIp(ip) || provider !== 'ip-api') {
    return { source: 'fallback' };
  }

  const now = Date.now();
  const cacheMs = Math.max(60000, Number(ipGeoConfig.cacheMs || 10 * 60 * 1000) || 10 * 60 * 1000);
  const cached = GEO_CACHE.get(ip);
  if (cached && now - cached.cachedAt < cacheMs) return cached.value;

  try {
    const timeoutMs = Math.max(500, Number(ipGeoConfig.timeoutMs || 2500) || 2500);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = new URL(`http://ip-api.com/json/${encodeURIComponent(ip)}`);
    url.searchParams.set('fields', 'status,message,countryCode,city,lat,lon,timezone,query');
    const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (!response.ok) throw new Error(`ip-api HTTP ${response.status}`);
    const data = await response.json();
    if (data.status !== 'success') throw new Error(data.message || 'ip-api lookup failed');
    const value = {
      source: 'ip-api',
      city: String(data.city || fallback.city || '上海').trim(),
      countryCode: String(data.countryCode || fallback.countryCode || 'CN').trim(),
      timeZone: String(data.timezone || fallback.timeZone || DEFAULT_TIME_ZONE).trim(),
      latitude: Number(data.lat),
      longitude: Number(data.lon)
    };
    GEO_CACHE.set(ip, { cachedAt: now, value });
    return value;
  } catch (error) {
    return {
      source: 'fallback',
      error: error?.message || String(error)
    };
  }
}

function applyClientHints(geo, clientHints, fallback) {
  const timeZone = clientHints.timeZone;
  if (!timeZone) return geo;
  if (geo?.source === 'ip-api' && geo.countryCode !== 'CN' && timeZone === 'Asia/Shanghai') {
    return {
      source: 'client-time-zone',
      city: fallback.city || 'Shanghai',
      countryCode: fallback.countryCode || 'CN',
      timeZone,
      latitude: fallback.latitude,
      longitude: fallback.longitude,
      ipGeoSource: geo.source,
      ipGeoCity: geo.city,
      ipGeoCountryCode: geo.countryCode
    };
  }
  if (geo?.source === 'fallback') {
    return {
      ...geo,
      timeZone
    };
  }
  return geo;
}

function normalizeTimeZone(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+){1,3}$/.test(text)) return '';
  return text.slice(0, 80);
}

async function getCachedEnvironmentWeather(environment, weatherConfig = {}) {
  const key = [
    environment.source,
    environment.city,
    environment.countryCode,
    environment.timeZone,
    environment.latitude,
    environment.longitude
  ].join('|');
  const cached = WEATHER_CACHE.get(key);
  if (cached && Date.now() - cached.cachedAt < WEATHER_CACHE_MS) return cached.weather;
  const weather = await getWeatherSummary({
    ...(weatherConfig || {}),
    city: environment.city,
    countryCode: environment.countryCode,
    timeZone: environment.timeZone,
    latitude: environment.latitude,
    longitude: environment.longitude
  });
  WEATHER_CACHE.set(key, { cachedAt: Date.now(), weather });
  return weather;
}

function fallbackEnvironment(config = {}) {
  return {
    source: 'fallback',
    city: config.weather?.city || '上海',
    countryCode: config.weather?.countryCode || 'CN',
    timeZone: config.weather?.timeZone || config.app?.timeZone || DEFAULT_TIME_ZONE,
    latitude: undefined,
    longitude: undefined
  };
}

function isPublicIp(ip) {
  if (!ip) return false;
  if (ip === '::1' || ip === 'localhost') return false;
  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    return !(lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:'));
  }
  const parts = ip.split('.').map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
}

function maskIp(ip) {
  if (!ip) return '';
  if (ip.includes(':')) return ip.split(':').slice(0, 2).join(':') + ':***';
  const parts = ip.split('.');
  if (parts.length !== 4) return '';
  return `${parts[0]}.${parts[1]}.***.${parts[3]}`;
}
