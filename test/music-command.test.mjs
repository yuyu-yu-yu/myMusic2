import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileMusicCommand,
  compileMusicCommandFallback,
  MUSIC_COMMAND_ACTIONS,
  MUSIC_VOCAL_POLICIES
} from '../server/music-command.mjs';

test('fallback compiler binds negation to instrumental music', () => {
  const command = compileMusicCommandFallback('不想听纯音乐');

  assert.equal(command.action, MUSIC_COMMAND_ACTIONS.RECOMMEND_AND_PLAY);
  assert.equal(command.vocalPolicy, MUSIC_VOCAL_POLICIES.VOCAL_REQUIRED);
  assert.equal(command.switchNow, true);
  assert.deepEqual(command.constraints, [{
    operation: 'add',
    type: 'vocal',
    value: 'instrumental',
    scope: 'session'
  }]);
  assert.equal(command.targets.searchHints.includes('纯音乐'), false);
});

test('fallback compiler distinguishes vocal and double-negative requests', () => {
  const instrumental = compileMusicCommandFallback('不想听有人声');
  assert.equal(instrumental.vocalPolicy, MUSIC_VOCAL_POLICIES.INSTRUMENTAL_ONLY);
  assert.equal(instrumental.constraints[0].value, 'vocal');

  const vocals = compileMusicCommandFallback('不要没有人声');
  assert.equal(vocals.vocalPolicy, MUSIC_VOCAL_POLICIES.VOCAL_REQUIRED);
  assert.equal(vocals.constraints[0].value, 'instrumental');

  const positive = compileMusicCommandFallback('想听纯音乐');
  assert.equal(positive.vocalPolicy, MUSIC_VOCAL_POLICIES.INSTRUMENTAL_ONLY);
  assert.deepEqual(positive.constraints, []);
});

test('fallback compiler removes only the instrumental restriction', () => {
  const command = compileMusicCommandFallback('可以听纯音乐了');

  assert.equal(command.action, MUSIC_COMMAND_ACTIONS.UPDATE_CONSTRAINTS);
  assert.equal(command.vocalPolicy, MUSIC_VOCAL_POLICIES.ANY);
  assert.deepEqual(command.constraints, [{
    operation: 'remove',
    type: 'vocal',
    value: 'instrumental',
    scope: 'session'
  }]);
});

test('LLM polarity mistakes are corrected before returning the command', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          action: 'recommend_and_play',
          targets: { searchHints: ['纯音乐'] },
          constraints: [],
          vocalPolicy: 'instrumental_only',
          switchNow: true,
          confidence: 0.98,
          normalizedSummary: '推荐纯音乐'
        })
      }
    }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const command = await compileMusicCommand({
    config: {
      llm: {
        baseUrl: 'http://llm.local',
        apiKey: 'test',
        model: 'test-model',
        timeoutMs: 1000
      }
    },
    text: '不想听纯音乐'
  });

  assert.equal(command.source, 'llm');
  assert.equal(command.vocalPolicy, MUSIC_VOCAL_POLICIES.VOCAL_REQUIRED);
  assert.equal(command.constraints[0].value, 'instrumental');
  assert.equal(command.targets.searchHints.includes('纯音乐'), false);
  assert.equal(command.conflictCorrected, true);
});

test('concert future constraints compile as replan without switching current track', () => {
  const command = compileMusicCommandFallback('后面不要纯音乐', {
    activeConcert: { phase: 'playing', currentIndex: 1, items: [{}, {}, {}] }
  });

  assert.equal(command.action, MUSIC_COMMAND_ACTIONS.ADJUST_CONCERT);
  assert.equal(command.switchNow, false);
  assert.equal(command.vocalPolicy, MUSIC_VOCAL_POLICIES.VOCAL_REQUIRED);
});
