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
  analyzeTurnContext,
  buildConfirmedTrackHostFallback,
  buildMemoryContext,
  buildFinalHostMessages,
  buildSongSearchQueries,
  classifyTurnIntent,
  canProactivelyRecommend,
  chatTurn,
  decideHardRuleTurnAction,
  decideTurnAction,
  extractAndStoreMemories,
  ensureRecommendationTextMatchesTrack,
  hasExplicitMusicIntent,
  parseDjModelResponse,
  parseFinalHostText,
  parseSongPlanResponse,
  recommendationTextMentionsDifferentTrack,
  rankAndSelectCandidates,
  trackMatchesPlayedSongName,
  trackMatchesSongPick,
  TURN_ACTIONS
} from '../server/dj.mjs';
import { resolvePlayableTrack } from '../server/library.mjs';
import { getMemories, getPreferences, nextRadioItem, removeAllMemories, removeMemory, startRadio, submitFeedback, updatePreferences } from '../server/radio.mjs';

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

test('song plan parser creates concrete song-search queries', () => {
  const plan = parseSongPlanResponse(JSON.stringify({
    picks: [
      {
        name: '陪你度过漫长岁月',
        artists: ['陈奕迅'],
        reason: '贴合陪伴感',
        queries: ['深夜 安静 陪伴', '陪你度过漫长岁月 陈奕迅']
      }
    ],
    hostDraft: '我给你放《陪你度过漫长岁月》。'
  }));

  assert.equal(plan.picks.length, 1);
  assert.equal(plan.picks[0].name, '陪你度过漫长岁月');
  assert.deepEqual(plan.picks[0].artists, ['陈奕迅']);

  const queries = buildSongSearchQueries(plan.picks[0]);
  assert.equal(queries[0], '陪你度过漫长岁月 陈奕迅');
  assert.equal(queries.includes('深夜 安静 陪伴'), false);
});

test('song search matching rejects unrelated mood-title results', () => {
  const pick = { name: '陪你度过漫长岁月', artists: ['陈奕迅'] };

  assert.equal(trackMatchesSongPick({
    id: 'target',
    name: '陪你度过漫长岁月',
    artists: ['Eason Chan']
  }, pick), true);

  assert.equal(trackMatchesSongPick({
    id: 'mood-hit',
    name: '安静',
    artists: ['周杰伦']
  }, pick), false);

  assert.equal(trackMatchesSongPick({
    id: 'wrong-artist',
    name: '陪你度过漫长岁月',
    artists: ['其他歌手']
  }, pick), false);
});

test('played song matching ignores artist and version names', () => {
  const played = [
    { name: '好久不见', artists: ['陈奕迅'] },
    { name: '她说', artists: ['林俊杰'] }
  ];

  assert.equal(trackMatchesPlayedSongName({
    name: '好久不见(国) - Album Version',
    artists: ['陈奕迅']
  }, played), true);

  assert.equal(trackMatchesPlayedSongName({
    name: '好久不见 Live',
    artists: ['翻唱歌手']
  }, played), true);

  assert.equal(trackMatchesPlayedSongName({
    name: '她说 - Cover',
    artists: ['其他歌手']
  }, played), true);

  assert.equal(trackMatchesPlayedSongName({
    name: '好久以后',
    artists: ['陈奕迅']
  }, played), false);
});

test('final host text parser accepts confirmed-track DJ copy', () => {
  const text = '我把这会儿的灯光放暗一点，先让情绪慢慢落下来。接下来给你放《陪你度过漫长岁月》 - 陈奕迅，像一只稳稳伸过来的手，陪你把这一段时间走完。';

  assert.equal(
    parseFinalHostText(JSON.stringify({ chatText: text }), 'fallback'),
    text
  );
  assert.equal(
    parseFinalHostText(text, 'fallback'),
    text
  );
  assert.equal(parseFinalHostText('', 'fallback'), 'fallback');
});

test('final host prompt uses weather only for first radio turn and then focuses on context', () => {
  const common = {
    selectedTrack: { name: '她说', artists: ['林俊杰'], album: '她说 概念自选辑' },
    selectedPick: { name: '她说', artists: ['林俊杰'], reason: '用户明确想听林俊杰' },
    plan: { picks: [{ name: '她说', artists: ['林俊杰'] }] },
    profile: { summary: '偏好华语流行和温柔旋律' },
    prefs: {},
    history: [{ role: 'user', content: '再来首陶喆的歌' }],
    timeOfDay: '深夜',
    hour: 1,
    weather: '上海有风，16度',
    conversationMood: { mood: 'calm' },
    userMessage: '',
    memoryContext: {}
  };

  const firstPrompt = JSON.stringify(buildFinalHostMessages({
    ...common,
    hostContext: { isFirstRadioTurn: true, trigger: '启动电台', recentPlays: [], recentFeedback: [] }
  }));
  assert.match(firstPrompt, /第一次播歌/);
  assert.match(firstPrompt, /可以轻描淡写使用一次时间天气/);

  const laterPrompt = JSON.stringify(buildFinalHostMessages({
    ...common,
    hostContext: {
      isFirstRadioTurn: false,
      trigger: '用户想换一首',
      recentPlays: [{ name: '普通朋友', artists: ['陶喆'], reason: '上一首', hostText: '刚才那首歌的余温还在，接下来换个方向。' }],
      recentFeedback: [{ eventType: 'skip', name: '普通朋友', artists: ['陶喆'] }]
    }
  }));
  assert.match(laterPrompt, /避免天气时间模板/);
  assert.match(laterPrompt, /不要再用时间、天气、城市、温度开头/);
  assert.match(laterPrompt, /只是可选素材，不要强行做上一首到当前歌曲的转场/);
  assert.match(laterPrompt, /不要复用“刚才\/现在\/接下来\/上一首”的转场结构/);
  assert.match(laterPrompt, /最近播放/);
  assert.match(laterPrompt, /最近操作反馈/);
  assert.match(laterPrompt, /最近导播词/);
  assert.match(laterPrompt, /下一首\/跳过：普通朋友/);
  assert.doesNotMatch(laterPrompt, /后续导播优先接最近对话、上一首歌的余味/);
});

test('confirmed track host fallback avoids rigid transition template', () => {
  const text = buildConfirmedTrackHostFallback({
    selectedTrack: { name: '晴天', artists: ['周杰伦'] },
    hostContext: {
      isFirstRadioTurn: false,
      recentPlays: [{ name: '普通朋友', artists: ['陶喆'] }],
      recentFeedback: [{ eventType: 'skip', name: '普通朋友', artists: ['陶喆'] }]
    }
  });

  assert.match(text, /《晴天》/);
  assert.doesNotMatch(text, /刚才|现在换|接下来|上一首/);
});

test('recommendation text is forced to match the final playable track', () => {
  const selected = { id: 'quiet', name: '安静', artists: ['海洋'], album: 'Album' };
  const candidates = [
    { id: 'angel', name: 'Angel (Live)', artists: ['陶喆'], album: 'Album' },
    selected
  ];

  assert.equal(
    recommendationTextMentionsDifferentTrack('今晚适合听 Angel，陶喆这版很柔和。', selected, candidates),
    true
  );
  assert.equal(
    recommendationTextMentionsDifferentTrack('我知道你现在压力很大，我们先把节奏放慢一点，我陪你听一会儿。', selected, [
      { id: 'us', name: '我们', artists: ['陈奕迅'] },
      { id: 'company', name: '陪伴', artists: ['纳豆nado'] },
      selected
    ]),
    false
  );
  assert.equal(
    recommendationTextMentionsDifferentTrack('我不会催你振作，先让这段音乐在旁边陪着。', selected, [
      { id: 'company', name: '陪伴', artists: ['纳豆nado'] },
      selected
    ]),
    false
  );
  assert.equal(
    recommendationTextMentionsDifferentTrack('那我给你放《我们》，陈奕迅这首会轻一点。', selected, [
      { id: 'us', name: '我们', artists: ['陈奕迅'] },
      selected
    ]),
    true
  );

  const text = ensureRecommendationTextMatchesTrack('今晚适合听 Angel，陶喆这版很柔和。', selected, candidates, {
    timeOfDay: '夜晚',
    weather: '上海有点风',
    conversationMood: { mood: 'calm' }
  });
  assert.match(text, /安静/);
  assert.match(text, /海洋/);
  assert.doesNotMatch(text, /Angel|陶喆/);
  assert.match(text, /今晚适合听/);
  assert.notEqual(text, '接下来放 《安静》 - 海洋。');

  const naturalText = ensureRecommendationTextMatchesTrack(
    '我知道你现在压力很大，我们先把节奏放慢一点，我陪你听一会儿。',
    selected,
    [
      { id: 'us', name: '我们', artists: ['陈奕迅'] },
      { id: 'company', name: '陪伴', artists: ['纳豆nado'] },
      selected
    ]
  );
  assert.match(naturalText, /压力很大/);
  assert.match(naturalText, /我们先把节奏放慢/);
  assert.match(naturalText, /陪你听/);
  assert.match(naturalText, /安静/);
  assert.doesNotMatch(naturalText, /我把现在的气氛接到|这一轮先放|接下来放/);

  const shortText = ensureRecommendationTextMatchesTrack('接下来放《安静》。', selected, candidates);
  assert.match(shortText, /安静/);
  assert.equal(shortText, '接下来放《安静》。');

  const fallbackText = ensureRecommendationTextMatchesTrack('', selected, candidates, {
    playableFallback: true,
    timeOfDay: '上午',
    conversationMood: { mood: 'comfort' }
  });
  assert.match(fallbackText, /安静/);
  assert.equal(fallbackText, '接下来放 《安静》 - 海洋。');
  assert.doesNotMatch(fallbackText, /上午|情绪|放稳|暂时放不了|重新确认|不太稳/);
});

test('DJ response parser accepts tagged and plain JSON responses', () => {
  const tagged = parseDjModelResponse(
    '<CHAT>上午适合轻一点，我给你放《安静》。</CHAT><JSON>{"pick":1,"reason":"calm","mode":null}</JSON>',
    'fallback'
  );
  assert.equal(tagged.chatText, '上午适合轻一点，我给你放《安静》。');
  assert.equal(tagged.pick, 1);
  assert.equal(tagged.reason, 'calm');

  const plainJson = parseDjModelResponse(JSON.stringify({
    chatText: '我先把节奏放轻一点，接这首《Weightless》。',
    pick: 0,
    reason: '适合放松',
    mode: null
  }), 'fallback');
  assert.equal(plainJson.chatText, '我先把节奏放轻一点，接这首《Weightless》。');
  assert.equal(plainJson.pick, 0);
  assert.equal(plainJson.reason, '适合放松');

  const textThenJson = parseDjModelResponse(
    '我先把今天的节奏放轻一点，给你接一首没那么吵的。\n{"pick":2,"reason":"适合安静下来","mode":null}',
    'fallback'
  );
  assert.equal(textThenJson.chatText, '我先把今天的节奏放轻一点，给你接一首没那么吵的。');
  assert.equal(textThenJson.pick, 2);
  assert.equal(textThenJson.reason, '适合安静下来');

  const alternateKeys = parseDjModelResponse(JSON.stringify({
    message: '这首会更轻一点，先让它把空间留出来。',
    pick: 0,
    reason: '低打扰'
  }), 'fallback');
  assert.equal(alternateKeys.chatText, '这首会更轻一点，先让它把空间留出来。');
  assert.equal(alternateKeys.pick, 0);
});

test('playable resolution keeps originalId tracks eligible for ncm-cli fallback', async () => {
  const netease = {
    isConfigured: () => true,
    playUrl: async () => ({ data: {} }),
    lyric: async () => ({ data: {} })
  };

  const resolved = await resolvePlayableTrack(null, netease, {
    id: 'encrypted-vip',
    originalId: '123456',
    name: 'VIP Song',
    artists: ['Artist']
  }, { includeLyric: false });

  assert.equal(resolved.playable, true);
  assert.equal(resolved.playUrl, null);
  assert.equal(resolved.playbackMode, 'ncm-cli');
  assert.equal(resolved.playbackError, null);

  const missingOriginalId = await resolvePlayableTrack(null, netease, {
    id: 'no-original-id',
    name: 'No Resource',
    artists: ['Artist']
  }, { includeLyric: false });

  assert.equal(missingOriginalId.playable, false);
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

test('feedback summaries use recent events and are returned after feedback', (t) => {
  const db = testDb(t);

  recordTrackFeedback(db, { trackId: 'track-1', eventType: 'like' });
  recordTrackFeedback(db, { trackId: 'track-1', eventType: 'complete' });
  const summary = getPreferences({ db }).feedbackSummary;
  assert.equal(summary.totals.likes, 1);
  assert.equal(summary.totals.completions, 1);
  assert.equal(summary.totals.events, 2);
  assert.equal(summary.windowDays, 30);
  assert.equal(summary.tracks[0].trackId, 'track-1');

  const ok = submitFeedback({
    db,
    payload: { trackId: 'track-2', eventType: 'skip', sessionId: 'session-1' }
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.feedbackSummary.totals.skips, 1);
  assert.equal(Array.isArray(ok.memories), true);
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

  const mixerSaved = updatePreferences({
    db,
    payload: {
      chatMusicBalance: 'friend',
      recommendationFrequency: 'high',
      voiceMode: 'off',
      moodMode: 'random'
    }
  });
  assert.equal(mixerSaved.preferences.chatMusicBalance, 'friend');
  assert.equal(mixerSaved.preferences.recommendationFrequency, 'high');
  assert.equal(mixerSaved.preferences.voiceMode, 'off');
  assert.equal(mixerSaved.preferences.moodMode, 'random');

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

test('voice mode is returned as an explicit speech decision for chat replies', async (t) => {
  const db = testDb(t);

  updatePreferences({ db, payload: { voiceMode: 'all' } });
  const speakAll = await chatTurn({
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'voice-all-chat',
    message: 'hello'
  });
  assert.equal(speakAll.track, null);
  assert.deepEqual(speakAll.speech, { mode: 'all', shouldSpeak: true });

  updatePreferences({ db, payload: { voiceMode: 'off' } });
  const speakOff = await chatTurn({
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'voice-off-chat',
    message: 'hello again'
  });
  assert.equal(speakOff.track, null);
  assert.deepEqual(speakOff.speech, { mode: 'off', shouldSpeak: false });
  assert.equal(speakOff.ttsUrl, null);
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

test('memory API surfaces recently updated memories first', (t) => {
  const db = testDb(t);
  const oldMemory = recordOrMergeUserMemory(db, {
    kind: 'preference',
    content: 'old memory should not stay first forever',
    importance: 1,
    confidence: 1
  });
  db.prepare('UPDATE user_memories SET updated_at = ? WHERE id = ?')
    .run('2000-01-01T00:00:00.000Z', oldMemory.id);
  const recentMemory = recordOrMergeUserMemory(db, {
    kind: 'need',
    content: 'recent memory should be visible in the mixer summary',
    importance: 0.2,
    confidence: 0.2
  });

  const memories = getMemories({ db }).memories;
  assert.equal(memories[0].id, recentMemory.id);
  assert.equal(listUserMemories(db)[0].id, recentMemory.id);
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
          content: JSON.stringify({
            chatText: '我记得你这种时候更需要有人陪着。我们先慢慢聊，不急着切歌。',
            shouldRecommend: false,
            mood: 'night',
            energy: 'low',
            intent: 'chat',
            searchHints: ['陪伴'],
            reason: '长期记忆提示先陪伴',
            mode: null
          })
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
  assert.match(JSON.stringify(requests[0].messages), /用户深夜睡不着时更需要先被陪伴/);
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

test('turn action gate separates self-disclosure, fatigue, music requests, and rejection', () => {
  assert.equal(decideTurnAction({
    userMessage: '我是大学生，软件工程专业的',
    baseMood: {}
  }).action, TURN_ACTIONS.ASK_FOLLOWUP);

  assert.equal(decideTurnAction({
    userMessage: '今天写代码写麻了',
    baseMood: { shouldRecommend: true, mood: 'calm', searchHints: ['放松'] },
    canSuggest: true,
    currentTrack: { id: 'current' }
  }).action, TURN_ACTIONS.ASK_FOLLOWUP);

  assert.equal(decideTurnAction({
    userMessage: '来首适合写代码的',
    explicitIntent: true,
    baseMood: {}
  }).action, TURN_ACTIONS.RECOMMEND_AND_PLAY);

  assert.equal(decideTurnAction({
    userMessage: '听陈奕迅的稳稳的幸福',
    explicitIntent: hasExplicitMusicIntent('听陈奕迅的稳稳的幸福'),
    baseMood: {}
  }).action, TURN_ACTIONS.RECOMMEND_AND_PLAY);

  assert.equal(decideTurnAction({
    userMessage: '别放歌，先聊聊',
    explicitIntent: false,
    baseMood: {}
  }).action, TURN_ACTIONS.CHAT_ONLY);

  assert.equal(decideTurnAction({
    userMessage: '下一首',
    explicitIntent: true,
    baseMood: {}
  }).action, TURN_ACTIONS.RECOMMEND_AND_PLAY);

  assert.equal(decideTurnAction({
    userMessage: '恢复正常推荐，取消所有偏好模式',
    explicitIntent: true,
    baseMood: {}
  }).action, TURN_ACTIONS.CHAT_ONLY);
});

test('intent classifier maps DeepSeek JSON into turn actions', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const prompt = JSON.stringify(body.messages);
    const isSongRequest = prompt.includes('稳稳的幸福');
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify(isSongRequest
            ? {
              action: 'recommend_and_play',
              confidence: 0.92,
              mood: 'calm',
              energy: 'medium',
              musicIntent: 'explicit_song',
              searchHints: ['陈奕迅', '稳稳的幸福'],
              reason: '用户明确点歌'
            }
            : {
              action: 'chat_only',
              confidence: 0.88,
              mood: 'random',
              energy: 'medium',
              musicIntent: 'none',
              searchHints: [],
              reason: '用户在问观点'
            })
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const config = { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-flash' } };
  const songIntent = await classifyTurnIntent({
    config,
    userMessage: '听陈奕迅的稳稳的幸福',
    baseMood: {},
    explicitIntent: true
  });
  assert.equal(songIntent.accepted, true);
  assert.equal(songIntent.action, TURN_ACTIONS.RECOMMEND_AND_PLAY);
  assert.equal(songIntent.source, 'llm');
  assert.equal(songIntent.searchHints.includes('陈奕迅'), true);
  assert.equal(songIntent.searchHints.includes('稳稳的幸福'), true);

  const chatIntent = await classifyTurnIntent({
    config,
    userMessage: '你喜欢陈奕迅吗',
    baseMood: {},
    explicitIntent: false
  });
  assert.equal(chatIntent.accepted, true);
  assert.equal(chatIntent.action, TURN_ACTIONS.CHAT_ONLY);
});

test('intent classifier falls back on bad JSON, low confidence, and hard rules', async (t) => {
  assert.equal(decideHardRuleTurnAction({ userMessage: '下一首' }).action, TURN_ACTIONS.RECOMMEND_AND_PLAY);
  assert.equal(decideHardRuleTurnAction({ userMessage: '不想听陈奕迅的这首，换他的另一首歌，切歌' }).action, TURN_ACTIONS.RECOMMEND_AND_PLAY);
  assert.equal(decideHardRuleTurnAction({ userMessage: '不想听这个版本，换一首' }).action, TURN_ACTIONS.RECOMMEND_AND_PLAY);
  assert.equal(decideHardRuleTurnAction({ userMessage: '暂停' }).action, TURN_ACTIONS.CONTINUE_CURRENT_SONG);
  assert.equal(decideHardRuleTurnAction({ userMessage: '别放歌，先聊聊' }).action, TURN_ACTIONS.CHAT_ONLY);
  assert.equal(decideHardRuleTurnAction({ userMessage: '不要切歌，先聊聊' }).action, TURN_ACTIONS.CHAT_ONLY);

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"action":"recommend_and_play","confidence":0.2}' } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const lowConfidence = await classifyTurnIntent({
    config: { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-flash' } },
    userMessage: '随便聊聊',
    baseMood: {}
  });
  assert.equal(lowConfidence.accepted, false);

  const hardRuleRequests = [];
  globalThis.fetch = async (url, options) => {
    hardRuleRequests.push(options?.body || '');
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const db = testDb(t);
  const result = await chatTurn({
    db,
    config: { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-flash' }, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'hard-rule-no-llm',
    message: '别放歌，先聊聊'
  });
  assert.equal(result.track, null);
  assert.equal(result.turnAction.action, TURN_ACTIONS.CHAT_ONLY);
  assert.equal(hardRuleRequests.some(body => String(body).includes('轻量意图路由器')), false);
  assert.equal(hardRuleRequests.some(body => String(body).includes('这一轮是普通聊天回复')), true);
});

test('self-disclosure chat does not select a track and stays in chat mode', async (t) => {
  const db = testDb(t);
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            chatText: '原来你是软件工程专业的大学生啊。你平时更喜欢做能马上看到效果的前端，还是偏逻辑的后端？',
            mood: 'random',
            energy: 'medium',
            intent: 'chat',
            searchHints: [],
            reason: '自我介绍',
            mode: null
          })
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await chatTurn({
    db,
    config: { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-test' }, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'self-disclosure',
    message: '我是一名大学生，软件工程专业的'
  });

  assert.equal(result.track, null);
  assert.equal(result.turnAction.action, TURN_ACTIONS.ASK_FOLLOWUP);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plays').get().count, 0);
  const chatPromptText = JSON.stringify(
    requests.find(req => JSON.stringify(req.messages).includes('这一轮只聊天，不切歌'))?.messages || []
  );
  assert.match(chatPromptText, /这一轮只聊天，不切歌/);
});

test('ordinary chat hides current track details from prompt', async (t) => {
  const db = testDb(t);
  db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?,?,?,?)')
    .run('hide-current-track', new Date().toISOString(), '{}', '[]');
  db.prepare('INSERT INTO tracks (id, name, artists, album, cover_url, duration_ms, raw_json, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('current-1', '几分之几', JSON.stringify(['卢广仲']), 'Album', null, 180000, '{}', new Date().toISOString());
  db.prepare('INSERT INTO plays (track_id, played_at, source, reason, report_status) VALUES (?,?,?,?,?)')
    .run('current-1', new Date().toISOString(), 'radio', 'test', 'pending');

  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            chatText: '写 AI DJ 项目听起来很有意思，你现在最想先做好聊天感，还是推荐准确度？',
            mood: 'random',
            energy: 'medium',
            intent: 'chat',
            searchHints: [],
            reason: 'ordinary chat',
            mode: null
          })
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await chatTurn({
    db,
    config: { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-test' }, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'hide-current-track',
    message: '我最近在写一个 AI DJ 项目'
  });

  const promptText = JSON.stringify(requests[0].messages);
  assert.equal(result.track, null);
  assert.doesNotMatch(promptText, /几分之几/);
  assert.doesNotMatch(promptText, /卢广仲/);
  assert.match(promptText, /不要主动提及歌名/);
});

test('current track details are exposed when user asks about the current song', async (t) => {
  const db = testDb(t);
  db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?,?,?,?)')
    .run('ask-current-track', new Date().toISOString(), '{}', '[]');
  db.prepare('INSERT INTO tracks (id, name, artists, album, cover_url, duration_ms, raw_json, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('current-2', '几分之几', JSON.stringify(['卢广仲']), 'Album', null, 180000, '{}', new Date().toISOString());
  db.prepare('INSERT INTO plays (track_id, played_at, source, reason, report_status) VALUES (?,?,?,?,?)')
    .run('current-2', new Date().toISOString(), 'radio', 'test', 'pending');

  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            chatText: '现在放的是《几分之几》，卢广仲的。',
            mood: 'random',
            energy: 'medium',
            intent: 'chat',
            searchHints: [],
            reason: 'user asked current song',
            mode: null
          })
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await chatTurn({
    db,
    config: { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-test' }, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'ask-current-track',
    message: '现在放的是什么歌？'
  });

  const promptText = JSON.stringify(requests[0].messages);
  assert.match(promptText, /几分之几/);
  assert.match(promptText, /卢广仲/);
});

test('ambiguous fatigue chat does not build candidates or create plays', async (t) => {
  const db = testDb(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          chatText: '听起来你今天被代码榨干了一点。先缓口气，最卡你的地方是 bug 还是项目压力？',
          mood: 'calm',
          energy: 'low',
          intent: 'chat',
          searchHints: ['放松'],
          reason: '先陪聊',
          mode: null
        })
      }
    }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const result = await chatTurn({
    db,
    config: { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-test' }, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'fatigue-chat',
    message: '今天写代码写麻了'
  });

  assert.equal(result.track, null);
  assert.equal(result.turnAction.action, TURN_ACTIONS.ASK_FOLLOWUP);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plays').get().count, 0);
});

test('chat LLM timeout remains bounded without playing music', async (t) => {
  const db = testDb(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Promise(() => {});

  const startedAt = Date.now();
  const result = await chatTurn({
    db,
    config: { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-test' }, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'timeout-chat',
    message: '我是软件工程专业的学生'
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.track, null);
  assert.equal(result.turnAction.action, TURN_ACTIONS.ASK_FOLLOWUP);
  assert.equal(elapsedMs < 14000, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plays').get().count, 0);
});

test('light chat returns text without selecting a track', async (t) => {
  const db = testDb(t);
  const result = await chatTurn({
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'chat-session',
    message: '今天看到一部电影，想随便聊聊'
  });

  assert.equal(result.track, null);
  assert.equal(result.ttsUrl, null);
  assert.equal(result.intent, 'chat');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plays').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE session_id = ?').get('chat-session').count, 2);
});

test('fallback companion chat is longer and avoids clinical follow-up', async (t) => {
  const db = testDb(t);
  const result = await chatTurn({
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'warm-fallback-chat',
    message: '疲惫，但有点开心和期待'
  });

  assert.equal(result.track, null);
  assert.equal(result.turnAction.action, TURN_ACTIONS.ASK_FOLLOWUP);
  assert.equal(result.chatText.length >= 30, true);
  assert.doesNotMatch(result.chatText, /最明显的感受是什么|为什么/);
  assert.match(result.chatText, /不用急|慢慢|压着|想到哪/);
});

test('fallback celebrates completed hard task without exposing routing template', async (t) => {
  const db = testDb(t);
  const result = await chatTurn({
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'happy-task-fallback',
    message: '我现在很开心，因为我一个很难做的任务做完了'
  });

  assert.equal(result.track, null);
  assert.match(result.chatText, /值得开心|做完|享受/);
  assert.doesNotMatch(result.chatText, /我会先按聊天来接|电台腔|你刚刚说/);
});

test('fallback answers direct artist preference without night comfort template', async (t) => {
  const db = testDb(t);
  db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?,?,?,?)')
    .run('artist-opinion-chat', new Date().toISOString(), '{}', '[]');
  db.prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?,?,?,?)')
    .run('artist-opinion-chat', 'user', '好晚了', new Date().toISOString());
  db.prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?,?,?,?)')
    .run('artist-opinion-chat', 'assistant', '是有点晚了。', new Date().toISOString());

  const result = await chatTurn({
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'artist-opinion-chat',
    message: '你喜欢陶喆吗'
  });

  assert.equal(result.track, null);
  assert.match(result.chatText, /陶喆|R&B|喜欢/);
  assert.doesNotMatch(result.chatText, /夜里人的感受|马上睡着|振作/);
});

test('light greeting stays casual instead of over-supportive', async (t) => {
  const db = testDb(t);
  const result = await chatTurn({
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'light-greeting-chat',
    message: '你好'
  });

  assert.equal(result.track, null);
  assert.equal(result.chatText.length < 70, true);
  assert.doesNotMatch(result.chatText, /不用.*完整|接住.*情绪|分析/);
  assert.match(result.chatText, /你好|我在|灿灿/);
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

test('recommendation trigger policy distinguishes chat from music intent', () => {
  assert.equal(hasExplicitMusicIntent('换一首，来点国风'), true);
  assert.equal(hasExplicitMusicIntent('不想听这首，换他的另一首'), true);
  assert.equal(hasExplicitMusicIntent('不想听这个版本，切歌'), true);
  assert.equal(hasExplicitMusicIntent('听陈奕迅的稳稳的幸福'), true);
  assert.equal(hasExplicitMusicIntent('放周杰伦的晴天'), true);
  assert.equal(hasExplicitMusicIntent('听过陈奕迅的稳稳的幸福吗'), false);
  assert.equal(hasExplicitMusicIntent('只是想和你说句话'), false);
  assert.equal(hasExplicitMusicIntent('不想听歌，先聊聊'), false);
  assert.equal(hasExplicitMusicIntent('你推荐什么电影'), false);

  assert.equal(canProactivelyRecommend({
    userMessageCount: 2,
    currentTrack: { id: 'current' },
    mood: { shouldRecommend: true }
  }), false);
  assert.equal(canProactivelyRecommend({
    userMessageCount: 3,
    currentTrack: { id: 'current' },
    mood: { shouldRecommend: true }
  }), true);
  assert.equal(canProactivelyRecommend({
    userMessageCount: 4,
    lastSuggestedAtUserCount: 2,
    currentTrack: { id: 'current' },
    mood: { shouldRecommend: true }
  }), false);
});

test('conversation analysis stores short-term preferences without forcing music', async (t) => {
  const db = testDb(t);
  const result = await chatTurn({
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'state-chat',
    message: '今天有点难过，后面可以多一点治愈安静的歌，但先别放'
  });

  assert.equal(result.track, null);
  assert.equal(result.turnAction.action, TURN_ACTIONS.CHAT_ONLY);
  const row = db.prepare('SELECT context_json AS contextJson FROM radio_sessions WHERE id = ?').get('state-chat');
  const context = JSON.parse(row.contextJson);
  assert.equal(context.conversationState.currentEmotion, 'comfort');
  assert.equal(context.conversationState.preferenceHints.includes('治愈'), true);
  assert.equal(context.conversationState.preferenceHints.includes('安静'), true);
  assert.equal(context.conversationState.noMusicUntilUserCount >= 4, true);
});

test('preference settings affect proactive recommendation thresholds', () => {
  const mood = { shouldRecommend: true };
  assert.equal(canProactivelyRecommend({
    userMessageCount: 2,
    currentTrack: { id: 'current' },
    mood,
    prefs: { chatMusicBalance: 'friend', recommendationFrequency: 'medium' }
  }), false);
  assert.equal(canProactivelyRecommend({
    userMessageCount: 2,
    currentTrack: { id: 'current' },
    mood,
    prefs: { chatMusicBalance: 'balanced', recommendationFrequency: 'medium' }
  }), true);
  assert.equal(canProactivelyRecommend({
    userMessageCount: 6,
    lastSuggestedAtUserCount: 2,
    currentTrack: { id: 'current' },
    mood,
    prefs: { chatMusicBalance: 'dj', recommendationFrequency: 'low' }
  }), false);
});

test('mood preference mode overrides automatic conversation mood', () => {
  const analysis = analyzeTurnContext({
    userMessage: '今天写代码写累了',
    prefs: { moodMode: 'focus' }
  });

  assert.equal(analysis.mood, 'focus');
  assert.equal(analysis.searchHints.includes('专注'), true);
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
