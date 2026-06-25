import assert from 'node:assert/strict';
import test from 'node:test';
import { createEdgeOneApi } from '../server/edgeone-api.mjs';
import { MemoryEdgeObjectStore } from '../server/edgeone-store.mjs';

const VISITOR_A = 'device-alpha-1234';
const VISITOR_B = 'device-beta-5678';

function testConfig(overrides = {}) {
  return {
    server: {},
    app: { timeZone: 'Asia/Shanghai' },
    demo: { guestMode: true, guestTtlHours: 720 },
    playback: { requireBrowserPlayUrl: true },
    recommendation: {},
    netease: {
      appId: '',
      privateKey: '',
      accessToken: '',
      device: { deviceId: 'edgeone-test-device' }
    },
    llm: { baseUrl: '', apiKey: '', model: '', timeoutMs: 1000 },
    minimax: { apiKey: '', model: 'music-2.6-free' },
    tts: {
      provider: '',
      baseUrl: '',
      apiKey: '',
      model: '',
      voice: '',
      timeoutMs: 1000,
      volcengine: {}
    },
    weather: { city: 'Shanghai', countryCode: 'CN', timeZone: 'Asia/Shanghai' },
    ipGeo: {},
    schedule: {},
    ...overrides
  };
}

function createHarness(options = {}) {
  const store = options.store || new MemoryEdgeObjectStore();
  const app = createEdgeOneApi({ store, config: testConfig(options.config || {}) });
  return { store, app };
}

async function requestJson(app, path, options = {}) {
  const response = await app.handle(buildRequest(path, options));
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : null
  };
}

function buildRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.visitorId) headers.set('x-demo-visitor-id', options.visitorId);
  if (options.ip) headers.set('x-forwarded-for', options.ip);
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  if (body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Request(`https://cancan-radio.edgeone.test${path}`, {
    method: options.method || 'GET',
    headers,
    body
  });
}

function withEnv(values, fn) {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

function withMockedFetch(handler, fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => handler(input, init);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = previous;
    });
}

function edgeProviderFetch(input) {
  const url = new URL(String(input));
  if (url.pathname === '/v1/lyrics_generation') {
    return new Response(JSON.stringify({
      base_resp: { status_code: 0 },
      lyrics: '[Verse]\nA small campus radio song',
      song_title: 'Campus Signal',
      style_tags: 'pop'
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.pathname === '/v1/music_generation') {
    return new Response(JSON.stringify({
      base_resp: { status_code: 0 },
      data: { audio: Buffer.from('fake-mp3').toString('hex') },
      extra_info: { music_duration: 1 },
      trace_id: 'trace-ai-music'
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.pathname === '/v1/chat/completions') {
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'OK' } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('not found', { status: 404 });
}

test('EdgeOne health and public config do not expose provider secrets', async () => {
  const { app } = createHarness({
    config: {
      llm: {
        baseUrl: 'https://private-llm.example.test',
        apiKey: 'private-llm-key',
        model: 'private-model',
        timeoutMs: 1000
      },
      tts: {
        provider: 'openai',
        baseUrl: 'https://private-tts.example.test',
        apiKey: 'private-tts-key',
        model: 'tts-test',
        voice: 'alloy',
        timeoutMs: 1000,
        volcengine: {}
      }
    }
  });

  const { response, body } = await requestJson(app, '/api/health');
  const serialized = JSON.stringify(body);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.runtime, 'edgeone');
  assert.equal(body.config.llm.configured, true);
  assert.equal(body.config.tts.configured, true);
  assert.doesNotMatch(serialized, /private-llm-key|private-tts-key|private-llm\.example|private-tts\.example/);
});

test('EdgeOne account-scoped routes reject missing or invalid visitor ids', async () => {
  const { app } = createHarness();

  const missing = await requestJson(app, '/api/library');
  const invalid = await requestJson(app, '/api/library', { visitorId: 'bad' });

  assert.equal(missing.response.status, 400);
  assert.equal(missing.body.code, 'demo_visitor_id_required');
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.code, 'demo_visitor_id_required');
});

test('EdgeOne device state isolates preferences and feedback per visitor id', async () => {
  const { app } = createHarness();

  const library = await requestJson(app, '/api/library', { visitorId: VISITOR_A });
  assert.equal(library.response.status, 200);
  assert.ok(library.body.tracks.length >= 1);

  const trackId = library.body.tracks[0].id;
  await requestJson(app, '/api/preferences', {
    visitorId: VISITOR_A,
    method: 'PUT',
    body: { note: 'alpha private note', moodMode: 'focus' }
  });
  await requestJson(app, '/api/feedback', {
    visitorId: VISITOR_A,
    method: 'POST',
    body: { trackId, eventType: 'like', sessionId: 'alpha-session' }
  });

  const alphaPrefs = await requestJson(app, '/api/preferences', { visitorId: VISITOR_A });
  const betaPrefs = await requestJson(app, '/api/preferences', { visitorId: VISITOR_B });

  assert.equal(alphaPrefs.body.preferences.note, 'alpha private note');
  assert.equal(alphaPrefs.body.feedbackSummary[trackId].likes, 1);
  assert.equal(betaPrefs.body.preferences.note, '');
  assert.equal(betaPrefs.body.feedbackSummary[trackId], undefined);
});

test('EdgeOne API serves TTS audio blobs without requiring a visitor id', async () => {
  const store = new MemoryEdgeObjectStore();
  const id = 'a'.repeat(64);
  await store.setBytes(`tts/${id}.mp3`, Buffer.from('fake-mp3'));
  const { app } = createHarness({ store });

  const response = await app.handle(buildRequest(`/api/tts/${id}.mp3`));
  const bytes = Buffer.from(await response.arrayBuffer());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(bytes.toString('utf8'), 'fake-mp3');
});

test('EdgeOne AI music writes generated audio to Blob and enforces daily quota', async () => {
  await withEnv({ EDGEONE_DAILY_AI_MUSIC_LIMIT: '1' }, async () => {
    await withMockedFetch(edgeProviderFetch, async () => {
      const { app } = createHarness({
        config: {
          minimax: {
            baseUrl: 'https://minimax.test',
            apiKey: 'private-minimax-key',
            model: 'music-2.6-free',
            allowPaidMusic: false,
            requestTimeoutMs: 1000
          }
        }
      });

      const first = await requestJson(app, '/api/ai-music/generate', {
        visitorId: VISITOR_A,
        ip: '203.0.113.10',
        method: 'POST',
        body: { prompt: 'short demo', sessionId: 'ai-session' }
      });
      const audio = await app.handle(buildRequest(first.body.track.playUrl));
      const second = await requestJson(app, '/api/ai-music/generate', {
        visitorId: VISITOR_A,
        ip: '203.0.113.10',
        method: 'POST',
        body: { prompt: 'short demo again' }
      });

      assert.equal(first.response.status, 200);
      assert.equal(first.body.ok, true);
      assert.equal(first.body.track.aiGenerated, true);
      assert.match(first.body.track.playUrl, /^\/api\/ai-music\/generated\/ai-minimax-.+\.mp3$/);
      assert.equal(audio.status, 200);
      assert.equal(Buffer.from(await audio.arrayBuffer()).toString('utf8'), 'fake-mp3');
      assert.equal(second.response.status, 429);
      assert.equal(second.body.code, 'quota_exceeded');
      assert.equal(second.body.kind, 'aiMusic');
    });
  });
});

test('EdgeOne prefetch queue is consumed by next and exposed in debug', async () => {
  const { app } = createHarness();

  const prefetch = await requestJson(app, '/api/radio/prefetch', {
    visitorId: VISITOR_A,
    method: 'POST',
    body: { sessionId: 'queue-session', force: true }
  });
  const debugBefore = await requestJson(app, '/api/radio/debug?sessionId=queue-session', { visitorId: VISITOR_A });
  const next = await requestJson(app, '/api/radio/next', {
    visitorId: VISITOR_A,
    method: 'POST',
    body: { sessionId: 'queue-session' }
  });
  const debugAfter = await requestJson(app, '/api/radio/debug?sessionId=queue-session', { visitorId: VISITOR_A });

  assert.equal(prefetch.response.status, 200);
  assert.equal(prefetch.body.queued, true);
  assert.equal(debugBefore.body.queue.length, 1);
  assert.equal(next.body.track.id, prefetch.body.item.track.id);
  assert.equal(debugAfter.body.queueMetrics.queueHitCount, 1);
  assert.equal(debugAfter.body.queue.length, 0);
});

test('EdgeOne concert routes maintain a multi-track isolated program', async () => {
  const { app } = createHarness();

  const start = await requestJson(app, '/api/radio/concert/start', {
    visitorId: VISITOR_A,
    method: 'POST',
    body: { sessionId: 'concert-session', settings: { length: 5, note: 'demo concert' } }
  });
  const next = await requestJson(app, '/api/radio/concert/next', {
    visitorId: VISITOR_A,
    method: 'POST',
    body: { sessionId: 'concert-session' }
  });
  const hostEvent = start.body.concert.hostEvents.find(event => event.type === 'interlude');
  const host = await requestJson(app, '/api/radio/concert/host', {
    visitorId: VISITOR_A,
    method: 'POST',
    body: { sessionId: 'concert-session', eventId: hostEvent.id }
  });
  const jump = await requestJson(app, '/api/radio/concert/jump', {
    visitorId: VISITOR_A,
    method: 'POST',
    body: { sessionId: 'concert-session', index: 3 }
  });
  const audience = await requestJson(app, '/api/radio/concert/audience', {
    visitorId: VISITOR_A,
    method: 'POST',
    body: { sessionId: 'concert-session', trackId: jump.body.track.id }
  });
  const encore = await requestJson(app, '/api/radio/concert/encore', {
    visitorId: VISITOR_A,
    method: 'POST',
    body: { sessionId: 'concert-session' }
  });

  assert.equal(start.response.status, 200);
  assert.equal(start.body.concertMode, true);
  assert.equal(start.body.concert.items.length, 5);
  assert.equal(start.body.concert.items[0].status, 'current');
  assert.equal(next.body.concert.currentIndex, 1);
  assert.equal(next.body.track.id, start.body.concert.items[1].track.id);
  assert.equal(host.body.track, null);
  assert.equal(host.body.concert.hostEvents.find(event => event.id === hostEvent.id).status, 'played');
  assert.equal(jump.body.concert.currentIndex, 3);
  assert.ok(audience.body.comments.length >= 1);
  assert.equal(encore.body.concert.encoreUsed, true);
  assert.equal(encore.body.concert.phase, 'encore');
});

test('EdgeOne playlist routes expose a program without per-track host speech', async () => {
  const { app } = createHarness();

  const start = await requestJson(app, '/api/radio/playlist/start', {
    visitorId: VISITOR_A,
    method: 'POST',
    body: { sessionId: 'playlist-session' }
  });
  const nextViaConcertCompat = await requestJson(app, '/api/radio/concert/next', {
    visitorId: VISITOR_A,
    method: 'POST',
    body: { sessionId: 'playlist-session' }
  });
  const jump = await requestJson(app, '/api/radio/playlist/jump', {
    visitorId: VISITOR_A,
    method: 'POST',
    body: { sessionId: 'playlist-session', index: 4 }
  });

  assert.equal(start.body.playlistMode, true);
  assert.equal(start.body.concert.playlistMode, true);
  assert.equal(start.body.concert.items.length, 5);
  assert.equal(nextViaConcertCompat.body.playlistMode, true);
  assert.equal(nextViaConcertCompat.body.hostPolicy, 'none');
  assert.equal(jump.body.concert.currentIndex, 4);
});

test('EdgeOne diagnostics returns full sanitized checks', async () => {
  await withMockedFetch(edgeProviderFetch, async () => {
    const { app } = createHarness({
      config: {
        llm: {
          baseUrl: 'https://private-llm.example.test',
          apiKey: 'private-llm-key',
          model: 'private-model',
          timeoutMs: 1000
        },
        minimax: {
          baseUrl: 'https://minimax.test',
          apiKey: 'private-minimax-key',
          model: 'music-2.6-free',
          allowPaidMusic: false,
          requestTimeoutMs: 1000
        }
      }
    });

    const result = await requestJson(app, '/api/diagnostics/self-check', {
      visitorId: VISITOR_A,
      method: 'POST',
      body: { sessionId: 'diag-session' }
    });
    const serialized = JSON.stringify(result.body);

    assert.equal(result.response.status, 200);
    assert.equal(result.body.runtime, 'edgeone');
    assert.ok(result.body.checks.some(check => check.id === 'llm'));
    assert.ok(result.body.checks.some(check => check.id === 'storage'));
    assert.ok(result.body.checks.some(check => check.id === 'ai_music'));
    assert.doesNotMatch(serialized, /private-llm-key|private-minimax-key|MUSIC_U=/);
  });
});

test('EdgeOne admin import replaces the shared library behind an admin token', async () => {
  await withEnv({ EDGEONE_ADMIN_TOKEN: 'test-admin-token' }, async () => {
    const { app } = createHarness();
    const imported = {
      source: 'test-import',
      tracks: [
        { id: 'edge-track-1', name: 'Imported Song', artists: ['Imported Artist'], album: 'Imported Album' }
      ],
      playlists: [
        { id: 'edge-playlist-1', name: 'Imported Playlist', trackIds: ['edge-track-1'] }
      ]
    };

    const importResult = await requestJson(app, '/api/admin/library/import', {
      method: 'POST',
      headers: { 'x-admin-token': 'test-admin-token' },
      body: imported
    });
    const library = await requestJson(app, '/api/library', { visitorId: VISITOR_A });

    assert.equal(importResult.response.status, 200);
    assert.equal(importResult.body.tracks, 1);
    assert.equal(library.body.tracks.length, 1);
    assert.equal(library.body.tracks[0].name, 'Imported Song');
    assert.equal(library.body.playlists[0].tracks[0].id, 'edge-track-1');
  });
});
