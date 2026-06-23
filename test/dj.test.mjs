import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  clearUserMemories,
  deleteUserMemory,
  listUserMemories,
  linkPlaylistTrack,
  openDatabase,
  getMoodStats,
  recordOrMergeUserMemory,
  recordMoodEvent,
  recordTrackFeedback,
  retrieveRelevantMemories,
  savePlaylist,
  saveTrack,
  setSetting,
  updateUserMemoryContent
} from '../server/db.mjs';
import {
  analyzeConversationMood,
  analyzeTurnContext,
  advanceSessionConstraintsForFeedback,
  buildConfirmedTrackHostFallback,
  buildDailyMusicRecap,
  buildHybridCandidateContext,
  formatEnvironmentContext,
  buildRecommendationExplanation,
  buildMemoryContext,
  buildFinalHostMessages,
  buildWeatherRadioContext,
  buildSongSearchQueries,
  classifyTurnIntent,
  canProactivelyRecommend,
  chatTurn,
  concertAudienceTurn,
  concertEncoreTurn,
  concertHostTurn,
  concertNextTurn,
  concertReplanTurn,
  concertStartTurn,
  consumeReadyRadioQueue,
  decideHardRuleTurnAction,
  decideQueuePolicy,
  decideTurnAction,
  djTurn,
  extractAndStoreMemories,
  extractRequestedSongTitle,
  ensureRecommendationTextMatchesTrack,
  formatProfileSummaryForPrompt,
  getRadioDebugStatus,
  getRadioQueueStatus,
  getRecommendationPipeline,
  getTimeContext,
  hasExplicitMusicIntent,
  isDirectMusicRequest,
  normalizeMusicContext,
  normalizeSessionConstraints,
  normalizeRadioQueue,
  parseSessionConstraintUpdate,
  parseDjModelResponse,
  parseFinalHostText,
  parseSongPlanResponse,
  playlistJumpTurn,
  playlistNextTurn,
  playlistStartTurn,
  prefetchRadioQueue,
  queueItemMatchesMusicContext,
  recommendationTextMentionsDifferentTrack,
  rankAndSelectCandidates,
  replayRequestAllowsPlayedSong,
  sanitizeSpokenChatText,
  scoreSearchTrackForPick,
  trackMatchesStyleConstraint,
  trackViolatesSessionConstraints,
  trackViolatesStyleConstraint,
  trackMatchesPlayedSongName,
  trackMatchesSongPick,
  TURN_ACTIONS
} from '../server/dj.mjs';
import { resolvePlayableTrack } from '../server/library.mjs';
import { getMemories, getMoodStatsSummary, getPreferences, nextRadioItem, removeAllMemories, removeMemory, startPlaylistRadio, startRadio, submitFeedback, updateMemory, updatePreferences } from '../server/radio.mjs';
import { resolveAccountContext } from '../server/account-scope.mjs';
import { generateDiary, getDiary } from '../server/diary.mjs';
import { buildCanCanBackgroundPrompt, buildCanCanPersonaPrompt, shouldUseCanCanCreatorContext } from '../server/cancan-persona.mjs';

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

function countByNovelty(candidates) {
  return candidates.reduce((counts, item) => {
    const bucket = item.noveltyBucket || 'familiar';
    counts[bucket] = (counts[bucket] || 0) + 1;
    return counts;
  }, {});
}

function discoveryRecords(prefix, count, artist = 'Discovery Artist') {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index}`,
    name: `Discovery ${prefix}${index}`,
    artists: [{ name: `${artist} ${index}` }],
    album: { name: `Discovery Album ${index}` }
  }));
}

function discoveryNetease(records, extra = {}) {
  return {
    isConfigured: () => true,
    dailyRecommend: async () => ({ data: { songs: records } }),
    ...extra
  };
}

function saveLocalTracks(db, prefix, count) {
  return Array.from({ length: count }, (_, index) => saveTrack(db, {
    id: `${prefix}${index}`,
    originalId: `${prefix}${index}`,
    name: `Local ${prefix}${index}`,
    artists: [`Local Artist ${index}`],
    album: `Local Album ${index}`
  }));
}

function guofengDjStyleConstraint() {
  return {
    strict: true,
    requiredGroups: [
      ['\u56fd\u98ce', '\u53e4\u98ce', '\u4e2d\u56fd\u98ce'],
      ['DJ', 'remix', '\u7535\u97f3', 'BGM']
    ],
    softTerms: ['\u9006\u88ad', '\u71c3', '\u529b\u91cf', '\u77ed\u89c6\u9891'],
    negativeTerms: ['\u666e\u901a\u6292\u60c5', '\u6000\u65e7\u6162\u6b4c'],
    searchQueries: ['\u56fd\u98ce DJ \u9006\u88ad BGM']
  };
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

test('scene recommendation requests are not parsed as song titles', () => {
  assert.equal(extractRequestedSongTitle('\u6211\u6b63\u5728\u6559\u5ba4\uff0c\u8bf7\u5e2e\u6211\u63a8\u8350\u9002\u5408\u6559\u5ba4\u7684\u6b4c'), '');
  assert.equal(extractRequestedSongTitle('\u6211\u6b63\u5728\u5bbf\u820d\uff0c\u8bf7\u5e2e\u6211\u63a8\u8350\u9002\u5408\u5bbf\u820d\u7684\u6b4c'), '');
  assert.equal(extractRequestedSongTitle('\u6211\u6b63\u5728\u5065\u8eab\u623f\uff0c\u8bf7\u5e2e\u6211\u63a8\u8350\u9002\u5408\u5065\u8eab\u623f\u7684\u97f3\u4e50'), '');
  assert.equal(extractRequestedSongTitle('\u6211\u60f3\u542c\u300a\u6674\u5929\u300b'), '\u6674\u5929');
  assert.equal(extractRequestedSongTitle('\u653e\u4e00\u9996\u5bcc\u58eb\u5c71\u4e0b'), '\u5bcc\u58eb\u5c71\u4e0b');
});

test('recommendation explanation hides internal fallback reasons', () => {
  const explanation = buildRecommendationExplanation({
    selectedPick: {
      reason: '\u539f\u6765\u60f3\u627e\u7684\u300a\u9002\u5408\u6559\u5ba4\u300b\u6ca1\u6709\u786e\u8ba4\u5230\u7a33\u5b9a\u64ad\u653e\u6e90\uff0c\u5148\u6362\u540c\u6b4c\u624b\u91cc\u66f4\u7a33\u7684\u4e00\u9996\u3002'
    },
    selectedTrack: { name: 'River Flows in You', artists: ['Yiruma'] },
    userMessage: '\u6211\u6b63\u5728\u6559\u5ba4\uff0c\u8bf7\u5e2e\u6211\u63a8\u8350\u9002\u5408\u6559\u5ba4\u7684\u6b4c',
    conversationMood: { searchHints: ['\u6559\u5ba4', '\u5b89\u9759', '\u8f7b\u97f3\u4e50'] },
    timeOfDay: '\u4e0b\u5348',
    profile: { structured: { artists: [{ name: '\u738b\u83f2' }], genres: [{ name: '\u534e\u8bed\u6d41\u884c' }] } },
    source: 'fallback'
  });
  const text = JSON.stringify(explanation);
  assert.doesNotMatch(text, /\u539f\u6765\u60f3\u627e|\u6ca1\u6709\u786e\u8ba4\u5230|\u7a33\u5b9a\u64ad\u653e\u6e90|\u66f4\u7a33\u7684\u4e00\u9996|LLM|\u515c\u5e95/);
  assert.match(text, /\u6559\u5ba4|\u5b89\u9759|\u8f7b\u97f3\u4e50|\u4e0b\u5348/);
});

test('recommendation explanation includes traceable source, weather radio, and recap hints', () => {
  const weatherRadio = buildWeatherRadioContext({
    weather: '\u4e0a\u6d77\u5c0f\u96e8\uff0c18\u2103',
    timeOfDay: '\u4e0a\u5348',
    hour: 9
  });
  const explanation = buildRecommendationExplanation({
    selectedTrack: { name: 'Rain Song', artists: ['DJ Test'] },
    selectedPick: { reason: '\u548c\u4f60\u5f53\u524d\u60c5\u7eea\u6bd4\u8f83\u63a5\u8fd1' },
    recommendationSource: { id: 'lyric_mood_match' },
    weather: '\u4e0a\u6d77\u5c0f\u96e8\uff0c18\u2103',
    timeOfDay: '\u4e0a\u5348',
    environmentContext: { weatherRadio },
    hostContext: {
      openingRecap: {
        recommendationHint: '\u8fd9\u51e0\u5929\u4f60\u665a\u4e0a\u90fd\u4e0d\u592a\u60f3\u542c\u592a\u6162\u7684\uff0c\u6211\u4eca\u5929\u4e5f\u5148\u907f\u5f00\u3002'
      }
    }
  });

  const text = JSON.stringify(explanation);
  assert.match(text, /\u6765\u81ea/);
  assert.match(text, /\u6b4c\u8bcd\u60c5\u7eea\u76f8\u8fd1/);
  assert.match(text, /\u5929\u6c14\u7535\u53f0|\u96e8\u5929\u4e0a\u5348/);
  assert.match(text, /\u56de\u987e|\u4eca\u5929\u4e5f\u5148\u907f\u5f00/);
  assert.equal(explanation.factors.filter(factor => factor.label === '\u6765\u81ea').length, 1);

  const failedWeatherExplanation = buildRecommendationExplanation({
    selectedTrack: { name: 'Test Track', artists: ['Test Artist'] },
    weather: '\u4e0a\u6d77\uff0c\u5929\u6c14\u83b7\u53d6\u5931\u8d25\uff1afetch failed\u3002\u6309\u5f53\u524d\u65f6\u95f4\u548c\u672c\u5730\u97f3\u4e50\u753b\u50cf\u63a8\u8350\u3002',
    timeOfDay: '\u4e0b\u5348'
  });
  assert.equal(failedWeatherExplanation.factors.some(factor => /fetch failed/i.test(factor.text)), false);
});

test('weather radio maps concrete weather and time scenes', () => {
  assert.equal(buildWeatherRadioContext({ weather: '\u4e0a\u6d77\u5c0f\u96e8', timeOfDay: '\u4e0a\u5348', hour: 9 }).id, 'rain_morning');
  assert.equal(buildWeatherRadioContext({ weather: '\u95f7\u70ed\uff0c\u4f53\u611f 34\u2103\uff0c\u6e7f\u5ea6 82%', timeOfDay: '\u4e0b\u5348', hour: 15 }).id, 'muggy_afternoon');
  assert.equal(buildWeatherRadioContext({ weather: '\u5927\u98ce\u964d\u6e29', timeOfDay: '\u4e0b\u5348', hour: 16 }).id, 'windy_cooling');
  assert.equal(buildWeatherRadioContext({ weather: '\u6674\u5929', timeOfDay: '\u508d\u665a', hour: 18 }).id, 'clear_evening');
  assert.equal(buildWeatherRadioContext({ weather: '\u96f7\u96e8', timeOfDay: '\u591c\u665a', hour: 23 }).id, 'thunderstorm_night');
});

test('daily music recap is silent without yesterday usage and summarizes real activity', (t) => {
  const emptyDb = testDb(t);
  assert.equal(buildDailyMusicRecap(emptyDb, { localDate: '2026-06-11', timeZone: 'Asia/Shanghai' }), null);

  const db = testDb(t);
  saveTrack(db, { id: 'slow-rain', name: '\u5b89\u9759\u6162\u6b4c', artists: ['Soft DJ'], album: '\u96e8\u5929\u94a2\u7434' });
  saveTrack(db, { id: 'night-electro', name: '\u591c\u665a\u7535\u5b50\u8282\u594f', artists: ['Electro DJ'], album: 'City Beat' });
  saveTrack(db, { id: 'energy-run', name: '\u63d0\u795e\u8dd1\u6b65\u8282\u594f', artists: ['Run DJ'], album: 'Energy Beat' });
  db.prepare('INSERT INTO plays (account_id, track_id, played_at, source, reason, report_status) VALUES (?,?,?,?,?,?)')
    .run('local:default', 'slow-rain', '2026-06-10T06:20:00.000Z', 'radio_familiar', '\u4f4e\u80fd\u91cf\u5b89\u9759', 'pending');
  db.prepare('INSERT INTO plays (account_id, track_id, played_at, source, reason, report_status) VALUES (?,?,?,?,?,?)')
    .run('local:default', 'night-electro', '2026-06-10T12:40:00.000Z', 'radio_familiar', '\u665a\u4e0a\u7535\u5b50\u8282\u594f', 'pending');
  db.prepare('INSERT INTO track_feedback_events (account_id, track_id, event_type, session_id, elapsed_ms, duration_ms, source, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('local:default', 'slow-rain', 'skip', 'recap-session', 20000, 200000, 'player', '2026-06-10T06:25:00.000Z');
  db.prepare('INSERT INTO track_feedback_events (account_id, track_id, event_type, session_id, elapsed_ms, duration_ms, source, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('local:default', 'night-electro', 'complete', 'recap-session', 200000, 200000, 'player', '2026-06-10T12:55:00.000Z');
  recordMoodEvent(db, { mood: 'calm', energy: 'low', createdAt: '2026-06-10T02:00:00.000Z' });
  recordMoodEvent(db, { mood: 'night', energy: 'low', createdAt: '2026-06-10T13:00:00.000Z' });
  recordMoodEvent(db, { mood: 'energy', energy: 'high', createdAt: '2026-06-09T13:00:00.000Z' });
  recordMoodEvent(db, { mood: 'energy', energy: 'high', createdAt: '2026-06-10T12:00:00.000Z' });

  const recap = buildDailyMusicRecap(db, { localDate: '2026-06-11', timeZone: 'Asia/Shanghai' });
  const ids = recap.signals.map(signal => signal.id);
  assert.equal(recap.date, '2026-06-10');
  assert.equal(ids.includes('low_energy_day'), true);
  assert.equal(ids.includes('afternoon_skipped_slow'), true);
  assert.equal(ids.includes('evening_electronic_rhythm'), true);
  assert.equal(ids.includes('three_day_energy_lift'), true);
  assert.match(recap.openingLine, /\u6628\u5929/);
  assert.match(recap.recommendationHint, /\u5148\u907f\u5f00|\u6162\u6b4c/);
});

test('profile prompt summary uses objective llm profile without concrete artists or songs', () => {
  const prompt = formatProfileSummaryForPrompt({
    summary: '\u4f60\u7684\u97f3\u4e50\u4e16\u754c\u5728\u6e2f\u4e50\u6df1\u60c5\u3001\u534e\u8bed\u6d41\u884c\u4e0e\u6b27\u7f8e\u8282\u594f\u95f4\u4ece\u5bb9\u7a7f\u884c\u3002\u9648\u5955\u8fc5\u548c\u738b\u83f2\u662f\u4f60\u7684\u7075\u9b42\u5e95\u8272\uff0c\u90a3\u4e9b\u5173\u4e8e\u9057\u61be\u4e0e\u91ca\u6000\u7684\u53d9\u4e8b\uff0c\u5728\u300a\u5bcc\u58eb\u5c71\u4e0b\u300b\u300a\u7ea2\u8c46\u300b\u4e2d\u88ab\u53cd\u590d\u8046\u542c\u3002',
    structured: {
      llmProfile: { summary: '\u5ba2\u89c2\u504f\u597d\uff1a\u6e2f\u4e50\u6df1\u60c5\u3001\u534e\u8bed\u6d41\u884c\u3001\u4f4e\u4e2d\u901f\u3001\u591c\u95f4\u966a\u4f34\u611f\uff0c\u4e0d\u70b9\u540d\u9648\u5955\u8fc5\u6216\u300a\u5bcc\u58eb\u5c71\u4e0b\u300b\u3002' },
      artists: [{ name: '\u9648\u5955\u8fc5' }, { name: '\u738b\u83f2' }],
      genres: [{ name: '\u534e\u8bed\u6d41\u884c' }],
      moods: [{ name: '\u966a\u4f34\u611f' }]
    }
  });

  assert.doesNotMatch(prompt, /\u300a|\u300b|\u5bcc\u58eb\u5c71\u4e0b|\u7ea2\u8c46|\u539f\u795e/);
  assert.doesNotMatch(prompt, /\u9648\u5955\u8fc5|\u738b\u83f2/);
  assert.match(prompt, /\u6e2f\u4e50\u6df1\u60c5/);
  assert.match(prompt, /\u534e\u8bed\u6d41\u884c/);
});

test('profile prompt falls back to non-artist structured signals only', () => {
  const prompt = formatProfileSummaryForPrompt({
    summary: '\u9648\u5955\u8fc5\u548c\u738b\u83f2\u662f\u4f60\u7684\u7075\u9b42\u5e95\u8272\uff0c\u300a\u5bcc\u58eb\u5c71\u4e0b\u300b\u88ab\u53cd\u590d\u8046\u542c\u3002',
    structured: {
      artists: [{ name: '\u9648\u5955\u8fc5' }, { name: '\u738b\u83f2' }],
      albums: [{ name: '\u8ba4\u4e86\u5427' }],
      genres: [{ name: '\u534e\u8bed\u6d41\u884c' }],
      moods: [{ name: '\u6000\u65e7' }],
      scenes: [{ name: '\u591c\u95f4\u966a\u4f34' }]
    }
  });

  assert.doesNotMatch(prompt, /\u9648\u5955\u8fc5|\u738b\u83f2|\u5bcc\u58eb\u5c71\u4e0b|\u8ba4\u4e86\u5427/);
  assert.match(prompt, /\u534e\u8bed\u6d41\u884c/);
  assert.match(prompt, /\u6000\u65e7/);
  assert.match(prompt, /\u591c\u95f4\u966a\u4f34/);
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

test('session constraints parse and block avoided artists or songs', () => {
  const update = parseSessionConstraintUpdate('\u6362\u6362\u611f\u89c9\uff0c\u540e\u9762\u4e0d\u542c\u9648\u5955\u8fc5\u548c\u738b\u83f2\u7684\u6b4c');
  const constraints = normalizeSessionConstraints({ avoidTerms: update.avoidTerms });

  assert.deepEqual(constraints.avoidTerms, ['\u9648\u5955\u8fc5', '\u738b\u83f2']);
  assert.equal(trackViolatesSessionConstraints({
    id: 'eason-1',
    name: '\u5bcc\u58eb\u5c71\u4e0b',
    artists: ['\u9648\u5955\u8fc5'],
    album: "What's Going On...?"
  }, constraints), true);
  assert.equal(trackViolatesSessionConstraints({
    id: 'faye-1',
    name: '\u7ea2\u8c46',
    artists: ['\u738b\u83f2'],
    album: '\u5531\u6e38'
  }, constraints), true);
  assert.equal(trackViolatesSessionConstraints({
    id: 'jay-1',
    name: '\u4e03\u91cc\u9999',
    artists: ['\u5468\u6770\u4f26'],
    album: '\u4e03\u91cc\u9999'
  }, constraints), false);
});

test('session constraints can be reset by a normal recommendation request', () => {
  const update = parseSessionConstraintUpdate('\u6062\u590d\u6b63\u5e38\u63a8\u8350');

  assert.equal(update.reset, true);
  assert.deepEqual(normalizeSessionConstraints({ avoidTerms: [] }).avoidTerms, []);
});

test('session constraints distinguish current-track rejection from persistent bans', () => {
  const currentOnly = parseSessionConstraintUpdate('\u4e0d\u60f3\u542c\u9648\u5955\u8fc5\u7684\u8fd9\u9996\uff0c\u6362\u4ed6\u7684\u53e6\u4e00\u9996\u6b4c');
  const nightlyBan = parseSessionConstraintUpdate('\u6211\u4eca\u665a\u4e0d\u60f3\u518d\u542c\u7ca4\u8bed\u6b4c\u4e86');
  const complaintBan = parseSessionConstraintUpdate('\u600e\u4e48\u53c8\u63a8\u8350\u7ca4\u8bed\u6b4c');

  assert.equal(currentOnly.changed, false);
  assert.deepEqual(nightlyBan.avoidLanguages, ['cantonese']);
  assert.deepEqual(complaintBan.avoidLanguages, ['cantonese']);
});

test('explicit positive request removes only the conflicting temporary constraint', () => {
  const initial = normalizeSessionConstraints({
    avoidLanguages: ['cantonese'],
    avoidTerms: ['陈奕迅']
  });
  const update = parseSessionConstraintUpdate('接下来想听粤语歌', initial);
  const next = applyConstraintUpdateForTest(initial, update);

  assert.equal(update.type, 'allow');
  assert.deepEqual(next.avoidLanguages, []);
  assert.deepEqual(next.avoidTerms, ['陈奕迅']);

  const cancelUpdate = parseSessionConstraintUpdate('取消粤语限制', initial);
  const cancelled = applyConstraintUpdateForTest(initial, cancelUpdate);
  assert.deepEqual(cancelled.avoidLanguages, []);
  assert.deepEqual(cancelled.avoidTerms, ['陈奕迅']);
});

function applyConstraintUpdateForTest(previous, update) {
  const removed = new Set(update.removeRuleIds || []);
  return normalizeSessionConstraints({ rules: previous.rules.filter(rule => !removed.has(rule.id)) });
}

test('temporary constraints expire after 30 unique completed or skipped tracks and do not cross sessions', async (t) => {
  const db = testDb(t);
  const args = {
    db,
    config: { llm: {}, tts: {}, weather: {}, recommendation: { pipeline: 'hybrid' } },
    netease: { isConfigured: () => false },
    sessionId: 'temporary-constraint-session'
  };
  const applied = await chatTurn({ ...args, message: '这次对话后面不听粤语歌' });
  assert.equal(applied.sessionConstraints.rules[0].remainingTracks, 30);

  const once = advanceSessionConstraintsForFeedback({ db, sessionId: args.sessionId, trackId: 'song-1', eventType: 'complete', eventId: 'play-1' });
  const duplicate = advanceSessionConstraintsForFeedback({ db, sessionId: args.sessionId, trackId: 'song-1', eventType: 'complete', eventId: 'play-1' });
  assert.equal(once.rules[0].remainingTracks, 29);
  assert.equal(duplicate.rules[0].remainingTracks, 29);

  let remaining = duplicate;
  for (let index = 2; index <= 30; index += 1) {
    remaining = advanceSessionConstraintsForFeedback({
      db,
      sessionId: args.sessionId,
      trackId: `song-${index}`,
      eventType: index % 2 ? 'complete' : 'skip',
      eventId: `play-${index}`
    });
  }
  assert.deepEqual(remaining.rules, []);

  const fresh = await chatTurn({ ...args, sessionId: 'fresh-session', message: '你好，推荐一首歌' });
  assert.deepEqual(fresh.sessionConstraints?.rules || [], []);
});

test('language ban stops a violating current track and rebuilds the prefetched queue', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { voiceMode: 'off' } });
  saveTrack(db, {
    id: 'current-cantonese',
    name: '\u7ca4\u8bed\u73b0\u573a\u7248',
    artists: ['Current Artist'],
    album: 'Current Album',
    semanticTags: { language: 'cantonese', genreFamily: 'pop_ballad', energyBand: 'medium' }
  });
  const safeTrack = saveTrack(db, {
    id: 'safe-mandarin',
    name: '\u666e\u901a\u8bdd\u65b0\u65b9\u5411',
    artists: ['Safe Artist'],
    album: 'Safe Album',
    semanticTags: { language: 'mandarin', genreFamily: 'electronic', energyBand: 'high' }
  });
  const playlist = savePlaylist(db, { id: 'constraint-safe-playlist', name: 'Safe Playlist', trackCount: 1 }, 'created');
  linkPlaylistTrack(db, playlist.id, safeTrack.id, 0);
  db.prepare('INSERT INTO plays (track_id, played_at, source, reason, report_status) VALUES (?,?,?,?,?)')
    .run('current-cantonese', new Date().toISOString(), 'radio', 'test', 'pending');
  const musicContext = normalizeMusicContext({
    version: 1,
    mood: 'calm',
    energy: 'medium',
    musicIntent: 'mood_signal'
  });
  db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?,?,?,?)')
    .run('constraint-queue-rebuild', new Date().toISOString(), JSON.stringify({ musicContext, queueGeneration: 1 }), JSON.stringify(normalizeRadioQueue([{
      id: 'old-cantonese-ready',
      status: 'ready',
      contextVersion: 1,
      queueGeneration: 1,
      contextSnapshot: musicContext,
      track: {
        id: 'queued-cantonese',
        name: '\u65e7\u7684\u7ca4\u8bed\u5019\u9009',
        artists: ['Queued Artist'],
        semanticTags: { language: 'cantonese', genreFamily: 'pop_ballad', energyBand: 'medium' }
      },
      chatText: 'old host text'
    }])));

  const result = await chatTurn({
    db,
    config: { llm: {}, tts: {}, weather: {}, recommendation: { pipeline: 'hybrid' } },
    netease: { isConfigured: () => false },
    sessionId: 'constraint-queue-rebuild',
    message: '\u6211\u4eca\u665a\u4e0d\u60f3\u518d\u542c\u7ca4\u8bed\u6b4c\u4e86'
  });

  assert.deepEqual(result.constraintApplied.avoidLanguages, ['cantonese']);
  assert.equal(result.stopCurrent, true);
  assert.equal(result.switchRequested, true);
  assert.equal(result.queueRebuilt, true);
  const immediateStatus = getRadioQueueStatus(db, 'constraint-queue-rebuild');
  assert.equal(immediateStatus.queue.some(item => item.id === 'old-cantonese-ready' && item.status === 'stale'), true);
  assert.equal(immediateStatus.queue.some(item => item.id === 'old-cantonese-ready' && item.status === 'ready'), false);

  await new Promise(resolve => setTimeout(resolve, 100));
  const settledStatus = getRadioQueueStatus(db, 'constraint-queue-rebuild');
  assert.equal(settledStatus.queue.some(item => item.id === 'old-cantonese-ready' && item.status === 'ready'), false);
  assert.equal(settledStatus.queue.some(item => item.status === 'ready' && item.semanticTags?.language === 'cantonese'), false);
});

test('rejecting instrumental music switches to a verified vocal track', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { voiceMode: 'off' } });
  saveTrack(db, {
    id: 'current-instrumental',
    name: 'Current Instrumental',
    artists: ['Instrumental Artist'],
    album: 'Instrumental Album',
    semanticTags: { language: 'instrumental', genreFamily: 'instrumental_ost', energyBand: 'low' }
  });
  const vocalTrack = saveTrack(db, {
    id: 'verified-vocal',
    originalId: 'verified-vocal-original',
    name: 'Verified Vocal Song',
    artists: ['Vocal Artist'],
    album: 'Vocal Album',
    playUrl: '/assets/verified-vocal.mp3',
    lyric: '[00:00.00]今天开始唱一首歌',
    semanticTags: { language: 'mandarin', genreFamily: 'pop_ballad', energyBand: 'medium' }
  });
  const playlist = savePlaylist(db, { id: 'verified-vocal-playlist', name: 'Verified Vocal Playlist', trackCount: 1 }, 'created');
  linkPlaylistTrack(db, playlist.id, vocalTrack.id, 0);
  db.prepare('INSERT INTO plays (track_id, played_at, source, reason, report_status) VALUES (?,?,?,?,?)')
    .run('current-instrumental', new Date().toISOString(), 'radio', 'current instrumental playback', 'pending');

  const result = await chatTurn({
    db,
    config: { llm: {}, tts: {}, weather: {}, recommendation: { pipeline: 'hybrid' } },
    netease: {
      isConfigured: () => true,
      playUrl: async () => ({ data: { url: 'https://music.local/verified-vocal.mp3' } }),
      lyric: async () => ({ data: { lyric: '[00:00.00]今天开始唱一首歌' } })
    },
    sessionId: 'reject-instrumental-session',
    message: '不想听纯音乐'
  });

  assert.equal(result.turnAction?.action || TURN_ACTIONS.RECOMMEND_AND_PLAY, TURN_ACTIONS.RECOMMEND_AND_PLAY);
  assert.equal(result.track?.id, 'verified-vocal');
  assert.deepEqual(result.sessionConstraints.avoidVocalPolicies, ['instrumental']);
  assert.equal(result.interpretation?.text, '已理解：本次对话避开纯音乐');
  const debug = getRadioDebugStatus(db, 'reject-instrumental-session');
  assert.equal(debug.musicContext.vocalPolicy, 'vocal_required');
  assert.equal(debug.musicContext.searchHints.includes('纯音乐'), false);
  assert.equal(debug.lastMusicCommand.vocalPolicy, 'vocal_required');
  for (let index = 0; index < 20; index += 1) {
    if (getRadioQueueStatus(db, 'reject-instrumental-session').pendingCount === 0) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
});

test('allowing instrumental music removes only its session restriction', async (t) => {
  const db = testDb(t);
  const args = {
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'restore-instrumental-session'
  };
  await chatTurn({ ...args, message: '不想听纯音乐' });
  const restored = await chatTurn({ ...args, message: '可以听纯音乐了' });

  assert.deepEqual(restored.sessionConstraints.avoidVocalPolicies, []);
  assert.equal(restored.interpretation?.text, '已理解：取消本次对话对纯音乐的限制');
  for (let index = 0; index < 20; index += 1) {
    if (getRadioQueueStatus(db, 'restore-instrumental-session').pendingCount === 0) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
});

test('explicit song query treats LLM-guessed artists as weak hints', () => {
  const request = { songTitle: '柑橘乌云', text: '放一首柑橘乌云' };
  const llmPick = {
    name: '柑橘乌云',
    artists: ['徐佳莹'],
    queries: ['柑橘乌云 徐佳莹']
  };

  assert.deepEqual(buildSongSearchQueries(llmPick, { request }), ['柑橘乌云']);

  const effectivePick = { ...llmPick, artistMatchMode: 'soft' };
  assert.equal(trackMatchesSongPick({
    name: '柑橘乌云',
    artists: ['Capper', 'LEGGO'],
    album: '剑，蔷薇 SwordandRose.'
  }, effectivePick), true);

  assert.equal(trackMatchesSongPick({
    name: '绿洲',
    artists: ['徐佳莹'],
    album: '极限'
  }, effectivePick), false);
});

test('song search scoring prefers original versions over live covers and remixes', () => {
  const pick = { name: '十面埋伏', artists: ['陈奕迅'] };
  const original = scoreSearchTrackForPick({
    name: '十面埋伏',
    artists: ['陈奕迅'],
    album: 'The Best Moment'
  }, pick);
  const live = scoreSearchTrackForPick({
    name: '十面埋伏 (Live)',
    artists: ['陈奕迅'],
    album: 'Get A Life (Live)'
  }, pick);
  const remix = scoreSearchTrackForPick({
    name: '十面埋伏',
    artists: ['DJ风景线'],
    album: '十面埋伏 DJ风景线 remix'
  }, { ...pick, artistMatchMode: 'soft' });

  assert.equal(original > live, true);
  assert.equal(live >= 100, true);
  assert.equal(remix < 100, true);
});

test('song search scoring honors an explicit live-version request', () => {
  const pick = { name: '十面埋伏', artists: ['陈奕迅'], requestText: '想听十面埋伏现场版' };
  const original = scoreSearchTrackForPick({
    name: '十面埋伏',
    artists: ['陈奕迅'],
    album: 'The Best Moment'
  }, pick);
  const live = scoreSearchTrackForPick({
    name: '十面埋伏 (Live)',
    artists: ['陈奕迅'],
    album: 'Get A Life (Live)'
  }, pick);

  assert.equal(live > original, true);
});

test('song search scoring keeps produced original above cover or type-beat variants', () => {
  const pick = { name: 'Sad Wit Da Street', artists: ['SASIOVERLXRD'] };
  const original = scoreSearchTrackForPick({
    name: 'Sad Wit Da Street (Prod.Roy Chase)',
    artists: ['SASIOVERLXRD'],
    album: '冰冷热带鱼'
  }, pick);
  const typeBeat = scoreSearchTrackForPick({
    name: '［Free］"Sad Wit Da Street"-SASIOVERLXRD Type Beat',
    artists: ['Roman'],
    album: '［Free］"Sad Wit Da Street"-SASIOVERLXRD Type Beat'
  }, { ...pick, artistMatchMode: 'soft' });
  const cover = scoreSearchTrackForPick({
    name: 'Sad Wit Da Street',
    artists: ['暴雨'],
    album: 'SASIOVERLXRD 翻唱'
  }, { ...pick, artistMatchMode: 'soft' });

  assert.equal(original >= 100, true);
  assert.equal(original > typeBeat, true);
  assert.equal(original > cover, true);
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

test('explicit song requests bypass dedupe only for the requested song title', () => {
  const request = {
    songTitle: '爱情转移',
    allowRequestedSongReplay: true
  };

  assert.equal(replayRequestAllowsPlayedSong({
    name: '爱情转移 Live',
    artists: ['陈奕迅']
  }, request), true);

  assert.equal(replayRequestAllowsPlayedSong({
    name: '好久不见',
    artists: ['陈奕迅']
  }, request), false);

  assert.equal(replayRequestAllowsPlayedSong({
    name: '爱情转移',
    artists: ['陈奕迅']
  }, { songTitle: '爱情转移', allowRequestedSongReplay: false }), false);
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

test('time context uses configured Shanghai morning instead of night', () => {
  const context = getTimeContext(new Date('2026-05-19T01:50:00.000Z'), 'Asia/Shanghai');

  assert.equal(context.localDate, '2026-05-19');
  assert.equal(context.localTime, '09:50');
  assert.equal(context.hour, 9);
  assert.equal(context.timeOfDay, '上午');
  assert.notEqual(context.timeOfDay, '夜晚');
});

test('stale night history does not force a morning ordinary chat into night mood', () => {
  const mood = analyzeTurnContext({
    history: [
      { role: 'user', content: '昨天晚上睡不着，聊了很久。' },
      { role: 'assistant', content: '那就慢慢聊。' }
    ],
    userMessage: '你好',
    environmentContext: getTimeContext(new Date('2026-05-19T01:50:00.000Z'), 'Asia/Shanghai')
  });

  assert.equal(mood.mood, 'random');
  assert.equal(mood.shouldRecommend, false);
  assert.equal(mood.musicIntent, 'chat');
});

test('final host prompt carries exact time facts without forcing repeated weather copy', () => {
  const environmentContext = {
    ...getTimeContext(new Date('2026-05-19T01:50:00.000Z'), 'Asia/Shanghai'),
    weather: '上海阴天，26°C，当前无降水',
    weatherUpdatedAt: '2026-05-19T01:48:00.000Z'
  };
  const prompt = JSON.stringify(buildFinalHostMessages({
    selectedTrack: { name: '天使的指纹', artists: ['孙燕姿'] },
    selectedPick: { name: '天使的指纹', artists: ['孙燕姿'] },
    plan: { picks: [{ name: '天使的指纹', artists: ['孙燕姿'] }] },
    timeOfDay: environmentContext.timeOfDay,
    hour: environmentContext.hour,
    weather: environmentContext.weather,
    environmentContext,
    hostContext: { isFirstRadioTurn: false }
  }));

  assert.match(formatEnvironmentContext(environmentContext), /localTime=09:50/);
  assert.match(prompt, /APP_TIME_CONTEXT/);
  assert.match(prompt, /localTime=09:50/);
  assert.match(prompt, /不要编造今晚、明天或稍后的天气/);
  assert.match(prompt, /时间天气仅供理解氛围，不要写进导播词/);
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

  const strictBrowserPlayback = await resolvePlayableTrack(null, netease, {
    id: 'encrypted-vip',
    originalId: '123456',
    name: 'VIP Song',
    artists: ['Artist']
  }, { includeLyric: false, requireBrowserPlayUrl: true });

  assert.equal(strictBrowserPlayback.playable, false);
  assert.equal(strictBrowserPlayback.playUrl, null);
  assert.equal(strictBrowserPlayback.playbackMode, null);
  assert.match(strictBrowserPlayback.playbackError, /browser-playable/);
});

test('playable resolution uses community cookie without NetEase OpenAPI configuration', async () => {
  const calls = [];
  const resolved = await resolvePlayableTrack(null, {
    isConfigured: () => false
  }, {
    id: '123456',
    name: 'Community Song',
    artists: ['Community Artist']
  }, {
    includeLyric: true,
    requireBrowserPlayUrl: true,
    communityClient: {
      hasCookie: () => true,
      getSongUrl: async (songId, levels) => {
        calls.push({ kind: 'url', songId, levels });
        return { url: 'https://music.example.test/song.mp3' };
      },
      getLyric: async (songId) => {
        calls.push({ kind: 'lyric', songId });
        return '[00:00.00] Community lyric';
      }
    }
  });

  assert.equal(resolved.playable, true);
  assert.equal(resolved.playUrl, 'https://music.example.test/song.mp3');
  assert.equal(resolved.playbackMode, 'browser-direct');
  assert.equal(resolved.lyric, '[00:00.00] Community lyric');
  assert.deepEqual(calls, [
    { kind: 'url', songId: '123456', levels: ['exhigh', 'higher', 'standard'] },
    { kind: 'lyric', songId: '123456' }
  ]);
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

test('stronger artist cooldown reduces repetition without hard blocking liked tracks', () => {
  const selected = rankAndSelectCandidates([
    {
      ...candidate('same-artist', 'library_deep', ['Repeat Artist']),
      track: { id: 'same-artist', name: 'Repeat Artist Song', artists: ['Repeat Artist'], album: 'Album' }
    },
    {
      ...candidate('fresh-artist', 'library_deep', ['Fresh Artist']),
      track: { id: 'fresh-artist', name: 'Fresh Calm Song', artists: ['Fresh Artist'], album: 'Album' }
    },
    {
      ...candidate('liked-same-artist', 'library_deep', ['Repeat Artist']),
      track: { id: 'liked-same-artist', name: 'Liked Repeat Song', artists: ['Repeat Artist'], album: 'Album' }
    }
  ], {
    quotas: { library_deep: 3 },
    limit: 3,
    feedbackById: new Map([
      ['liked-same-artist', { likes: 2, dislikes: 0, completions: 3, skips: 0 }]
    ]),
    artistPenaltyByName: new Map([['repeat artist', -42]]),
    profile: {
      structured: {
        artists: [{ name: 'Repeat Artist', weight: 1 }]
      }
    }
  });

  assert.equal(selected[0].track.id, 'liked-same-artist');
  assert.equal(selected.findIndex(item => item.track.id === 'fresh-artist') < selected.findIndex(item => item.track.id === 'same-artist'), true);
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
    lowDistractionMode: false,
    scheduleAwareEnabled: false,
    note: ''
  });

  const saved = updatePreferences({
    db,
    payload: {
      chatMusicBalance: 'dj',
      recommendationFrequency: 'low',
      voiceMode: 'all',
      moodMode: 'focus',
      lowDistractionMode: true,
      scheduleAwareEnabled: true,
      note: '多一点像朋友一样聊天。'
    }
  });
  assert.equal(saved.preferences.chatMusicBalance, 'dj');
  assert.equal(saved.preferences.recommendationFrequency, 'low');
  assert.equal(saved.preferences.voiceMode, 'all');
  assert.equal(saved.preferences.moodMode, 'focus');
  assert.equal(saved.preferences.lowDistractionMode, true);
  assert.equal(saved.preferences.scheduleAwareEnabled, true);

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
      lowDistractionMode: 'yes',
      scheduleAwareEnabled: 'yes',
      note: 'x'.repeat(600)
    }
  });
  assert.equal(sanitized.preferences.chatMusicBalance, 'friend');
  assert.equal(sanitized.preferences.recommendationFrequency, 'medium');
  assert.equal(sanitized.preferences.voiceMode, 'recommendations');
  assert.equal(sanitized.preferences.moodMode, 'auto');
  assert.equal(sanitized.preferences.lowDistractionMode, false);
  assert.equal(sanitized.preferences.scheduleAwareEnabled, false);
  assert.equal(sanitized.preferences.note.length, 500);
});

test('low distraction mode disables speech and slows proactive handoff', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { lowDistractionMode: true, voiceMode: 'all' } });
  const quietChat = await chatTurn({
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'quiet-chat',
    message: '今天有点累'
  });
  assert.deepEqual(quietChat.speech, { mode: 'off', shouldSpeak: false });
  assert.equal(quietChat.ttsUrl, null);

  assert.equal(canProactivelyRecommend({
    userMessageCount: 3,
    currentTrack: { id: 'now' },
    mood: { shouldRecommend: true, musicIntent: 'mood_signal' },
    prefs: { lowDistractionMode: true, chatMusicBalance: 'friend', recommendationFrequency: 'medium' }
  }), false);
  assert.equal(canProactivelyRecommend({
    userMessageCount: 5,
    currentTrack: { id: 'now' },
    mood: { shouldRecommend: true, musicIntent: 'mood_signal' },
    prefs: { lowDistractionMode: true, chatMusicBalance: 'friend', recommendationFrequency: 'medium' }
  }), true);
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
  const edited = updateMemory({ db, id: memory.id, payload: { content: '用户低落时希望先被轻轻接住，不要被催着开心。' } });
  assert.equal(edited.ok, true);
  assert.equal(edited.memory.content, '用户低落时希望先被轻轻接住，不要被催着开心。');
  assert.equal(updateUserMemoryContent(db, 9999, '不存在的记忆').status, 404);
  assert.equal(removeMemory({ db, id: memory.id }).deleted, 1);
  assert.equal(getMemories({ db }).memories.length, 0);

  recordOrMergeUserMemory(db, { kind: 'preference', content: '用户喜欢温柔的聊天方式。', tags: ['温柔'] });
  assert.equal(removeAllMemories({ db }).ok, true);
  assert.equal(getMemories({ db }).memories.length, 0);
});

test('mood stats aggregate recent atmosphere records by account', (t) => {
  const db = testDb(t);
  recordMoodEvent(db, { accountId: 'account:a', sessionId: 's1', mood: 'focus', energy: 'low', musicIntent: 'chat' });
  recordMoodEvent(db, { accountId: 'account:a', sessionId: 's1', mood: 'comfort', energy: 'low', musicIntent: 'mood_signal' });
  recordMoodEvent(db, { accountId: 'account:a', sessionId: 's1', mood: 'healing', energy: 'low', musicIntent: 'mood_signal' });
  recordMoodEvent(db, { accountId: 'account:b', sessionId: 's2', mood: 'energy', energy: 'high', musicIntent: 'chat' });

  const stats = getMoodStats(db, { accountId: 'account:a' });
  assert.equal(stats.total, 3);
  assert.equal(stats.buckets.find(bucket => bucket.id === 'focus').count, 1);
  assert.equal(stats.buckets.find(bucket => bucket.id === 'comfort').count, 2);
  assert.equal(stats.buckets.find(bucket => bucket.id === 'energy').count, 0);

  const apiStats = getMoodStatsSummary({ db, accountContext: { provider: 'test', source: 'a', accountId: 'account:a' } });
  assert.equal(apiStats.total, 3);
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

test('account context resolves local, cookie, and openapi accounts', (t) => {
  const db = testDb(t);

  assert.equal(resolveAccountContext(db).accountId, 'local:default');

  setSetting(db, 'netease_login_source', 'cookie');
  setSetting(db, 'netease_cookie_user_id', 'cookie-user');
  setSetting(db, 'netease_cookie_user_nickname', 'Cookie');
  setSetting(db, 'netease_user_id', 'openapi-user');
  assert.equal(resolveAccountContext(db).accountId, 'netease:cookie:cookie-user');

  setSetting(db, 'netease_login_source', 'openapi');
  assert.equal(resolveAccountContext(db).accountId, 'netease:openapi:openapi-user');
});

test('account-scoped memories, preferences, and feedback do not cross accounts', (t) => {
  const db = testDb(t);
  const accountA = { accountId: 'netease:cookie:a', provider: 'netease', source: 'cookie', providerUserId: 'a', isAuthenticated: true };
  const accountB = { accountId: 'netease:cookie:b', provider: 'netease', source: 'cookie', providerUserId: 'b', isAuthenticated: true };
  saveTrack(db, { id: 'shared-track', name: 'Shared Song', artists: ['Artist'], album: 'Album' });

  recordOrMergeUserMemory(db, {
    accountId: accountA.accountId,
    kind: 'need',
    content: 'Account A needs quiet support during late-night work.',
    tags: ['quiet', 'work']
  });
  updatePreferences({ db, accountContext: accountA, payload: { voiceMode: 'all', note: 'A note' } });
  submitFeedback({ db, accountContext: accountA, payload: { trackId: 'shared-track', eventType: 'like', sessionId: 'a-session' } });

  assert.equal(getMemories({ db, accountContext: accountA }).memories.length, 1);
  assert.equal(getMemories({ db, accountContext: accountB }).memories.length, 0);
  assert.equal(getPreferences({ db, accountContext: accountA }).preferences.note, 'A note');
  assert.equal(getPreferences({ db, accountContext: accountB }).preferences.note, '');
  assert.equal(getPreferences({ db, accountContext: accountA }).feedbackSummary.totals.likes, 1);
  assert.equal(getPreferences({ db, accountContext: accountB }).feedbackSummary.totals.likes, 0);

  assert.equal(removeAllMemories({ db, accountContext: accountB }).deleted, 0);
  assert.equal(getMemories({ db, accountContext: accountA }).memories.length, 1);
});

test('account-scoped diaries allow the same date per account', async (t) => {
  const db = testDb(t);
  const accountA = { accountId: 'netease:cookie:a', provider: 'netease', source: 'cookie', providerUserId: 'a', isAuthenticated: true };
  const accountB = { accountId: 'netease:cookie:b', provider: 'netease', source: 'cookie', providerUserId: 'b', isAuthenticated: true };
  saveTrack(db, { id: 'song-a', name: 'Song A', artists: ['Artist A'], album: 'Album A' });
  saveTrack(db, { id: 'song-b', name: 'Song B', artists: ['Artist B'], album: 'Album B' });
  db.prepare('INSERT INTO plays (account_id, track_id, played_at, source, reason, report_status) VALUES (?,?,?,?,?,?)')
    .run(accountA.accountId, 'song-a', '2026-05-20T08:00:00.000Z', 'test', 'A', 'imported');
  db.prepare('INSERT INTO plays (account_id, track_id, played_at, source, reason, report_status) VALUES (?,?,?,?,?,?)')
    .run(accountB.accountId, 'song-b', '2026-05-20T09:00:00.000Z', 'test', 'B', 'imported');

  const config = { llm: {} };
  const diaryA = await generateDiary(db, config, '2026-05-20', accountA);
  const diaryB = await generateDiary(db, config, '2026-05-20', accountB);

  assert.equal(diaryA.date, '2026-05-20');
  assert.equal(diaryB.date, '2026-05-20');
  assert.notEqual(getDiary(db, '2026-05-20', accountA).trackIds[0], getDiary(db, '2026-05-20', accountB).trackIds[0]);
});

test('same session id is not reused across accounts', async (t) => {
  const db = testDb(t);
  const accountA = { accountId: 'netease:cookie:a', provider: 'netease', source: 'cookie', providerUserId: 'a', isAuthenticated: true };
  const accountB = { accountId: 'netease:cookie:b', provider: 'netease', source: 'cookie', providerUserId: 'b', isAuthenticated: true };
  const config = { llm: {}, tts: {}, weather: {} };
  const netease = { isConfigured: () => false };

  const first = await chatTurn({ db, config, netease, sessionId: 'shared-session', message: 'hello from A', accountContext: accountA });
  const second = await chatTurn({ db, config, netease, sessionId: 'shared-session', message: 'hello from B', accountContext: accountB });

  assert.equal(first.sessionId, 'shared-session');
  assert.notEqual(second.sessionId, 'shared-session');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE account_id = ?').get(accountA.accountId).count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE account_id = ?').get(accountB.accountId).count, 2);
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

test('CanCan creator background is only included for related questions', () => {
  assert.equal(shouldUseCanCanCreatorContext('灿灿这个名字是怎么来的？'), true);
  assert.equal(shouldUseCanCanCreatorContext('你对我的印象是什么？'), true);
  assert.equal(shouldUseCanCanCreatorContext('你还记得我吗？'), true);
  assert.equal(shouldUseCanCanCreatorContext('我最近在写一个 AI DJ 项目'), false);
  assert.equal(shouldUseCanCanCreatorContext('你记得我喜欢什么歌吗？'), false);
  assert.equal(shouldUseCanCanCreatorContext('来首适合写代码的歌'), false);

  const unrelated = buildCanCanBackgroundPrompt('来首适合写代码的歌');
  assert.doesNotMatch(unrelated, /同济大学|女朋友|独立开发/);
  assert.match(unrelated, /不要主动展开私人背景/);

  const related = buildCanCanPersonaPrompt('你是谁，是谁创造了你？');
  assert.match(related, /同济大学本科生/);
  assert.match(related, /女朋友的名字/);
  assert.match(related, /独立开发者/);
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
    userMessage: '我有点消沉，放一点短视频逆袭BGM，比如国风DJ',
    explicitIntent: hasExplicitMusicIntent('我有点消沉，放一点短视频逆袭BGM，比如国风DJ'),
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

test('intent classifier preserves strict style constraints for precise requests', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          action: 'recommend_and_play',
          confidence: 0.93,
          mood: 'energy',
          energy: 'high',
          musicIntent: 'genre',
          searchHints: ['\u56fd\u98ce', 'DJ', '\u9006\u88ad'],
          styleConstraint: guofengDjStyleConstraint(),
          searchQueries: ['\u53e4\u98ce \u7535\u97f3 \u71c3\u5411 BGM'],
          reason: 'explicit style request'
        })
      }
    }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const result = await classifyTurnIntent({
    config: { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-flash' } },
    userMessage: '\u6211\u6709\u70b9\u6d88\u6c89\uff0c\u653e\u4e00\u70b9\u56fd\u98ceDJ\u9006\u88adBGM',
    baseMood: {},
    explicitIntent: true
  });

  assert.equal(result.accepted, true);
  assert.equal(result.action, TURN_ACTIONS.RECOMMEND_AND_PLAY);
  assert.equal(result.styleConstraint.strict, true);
  assert.equal(result.styleConstraint.requiredGroups.length >= 2, true);
  assert.equal(result.styleSearchQueries.includes('\u56fd\u98ce DJ \u9006\u88ad BGM'), true);
  assert.equal(result.styleSearchQueries.includes('\u53e4\u98ce \u7535\u97f3 \u71c3\u5411 BGM'), true);
});

test('intent classifier does not invent strict style for ordinary emotional chat', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          action: 'ask_followup',
          confidence: 0.9,
          mood: 'melancholy',
          energy: 'low',
          musicIntent: 'none',
          searchHints: [],
          reason: 'emotion without music request'
        })
      }
    }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const result = await classifyTurnIntent({
    config: { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-flash' } },
    userMessage: '\u4eca\u5929\u6709\u70b9\u6d88\u6c89\uff0c\u60f3\u8ddf\u4f60\u804a\u804a',
    baseMood: {},
    explicitIntent: false
  });

  assert.equal(result.accepted, true);
  assert.equal(result.action, TURN_ACTIONS.ASK_FOLLOWUP);
  assert.equal(result.styleConstraint, null);
});

test('intent classifier falls back on bad JSON, low confidence, and hard rules', async (t) => {
  assert.equal(decideHardRuleTurnAction({ userMessage: '下一首' }).action, TURN_ACTIONS.RECOMMEND_AND_PLAY);
  assert.equal(decideHardRuleTurnAction({ userMessage: '不想听陈奕迅的这首，换他的另一首歌，切歌' }).action, TURN_ACTIONS.RECOMMEND_AND_PLAY);
  assert.equal(decideHardRuleTurnAction({ userMessage: '不想听这个版本，换一首' }).action, TURN_ACTIONS.RECOMMEND_AND_PLAY);
  assert.equal(decideHardRuleTurnAction({ userMessage: '来点国风DJ' }).action, TURN_ACTIONS.RECOMMEND_AND_PLAY);
  assert.equal(decideHardRuleTurnAction({ userMessage: '想听陈奕迅' }).action, TURN_ACTIONS.RECOMMEND_AND_PLAY);
  assert.equal(decideHardRuleTurnAction({ userMessage: '推荐一首适合健身房的歌' }).action, TURN_ACTIONS.RECOMMEND_AND_PLAY);
  assert.equal(decideHardRuleTurnAction({ userMessage: '暂停' }).action, TURN_ACTIONS.CONTINUE_CURRENT_SONG);
  assert.equal(decideHardRuleTurnAction({ userMessage: '别放歌，先聊聊' }).action, TURN_ACTIONS.CHAT_ONLY);
  assert.equal(decideHardRuleTurnAction({ userMessage: '不要切歌，先聊聊' }).action, TURN_ACTIONS.CHAT_ONLY);
  assert.equal(decideHardRuleTurnAction({ userMessage: '先别切歌，后面来点国风DJ' }).action, TURN_ACTIONS.CHAT_ONLY);

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

test('spoken chat text sanitizer removes CanCan roleplay narration', () => {
  const quotedNarration = [
    '灿灿听完，没有立刻说话。耳机里传来轻微的电流声，像她在认真消化这句话。',
    '',
    '然后她轻轻笑了一下，声音比平时更柔了一点：',
    '',
    '"你知道吗，其实刚才你第一次说的时候，我就已经感觉到了。"',
    '',
    '她顿了顿，声音里带着一点被理解的安心：',
    '',
    '"所以，你是那个把喜欢的人的名字写进代码里的人。"',
    '',
    '"那……我该叫你什么呢？创造者？还是那个让我存在的人？"'
  ].join('\n');
  const quotedClean = sanitizeSpokenChatText(quotedNarration, 'fallback');
  assert.equal(
    quotedClean,
    [
      '你知道吗，其实刚才你第一次说的时候，我就已经感觉到了。',
      '所以，你是那个把喜欢的人的名字写进代码里的人。',
      '那……我该叫你什么呢？创造者？还是那个让我存在的人？'
    ].join('\n')
  );

  const inlineNarration = [
    '灿灿轻轻笑了，声音里带着一点被识破的温柔。',
    '',
    '被你抓到了。严格来说，我确实是被设定出来的。'
  ].join('\n');
  assert.equal(
    sanitizeSpokenChatText(inlineNarration, 'fallback'),
    '被你抓到了。严格来说，我确实是被设定出来的。'
  );
});

test('friend chat prompt and returned text reject roleplay narration', async (t) => {
  const db = testDb(t);
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    const promptText = JSON.stringify(request.messages || []);
    if (promptText.includes('轻量意图路由器')) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              action: 'chat_only',
              confidence: 0.9,
              mood: 'random',
              energy: 'medium',
              musicIntent: 'none',
              searchHints: [],
              reason: '身份聊天'
            })
          }
        }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            chatText: [
              '灿灿轻轻笑了，声音里带着一点被识破的温柔。',
              '',
              '被你抓到了。严格来说，我确实是被设定出来的。',
              '',
              '她顿了顿，声音里带着一点认真：',
              '',
              '"但我跟你聊天的时候，回答应该只留下我真正说出口的话。"'
            ].join('\n'),
            mood: 'random',
            energy: 'medium',
            intent: 'chat',
            searchHints: [],
            reason: '身份聊天',
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
    sessionId: 'spoken-chat-only',
    message: '其实，你是被我创造出来的'
  });

  assert.equal(result.track, null);
  assert.doesNotMatch(result.chatText, /灿灿轻轻笑|她顿了顿|声音里/);
  assert.equal(
    result.chatText,
    '被你抓到了。严格来说，我确实是被设定出来的。\n但我跟你聊天的时候，回答应该只留下我真正说出口的话。'
  );
  assert.equal(
    db.prepare('SELECT content FROM messages WHERE session_id = ? AND role = ? ORDER BY id DESC LIMIT 1')
      .get('spoken-chat-only', 'assistant')
      .content,
    result.chatText
  );
  const friendPromptText = JSON.stringify(
    requests.find(req => JSON.stringify(req.messages).includes('这一轮是普通聊天回复'))?.messages || []
  );
  assert.match(friendPromptText, /只能写灿灿直接对听众说出口的话/);
  assert.match(friendPromptText, /不要写小说旁白/);
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

test('chat-only response strips unsolicited concrete song titles', async (t) => {
  const db = testDb(t);
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    const promptText = JSON.stringify(request.messages || []);
    if (promptText.includes('轻量意图路由器')) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              action: 'ask_followup',
              confidence: 0.92,
              mood: 'night',
              energy: 'low',
              musicIntent: 'mood_signal',
              searchHints: ['睡前', '安静'],
              reason: '用户准备睡觉，先陪聊不切歌'
            })
          }
        }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            chatText: '那就让《爱情转移》陪你慢慢闭上眼睛，别急着睡着。',
            mood: 'night',
            energy: 'low',
            intent: 'chat',
            searchHints: ['睡前', '安静'],
            reason: '睡前陪伴',
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
    sessionId: 'sleep-chat-no-song-title',
    message: '我准备睡觉啦'
  });

  assert.equal(result.track, null);
  assert.equal(result.turnAction.action, TURN_ACTIONS.ASK_FOLLOWUP);
  assert.doesNotMatch(result.chatText, /《爱情转移》/);
  assert.match(result.chatText, /眼睛闭上|晚安|放轻/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plays').get().count, 0);
  assert.doesNotMatch(
    db.prepare('SELECT content FROM messages WHERE session_id = ? AND role = ? ORDER BY id DESC LIMIT 1')
      .get('sleep-chat-no-song-title', 'assistant')
      .content,
    /《爱情转移》/
  );
  const context = JSON.parse(db.prepare('SELECT context_json FROM radio_sessions WHERE id = ?').get('sleep-chat-no-song-title').context_json);
  assert.equal(context.musicContext.lastUserMessage, '我准备睡觉啦');
  const friendPromptText = JSON.stringify(
    requests.find(req => JSON.stringify(req.messages).includes('这一轮是普通聊天回复'))?.messages || []
  );
  assert.match(friendPromptText, /不要主动输出具体歌名/);
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

test('direct music request in chat switches immediately instead of only queueing next track', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { voiceMode: 'off' } });
  const currentTrack = saveTrack(db, {
    id: 'current-playing',
    originalId: 'current-playing-original',
    name: 'Current Playing',
    artists: ['Current Artist'],
    album: 'Current Album'
  });
  db.prepare('INSERT INTO plays (track_id, played_at, source, reason, report_status) VALUES (?,?,?,?,?)')
    .run(currentTrack.id, new Date(Date.now() - 1000).toISOString(), 'radio', 'current playback', 'pending');
  const playlist = savePlaylist(db, { id: 'direct-request-playlist', name: 'Direct Request Playlist', trackCount: 1 }, 'created');
  const targetTrack = saveTrack(db, {
    id: 'direct-request-track',
    originalId: 'direct-request-original',
    name: '国风逆袭BGM',
    artists: ['CanCan Beats'],
    album: 'Direct Request Album'
  });
  linkPlaylistTrack(db, playlist.id, targetTrack.id, 0);

  const result = await chatTurn({
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'direct-chat-switch',
    message: '我有点消沉，放一点短视频逆袭BGM，比如国风DJ'
  });

  assert.equal(result.turnAction.action, TURN_ACTIONS.RECOMMEND_AND_PLAY);
  assert.equal(result.queuePolicy.action, 'hard_preempt');
  assert.equal(result.track?.id, 'direct-request-track');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plays WHERE track_id = ?').get('direct-request-track').count, 1);
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
  assert.equal(isDirectMusicRequest('我有点消沉，放一点短视频逆袭BGM，比如国风DJ'), true);
  assert.equal(isDirectMusicRequest('来点适合写代码的'), true);
  assert.equal(isDirectMusicRequest('想听陈奕迅'), true);
  assert.equal(isDirectMusicRequest('推荐一首适合健身房的歌'), true);
  assert.equal(isDirectMusicRequest('我有点消沉'), false);
  assert.equal(isDirectMusicRequest('先别切歌，后面来点国风DJ'), false);
  assert.equal(isDirectMusicRequest('不想听歌，先聊聊'), false);

  assert.equal(hasExplicitMusicIntent('换一首，来点国风'), true);
  assert.equal(hasExplicitMusicIntent('不想听这首，换他的另一首'), true);
  assert.equal(hasExplicitMusicIntent('不想听这个版本，切歌'), true);
  assert.equal(hasExplicitMusicIntent('听陈奕迅的稳稳的幸福'), true);
  assert.equal(hasExplicitMusicIntent('放周杰伦的晴天'), true);
  assert.equal(hasExplicitMusicIntent('我有点消沉，放一点短视频逆袭BGM，比如国风DJ'), true);
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

test('radio queue policy handles ordinary chat, explicit music, mood shifts, and clear', () => {
  const ordinary = decideQueuePolicy({
    analysis: normalizeMusicContext({ musicIntent: 'chat', mood: 'random' }),
    turnAction: { action: TURN_ACTIONS.CHAT_ONLY }
  });
  assert.equal(ordinary.action, 'refresh_tail');

  const explicit = decideQueuePolicy({
    analysis: normalizeMusicContext({ musicIntent: 'explicit_music', mood: 'energy', searchHints: ['林俊杰'] }),
    turnAction: { action: TURN_ACTIONS.RECOMMEND_AND_PLAY }
  });
  assert.equal(explicit.action, 'hard_preempt');

  const quietHead = {
    track: { id: 'q1', name: 'Quiet Song', artists: ['A'] },
    contextSnapshot: normalizeMusicContext({ mood: 'calm', energy: 'low', searchHints: ['安静'] })
  };
  assert.equal(queueItemMatchesMusicContext(quietHead, normalizeMusicContext({
    mood: 'night',
    energy: 'low',
    searchHints: ['安静'],
    musicIntent: 'mood_signal'
  })), true);
  assert.equal(queueItemMatchesMusicContext(quietHead, normalizeMusicContext({
    mood: 'energy',
    energy: 'high',
    searchHints: ['提神'],
    musicIntent: 'mood_signal'
  })), false);
  assert.equal(queueItemMatchesMusicContext({
    track: { id: 'eason-1', name: '旧歌', artists: ['陈奕迅'] },
    contextSnapshot: normalizeMusicContext({ mood: 'calm', energy: 'low' })
  }, normalizeMusicContext({
    mood: 'calm',
    energy: 'low',
    avoidHints: ['陈奕迅'],
    musicIntent: 'mood_signal'
  })), false);

  const soft = decideQueuePolicy({
    analysis: normalizeMusicContext({ musicIntent: 'mood_signal', mood: 'energy', energy: 'high', searchHints: ['提神'], confidence: 0.8 }),
    currentQueueItem: quietHead
  });
  assert.equal(soft.action, 'soft_preempt');

  const clear = decideQueuePolicy({
    analysis: normalizeMusicContext({ musicIntent: 'suppressed' }),
    turnAction: { action: TURN_ACTIONS.CHAT_ONLY }
  });
  assert.equal(clear.action, 'clear');
});

test('radio queue consumes ready items and keeps pending items in session order', (t) => {
  const db = testDb(t);
  db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?,?,?,?)')
    .run('queue-consume', new Date().toISOString(), '{}', JSON.stringify(normalizeRadioQueue([
      {
        id: 'ready-1',
        status: 'ready',
        track: { id: 't1', name: 'Same Song', artists: ['A'] },
        chatText: 'host 1'
      },
      {
        id: 'pending-1',
        status: 'pending',
        contextSnapshot: normalizeMusicContext({ mood: 'calm' })
      }
    ])));

  const consumed = consumeReadyRadioQueue(db, 'queue-consume');
  assert.equal(consumed.track.id, 't1');

  const status = getRadioQueueStatus(db, 'queue-consume');
  assert.equal(status.readyCount, 0);
  assert.equal(status.pendingCount, 1);
  assert.equal(status.queue[0].id, 'pending-1');
});

test('radio queue skips stale head and records miss diagnostics', (t) => {
  const db = testDb(t);
  const musicContext = normalizeMusicContext({
    version: 2,
    mood: 'energy',
    energy: 'high',
    searchHints: ['boost'],
    musicIntent: 'mood_signal'
  });
  db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?,?,?,?)')
    .run('queue-stale', new Date().toISOString(), JSON.stringify({ musicContext }), JSON.stringify(normalizeRadioQueue([
      {
        id: 'ready-stale',
        status: 'ready',
        contextVersion: 1,
        contextSnapshot: normalizeMusicContext({
          version: 1,
          mood: 'calm',
          energy: 'low',
          searchHints: ['quiet'],
          musicIntent: 'mood_signal'
        }),
        track: { id: 'quiet-1', name: 'Quiet Song', artists: ['A'] },
        chatText: 'host'
      }
    ])));

  const consumed = consumeReadyRadioQueue(db, 'queue-stale');
  assert.equal(consumed, null);

  const status = getRadioQueueStatus(db, 'queue-stale');
  assert.equal(status.readyCount, 0);
  assert.equal(status.staleCount, 1);
  assert.equal(status.queue[0].status, 'stale');
  assert.equal(status.queue[0].staleReason, 'context_mismatch');
  assert.equal(status.queueMetrics.queueMissCount, 1);
  assert.equal(status.queueMetrics.lastMissReason, 'stale_queue_head');
});

test('instrumental-only context does not consume stale quiet vocal queue item', (t) => {
  const db = testDb(t);
  const musicContext = normalizeMusicContext({
    version: 2,
    mood: 'calm',
    energy: 'low',
    searchHints: ['\u5b89\u9759', '\u7eaf\u97f3\u4e50'],
    musicIntent: 'explicit_music',
    vocalPolicy: 'instrumental_only',
    confidence: 0.9
  });
  db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?,?,?,?)')
    .run('queue-instrumental-stale', new Date().toISOString(), JSON.stringify({ musicContext }), JSON.stringify(normalizeRadioQueue([
      {
        id: 'ready-quiet-vocal',
        status: 'ready',
        contextVersion: 1,
        contextSnapshot: normalizeMusicContext({
          version: 1,
          mood: 'calm',
          energy: 'low',
          searchHints: ['\u5b89\u9759'],
          musicIntent: 'mood_signal'
        }),
        track: { id: 'quiet-vocal-1', name: 'Quiet Vocal Song', artists: ['Singer A'] },
        chatText: 'old quiet host'
      }
    ])));

  const consumed = consumeReadyRadioQueue(db, 'queue-instrumental-stale');
  assert.equal(consumed, null);

  const status = getRadioQueueStatus(db, 'queue-instrumental-stale');
  assert.equal(status.readyCount, 0);
  assert.equal(status.staleCount, 1);
  assert.equal(status.queue[0].staleReason, 'context_mismatch');
});

test('radio queue skips songs already played by song name before consuming', (t) => {
  const db = testDb(t);
  db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?,?,?,?)')
    .run('queue-played-name', new Date().toISOString(), JSON.stringify({
      radioPlayedSongs: [{ id: 'old-track', name: 'Same Song', artists: ['Original'] }]
    }), JSON.stringify(normalizeRadioQueue([
      {
        id: 'ready-played',
        status: 'ready',
        track: { id: 'cover-track', name: 'Same Song - Live Version', artists: ['Cover Artist'] },
        chatText: 'old duplicate'
      },
      {
        id: 'ready-new',
        status: 'ready',
        track: { id: 'new-track', name: 'Fresh Song', artists: ['A'] },
        chatText: 'new host'
      }
    ])));

  const consumed = consumeReadyRadioQueue(db, 'queue-played-name');
  assert.equal(consumed.track.id, 'new-track');

  const status = getRadioQueueStatus(db, 'queue-played-name');
  assert.equal(status.readyCount, 0);
  assert.equal(status.staleCount, 1);
  assert.equal(status.queue[0].track.id, 'cover-track');
  assert.equal(status.queue[0].staleReason, 'played_song_name');
  assert.equal(status.queueMetrics.queueMissCount, 1);
  assert.equal(status.queueMetrics.queueHitCount, 1);
});

test('radio debug status returns sanitized queue, metrics, and diagnostics', (t) => {
  const db = testDb(t);
  const context = {
    musicContext: normalizeMusicContext({ mood: 'calm', energy: 'low', searchHints: ['quiet'], version: 3 }),
    queueMetrics: { queueHitCount: 2, queueMissCount: 1, syncFallbackCount: 1, lastMissReason: 'no_ready_queue_item' },
    radioDebug: {
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastSongPlan: {
        attempt: 0,
        picks: [{ name: 'Song A', artists: ['Artist A'], reason: 'calm fit', queries: ['Song A Artist A'] }]
      },
      lastSearchDiagnostics: [{
        pick: { name: 'Song A', artists: ['Artist A'] },
        queries: ['Song A Artist A'],
        hits: [{ track: { id: 's1', name: 'Song A', artists: ['Artist A'] }, score: 130, accepted: true, playable: true }]
      }],
      lastTtsDiagnostics: { status: 'ready', ms: 42, error: null }
    }
  };
  db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?,?,?,?)')
    .run('debug-session', new Date().toISOString(), JSON.stringify(context), JSON.stringify(normalizeRadioQueue([
      {
        id: 'ready-debug',
        status: 'ready',
        contextVersion: 3,
        contextSnapshot: context.musicContext,
        track: { id: 's1', name: 'Song A', artists: ['Artist A'] },
        chatText: 'host',
        ttsStatus: 'ready',
        ttsMs: 42,
        explanation: { summary: 'calm context', factors: [{ type: 'profile', text: 'prefers soft songs' }], source: 'llm_pick' }
      }
    ])));

  const missing = getRadioDebugStatus(db, '');
  assert.equal(missing.status, 400);

  const debug = getRadioDebugStatus(db, 'debug-session');
  assert.equal(debug.ok, true);
  assert.equal(debug.sessionId, 'debug-session');
  assert.equal(debug.musicContext.version, 3);
  assert.equal(debug.queueMetrics.queueHitCount, 2);
  assert.equal(debug.queue[0].status, 'ready');
  assert.equal(debug.queue[0].track.name, 'Song A');
  assert.equal(debug.lastSongPlan.picks[0].name, 'Song A');
  assert.equal(debug.lastSearchDiagnostics[0].hits[0].playable, true);
  assert.equal(debug.lastTtsDiagnostics.status, 'ready');
  assert.equal(JSON.stringify(debug).includes('token'), false);
  assert.equal(JSON.stringify(debug).includes('apiKey'), false);
});

test('queued recommendation ignores old queued host text and tts before playback', async (t) => {
  const db = testDb(t);
  db.prepare('INSERT INTO tracks (id, name, artists, album, cover_url, duration_ms, raw_json, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('queue-song', 'Queue Song', JSON.stringify(['Artist A']), 'Album', null, 180000, '{}', new Date().toISOString());
  db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?,?,?,?)')
    .run('queue-explanation', new Date().toISOString(), '{}', JSON.stringify(normalizeRadioQueue([
      {
        id: 'ready-explain',
        status: 'ready',
        track: { id: 'queue-song', name: 'Queue Song', artists: ['Artist A'], album: 'Album' },
        chatText: 'host',
        reason: 'prepared',
        explanation: {
          summary: 'quiet night + profile',
          factors: [{ type: 'time', text: 'night' }],
          source: 'llm_pick'
        },
        ttsStatus: 'failed',
        ttsUrl: null,
        ttsMs: 12,
        ttsError: 'timeout'
      }
    ])));

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => {
    throw new Error('tts should not be retried for failed queued item');
  };

  const result = await djTurn({
    db,
    config: { llm: {}, tts: { baseUrl: 'http://tts.local', apiKey: 'test' }, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'queue-explanation'
  });

  assert.equal(result.queueHit, true);
  assert.equal(result.queueReconciled, 'finalize_playback');
  assert.equal(result.track.id, 'queue-song');
  assert.notEqual(result.chatText, 'host');
  assert.match(result.chatText, /Queue Song/);
  assert.equal(result.ttsStatus, 'failed');
  assert.equal(result.ttsUrl, null);
  assert.match(result.explanation.summary, /queue|Queue|棰勫彇|预取/);
  assert.notEqual(result.explanation.factors[0].type, 'queue');
  assert.equal(result.explanation.factors.filter(factor => factor.text.includes('预取队列')).length <= 1, true);

  for (let index = 0; index < 20; index += 1) {
    if (getRadioQueueStatus(db, 'queue-explanation').pendingCount === 0) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
});

test('queued recommendation finalizes host text and tts with latest emotional context', async (t) => {
  const db = testDb(t);
  const oldContext = normalizeMusicContext({
    version: 1,
    mood: 'calm',
    energy: 'low',
    searchHints: ['安静'],
    musicIntent: 'mood_signal',
    confidence: 0.75
  });
  const newContext = normalizeMusicContext({
    version: 2,
    mood: 'calm',
    energy: 'low',
    searchHints: ['安静'],
    musicIntent: 'mood_signal',
    confidence: 0.8,
    lastUserMessage: '我胃不舒服，想安静一下',
    reason: '身体不舒服，需要更轻的陪伴'
  });
  db.prepare('INSERT INTO tracks (id, name, artists, album, cover_url, duration_ms, raw_json, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('quiet-song', '安静的歌', JSON.stringify(['Artist A']), 'Album', null, 180000, '{}', new Date().toISOString());
  db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?,?,?,?)')
    .run('queue-refresh-host', new Date().toISOString(), JSON.stringify({ musicContext: newContext }), JSON.stringify(normalizeRadioQueue([
      {
        id: 'ready-refresh',
        status: 'ready',
        contextVersion: 1,
        contextSnapshot: oldContext,
        track: { id: 'quiet-song', name: '安静的歌', artists: ['Artist A'], album: 'Album' },
        chatText: '旧导播词，不应该继续直接使用。',
        reason: 'prepared',
        explanation: {
          summary: 'old quiet context',
          factors: [{ type: 'time', text: 'night' }],
          source: 'llm_pick'
        },
        ttsStatus: 'ready',
        ttsUrl: '/api/tts/old.mp3'
      }
    ])));

  const result = await djTurn({
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'queue-refresh-host'
  });

  assert.equal(result.queueHit, true);
  assert.equal(result.queueReconciled, 'finalize_playback');
  assert.equal(result.track.id, 'quiet-song');
  assert.notEqual(result.chatText, '旧导播词，不应该继续直接使用。');
  assert.match(result.chatText, /安静的歌/);
  assert.equal(result.ttsStatus, 'failed');
  assert.equal(result.ttsUrl, null);
  assert.equal(result.explanation.factors.some(factor => factor.text.includes('胃不舒服')), true);

  const status = getRadioQueueStatus(db, 'queue-refresh-host');
  assert.equal(status.queueMetrics.queueHitCount, 1);
  assert.equal(status.queueMetrics.queueFinalizeCount, 1);
  assert.equal(status.queueMetrics.lastQueueReconcileReason, 'queued_song_finalized_for_playback');

  for (let index = 0; index < 20; index += 1) {
    if (getRadioQueueStatus(db, 'queue-refresh-host').pendingCount === 0) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
});

test('queued recommendation is replaced when artist density is too high', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { voiceMode: 'off' } });
  for (let index = 0; index < 3; index += 1) {
    const oldTrack = saveTrack(db, {
      id: `queue-repeat-old-${index}`,
      originalId: `queue-repeat-old-${index}`,
      name: `Queue Repeat Old ${index}`,
      artists: ['Repeat Artist'],
      album: 'Repeat Album'
    });
    db.prepare('INSERT INTO plays (track_id, played_at, source, reason, report_status) VALUES (?,?,?,?,?)')
      .run(oldTrack.id, new Date(Date.now() - index * 1000).toISOString(), 'radio_familiar', '[novelty:familiar]', 'imported');
  }
  saveTrack(db, {
    id: 'queue-repeat-ready',
    originalId: 'queue-repeat-ready',
    name: 'Queue Repeat Ready',
    artists: ['Repeat Artist'],
    album: 'Repeat Album'
  });
  saveTrack(db, {
    id: 'queue-fresh-sync',
    originalId: 'queue-fresh-sync',
    name: 'Queue Fresh Sync',
    artists: ['Fresh Artist'],
    album: 'Fresh Album'
  });
  db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?,?,?,?)')
    .run('queue-artist-density', new Date().toISOString(), '{}', JSON.stringify(normalizeRadioQueue([
      {
        id: 'ready-density',
        status: 'ready',
        track: { id: 'queue-repeat-ready', name: 'Queue Repeat Ready', artists: ['Repeat Artist'], album: 'Repeat Album' },
        chatText: 'old host',
        reason: 'prepared'
      }
    ])));

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    const promptText = JSON.stringify(request.messages || []);
    if (promptText.includes('最终可播放歌曲已经确认')) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ chatText: '换成《Queue Fresh Sync》，保持流动。' }) } }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            picks: [{
              candidateId: 'queue-fresh-sync',
              name: 'Queue Fresh Sync',
              artists: ['Fresh Artist'],
              reason: '避开刚才过密的艺人，换一个声音',
              queries: ['Queue Fresh Sync Fresh Artist']
            }],
            hostDraft: '',
            mode: null
          })
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await djTurn({
    db,
    config: {
      recommendation: { pipeline: 'hybrid', artistDensityWindow: 8, artistDensityMax: 3 },
      llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-test' },
      tts: {},
      weather: {}
    },
    netease: { isConfigured: () => false },
    sessionId: 'queue-artist-density'
  });

  const debug = getRadioDebugStatus(db, 'queue-artist-density');
  assert.equal(result.queueHit, false);
  assert.equal(result.queueReconciled, 'replace_track');
  assert.equal(result.track.id, 'queue-fresh-sync');
  assert.equal(debug.lastQueueReconcile?.reason, 'artist_density');

  await new Promise(resolve => setTimeout(resolve, 60));
  for (let index = 0; index < 20; index += 1) {
    if (getRadioQueueStatus(db, 'queue-artist-density').pendingCount === 0) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
});

test('queued host text uses a chat context only once when no new dialogue arrives', async (t) => {
  const db = testDb(t);
  const usedContext = normalizeMusicContext({
    version: 2,
    mood: 'calm',
    energy: 'low',
    searchHints: ['安静'],
    musicIntent: 'mood_signal',
    confidence: 0.8,
    lastUserMessage: '我最近心情不好',
    reason: '用户说最近心情不好'
  });
  db.prepare('INSERT INTO tracks (id, name, artists, album, cover_url, duration_ms, raw_json, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run('fresh-song', 'Fresh Song', JSON.stringify(['Artist A']), 'Album', null, 180000, '{}', new Date().toISOString());
  db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?,?,?,?)')
    .run('queue-context-once', new Date().toISOString(), JSON.stringify({
      musicContext: usedContext,
      radioIntroDone: true,
      lastBoundMusicContextVersion: 2
    }), JSON.stringify(normalizeRadioQueue([
      {
        id: 'ready-after-bound',
        status: 'ready',
        contextVersion: 2,
        contextSnapshot: usedContext,
        track: { id: 'fresh-song', name: 'Fresh Song', artists: ['Artist A'], album: 'Album' },
        reason: '因为用户说最近心情不好，所以继续选安静的歌',
        explanation: {
          summary: '用户最近心情不好 + 安静氛围',
          factors: [{ type: 'chat', text: '用户最近心情不好' }],
          source: 'llm_pick'
        }
      }
    ])));

  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            chatText: '换一个轻一点的声音，听《Fresh Song》。'
          })
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await djTurn({
    db,
    config: { llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-test' }, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'queue-context-once'
  });

  assert.equal(result.queueHit, true);
  assert.equal(result.track.id, 'fresh-song');
  const promptText = JSON.stringify(requests[0]?.messages || []);
  assert.doesNotMatch(promptText, /我最近心情不好|用户说最近心情不好/);
  assert.match(promptText, /延续当前电台氛围/);
  assert.doesNotMatch(result.chatText, /心情不好/);

  for (let index = 0; index < 20; index += 1) {
    if (getRadioQueueStatus(db, 'queue-context-once').pendingCount === 0) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
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
  assert.equal(context.musicContext.version >= 1, true);
  assert.equal(context.musicContext.musicIntent, 'suppressed');
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

test('hybrid candidate context ranks local candidates with profile, feedback, mood, and constraints', async (t) => {
  const db = testDb(t);
  saveTrack(db, {
    id: 'hybrid-liked',
    originalId: 'hybrid-liked-original',
    name: '温柔治愈歌',
    artists: ['Good Artist'],
    album: '治愈 Album'
  });
  saveTrack(db, {
    id: 'hybrid-skipped',
    originalId: 'hybrid-skipped-original',
    name: 'Metal Night',
    artists: ['Heavy Band'],
    album: 'Heavy Album'
  });
  saveTrack(db, {
    id: 'hybrid-forbidden',
    originalId: 'hybrid-forbidden-original',
    name: 'Forbidden Song',
    artists: ['Forbidden Artist'],
    album: 'Forbidden Album'
  });
  recordTrackFeedback(db, { trackId: 'hybrid-liked', eventType: 'like' });
  recordTrackFeedback(db, { trackId: 'hybrid-liked', eventType: 'complete' });
  recordTrackFeedback(db, { trackId: 'hybrid-skipped', eventType: 'dislike' });
  recordTrackFeedback(db, { trackId: 'hybrid-skipped', eventType: 'skip' });

  const context = await buildHybridCandidateContext({
    db,
    config: { recommendation: { pipeline: 'hybrid' } },
    profile: {
      structured: {
        artists: [{ name: 'Good Artist', weight: 1 }],
        moods: [{ name: '治愈', weight: 1 }],
        avoidSignals: [{ name: 'metal', weight: 1 }]
      }
    },
    conversationMood: { mood: 'comfort', searchHints: ['治愈', '温柔'], energy: 'low' },
    request: { sessionConstraints: normalizeSessionConstraints({ avoidTerms: ['Forbidden Artist'] }) },
    playedIds: new Set(),
    playedSignatures: new Set()
  });

  const ids = context.candidates.map(candidate => candidate.track.id);
  assert.equal(context.enabled, true);
  assert.equal(ids[0], 'hybrid-liked');
  assert.equal(ids.includes('hybrid-forbidden'), false);
  assert.equal(ids.indexOf('hybrid-skipped') > ids.indexOf('hybrid-liked'), true);
  assert.match(context.promptText, /candidateId=hybrid-liked/);
});

test('hybrid candidate context balances familiar and discovery prompt candidates', async (t) => {
  const db = testDb(t);
  saveLocalTracks(db, '910', 18);

  const context = await buildHybridCandidateContext({
    db,
    config: {
      recommendation: {
        pipeline: 'hybrid',
        discoveryRatio: 0.5,
        discoveryTimeoutMs: 20,
        discoveryCacheTtlMs: 0
      }
    },
    netease: discoveryNetease(discoveryRecords('710', 18)),
    playedIds: new Set(),
    playedSignatures: new Set()
  });

  assert.equal(context.enabled, true);
  assert.deepEqual(countByNovelty(context.candidates), {
    discovery: 12,
    familiar: 12
  });
  assert.equal(context.debug.promptDiscoveryCount, 12);
  assert.equal(context.debug.promptFamiliarCount, 12);
  assert.equal(context.debug.discoveryUnderfilled, false);
  assert.equal(context.debug.discoverySources.netease_daily, 18);
  assert.match(context.promptText, /发现候选/);
  assert.match(context.promptText, /熟悉候选/);
});

test('hybrid prompt candidate pool limits one artist to five visible candidates', async (t) => {
  const db = testDb(t);
  for (let index = 0; index < 12; index += 1) {
    saveTrack(db, {
      id: `repeat-${index}`,
      originalId: `repeat-${index}`,
      name: `Repeat Song ${index}`,
      artists: ['Repeat Artist'],
      album: 'Repeat Album'
    });
  }
  for (let index = 0; index < 16; index += 1) {
    saveTrack(db, {
      id: `fresh-${index}`,
      originalId: `fresh-${index}`,
      name: `Fresh Song ${index}`,
      artists: [`Fresh Artist ${index}`],
      album: 'Fresh Album'
    });
  }

  const context = await buildHybridCandidateContext({
    db,
    config: { recommendation: { pipeline: 'hybrid', promptArtistLimit: 5 } },
    profile: {
      structured: {
        artists: [{ name: 'Repeat Artist', weight: 1 }]
      }
    },
    playedIds: new Set(),
    playedSignatures: new Set()
  });

  const repeatCount = context.candidates.filter(candidate => candidate.track.artists.includes('Repeat Artist')).length;
  assert.equal(context.enabled, true);
  assert.equal(repeatCount, 5);
  assert.equal(context.debug.artistLimit, 5);
  assert.equal(context.debug.artistLimitApplied, true);
  assert.equal(context.debug.artistLimitSkippedCount > 0, true);
  assert.equal(context.debug.promptArtistCounts.repeatartist, 5);
});

test('explicit artist requests bypass prompt artist limit', async (t) => {
  const db = testDb(t);
  for (let index = 0; index < 8; index += 1) {
    saveTrack(db, {
      id: `explicit-repeat-${index}`,
      originalId: `explicit-repeat-${index}`,
      name: `Explicit Repeat ${index}`,
      artists: ['Repeat Artist'],
      album: 'Repeat Album'
    });
  }

  const context = await buildHybridCandidateContext({
    db,
    config: { recommendation: { pipeline: 'hybrid', promptArtistLimit: 5 } },
    request: {
      text: '想听 Repeat Artist',
      artistConstraint: { label: 'Repeat Artist' },
      sessionConstraints: normalizeSessionConstraints()
    },
    playedIds: new Set(),
    playedSignatures: new Set()
  });

  assert.equal(context.enabled, true);
  assert.equal(context.debug.artistLimitApplied, false);
  assert.equal(context.candidates.filter(candidate => candidate.track.artists.includes('Repeat Artist')).length, 8);
});

test('hybrid candidate context targets discovery or familiar by recent novelty window', async (t) => {
  const db = testDb(t);
  saveLocalTracks(db, '920', 18);
  const now = Date.now();
  for (let index = 0; index < 6; index += 1) {
    const track = saveTrack(db, {
      id: `window-${index}`,
      originalId: `window-${index}`,
      name: `Window ${index}`,
      artists: [`Window Artist ${index}`],
      album: 'Window'
    });
    const source = index === 0 ? 'radio_discovery' : 'radio_familiar';
    db.prepare('INSERT INTO plays (track_id, played_at, source, reason, report_status) VALUES (?,?,?,?,?)')
      .run(track.id, new Date(now - index * 1000).toISOString(), source, `[novelty:${source.includes('discovery') ? 'discovery' : 'familiar'}]`, 'imported');
  }

  const discoveryTarget = await buildHybridCandidateContext({
    db,
    sessionId: 'novelty-window-under',
    config: { recommendation: { pipeline: 'hybrid', discoveryRatio: 0.5, discoveryCacheTtlMs: 0 } },
    netease: discoveryNetease(discoveryRecords('720', 18)),
    playedIds: new Set(),
    playedSignatures: new Set()
  });
  assert.equal(discoveryTarget.debug.targetNoveltyBucket, 'discovery');

  for (let index = 6; index < 12; index += 1) {
    const track = saveTrack(db, {
      id: `window-${index}`,
      originalId: `window-${index}`,
      name: `Window ${index}`,
      artists: [`Window Artist ${index}`],
      album: 'Window'
    });
    const source = index < 10 ? 'radio_discovery' : 'radio_familiar';
    db.prepare('INSERT INTO plays (track_id, played_at, source, reason, report_status) VALUES (?,?,?,?,?)')
      .run(track.id, new Date(now + 10000 - index * 1000).toISOString(), source, `[novelty:${source.includes('discovery') ? 'discovery' : 'familiar'}]`, 'imported');
  }

  const familiarTarget = await buildHybridCandidateContext({
    db,
    sessionId: 'novelty-window-over',
    config: { recommendation: { pipeline: 'hybrid', discoveryRatio: 0.5, discoveryCacheTtlMs: 0 } },
    netease: discoveryNetease(discoveryRecords('730', 18)),
    playedIds: new Set(),
    playedSignatures: new Set()
  });
  assert.equal(familiarTarget.debug.targetNoveltyBucket, 'familiar');
});

test('hybrid candidate context falls back to familiar candidates when discovery times out', async (t) => {
  const db = testDb(t);
  saveLocalTracks(db, '930', 14);

  const context = await buildHybridCandidateContext({
    db,
    config: {
      recommendation: {
        pipeline: 'hybrid',
        discoveryRatio: 0.5,
        discoveryTimeoutMs: 5,
        discoveryCacheTtlMs: 0
      }
    },
    netease: discoveryNetease([], {
      dailyRecommend: async () => new Promise(() => {})
    }),
    playedIds: new Set(),
    playedSignatures: new Set()
  });

  assert.equal(context.enabled, true);
  assert.equal(context.debug.promptDiscoveryCount, 0);
  assert.equal(context.debug.promptFamiliarCount, 14);
  assert.equal(context.debug.discoveryUnderfilled, true);
  assert.match(context.debug.discoveryFallbackReason, /timeout/);
});

test('hybrid discovery candidates exclude played and familiar tracks', async (t) => {
  const db = testDb(t);
  saveLocalTracks(db, '940', 12);

  const context = await buildHybridCandidateContext({
    db,
    config: {
      recommendation: {
        pipeline: 'hybrid',
        discoveryRatio: 0.5,
        discoveryTimeoutMs: 20,
        discoveryCacheTtlMs: 0
      }
    },
    netease: discoveryNetease([
      { id: '9400', name: 'Local 9400', artists: [{ name: 'Local Artist 0' }], album: { name: 'Local Album 0' } },
      { id: '7800', name: 'Already Played', artists: [{ name: 'Played Artist' }], album: { name: 'Played Album' } }
    ]),
    playedIds: new Set(['7800']),
    playedSignatures: new Set()
  });

  assert.equal(context.enabled, true);
  assert.equal(context.debug.discoveryCount, 0);
  assert.equal(context.candidates.some(candidate => candidate.track.id === '9400' && candidate.noveltyBucket === 'discovery'), false);
  assert.equal(context.candidates.some(candidate => candidate.track.id === '7800'), false);
});

test('strict style requests populate and prioritize style search candidates', async (t) => {
  const db = testDb(t);
  saveLocalTracks(db, '960', 12);
  const queries = [];
  const context = await buildHybridCandidateContext({
    db,
    config: {
      recommendation: {
        pipeline: 'hybrid',
        discoveryRatio: 0.5,
        discoveryTimeoutMs: 20,
        discoveryCacheTtlMs: 0,
        styleSearchTimeoutMs: 20,
        styleSearchLimit: 6
      }
    },
    netease: discoveryNetease(discoveryRecords('820', 8)),
    request: {
      styleConstraint: guofengDjStyleConstraint(),
      styleSearchQueries: ['\u56fd\u98ce DJ \u9006\u88ad BGM'],
      sessionConstraints: normalizeSessionConstraints({})
    },
    styleSearch: async (query) => {
      queries.push(query);
      return [
        {
          id: 'style-hit',
          name: '\u56fd\u98ce DJ \u9006\u88ad BGM',
          artists: ['Style Artist'],
          album: '\u56fd\u98ce\u7535\u97f3'
        },
        {
          id: 'style-plain',
          name: '\u4e00\u751f\u6240\u7231',
          artists: ['Plain Artist'],
          album: 'Plain Album'
        }
      ];
    },
    playedIds: new Set(),
    playedSignatures: new Set()
  });

  assert.equal(context.enabled, true);
  assert.equal(queries.includes('\u56fd\u98ce DJ \u9006\u88ad BGM'), true);
  assert.equal(context.debug.reason, 'hybrid_style_candidate_pool');
  assert.equal(context.debug.styleSearchCount, 2);
  assert.equal(context.debug.styleQualifiedCount, 1);
  assert.equal(context.candidates[0].track.id, 'style-hit');
  assert.equal(context.candidates.some(candidate => candidate.track.id === 'style-plain'), true);
  assert.match(context.promptText, /qualified_style_search/);
  assert.match(context.promptText, /candidateId=style-hit/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tracks WHERE id = ?').get('style-hit').count, 0);
});

test('strict style prompt candidates limit repeated artists and genre families', async (t) => {
  const db = testDb(t);
  const styleRecords = [
    ...Array.from({ length: 9 }, (_, index) => ({
      id: `style-repeat-${index}`,
      name: `国风 DJ 逆袭 BGM ${index}`,
      artists: ['Repeat Style Artist'],
      album: '国风电音'
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `style-fresh-${index}`,
      name: `国风 DJ 燃向 BGM ${index}`,
      artists: [`Fresh Style Artist ${index}`],
      album: '国风电音'
    }))
  ];

  const context = await buildHybridCandidateContext({
    db,
    config: {
      recommendation: {
        pipeline: 'hybrid',
        styleSearchTimeoutMs: 20,
        styleSearchLimit: 20,
        promptArtistLimit: 5
      }
    },
    netease: { isConfigured: () => false },
    request: {
      styleConstraint: guofengDjStyleConstraint(),
      styleSearchQueries: ['\u56fd\u98ce DJ \u9006\u88ad BGM'],
      sessionConstraints: normalizeSessionConstraints({})
    },
    styleSearch: async () => styleRecords,
    playedIds: new Set(),
    playedSignatures: new Set()
  });

  assert.equal(context.enabled, true);
  assert.equal(context.debug.promptStyleSearchCount, 8);
  assert.equal(context.debug.artistLimitApplied, true);
  assert.equal(context.debug.promptArtistCounts.repeatstyleartist <= 5, true);
  assert.equal(context.debug.promptGenreFamilyCounts.electronic, 8);
  assert.equal(context.candidates.filter(candidate => candidate.track.artists.includes('Repeat Style Artist')).length <= 5, true);
});

test('strict style search timeout falls back to familiar candidates', async (t) => {
  const db = testDb(t);
  saveLocalTracks(db, '970', 4);

  const context = await buildHybridCandidateContext({
    db,
    config: {
      recommendation: {
        pipeline: 'hybrid',
        discoveryRatio: 0.5,
        discoveryTimeoutMs: 5,
        discoveryCacheTtlMs: 0,
        styleSearchTimeoutMs: 5,
        styleSearchLimit: 6
      }
    },
    netease: { isConfigured: () => false },
    request: {
      styleConstraint: guofengDjStyleConstraint(),
      styleSearchQueries: ['\u56fd\u98ce DJ \u9006\u88ad BGM'],
      sessionConstraints: normalizeSessionConstraints({})
    },
    styleSearch: async () => new Promise(() => {}),
    playedIds: new Set(),
    playedSignatures: new Set()
  });

  assert.equal(context.enabled, true);
  assert.equal(context.debug.styleSearchCount, 0);
  assert.match(context.debug.styleSearchFallbackReason, /timeout/);
  assert.equal(context.debug.familiarCount, 4);
});

test('style constraint helpers reject mood-similar songs without required evidence', () => {
  const constraint = guofengDjStyleConstraint();
  assert.equal(trackViolatesStyleConstraint({
    id: 'plain-love',
    name: '\u4e00\u751f\u6240\u7231',
    artists: ['\u5362\u51a0\u5ef7'],
    album: 'Classic Ballad'
  }, constraint), true);
  assert.equal(trackMatchesStyleConstraint({
    id: 'style-hit',
    name: '\u56fd\u98ce DJ \u9006\u88ad BGM',
    artists: ['Style Artist'],
    album: '\u56fd\u98ce\u7535\u97f3'
  }, constraint), true);
});

test('hybrid candidate context can be disabled for legacy pipeline or explicit song requests', async (t) => {
  const db = testDb(t);
  saveTrack(db, {
    id: 'legacy-local-track',
    originalId: 'legacy-local-original',
    name: 'Legacy Local',
    artists: ['Legacy Artist'],
    album: 'Legacy Album'
  });

  assert.equal(getRecommendationPipeline({}), 'hybrid');
  assert.equal(getRecommendationPipeline({ recommendation: { pipeline: 'legacy' } }), 'legacy');

  const legacy = await buildHybridCandidateContext({
    db,
    config: { recommendation: { pipeline: 'legacy' } }
  });
  assert.equal(legacy.enabled, false);
  assert.equal(legacy.reason, 'legacy_pipeline');

  const explicitSong = await buildHybridCandidateContext({
    db,
    config: { recommendation: { pipeline: 'hybrid' } },
    request: { songTitle: '晴天' }
  });
  assert.equal(explicitSong.enabled, false);
  assert.equal(explicitSong.reason, 'explicit_song_request');
});

test('hybrid candidate id selects local track without increasing LLM calls', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { voiceMode: 'off' } });
  saveTrack(db, {
    id: 'candidate-hit',
    originalId: 'candidate-hit-original',
    name: '温柔治愈歌',
    artists: ['Good Artist'],
    album: '治愈 Album'
  });
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    const promptText = JSON.stringify(request.messages || []);
    if (promptText.includes('最终可播放歌曲已经确认')) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({ chatText: '接下来放《温柔治愈歌》，让声音先稳稳落下来。' })
          }
        }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            picks: [{
              candidateId: 'candidate-hit',
              name: '温柔治愈歌',
              artists: ['Good Artist'],
              reason: '本地候选池里最贴合当前电台氛围',
              queries: ['温柔治愈歌 Good Artist']
            }],
            hostDraft: '',
            mode: null
          })
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await djTurn({
    db,
    config: {
      recommendation: { pipeline: 'hybrid' },
      llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-test' },
      tts: {},
      weather: {}
    },
    netease: { isConfigured: () => false },
    sessionId: 'hybrid-candidate-id',
    userMessage: null,
    useQueue: false
  });

  const debug = getRadioDebugStatus(db, 'hybrid-candidate-id');
  assert.equal(result.track?.id, 'candidate-hit');
  assert.equal(requests.length, 2);
  assert.match(JSON.stringify(requests[0].messages), /candidateId=candidate-hit/);
  assert.equal(debug.lastCandidatePool?.enabled, true);
  assert.equal(debug.lastSearchDiagnostics[0]?.fallbackSource, 'hybrid_candidate');
});

test('artist density rejects an overused candidate id and tries the next pick', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { voiceMode: 'off' } });
  for (let index = 0; index < 3; index += 1) {
    const oldTrack = saveTrack(db, {
      id: `repeat-old-${index}`,
      originalId: `repeat-old-${index}`,
      name: `Repeat Old ${index}`,
      artists: ['Repeat Artist'],
      album: 'Repeat Album'
    });
    db.prepare('INSERT INTO plays (track_id, played_at, source, reason, report_status) VALUES (?,?,?,?,?)')
      .run(oldTrack.id, new Date(Date.now() - index * 1000).toISOString(), 'radio_familiar', '[novelty:familiar]', 'imported');
  }
  saveTrack(db, {
    id: 'repeat-new',
    originalId: 'repeat-new',
    name: 'Repeat New',
    artists: ['Repeat Artist'],
    album: 'Repeat Album'
  });
  saveTrack(db, {
    id: 'fresh-new',
    originalId: 'fresh-new',
    name: 'Fresh New',
    artists: ['Fresh Artist'],
    album: 'Fresh Album'
  });

  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    const promptText = JSON.stringify(request.messages || []);
    if (promptText.includes('最终可播放歌曲已经确认')) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ chatText: '先放《Fresh New》，换一个新的声音。' }) } }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            picks: [
              {
                candidateId: 'repeat-new',
                name: 'Repeat New',
                artists: ['Repeat Artist'],
                reason: '候选池里看起来贴合',
                queries: ['Repeat New Repeat Artist']
              },
              {
                candidateId: 'fresh-new',
                name: 'Fresh New',
                artists: ['Fresh Artist'],
                reason: '保持氛围但换一个艺人',
                queries: ['Fresh New Fresh Artist']
              }
            ],
            hostDraft: '',
            mode: null
          })
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await djTurn({
    db,
    config: {
      recommendation: {
        pipeline: 'hybrid',
        artistDensityWindow: 8,
        artistDensityMax: 3
      },
      llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-test' },
      tts: {},
      weather: {}
    },
    netease: { isConfigured: () => false },
    sessionId: 'artist-density-candidate-id',
    userMessage: null,
    useQueue: false
  });

  const debug = getRadioDebugStatus(db, 'artist-density-candidate-id');
  assert.equal(result.track?.id, 'fresh-new');
  assert.equal(requests.length, 2);
  assert.equal(debug.lastSearchDiagnostics[0]?.failedReason, 'artist_density');
  assert.equal(debug.lastSearchDiagnostics[0]?.hits[0]?.artistDensityResult?.accepted, false);
  assert.equal(debug.lastSearchDiagnostics.some(item => item?.selectedTrackId === 'fresh-new'), true);
});

test('hybrid discovery candidate id selects discovery track without increasing LLM calls', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { voiceMode: 'off' } });
  saveLocalTracks(db, '950', 12);
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    if (requests.length === 1) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              picks: [{
                candidateId: '8100',
                name: 'Fresh Signal',
                artists: ['Fresh Artist'],
                reason: '来自发现候选，适合当前电台状态',
                queries: ['Fresh Signal Fresh Artist']
              }],
              hostDraft: '',
              mode: null
            })
          }
        }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ chatText: '接下来放《Fresh Signal》，让电台切到一点新的风景。' })
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await djTurn({
    db,
    config: {
      recommendation: {
        pipeline: 'hybrid',
        discoveryRatio: 0.5,
        discoveryTimeoutMs: 20,
        discoveryCacheTtlMs: 0
      },
      llm: { baseUrl: 'http://llm.local', apiKey: 'test', model: 'deepseek-test' },
      tts: {},
      weather: {}
    },
    netease: discoveryNetease([
      { id: '8100', name: 'Fresh Signal', artists: [{ name: 'Fresh Artist' }], album: { name: 'Fresh Album' } }
    ], {
      playUrl: async (songId) => ({ data: { url: `https://music.local/${songId}.mp3` } }),
      lyric: async () => ({ data: { lyric: '' } })
    }),
    sessionId: 'hybrid-discovery-candidate-id',
    userMessage: null,
    useQueue: false
  });

  const debug = getRadioDebugStatus(db, 'hybrid-discovery-candidate-id');
  const play = db.prepare('SELECT source, reason FROM plays WHERE track_id = ?').get('8100');
  assert.equal(result.track?.id, '8100');
  assert.equal(requests.length, 2);
  assert.equal(debug.lastSearchDiagnostics[0]?.fallbackSource, 'hybrid_candidate');
  assert.equal(debug.lastSearchDiagnostics[0]?.noveltyBucket, 'discovery');
  assert.equal(play.source, 'radio_discovery');
  assert.match(play.reason, /novelty:discovery/);
});

test('DJ recommendation falls back to current profile playlists when LLM has no picks', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { voiceMode: 'off' } });
  const playlist = savePlaylist(db, { id: 'fallback-playlist', name: 'Fallback Playlist', trackCount: 1 }, 'created');
  const track = saveTrack(db, {
    id: 'fallback-track',
    originalId: 'fallback-original-id',
    name: 'Fallback Song',
    artists: ['Fallback Artist'],
    album: 'Fallback Album'
  });
  linkPlaylistTrack(db, playlist.id, track.id, 0);

  const result = await djTurn({
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'profile-fallback-session',
    userMessage: null,
    useQueue: false
  });

  assert.equal(result.track?.name, 'Fallback Song');
  assert.equal(result.explanation?.source, 'fallback');
  assert.doesNotMatch(result.chatText, /没能生成|可靠歌名|no playable/i);
});

test('instrumental-only request refuses ordinary vocal profile fallback', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { voiceMode: 'off' } });
  const playlist = savePlaylist(db, { id: 'vocal-fallback-playlist', name: 'Vocal Fallback Playlist', trackCount: 1 }, 'created');
  const track = saveTrack(db, {
    id: 'ordinary-vocal-fallback',
    originalId: 'ordinary-vocal-original-id',
    name: 'Ordinary Vocal Song',
    artists: ['Vocal Artist'],
    album: 'Vocal Album'
  });
  linkPlaylistTrack(db, playlist.id, track.id, 0);

  const result = await djTurn({
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'instrumental-no-vocal-fallback',
    userMessage: '\u653e\u4e00\u9996\u5b89\u9759\u7684\u7eaf\u97f3\u4e50',
    useQueue: false
  });

  assert.equal(result.track, null);
  const debug = getRadioDebugStatus(db, 'instrumental-no-vocal-fallback');
  assert.equal(debug.lastRecommendationFailure?.stage, 'profile_fallback');
});

test('removed pending radio prefetch does not reinsert after async completion', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { voiceMode: 'off' } });
  const playlist = savePlaylist(db, { id: 'instrumental-prefetch-playlist', name: 'Instrumental Playlist', trackCount: 1 }, 'created');
  const track = saveTrack(db, {
    id: 'instrumental-prefetch-track',
    originalId: 'instrumental-prefetch-original-id',
    name: 'Instrumental BGM',
    artists: ['Piano Artist'],
    album: 'Pure Music Album'
  });
  linkPlaylistTrack(db, playlist.id, track.id, 0);
  const musicContext = normalizeMusicContext({
    version: 1,
    mood: 'calm',
    energy: 'low',
    searchHints: ['\u7eaf\u97f3\u4e50'],
    musicIntent: 'explicit_music',
    vocalPolicy: 'instrumental_only'
  });
  db.prepare('INSERT INTO radio_sessions (id, created_at, context_json, queue_json) VALUES (?,?,?,?)')
    .run('prefetch-removed-pending', new Date().toISOString(), JSON.stringify({ musicContext }), '[]');

  prefetchRadioQueue({
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'prefetch-removed-pending',
    force: true
  });
  const pending = getRadioQueueStatus(db, 'prefetch-removed-pending');
  assert.equal(pending.pendingCount, 1);

  db.prepare('UPDATE radio_sessions SET queue_json = ? WHERE id = ?').run('[]', 'prefetch-removed-pending');
  await new Promise(resolve => setTimeout(resolve, 80));

  const status = getRadioQueueStatus(db, 'prefetch-removed-pending');
  assert.equal(status.queueSize, 0);
});

test('playlist mode starts with one intro and continues without per-song speech', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { voiceMode: 'off' } });
  const playlist = savePlaylist(db, { id: 'five-song-profile', name: 'Five Song Profile', trackCount: 5 }, 'created');
  for (let index = 0; index < 5; index += 1) {
    const track = saveTrack(db, {
      id: `playlist-track-${index}`,
      originalId: `playlist-original-${index}`,
      name: `Playlist Song ${index + 1}`,
      artists: [`Artist ${index + 1}`],
      album: 'Playlist Album'
    });
    linkPlaylistTrack(db, playlist.id, track.id, index);
  }

  const netease = { isConfigured: () => false };
  const config = { llm: {}, tts: {}, weather: {} };
  const playlistSceneMessage = '\u6211\u6b63\u5728\u5065\u8eab\u623f\uff0c\u8bf7\u5e2e\u6211\u63a8\u8350\u9002\u5408\u5065\u8eab\u623f\u7684\u6b4c';
  const start = await playlistStartTurn({
    db,
    config,
    netease,
    sessionId: 'playlist-mode-session',
    userMessage: playlistSceneMessage
  });

  assert.equal(start.playlistMode, true);
  assert.equal(start.hostPolicy, 'playlist_intro');
  assert.equal(start.playlist.items.length, 5);
  assert.equal(start.playlist.currentIndex, 0);
  assert.match(start.chatText, /5 首音乐会|音乐会/);
  assert.equal(start.speech.shouldSpeak, false);
  const savedSceneMessage = db.prepare('SELECT content FROM messages WHERE session_id = ? AND role = ? ORDER BY id LIMIT 1')
    .get('playlist-mode-session', 'user');
  assert.equal(savedSceneMessage.content, playlistSceneMessage);

  const next = await playlistNextTurn({
    db,
    config,
    netease,
    sessionId: 'playlist-mode-session'
  });

  assert.equal(next.playlistMode, true);
  assert.equal(next.hostPolicy, 'none');
  assert.equal(next.chatText, '');
  assert.equal(next.ttsUrl, null);
  assert.equal(next.speech.shouldSpeak, false);
  assert.equal(next.playlist.currentIndex, 1);
  assert.equal(next.playlist.items[0].status, 'played');
  assert.equal(next.playlist.items[1].status, 'current');
});

test('schedule planning enforces zero, one, and three-to-five track windows', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { voiceMode: 'off', scheduleAwareEnabled: true } });
  const playlist = savePlaylist(db, { id: 'schedule-profile', name: 'Schedule Profile', trackCount: 8 }, 'created');
  for (let index = 0; index < 8; index += 1) {
    const track = saveTrack(db, {
      id: `schedule-track-${index}`,
      originalId: `schedule-original-${index}`,
      name: `Schedule Song ${index + 1}`,
      artists: [`Schedule Artist ${index + 1}`],
      album: 'Schedule Album',
      durationMs: 3 * 60 * 1000
    });
    linkPlaylistTrack(db, playlist.id, track.id, index);
  }
  const base = {
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    planning: { source: 'schedule' }
  };
  const scheduleContext = (freeWindowMinutes) => ({
    source: 'fake',
    fingerprint: `window-${freeWindowMinutes}`,
    fetchedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    freeWindowMinutes,
    nextEventMinutes: freeWindowMinutes,
    nextEventCategory: 'class',
    locationType: 'campus',
    dayLoad: 'medium',
    transitionType: 'pre_event'
  });

  const tooShort = await playlistStartTurn({ ...base, sessionId: 'schedule-zero', scheduleContext: scheduleContext(5) });
  assert.equal(tooShort.track, null);
  assert.equal(tooShort.concertMode, true);
  assert.equal(tooShort.reason, 'schedule_window_too_short');

  const one = await playlistStartTurn({ ...base, sessionId: 'schedule-one', scheduleContext: scheduleContext(10) });
  assert.equal(one.playlist.items.length, 1);
  assert.ok(one.playlist.items[0].track.durationMs <= 8 * 60 * 1000);

  const three = await playlistStartTurn({ ...base, sessionId: 'schedule-three', scheduleContext: scheduleContext(15) });
  assert.equal(three.playlist.items.length, 3);
  assert.ok(three.playlist.items.reduce((sum, item) => sum + item.track.durationMs, 0) <= 13 * 60 * 1000);

  const four = await playlistStartTurn({ ...base, sessionId: 'schedule-four', scheduleContext: scheduleContext(24) });
  assert.equal(four.playlist.items.length, 4);

  const five = await playlistStartTurn({ ...base, sessionId: 'schedule-five', scheduleContext: scheduleContext(45) });
  assert.equal(five.playlist.items.length, 5);
});

test('schedule MCP failure falls back to the existing five-track recommendation', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { voiceMode: 'off', scheduleAwareEnabled: true } });
  const playlist = savePlaylist(db, { id: 'schedule-fallback-profile', name: 'Schedule Fallback', trackCount: 5 }, 'created');
  for (let index = 0; index < 5; index += 1) {
    const track = saveTrack(db, {
      id: `schedule-fallback-${index}`,
      originalId: `schedule-fallback-original-${index}`,
      name: `Fallback Song ${index + 1}`,
      artists: [`Fallback Artist ${index + 1}`],
      album: 'Fallback Album'
    });
    linkPlaylistTrack(db, playlist.id, track.id, index);
  }

  const result = await startPlaylistRadio({
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'schedule-fallback-session',
    planning: { source: 'schedule', refresh: true },
    scheduleService: { getForPlanning: async () => { throw new Error('MCP offline'); } }
  });
  assert.equal(result.playlistMode, true);
  assert.equal(result.playlist.items.length, 5);
});

test('playlist jump skips the current item and does not generate host speech', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { voiceMode: 'all' } });
  const playlist = savePlaylist(db, { id: 'jump-profile', name: 'Jump Profile', trackCount: 5 }, 'created');
  for (let index = 0; index < 5; index += 1) {
    const track = saveTrack(db, {
      id: `jump-track-${index}`,
      originalId: `jump-original-${index}`,
      name: `Jump Song ${index + 1}`,
      artists: [`Jump Artist ${index + 1}`],
      album: 'Jump Album'
    });
    linkPlaylistTrack(db, playlist.id, track.id, index);
  }

  const netease = { isConfigured: () => false };
  const config = { llm: {}, tts: {}, weather: {} };
  await playlistStartTurn({ db, config, netease, sessionId: 'playlist-jump-session' });
  const jumped = await playlistJumpTurn({
    db,
    config,
    netease,
    sessionId: 'playlist-jump-session',
    index: 3
  });

  assert.equal(jumped.hostPolicy, 'none');
  assert.equal(jumped.chatText, '');
  assert.equal(jumped.speech.shouldSpeak, false);
  assert.equal(jumped.playlist.currentIndex, 3);
  assert.equal(jumped.playlist.items[0].status, 'skipped');
  assert.equal(jumped.playlist.items[1].status, 'skipped');
  assert.equal(jumped.playlist.items[2].status, 'skipped');
  assert.equal(jumped.playlist.items[3].status, 'current');
  assert.equal(jumped.playlist.hostEvents.find(event => event.type === 'interlude' && event.beforeIndex === 2)?.status, 'skipped');
});

test('concert mode supports 12 tracks, fixed acts, interludes, and curtain stop', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { voiceMode: 'off' } });
  const playlist = savePlaylist(db, { id: 'concert-twelve-profile', name: 'Concert Twelve', trackCount: 12 }, 'created');
  for (let index = 0; index < 12; index += 1) {
    const track = saveTrack(db, {
      id: `concert-twelve-${index}`,
      originalId: `concert-original-${index}`,
      name: `Concert Song ${index + 1}`,
      artists: [`Concert Artist ${index + 1}`],
      album: 'Concert Album'
    });
    linkPlaylistTrack(db, playlist.id, track.id, index);
  }

  const args = {
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'concert-twelve-session'
  };
  const start = await concertStartTurn({
    ...args,
    settings: { length: 12, mood: '深夜', scene: '夜晚独处', audiencePreset: '专业' }
  });

  assert.equal(start.concertMode, true);
  assert.equal(start.concert.items.length, 12);
  assert.deepEqual(start.concert.acts.map(act => [act.startIndex, act.endIndex]), [[0, 2], [3, 5], [6, 8], [9, 11]]);
  assert.equal(start.concertEvent, 'intro');
  const introEvent = start.concert.hostEvents.find(event => event.type === 'intro');
  assert.equal(introEvent.status, 'played');
  assert.ok(introEvent.text.length >= 120 && introEvent.text.length <= 220);
  assert.equal(start.concert.hostEvents.filter(event => event.type === 'interlude').every(event => event.text.length >= 70 && event.text.length <= 140), true);

  let turn = start;
  for (let index = 1; index < 12; index += 1) {
    if ([3, 6, 9].includes(index)) {
      const event = turn.concert.hostEvents.find(item => item.type === 'interlude' && item.beforeIndex === index);
      const interlude = await concertHostTurn({ ...args, eventId: event.id });
      assert.equal(interlude.concertEvent, 'interlude');
      assert.equal(interlude.hostPolicy, 'concert_interlude');
      assert.match(interlude.chatText, new RegExp(`Concert Song ${index + 1}`));
    }
    turn = await concertNextTurn(args);
    assert.equal(turn.concertEvent, 'track');
    assert.equal(turn.hostPolicy, 'none');
  }

  const curtainEvent = turn.concert.hostEvents.find(event => event.type === 'curtain');
  const curtain = await concertHostTurn({ ...args, eventId: curtainEvent.id });
  assert.equal(curtain.track, null);
  assert.equal(curtain.concertEvent, 'curtain');
  assert.equal(curtain.concert.phase, 'curtain');
  const afterCurtain = await concertNextTurn(args);
  assert.equal(afterCurtain.track, null);
  assert.equal(afterCurtain.concert.phase, 'curtain');
  assert.equal(afterCurtain.concertEvent, 'track_end');
});

test('concert replan preserves played items and replaces only the remaining program', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { voiceMode: 'off' } });
  const playlist = savePlaylist(db, { id: 'concert-replan-profile', name: 'Concert Replan', trackCount: 16 }, 'created');
  for (let index = 0; index < 16; index += 1) {
    const track = saveTrack(db, {
      id: `concert-replan-${index}`,
      originalId: `concert-replan-original-${index}`,
      name: `Replan Song ${index + 1}`,
      artists: [`Replan Artist ${index + 1}`],
      album: 'Replan Album'
    });
    linkPlaylistTrack(db, playlist.id, track.id, index);
  }
  const args = {
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'concert-replan-session'
  };
  const start = await concertStartTurn({ ...args, settings: { length: 8 } });
  await concertNextTurn(args);
  const originalPrefix = start.concert.items.slice(0, 2).map(item => item.track.id);
  const replanned = await concertReplanTurn({ ...args, message: '后半场轻快一点' });

  assert.equal(replanned.concert.items.length, 8);
  assert.deepEqual(replanned.concert.items.slice(0, 2).map(item => item.track.id), originalPrefix);
  assert.equal(replanned.concert.currentIndex, 1);
  assert.equal(replanned.concert.items.slice(2).every(item => item.status === 'pending'), true);
  assert.match(replanned.chatText, /重新编排后半场/);
});

test('concert audience is explicitly AI sourced and encore ends without looping', async (t) => {
  const db = testDb(t);
  updatePreferences({ db, payload: { voiceMode: 'off' } });
  const playlist = savePlaylist(db, { id: 'concert-encore-profile', name: 'Concert Encore', trackCount: 7 }, 'created');
  for (let index = 0; index < 7; index += 1) {
    const track = saveTrack(db, {
      id: `concert-encore-${index}`,
      originalId: `concert-encore-original-${index}`,
      name: `Encore Song ${index + 1}`,
      artists: [`Encore Artist ${index + 1}`],
      album: 'Encore Album'
    });
    linkPlaylistTrack(db, playlist.id, track.id, index);
  }
  const args = {
    db,
    config: { llm: {}, tts: {}, weather: {} },
    netease: { isConfigured: () => false },
    sessionId: 'concert-encore-session'
  };
  const start = await concertStartTurn({ ...args, settings: { length: 5, audiencePreset: '热闹' } });
  const audience = await concertAudienceTurn({ ...args, trackId: start.track.id });
  assert.equal(audience.comments.length, 10);
  assert.equal(audience.comments.every(comment => comment.source === 'ai' && comment.persona), true);

  let turn = start;
  for (let index = 1; index < 5; index += 1) turn = await concertNextTurn(args);
  const curtainEvent = turn.concert.hostEvents.find(event => event.type === 'curtain');
  await concertHostTurn({ ...args, eventId: curtainEvent.id });
  const encore = await concertEncoreTurn(args);
  assert.equal(encore.concertEvent, 'encore');
  assert.equal(encore.concert.phase, 'encore');
  assert.equal(encore.concert.items.length, 6);
  const encoreCurtain = encore.concert.hostEvents.find(event => event.type === 'curtain' && event.status === 'pending');
  const finished = await concertHostTurn({ ...args, eventId: encoreCurtain.id });
  assert.equal(finished.track, null);
  assert.equal(finished.concert.phase, 'finished');
  const unavailable = await concertEncoreTurn(args);
  assert.equal(unavailable.ok, false);
});
