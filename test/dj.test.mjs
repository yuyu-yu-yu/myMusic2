import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase, recordTrackFeedback } from '../server/db.mjs';
import { analyzeConversationMood, canProactivelyRecommend, chatTurn, hasExplicitMusicIntent, rankAndSelectCandidates } from '../server/dj.mjs';
import { submitFeedback } from '../server/radio.mjs';

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
  assert.equal(hasExplicitMusicIntent('只是想和你说句话'), false);

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
