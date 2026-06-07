import assert from 'node:assert/strict';
import test from 'node:test';
import { getConfig } from '../server/config.mjs';

const ENV_KEYS = [
  'DEMO_GUEST_MODE',
  'REQUIRE_BROWSER_PLAY_URL',
  'LOCAL_DEV_UNLOCK_DEMO'
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
