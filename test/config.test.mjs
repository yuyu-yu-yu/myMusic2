import assert from 'node:assert/strict';
import test from 'node:test';
import { getConfig, publicConfigStatus } from '../server/config.mjs';

const ENV_KEYS = [
  'DEMO_GUEST_MODE',
  'REQUIRE_BROWSER_PLAY_URL',
  'LOCAL_DEV_UNLOCK_DEMO',
  'RECOMMENDATION_DISCOVERY_RATIO',
  'RECOMMENDATION_DISCOVERY_TIMEOUT_MS',
  'RECOMMENDATION_DISCOVERY_CACHE_TTL_MS',
  'RECOMMENDATION_STYLE_SEARCH_TIMEOUT_MS',
  'RECOMMENDATION_STYLE_SEARCH_LIMIT',
  'RECOMMENDATION_STRICT_STYLE',
  'RECOMMENDATION_PROMPT_ARTIST_LIMIT',
  'RECOMMENDATION_ARTIST_DENSITY_WINDOW',
  'RECOMMENDATION_ARTIST_DENSITY_MAX',
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'LLM_MODEL',
  'SCHEDULE_MCP_ENABLED',
  'SCHEDULE_MCP_PROVIDER',
  'SCHEDULE_MCP_COMMAND',
  'SCHEDULE_MCP_ARGS_JSON',
  'SCHEDULE_MCP_ENV_JSON',
  'SCHEDULE_MCP_ALLOWED_TOOLS_JSON',
  'SCHEDULE_MCP_TIMEOUT_MS',
  'SCHEDULE_MCP_CACHE_MS',
  'SCHEDULE_MCP_FAILURE_CACHE_MS',
  'SCHEDULE_MCP_LOOKAHEAD_HOURS',
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET'
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
    RECOMMENDATION_STRICT_STYLE: 'false',
    RECOMMENDATION_PROMPT_ARTIST_LIMIT: '4',
    RECOMMENDATION_ARTIST_DENSITY_WINDOW: '7',
    RECOMMENDATION_ARTIST_DENSITY_MAX: '2'
  }, () => {
    const config = getConfig();
    assert.equal(config.recommendation.discoveryRatio, 0.5);
    assert.equal(config.recommendation.discoveryTimeoutMs, 900);
    assert.equal(config.recommendation.discoveryCacheTtlMs, 60000);
    assert.equal(config.recommendation.styleSearchTimeoutMs, 700);
    assert.equal(config.recommendation.styleSearchLimit, 12);
    assert.equal(config.recommendation.strictStyle, false);
    assert.equal(config.recommendation.promptArtistLimit, 4);
    assert.equal(config.recommendation.artistDensityWindow, 7);
    assert.equal(config.recommendation.artistDensityMax, 2);
  });
});

test('public config status exposes capability flags without provider secrets', () => {
  withEnv({
    LLM_BASE_URL: 'https://llm.example.test',
    LLM_API_KEY: 'private-test-key',
    LLM_MODEL: 'private-test-model'
  }, () => {
    const serialized = JSON.stringify(publicConfigStatus(getConfig()));
    assert.match(serialized, /\"configured\":true/);
    assert.doesNotMatch(serialized, /private-test-key|https:\/\/llm\.example\.test/);
  });
});

test('schedule MCP config uses read-only defaults and keeps credentials out of public status', () => {
  withEnv({
    SCHEDULE_MCP_ENABLED: 'true',
    FEISHU_APP_ID: 'cli_test_app_id',
    FEISHU_APP_SECRET: 'private_feishu_secret',
    SCHEDULE_MCP_TIMEOUT_MS: '2500',
    SCHEDULE_MCP_CACHE_MS: '300000',
    SCHEDULE_MCP_FAILURE_CACHE_MS: '1800000',
    SCHEDULE_MCP_LOOKAHEAD_HOURS: '24'
  }, () => {
    const config = getConfig();
    assert.equal(config.schedule.enabled, true);
    assert.equal(config.schedule.command, 'npx');
    assert.deepEqual(config.schedule.allowedTools, [
      'calendar.v4.calendar.primary',
      'calendar.v4.calendarEvent.list',
      'calendar.v4.freebusy.list'
    ]);
    assert.match(config.schedule.args.join(' '), /@larksuiteoapi\/lark-mcp/);
    assert.match(config.schedule.args.join(' '), /\$\{FEISHU_APP_SECRET\}/);

    const status = publicConfigStatus(config);
    assert.equal(status.schedule.configured, true);
    assert.equal(status.schedule.timeoutMs, 2500);
    assert.equal(status.schedule.cacheMs, 300000);
    assert.doesNotMatch(JSON.stringify(status), /private_feishu_secret|cli_test_app_id|FEISHU_APP_SECRET/);
  });
});
