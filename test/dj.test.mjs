import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  clearUserMemories,
  deleteUserMemory,
  listUserMemories,
  openDatabase,
  recordOrMergeUserMemory,
  recordTrackFeedback,
  retrieveRelevantMemories
} from '../server/db.mjs';
import {
  analyzeConversationMood,
  buildMemoryContext,
  chatTurn,
  extractAndStoreMemories,
  rankAndSelectCandidates
} from '../server/dj.mjs';
import { getMemories, getPreferences, removeAllMemories, removeMemory, submitFeedback, updatePreferences } from '../server/radio.mjs';

function candidate(id, source, artists = ['Artist']) {
  return {
    track: {
      id,
      name: `Track ${id}`,
      artists,
      album: 'Album'
    },
    source,
    sourceReason: source
  };
}

function makeCandidates(prefix, count, source, artists) {
  return Array.from({ length: count }, (_, index) => candidate(`${prefix}-${index}`, source, artists));
}

function countBySource(candidates) {
  return candidates.reduce((counts, item) => {
    counts[item.source] = (counts[item.source] || 0) + 1;
    return counts;
  }, {});
}

function testDb(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-dj-'));
  const db = openDatabase(rootDir);
  t.after(() => {
    db.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
  return db;
}

test('automatic candidate selection preserves discovery quota in final 60', () => {
  const selected = rankAndSelectCandidates([
    ...makeCandidates('recent', 30, 'library_recent'),
    ...makeCandidates('deep', 40, 'library_deep'),
    ...makeCandidates('discovery', 25, 'ai_discovery')
  ], {
    quotas: { library_recent: 18, library_deep: 22, ai_discovery: 20 },
    limit: 60,
    seed: 'auto'
  });

  assert.equal(selected.length, 60);
  assert.deepEqual(countBySource(selected), {
    library_recent: 18,
    library_deep: 22,
    ai_discovery: 20
  });
});

test('search candidate selection puts community results first', () => {
  const selected = rankAndSelectCandidates([
    ...makeCandidates('search', 30, 'community_search'),
    ...makeCandidates('discovery', 20, 'ai_discovery'),
    ...makeCandidates('recent', 20, 'library_recent'),
    ...makeCandidates('deep', 20, 'library_deep')
  ], {
    quotas: { community_search: 24, ai_discovery: 12, library_recent: 12, library_deep: 12 },
    limit: 60,
    userMessage: 'play electronic',
    seed: 'search'
  });

  assert.equal(selected.length, 60);
  assert.equal(selected.slice(0, 24).every(item => item.source === 'community_search'), true);
  assert.deepEqual(countBySource(selected), {
    community_search: 24,
    ai_discovery: 12,
    library_recent: 12,
    library_deep: 12
  });
});

test('candidate ranking deduplicates tracks and keeps highest scoring source', () => {
  const selected = rankAndSelectCandidates([
    candidate('same-track', 'library_deep'),
    candidate('same-track', 'community_search'),
    candidate('other-track', 'library_deep')
  ], {
    quotas: { community_search: 2, library_deep: 2 },
    limit: 4,
    userMessage: 'same'
  });

  assert.equal(selected.filter(item => item.track.id === 'same-track').length, 1);
  assert.equal(selected.find(item => item.track.id === 'same-track').source, 'community_search');
});

test('feedback and artist cooldown change candidate order', () => {
  const feedbackById = new Map([
    ['liked', { likes: 1, dislikes: 0, completions: 2, skips: 0 }],
    ['skipped', { likes: 0, dislikes: 1, completions: 0, skips: 3 }]
  ]);
  const selected = rankAndSelectCandidates([
    candidate('skipped', 'library_deep', ['Artist A']),
    candidate('cooldown', 'library_deep', ['Artist B']),
    candidate('liked', 'library_deep', ['Artist C'])
  ], {
    quotas: { library_deep: 3 },
    feedbackById,
    artistPenaltyByName: new Map([['artist b', -25]]),
    limit: 3
  });

  assert.equal(selected[0].track.id, 'liked');
  assert.equal(selected.at(-1).track.id, 'skipped');
  assert.equal(selected.find(item => item.track.id === 'cooldown').score < selected[0].score, true);
});

test('feedback API handler records valid events and rejects invalid payloads', (t) => {
  const db = testDb(t);

  const ok = submitFeedback({
    db,
    payload: { trackId: 'track-1', eventType: 'like', sessionId: 'session-1', elapsedMs: 1200 }
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.feedback.likes, 1);

  recordTrackFeedback(db, { trackId: 'track-1', eventType: 'complete' });
  const row = db.prepare('SELECT likes, completions FROM track_feedback_summary WHERE track_id = ?').get('track-1');
  assert.equal(row.likes, 1);
  assert.equal(row.completions, 1);

  const missingTrack = submitFeedback({ db, payload: { eventType: 'like' } });
  assert.equal(missingTrack.ok, false);
  assert.equal(missingTrack.status, 400);

  const badType = submitFeedback({ db, payload: { trackId: 'track-1', eventType: 'favorite' } });
  assert.equal(badType.ok, false);
  assert.equal(badType.status, 400);
});

test('preferences API helpers read defaults, persist updates, and sanitize invalid values', (t) => {
  const db = testDb(t);

  const initial = getPreferences({ db });
  assert.equal(initial.ok, true);
  assert.deepEqual(initial.preferences, {
    chatMusicBalance: 'friend',
    recommendationFrequency: 'medium',
    voiceMode: 'recommendations',
    moodMode: 'auto',
    note: ''
  });

  const saved = updatePreferences({
    db,
    payload: {
      chatMusicBalance: 'dj',
      recommendationFrequency: 'low',
      voiceMode: 'all',
      moodMode: 'focus',
      note: '多一点像朋友一样聊天。'
    }
  });
  assert.equal(saved.preferences.chatMusicBalance, 'dj');
  assert.equal(saved.preferences.recommendationFrequency, 'low');
  assert.equal(saved.preferences.voiceMode, 'all');
  assert.equal(saved.preferences.moodMode, 'focus');

  const loaded = getPreferences({ db });
  assert.equal(loaded.preferences.note, '多一点像朋友一样聊天。');

  const sanitized = updatePreferences({
    db,
    payload: {
      chatMusicBalance: 'loud',
      recommendationFrequency: 'always',
      voiceMode: 'robot',
      moodMode: 'chaos',
      note: 'x'.repeat(600)
    }
  });
  assert.equal(sanitized.preferences.chatMusicBalance, 'friend');
  assert.equal(sanitized.preferences.recommendationFrequency, 'medium');
  assert.equal(sanitized.preferences.voiceMode, 'recommendations');
  assert.equal(sanitized.preferences.moodMode, 'auto');
  assert.equal(sanitized.preferences.note.length, 500);
});

test('user memories can be recorded, merged, retrieved, deleted, and cleared', (t) => {
  const db = testDb(t);

  const first = recordOrMergeUserMemory(db, {
    kind: 'need',
    content: '用户在深夜失眠时希望先被陪伴，不要马上推歌。',
    tags: ['深夜', '失眠', '陪伴'],
    confidence: 0.7,
    importance: 0.8,
    sourceSessionId: 'session-1'
  });
  const merged = recordOrMergeUserMemory(db, {
    kind: 'need',
    content: '用户深夜睡不着时更需要陪伴，暂时不要马上推歌。',
    tags: ['深夜', '睡不着', '陪伴'],
    confidence: 0.74,
    importance: 0.82,
    sourceSessionId: 'session-1'
  });

  assert.equal(first.id, merged.id);
  assert.equal(merged.evidenceCount, 2);
  assert.equal(listUserMemories(db).length, 1);

  recordOrMergeUserMemory(db, {
    kind: 'preference',
    content: '用户喜欢下雨天听安静的中文慢歌。',
    tags: ['下雨', '安静', '中文慢歌'],
    confidence: 0.6,
    importance: 0.5
  });

  const relevant = retrieveRelevantMemories(db, {
    text: '今晚又睡不着，想有人陪',
    mood: { mood: 'night', searchHints: ['睡不着', '陪伴'] },
    limit: 1
  });
  assert.equal(relevant.length, 1);
  assert.equal(relevant[0].kind, 'need');

  assert.equal(deleteUserMemory(db, first.id).deleted, 1);
  assert.equal(clearUserMemories(db).ok, true);
  assert.equal(listUserMemories(db).length, 0);
});

test('memory API helpers expose list, delete one, and clear all', (t) => {
  const db = testDb(t);
  const memory = recordOrMergeUserMemory(db, {
    kind: 'boundary',
    content: '用户不希望低落时被催着立刻开心起来。',
    tags: ['低落', '边界']
  });

  assert.equal(getMemories({ db }).memories.length, 1);
  assert.equal(removeMemory({ db, id: memory.id }).deleted, 1);
  assert.equal(getMemories({ db }).memories.length, 0);

  recordOrMergeUserMemory(db, { kind: 'preference', content: '用户喜欢温柔的聊天方式。', tags: ['温柔'] });
  assert.equal(removeAllMemories({ db }).ok, true);
  assert.equal(getMemories({ db }).memories.length, 0);
});

test('memory prompt formatting has a bounded long-term memory section', () => {
  const memories = Array.from({ length: 20 }, (_, index) => ({
    kind: 'need',
    content: `用户需要第 ${index} 条很长的陪伴式记忆，用来验证 prompt 不会无限增长。`.repeat(3)
  }));
  const context = buildMemoryContext({ sessionSummary: '用户今晚在聊工作压力。', longTermMemories: memories });

  assert.equal(context.promptText.startsWith('相关长期记忆：'), true);
  assert.equal(context.promptText.length <= 860, true);
  assert.equal(context.sessionSummary, '用户今晚在聊工作压力。');
});

test('chat decision prompt receives relevant long-term memory without selecting a track', async (t) => {
  const db = testDb(t);
  recordOrMergeUserMemory(db, {
    kind: 'need',
    content: '用户深夜睡不着时更需要先被陪伴，不要马上推歌。',
    tags: ['睡不着', '陪伴', '深夜'],
    confidence: 0.8,
    importance: 0.9
  });

  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: '<CHAT>我记得你这种时候更需要有人陪着。我们先慢慢聊，不急着切歌。</CHAT><JSON>{"pick":null,"reason":"长期记忆提示先陪伴","mode":null}</JSON>'
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await chatTurn({
    db,
    config: { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-test' }, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'memory-chat',
    message: '今晚又睡不着'
  });

  assert.equal(result.track, null);
  assert.equal(result.intent, 'chat');
  const promptText = JSON.stringify(requests[0].messages);
  assert.match(promptText, /用户深夜睡不着时更需要先被陪伴/);
  assert.match(promptText, /情绪可能不太好/);
});

test('memory extraction failure does not block or write invalid memories', async (t) => {
  const db = testDb(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: 'not json at all' } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const saved = await extractAndStoreMemories({
    db,
    config: { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-test' } },
    sessionId: 'extract-fail',
    userMessage: '请记住我深夜睡不着时想先聊聊天',
    assistantText: '好，我会记得。'
  });

  assert.deepEqual(saved, []);
  assert.equal(listUserMemories(db).length, 0);
});

test('safety valve: emotional distress without music intent stays in accompany mode', async (t) => {
  const db = testDb(t);
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: '<CHAT>听起来你今天被代码榨干了。先缓口气，我在这儿陪着。</CHAT><JSON>{"pick":null,"reason":"先陪伴","mode":null}</JSON>'
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await chatTurn({
    db,
    config: { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-test' }, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'fatigue-safety',
    message: '今天心情很难受'
  });

  assert.equal(result.track, null);
  assert.equal(result.intent, 'chat');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plays').get().count, 0);
  // Safety valve mode: buildLightPool makes no API calls, so the only request is callDJ
  const promptText = JSON.stringify(requests[0].messages);
  assert.match(promptText, /你是灿灿/);
  assert.match(promptText, /情绪可能不太好/);
});

test('safety valve: explicit music rejection stays in chat-only mode', async (t) => {
  const db = testDb(t);
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: '<CHAT>好的，不急着放歌。你想聊什么？</CHAT><JSON>{"pick":null,"reason":"","mode":null}</JSON>'
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await chatTurn({
    db,
    config: { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-test' }, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'reject-music',
    message: '别放歌，先聊聊'
  });

  assert.equal(result.track, null);
  assert.equal(result.intent, 'chat');
  const promptText = JSON.stringify(requests[0].messages);
  assert.match(promptText, /不想听歌/);
});

test('unified chat: casual conversation lets LLM decide whether to recommend', async (t) => {
  const db = testDb(t);
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: '<CHAT>写 AI DJ 项目听起来很有意思。你现在最想先做好聊天感，还是推荐准确度？</CHAT><JSON>{"pick":null,"reason":"","mode":null}</JSON>'
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await chatTurn({
    db,
    config: { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-test' }, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'casual-chat',
    message: '我最近在写一个 AI DJ 项目'
  });

  assert.equal(result.track, null);
  assert.equal(result.intent, 'chat');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plays').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE session_id = ?').get('casual-chat').count, 2);
});

test('unified chat: empty message triggers auto-continue recommendation', async (t) => {
  const db = testDb(t);
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: '<CHAT>来，下一首歌。</CHAT><JSON>{"pick":null,"reason":"","mode":null}</JSON>'
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await chatTurn({
    db,
    config: { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-test' }, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'auto-continue',
    message: ''
  });

  assert.equal(result.track, null);
  const promptText = JSON.stringify(requests[0].messages);
  assert.match(promptText, /pick 填数字/);
});

test('unified chat: explicit music request goes through full candidate search', async (t) => {
  const db = testDb(t);
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: '<CHAT>好嘞，来首陈奕迅的。</CHAT><JSON>{"pick":null,"reason":"","mode":null}</JSON>'
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await chatTurn({
    db,
    config: { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-test' }, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'music-request',
    message: '放首陈奕迅的歌'
  });

  assert.equal(result.intent, 'chat');
  const promptText = JSON.stringify(requests[0].messages);
  // Should NOT have safety note (not emotional, not rejection)
  assert.doesNotMatch(promptText, /情绪可能不太好/);
  assert.doesNotMatch(promptText, /不想听歌/);
});

test('chat without LLM config uses fallback greeting', async (t) => {
  const db = testDb(t);
  const result = await chatTurn({
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'no-llm-chat',
    message: '今天看到一部电影，想随便聊聊'
  });

  assert.equal(result.track, null);
  assert.equal(result.intent, 'chat');
  assert.equal(result.chatText.length > 0, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plays').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE session_id = ?').get('no-llm-chat').count, 2);
});

test('conversation mood detects comfort needs from recent chat', () => {
  const mood = analyzeConversationMood({
    history: [{ role: 'user', content: '我心情很不好' }],
    userMessage: '刚刚跟亲密的人吵架了',
    currentTrack: { name: 'Current' }
  });

  assert.equal(mood.shouldRecommend, true);
  assert.equal(mood.mood, 'comfort');
  assert.equal(mood.energy, 'low');
  assert.equal(mood.searchHints.includes('治愈'), true);
});

test('conversation mood boosts matching candidates', () => {
  const selected = rankAndSelectCandidates([
    candidate('plain', 'library_deep'),
    {
      ...candidate('warm', 'library_deep'),
      track: { id: 'warm', name: '温柔治愈夜', artists: ['Artist'], album: 'Album' }
    }
  ], {
    quotas: { library_deep: 2 },
    limit: 2,
    conversationMood: {
      mood: 'comfort',
      searchHints: ['治愈', '温柔'],
      energy: 'low'
    }
  });

  assert.equal(selected[0].track.id, 'warm');
});

test('structured profile boosts matching artists, albums, and discovery text', () => {
  const selected = rankAndSelectCandidates([
    {
      ...candidate('plain', 'library_deep'),
      track: { id: 'plain', name: 'Plain Song', artists: ['Other'], album: 'Other Album' }
    },
    {
      ...candidate('profile-hit', 'library_deep'),
      track: { id: 'profile-hit', name: '夜晚城市', artists: ['Owned Artist'], album: 'Owned Album' },
      sourceReason: '夜晚 治愈'
    }
  ], {
    quotas: { library_deep: 2 },
    limit: 2,
    profile: {
      structured: {
        artists: [{ name: 'Owned Artist', weight: 0.9 }],
        albums: [{ name: 'Owned Album', weight: 0.7 }],
        moods: [{ name: '治愈', weight: 0.6 }],
        scenes: [{ name: '夜晚', weight: 0.6 }]
      }
    }
  });

  assert.equal(selected[0].track.id, 'profile-hit');
  assert.ok(selected[0].scoreParts.profile > 0);
});

test('structured avoid signals lower candidate ranking', () => {
  const selected = rankAndSelectCandidates([
    {
      ...candidate('avoid', 'library_deep'),
      track: { id: 'avoid', name: 'Heavy Metal Night', artists: ['Band'], album: 'Album' }
    },
    {
      ...candidate('safe', 'library_deep'),
      track: { id: 'safe', name: 'Soft Night', artists: ['Band'], album: 'Album' }
    }
  ], {
    quotas: { library_deep: 2 },
    limit: 2,
    profile: {
      structured: {
        avoidSignals: [{ name: 'metal', weight: 1 }]
      }
    }
  });

  assert.equal(selected[0].track.id, 'safe');
  assert.ok(selected.find(item => item.track.id === 'avoid').scoreParts.profile < 0);
});

test('conversation mood can override weak long-term profile signal', () => {
  const selected = rankAndSelectCandidates([
    {
      ...candidate('profile', 'library_deep'),
      track: { id: 'profile', name: 'Owned Artist Song', artists: ['Owned Artist'], album: 'Album' }
    },
    {
      ...candidate('mood', 'library_deep'),
      track: { id: 'mood', name: '温柔治愈夜晚', artists: ['Other'], album: 'Album' }
    }
  ], {
    quotas: { library_deep: 2 },
    limit: 2,
    profile: {
      structured: {
        artists: [{ name: 'Owned Artist', weight: 0.2 }]
      }
    },
    conversationMood: {
      mood: 'comfort',
      energy: 'low',
      searchHints: ['治愈', '温柔', '夜晚']
    }
  });

  assert.equal(selected[0].track.id, 'mood');
});
