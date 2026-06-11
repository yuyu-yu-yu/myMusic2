import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase, nowIso } from '../server/db.mjs';
import {
  buildDailyMusicRecap,
  getDiaryOverview,
  getDiaryRadioContext,
  getDiaryRecommendationContext,
  isLocalDate,
  recordDiarySignalFeedback
} from '../server/music-recap.mjs';

function openTempDb(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-recap-'));
  const db = openDatabase(root);
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return db;
}

function insertTrack(db, id, name, album = 'Electronic Archive') {
  db.prepare(`
    INSERT INTO tracks (id, name, artists, album, cover_url, duration_ms, raw_json, updated_at)
    VALUES (?, ?, ?, ?, '', 180000, '{}', ?)
  `).run(id, name, JSON.stringify(['Test Artist']), album, nowIso());
}

function insertPlay(db, accountId, trackId, playedAt) {
  db.prepare(`
    INSERT INTO plays (account_id, track_id, played_at, source, reason, host_text, report_status)
    VALUES (?, ?, ?, 'radio', 'electronic rhythm', '', 'pending')
  `).run(accountId, trackId, playedAt);
}

function insertFeedback(db, accountId, trackId, eventType, createdAt) {
  db.prepare(`
    INSERT INTO track_feedback_events
      (account_id, track_id, event_type, session_id, elapsed_ms, duration_ms, source, created_at)
    VALUES (?, ?, ?, 'session', 170000, 180000, 'test', ?)
  `).run(accountId, trackId, eventType, createdAt);
}

test('diary overview groups seven days by configured timezone and exposes evidence', (t) => {
  const db = openTempDb(t);
  insertTrack(db, 'track-a', 'Neon Beat');
  insertTrack(db, 'track-b', 'City Electronic');
  insertPlay(db, 'local:default', 'track-a', '2026-06-10T12:30:00.000Z');
  insertPlay(db, 'local:default', 'track-b', '2026-06-10T13:30:00.000Z');
  insertFeedback(db, 'local:default', 'track-a', 'complete', '2026-06-10T12:35:00.000Z');
  insertFeedback(db, 'local:default', 'track-b', 'complete', '2026-06-10T13:35:00.000Z');

  const overview = getDiaryOverview(db, {
    localDate: '2026-06-11',
    date: '2026-06-10',
    timeZone: 'Asia/Shanghai'
  });

  assert.equal(overview.timeline.length, 7);
  assert.equal(overview.selectedDate, '2026-06-10');
  assert.equal(overview.detail.metrics.plays, 2);
  assert.equal(overview.detail.metrics.completed, 2);
  assert.equal(overview.detail.dominantPeriod.id, 'evening');
  assert.equal(overview.detail.tracks[0].localTime.startsWith('21:'), true);
  assert.equal(overview.detail.signals.some(signal => signal.id === 'dominant_listening_period'), true);
  assert.equal(overview.detail.signals.some(signal => signal.id === 'high_completion_day'), true);
  assert.equal(overview.detail.signals.every(signal => Array.isArray(signal.evidence) && signal.evidence.length > 0), true);
});

test('diary feedback is account scoped and immediately filters recommendation context', (t) => {
  const db = openTempDb(t);
  const accountA = { accountId: 'account:a' };
  const accountB = { accountId: 'account:b' };
  insertTrack(db, 'track-a', 'Neon Beat');
  insertTrack(db, 'track-b', 'Pulse Electronic');
  for (const account of [accountA, accountB]) {
    insertPlay(db, account.accountId, 'track-a', '2026-06-10T12:30:00.000Z');
    insertPlay(db, account.accountId, 'track-b', '2026-06-10T13:30:00.000Z');
  }

  let overviewA = getDiaryOverview(db, { accountContext: accountA, localDate: '2026-06-11', date: '2026-06-10' });
  const signal = overviewA.detail.signals.find(item => item.id === 'dominant_listening_period');
  assert.ok(signal);

  recordDiarySignalFeedback(db, {
    accountContext: accountA,
    date: '2026-06-10',
    signalId: signal.id,
    signalType: signal.type,
    action: 'inaccurate'
  });
  overviewA = getDiaryOverview(db, { accountContext: accountA, localDate: '2026-06-11', date: '2026-06-10' });
  const overviewB = getDiaryOverview(db, { accountContext: accountB, localDate: '2026-06-11', date: '2026-06-10' });
  assert.equal(overviewA.detail.signals.find(item => item.id === signal.id).effective, false);
  assert.equal(overviewB.detail.signals.find(item => item.id === signal.id).effective, true);

  recordDiarySignalFeedback(db, {
    accountContext: accountA,
    date: '2026-06-10',
    signalId: signal.id,
    signalType: signal.type,
    action: 'disable'
  });
  assert.equal(getDiaryRecommendationContext(db, { accountContext: accountA, localDate: '2026-06-11' }).disabledSignalTypes.includes(signal.type), true);

  recordDiarySignalFeedback(db, {
    accountContext: accountA,
    date: '2026-06-10',
    signalId: signal.id,
    signalType: signal.type,
    action: 'restore'
  });
  overviewA = getDiaryOverview(db, { accountContext: accountA, localDate: '2026-06-11', date: '2026-06-10' });
  assert.notEqual(overviewA.detail.signals.find(item => item.id === signal.id).status, 'disabled');
});

test('daily recap and diary radio use only effective signals', (t) => {
  const db = openTempDb(t);
  insertTrack(db, 'track-a', 'Neon Beat');
  insertTrack(db, 'track-b', 'Pulse Electronic');
  insertPlay(db, 'local:default', 'track-a', '2026-06-10T12:30:00.000Z');
  insertPlay(db, 'local:default', 'track-b', '2026-06-10T13:30:00.000Z');

  const recap = buildDailyMusicRecap(db, { localDate: '2026-06-11', timeZone: 'Asia/Shanghai' });
  assert.equal(recap.date, '2026-06-10');
  const radioContext = getDiaryRadioContext(db, { date: '2026-06-10', timeZone: 'Asia/Shanghai' });
  assert.match(radioContext.message, /生成 5 首相似状态的歌单/);
  assert.equal(radioContext.signals.length > 0, true);

  const signal = radioContext.signals[0];
  recordDiarySignalFeedback(db, {
    date: '2026-06-10',
    signalId: signal.id,
    signalType: signal.type,
    action: 'disable'
  });
  const nextContext = getDiaryRadioContext(db, { date: '2026-06-10', timeZone: 'Asia/Shanghai' });
  assert.equal(nextContext.signals.some(item => item.type === signal.type), false);
});

test('empty and invalid diary requests do not invent records', (t) => {
  const db = openTempDb(t);
  const overview = getDiaryOverview(db, { localDate: '2026-06-11', date: '2026-06-10' });
  assert.equal(overview.detail.hasActivity, false);
  assert.deepEqual(overview.detail.signals, []);
  assert.equal(getDiaryRadioContext(db, { date: '2026-06-10' }), null);
  assert.equal(isLocalDate('2026-02-31'), false);
  assert.throws(() => getDiaryOverview(db, {
    date: 'bad-date',
    localDate: '2026-06-11'
  }), /YYYY-MM-DD/);
  assert.throws(() => recordDiarySignalFeedback(db, {
    date: 'bad-date',
    signalId: 'low_energy_day',
    signalType: 'energy',
    action: 'accurate'
  }), /YYYY-MM-DD/);
});
