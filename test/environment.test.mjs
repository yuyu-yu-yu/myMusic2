import assert from 'node:assert/strict';
import test from 'node:test';
import { configWithEnvironment, extractClientIp, resolveRequestEnvironment } from '../server/environment.mjs';

function mockRequest(headers = {}, remoteAddress = '127.0.0.1') {
  return { headers, socket: { remoteAddress } };
}

function baseConfig() {
  return {
    app: { timeZone: 'Asia/Shanghai' },
    weather: {
      provider: 'openmeteo',
      city: 'Shanghai',
      countryCode: 'CN',
      timeZone: 'Asia/Shanghai'
    },
    ipGeo: {
      provider: 'ip-api',
      timeoutMs: 1000,
      cacheMs: 60000
    }
  };
}

test('environment resolver uses forwarded public IP geolocation', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      async json() {
        return {
          status: 'success',
          countryCode: 'CN',
          city: 'Guangzhou',
          lat: 23.1291,
          lon: 113.2644,
          timezone: 'Asia/Shanghai',
          query: '8.8.8.8'
        };
      }
    };
  };

  const environment = await resolveRequestEnvironment(
    mockRequest({ 'x-forwarded-for': '8.8.8.8, 10.0.0.1' }),
    baseConfig()
  );

  assert.equal(extractClientIp(mockRequest({ 'x-real-ip': '::ffff:8.8.4.4' })), '8.8.4.4');
  assert.equal(environment.source, 'ip-api');
  assert.equal(environment.city, 'Guangzhou');
  assert.equal(environment.countryCode, 'CN');
  assert.equal(environment.timeZone, 'Asia/Shanghai');
  assert.equal(environment.latitude, 23.1291);
  assert.equal(environment.longitude, 113.2644);
  assert.equal(environment.ip, '8.8.***.8');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /ip-api\.com\/json\/8\.8\.8\.8/);
});

test('environment resolver falls back for private IPs without network lookup', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('unexpected fetch');
  };

  const environment = await resolveRequestEnvironment(
    mockRequest({ 'x-forwarded-for': '192.168.1.8' }),
    baseConfig()
  );

  assert.equal(environment.source, 'fallback');
  assert.equal(environment.city, 'Shanghai');
  assert.equal(environment.countryCode, 'CN');
  assert.equal(environment.timeZone, 'Asia/Shanghai');
  assert.equal(called, false);
});

test('environment resolver prefers Shanghai fallback when browser timezone contradicts overseas proxy IP', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        status: 'success',
        countryCode: 'US',
        city: 'Los Angeles',
        lat: 34.0549,
        lon: -118.243,
        timezone: 'America/Los_Angeles'
      };
    }
  });

  const environment = await resolveRequestEnvironment(
    mockRequest({
      'x-forwarded-for': '154.64.1.166',
      'x-demo-time-zone': 'Asia/Shanghai',
      'x-demo-locale': 'zh-CN'
    }),
    baseConfig()
  );

  assert.equal(environment.source, 'client-time-zone');
  assert.equal(environment.city, 'Shanghai');
  assert.equal(environment.countryCode, 'CN');
  assert.equal(environment.timeZone, 'Asia/Shanghai');
  assert.equal(environment.ipGeoCity, 'Los Angeles');
  assert.equal(environment.ipGeoCountryCode, 'US');
});

test('environment weather uses IP coordinates and falls back cleanly on weather failure', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls = [];
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('ip-api.com')) {
      return {
        ok: true,
        async json() {
          return {
            status: 'success',
            countryCode: 'CN',
            city: 'Guangzhou',
            lat: 23.1291,
            lon: 113.2644,
            timezone: 'Asia/Shanghai'
          };
        }
      };
    }
    if (href.includes('api.open-meteo.com')) {
      return {
        ok: true,
        async json() {
          return {
            current: {
              temperature_2m: 24.4,
              apparent_temperature: 25.1,
              relative_humidity_2m: 61,
              precipitation: 0,
              rain: 0,
              weather_code: 1,
              wind_speed_10m: 5.8
            }
          };
        }
      };
    }
    throw new Error(`unexpected URL ${href}`);
  };

  const environment = await resolveRequestEnvironment(
    mockRequest({ 'x-forwarded-for': '8.8.4.4' }),
    baseConfig(),
    { includeWeather: true }
  );

  assert.equal(environment.source, 'ip-api');
  assert.equal(environment.city, 'Guangzhou');
  assert.match(environment.weather, /^Guangzhou /);
  assert.match(environment.weather, /24°C/);
  assert.equal(calls.some((href) => href.includes('geocoding-api.open-meteo.com')), false);
  const forecastCall = calls.find((href) => href.includes('api.open-meteo.com'));
  assert.match(forecastCall, /latitude=23\.1291/);
  assert.match(forecastCall, /longitude=113\.2644/);

  const scopedConfig = configWithEnvironment(baseConfig(), environment);
  assert.equal(scopedConfig.weather.city, 'Guangzhou');
  assert.equal(scopedConfig.weather.latitude, 23.1291);
  assert.equal(scopedConfig.app.timeZone, 'Asia/Shanghai');
});
