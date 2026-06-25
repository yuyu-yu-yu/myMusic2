import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildAiMusicExplanation, buildLrcFromStructuredLyrics, buildMusicPrompt, generateAiMusic } from '../server/ai-music.mjs';

test('MiniMax music generation returns a clear configuration error without API key', async () => {
  const result = await generateAiMusic({ config: {}, rootDir: process.cwd(), payload: { sessionId: 's1' } });

  assert.equal(result.__error, true);
  assert.equal(result.status, 400);
  assert.match(result.error, /MINIMAX_API_KEY/);
});

test('MiniMax music generation posts lyrics and saves returned audio', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-minimax-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const audioBytes = Buffer.from([0x49, 0x44, 0x33, 0x06]);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options, body: JSON.parse(options.body) });
    if (String(url).endsWith('/v1/lyrics_generation')) {
      return new Response(JSON.stringify({
        song_title: '自动生成标题',
        style_tags: 'Mandopop, Female Vocals',
        lyrics: '[Verse]\n自动生成的歌词',
        base_resp: { status_code: 0, status_msg: 'success' }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      data: { audio: audioBytes.toString('hex'), status: 2 },
      trace_id: 'trace-test',
      extra_info: { music_duration: 25364 },
      base_resp: { status_code: 0, status_msg: 'success' }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await generateAiMusic({
    config: { apiKey: 'key-test', baseUrl: 'https://api.minimaxi.com', model: 'music-2.6', allowPaidMusic: true },
    rootDir,
    profile: { tags: ['synth pop', 'night'] },
    payload: { sessionId: 's1', trigger: 'next', preferences: { moodMode: 'focus' } }
  });

  assert.equal(result.ok, true);
  assert.equal(result.track.artists[0], '灿灿 AI DJ');
  assert.equal(result.track.lyricSync, 'plain');
  assert.doesNotMatch(result.track.name, /CanCan|开场|下一首/);
  assert.match(result.chatText, /灿灿/);
  assert.match(result.track.playUrl, /^\/ai-music\/generated\/ai-minimax-.+\.mp3$/);
  assert.equal(result.track.name, '自动生成标题');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.minimaxi.com/v1/lyrics_generation');
  assert.equal(calls[0].options.headers.authorization, 'Bearer key-test');
  assert.equal(calls[0].body.mode, 'write_full_song');
  assert.match(calls[0].body.prompt, /人声类型：女音/);
  assert.equal(calls[1].url, 'https://api.minimaxi.com/v1/music_generation');
  assert.equal(calls[1].options.headers.authorization, 'Bearer key-test');
  assert.equal(calls[1].body.model, 'music-2.6');
  assert.equal(calls[1].body.is_instrumental, false);
  assert.equal(calls[1].body.output_format, 'url');
  assert.equal(calls[1].body.lyrics_optimizer, false);
  assert.equal(calls[1].body.lyrics, '[Verse]\n自动生成的歌词');
  assert.match(calls[1].body.prompt, /人声类型：女音/);
  assert.doesNotMatch(calls[1].body.prompt, /不要|禁止|CanCan|开场|下一首|启动电台|AI 原创/);

  const filePath = path.join(rootDir, 'public', result.track.playUrl);
  assert.deepEqual(fs.readFileSync(filePath), audioBytes);
  assert.match(result.track.lyric, /^\[Verse\]/);
  assert.equal(result.aiMusic.lyricsGeneration.status, 'generated');
  assert.equal(result.explanation.factors.some(factor => factor.text === '当前状态：需要专注 / 情绪稳定'), true);
  assert.equal(result.explanation.factors.some(factor => factor.text === '音乐画像：synthpop / night'), true);
  assert.equal(result.explanation.factors.some(factor => factor.text === '人声类型：女音'), true);
  assert.equal(result.explanation.factors.some(factor => factor.text.includes('生成方式')), false);
  assert.equal(result.explanation.factors.some(factor => factor.text.includes('Music-2.6')), false);
});

test('MiniMax music generation retries hosted audio downloads without authorization', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-minimax-url-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const audioBytes = Buffer.from('fake-mp3-from-url');
  const downloadAuthHeaders = [];
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith('/v1/lyrics_generation')) {
      return new Response(JSON.stringify({
        lyrics: '[Verse]\nurl audio',
        base_resp: { status_code: 0, status_msg: 'success' }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (href.endsWith('/v1/music_generation')) {
      return new Response(JSON.stringify({
        data: { audio: 'https://cdn.minimax.test/generated-song.mp3', status: 2 },
        base_resp: { status_code: 0, status_msg: 'success' }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (href === 'https://cdn.minimax.test/generated-song.mp3') {
      const auth = options.headers?.authorization || '';
      downloadAuthHeaders.push(auth);
      if (auth) return new Response('forbidden', { status: 403 });
      return new Response(audioBytes, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    }
    throw new Error(`unexpected fetch ${href}`);
  };

  const result = await generateAiMusic({
    config: { apiKey: 'key-test', baseUrl: 'https://api.minimaxi.com', model: 'music-2.6-free' },
    rootDir,
    payload: { sessionId: 's1' }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(downloadAuthHeaders, ['Bearer key-test', '']);
  const filePath = path.join(rootDir, 'public', result.track.playUrl);
  assert.deepEqual(fs.readFileSync(filePath), audioBytes);
});

test('MiniMax music generation saves base64 data URL audio', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-minimax-data-url-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const audioBytes = Buffer.from('fake-mp3-data-url');
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.endsWith('/v1/lyrics_generation')) {
      return new Response(JSON.stringify({
        lyrics: '[Verse]\ndata url audio',
        base_resp: { status_code: 0, status_msg: 'success' }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      data: { audio: `data:audio/mpeg;base64,${audioBytes.toString('base64')}`, status: 2 },
      base_resp: { status_code: 0, status_msg: 'success' }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await generateAiMusic({
    config: { apiKey: 'key-test', baseUrl: 'https://api.minimaxi.com', model: 'music-2.6-free' },
    rootDir,
    payload: { sessionId: 's1' }
  });

  assert.equal(result.ok, true);
  const filePath = path.join(rootDir, 'public', result.track.playUrl);
  assert.deepEqual(fs.readFileSync(filePath), audioBytes);
});

test('AI music helpers create compact prompt and timed LRC', () => {
  const prompt = buildMusicPrompt({
    payload: { currentTrack: { name: 'Previous Song' }, preferences: { moodMode: 'night' } },
    profile: { summary: 'x'.repeat(5000) }
  });
  assert.equal(prompt.length <= 2000, true);
  assert.match(prompt, /音乐画像：/);
  assert.match(prompt, /人声类型：女音/);
  assert.match(prompt, /完整中文流行歌曲/);
  assert.doesNotMatch(prompt, /AI DJ少女主持|蓝紫霓虹|校园电台/);

  const lrc = buildLrcFromStructuredLyrics('[Intro]\nhello\n[Chorus]\nworld', 60000);
  assert.deepEqual(lrc.split('\n'), ['[00:00.00] hello', '[00:20.00] world']);
});

test('AI music prompt reflects recent state with compact C-end style', () => {
  const payload = {
    trigger: 'next',
    recentMessages: [
      { role: 'user', content: '我有点饿了' },
      { role: 'assistant', content: '傍晚一点，正好是肚子开始咕咕叫的时候。' }
    ],
    sessionContext: {
      musicContext: {
        lastUserMessage: '我有点饿了',
        mood: 'comfort',
        energy: 'low',
        reason: '用户表示有点饿'
      }
    },
    environmentContext: { localTime: '18:30', weather: '上海当前阴，18℃' },
    preferences: { moodMode: 'comfort' }
  };
  const profile = { tags: ['华语流行', '欧美流行', '影视/游戏原声', '电子/DJ'] };

  const prompt = buildMusicPrompt({ payload, profile });

  assert.equal(prompt, [
    '上海，下午六点半，阴天，用户有点饿，情绪平稳。',
    '音乐画像：华语流行、欧美流行、影视感、轻电子',
    '人声类型：女音',
    '生成一首轻暖、松弛、有陪伴感的完整中文流行歌曲。'
  ].join(' '));
  assert.doesNotMatch(prompt, /CanCan/);
  assert.doesNotMatch(prompt, /不要|禁止|开场|下一首|启动电台|AI 原创/);
});

test('AI music explanation uses concise recommendation chips', () => {
  const payload = {
    recentMessages: [{ role: 'user', content: '我有点饿了' }],
    sessionContext: {
      musicContext: { lastUserMessage: '我有点饿了' },
      environmentContext: { localTime: '18:30', weather: '上海当前阴，18℃' }
    }
  };
  const profile = { tags: ['华语流行', '欧美流行', '影视/游戏原声', '电子/DJ'] };
  const explanation = buildAiMusicExplanation({
    payload,
    profile,
    lyricsResult: { status: 'generated' },
    usedModel: 'music-2.6-free'
  });

  assert.deepEqual(explanation.factors.map(factor => factor.text), [
    '当前状态：有点饿 / 情绪平稳',
    '最近表达：我有点饿了',
    '场景时间：上海 / 下午六点半 / 阴天',
    '音乐画像：华语流行 / 欧美流行 / 影视感 / 轻电子',
    '生成方向：轻暖、松弛、有陪伴感',
    '人声类型：女音'
  ]);
  assert.deepEqual(explanation.factors.map(factor => factor.label), [
    '当前状态',
    '最近表达',
    '场景时间',
    '音乐画像',
    '生成方向',
    '人声类型'
  ]);
  assert.equal(explanation.factors.every(factor => factor.value && factor.text.length <= 80), true);
  assert.doesNotMatch(explanation.factors.map(factor => factor.text).join('\n'), /当前偏好状态|用户备注|AI 原创电台模式已开启|对话分析|生成方式|Music-2\.6/);
});

test('MiniMax music generation falls back when lyrics API is unavailable', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-minimax-lyrics-fallback-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    if (String(url).endsWith('/v1/lyrics_generation')) {
      return new Response(JSON.stringify({
        base_resp: { status_code: 1002, status_msg: 'lyrics busy' }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      data: { audio: Buffer.from([0x49, 0x44, 0x33]).toString('hex'), status: 2 },
      base_resp: { status_code: 0, status_msg: 'success' }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await generateAiMusic({
    config: { apiKey: 'key-test', baseUrl: 'https://api.minimaxi.com', model: 'music-2.6-free' },
    rootDir,
    payload: { sessionId: 's1' }
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://api.minimaxi.com/v1/music_generation');
  assert.equal(calls[1].body.lyrics, '');
  assert.equal(calls[1].body.lyrics_optimizer, true);
  assert.equal(result.aiMusic.lyricsGeneration.status, 'fallback');
});

test('MiniMax music generation retries free model when paid balance is insufficient', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-minimax-free-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const models = [];
  globalThis.fetch = async (_url, options) => {
    if (String(_url).endsWith('/v1/lyrics_generation')) {
      return new Response(JSON.stringify({
        lyrics: '[Verse]\n先写好歌词',
        base_resp: { status_code: 0, status_msg: 'success' }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const body = JSON.parse(options.body);
    models.push(body.model);
    if (body.model === 'music-2.6') {
      return new Response(JSON.stringify({
        base_resp: { status_code: 1001, status_msg: 'insufficient balance' }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      data: { audio: Buffer.from([0x49, 0x44, 0x33]).toString('hex'), status: 2 },
      base_resp: { status_code: 0, status_msg: 'success' }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await generateAiMusic({
    config: { apiKey: 'key-test', baseUrl: 'https://api.minimaxi.com', model: 'music-2.6', allowPaidMusic: true },
    rootDir,
    payload: { sessionId: 's1' }
  });

  assert.deepEqual(models, ['music-2.6', 'music-2.6-free']);
  assert.equal(result.aiMusic.model, 'music-2.6-free');
  assert.equal(result.aiMusic.fallbackModelFrom, 'music-2.6');
});

test('MiniMax music generation blocks paid model unless explicitly allowed', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-minimax-paid-block-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const models = [];
  globalThis.fetch = async (_url, options) => {
    if (String(_url).endsWith('/v1/lyrics_generation')) {
      return new Response(JSON.stringify({
        lyrics: '[Verse]\n先写好歌词',
        base_resp: { status_code: 0, status_msg: 'success' }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const body = JSON.parse(options.body);
    models.push(body.model);
    return new Response(JSON.stringify({
      data: { audio: Buffer.from([0x49, 0x44, 0x33]).toString('hex'), status: 2 },
      base_resp: { status_code: 0, status_msg: 'success' }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await generateAiMusic({
    config: { apiKey: 'key-test', baseUrl: 'https://api.minimaxi.com', model: 'music-2.6' },
    rootDir,
    payload: { sessionId: 's1' }
  });

  assert.deepEqual(models, ['music-2.6-free']);
  assert.equal(result.aiMusic.configuredModel, 'music-2.6');
  assert.equal(result.aiMusic.paidModelBlocked, true);
});
