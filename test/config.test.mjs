import assert from 'node:assert/strict';
import test from 'node:test';
import { getConfig } from '../server/config.mjs';

const ENV_KEYS = [
  'DEMO_GUEST_MODE',
  'REQUIRE_BROWSER_PLAY_URL',
  'LOCAL_DEV_UNLOCK_DEMO',
  'RECOMMENDATION_DISCOVERY_RATIO',
  'RECOMMENDATION_DISCOVERY_TIMEOUT_MS',
  'RECOMMENDATION_DISCOVERY_CACHE_TTL_MS',
  'RECOMMENDATION_STYLE_SEARCH_TIMEOUT_MS',
  'RECOMMENDATION_STYLE_SEARCH_LIMIT',
  'RECOMMENDATION_STRICT_STYLE'
];

function withEnv(values, fn) {
  const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try {
    return fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('local dev unlock disables demo guest and browser-only playback locks', () => {
  withEnv({
    DEMO_GUEST_MODE: 'true',
    REQUIRE_BROWSER_PLAY_URL: 'true',
    LOCAL_DEV_UNLOCK_DEMO: 'true'
  }, () => {
    const config = getConfig();
    assert.equal(config.demo.guestMode, false);
    assert.equal(config.demo.localDevUnlock, true);
    assert.equal(config.playback.requireBrowserPlayUrl, false);
  });
});

test('demo locks stay enabled without local dev unlock', () => {
  withEnv({
    DEMO_GUEST_MODE: 'true',
    REQUIRE_BROWSER_PLAY_URL: 'true'
  }, () => {
    const config = getConfig();
    assert.equal(config.demo.guestMode, true);
    assert.equal(config.demo.localDevUnlock, false);
    assert.equal(config.playback.requireBrowserPlayUrl, true);
  });
});

test('recommendation discovery env values are parsed', () => {
  withEnv({
    RECOMMENDATION_DISCOVERY_RATIO: '0.5',
    RECOMMENDATION_DISCOVERY_TIMEOUT_MS: '900',
    RECOMMENDATION_DISCOVERY_CACHE_TTL_MS: '60000',
    RECOMMENDATION_STYLE_SEARCH_TIMEOUT_MS: '700',
    RECOMMENDATION_STYLE_SEARCH_LIMIT: '12',
    RECOMMENDATION_STRICT_STYLE: 'false'
  }, () => {
    const config = getConfig();
    assert.equal(config.recommendation.discoveryRatio, 0.5);
    assert.equal(config.recommendation.discoveryTimeoutMs, 900);
    assert.equal(config.recommendation.discoveryCacheTtlMs, 60000);
    assert.equal(config.recommendation.styleSearchTimeoutMs, 700);
    assert.equal(config.recommendation.styleSearchLimit, 12);
    assert.equal(config.recommendation.strictStyle, false);
  });
});
