import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../server/db.mjs';
import { applyScheduleContextToSession, getRadioDebugStatus } from '../server/dj.mjs';
import {
  buildScheduleContext,
  createScheduleService,
  getSchedulePlaylistPolicy,
  McpScheduleProvider
} from '../server/schedule.mjs';

const PRIMARY_TOOL = 'calendar.v4.calendar.primary';
const EVENTS_TOOL = 'calendar.v4.calendarEvent.list';
const FREEBUSY_TOOL = 'calendar.v4.freebusy.list';
const WRITE_TOOL = 'calendar.v4.calendarEvent.create';

function tempDb(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-schedule-'));
  const db = openDatabase(root);
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return db;
}

function providerConfig(overrides = {}) {
  return {
    enabled: true,
    command: 'fake-mcp',
    args: ['serve'],
    allowedTools: [PRIMARY_TOOL, EVENTS_TOOL, FREEBUSY_TOOL],
    timeoutMs: 250,
    cacheMs: 5 * 60 * 1000,
    failureCacheMs: 30 * 60 * 1000,
    lookaheadHours: 24,
    ...overrides
  };
}

function toolList() {
  return {
    tools: [
      { name: PRIMARY_TOOL, inputSchema: { type: 'object', properties: {} } },
      {
        name: EVENTS_TOOL,
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'object', properties: { calendar_id: { type: 'string' } } },
            query: {
              type: 'object',
              properties: {
                start_time: { type: 'string' },
                end_time: { type: 'string' },
                page_size: { type: 'number' }
              }
            }
          }
        }
      },
      { name: FREEBUSY_TOOL, inputSchema: { type: 'object', properties: {} } },
      { name: WRITE_TOOL, inputSchema: { type: 'object', properties: {} } }
    ]
  };
}

function primaryResult() {
  return { content: [{ type: 'text', text: JSON.stringify({ data: { calendar: { calendar_id: 'primary-calendar' } } }) }] };
}

function eventResult(now) {
  const start = new Date(now.getTime() + 20 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    structuredContent: {
      data: {
        items: [{
          summary: '高等数学期中考试 - 不得外泄',
          description: '会议正文和复习范围',
          attendees: [{ name: '敏感参与者' }],
          start_time: { timestamp: String(Math.floor(start.getTime() / 1000)) },
          end_time: { timestamp: String(Math.floor(end.getTime() / 1000)) },
          location: { name: '第一教学楼 201' }
        }]
      }
    }
  };
}

test('schedule context classifies locally and exposes no raw event content', () => {
  const now = new Date('2026-06-12T01:00:00.000Z');
  const context = buildScheduleContext([{
    title: '高等数学期中考试 - 不得外泄',
    description: '会议正文和复习范围',
    participants: ['敏感参与者'],
    start: new Date(now.getTime() + 20 * 60 * 1000).toISOString(),
    end: new Date(now.getTime() + 80 * 60 * 1000).toISOString(),
    location: '第一教学楼 201'
  }], { now });

  assert.equal(context.freeWindowMinutes, 20);
  assert.equal(context.nextEventCategory, 'exam');
  assert.equal(context.locationType, 'campus');
  assert.equal(context.transitionType, 'pre_event');
  assert.doesNotMatch(JSON.stringify(context), /高等数学|不得外泄|会议正文|敏感参与者|第一教学楼/);
});

test('schedule playlist policy maps free windows to zero, one, or three-to-five tracks', () => {
  assert.deepEqual(getSchedulePlaylistPolicy({ freeWindowMinutes: 5 }), {
    canStart: false,
    targetLength: 0,
    minLength: 0,
    maxDurationMs: 0,
    reason: 'schedule_window_too_short'
  });
  assert.equal(getSchedulePlaylistPolicy({ freeWindowMinutes: 10 }).targetLength, 1);
  assert.equal(getSchedulePlaylistPolicy({ freeWindowMinutes: 10 }).maxDurationMs, 8 * 60 * 1000);
  assert.equal(getSchedulePlaylistPolicy({ freeWindowMinutes: 15 }).targetLength, 3);
  assert.equal(getSchedulePlaylistPolicy({ freeWindowMinutes: 24 }).targetLength, 4);
  assert.equal(getSchedulePlaylistPolicy({ freeWindowMinutes: 45 }).targetLength, 5);
  assert.equal(getSchedulePlaylistPolicy({ freeWindowMinutes: 45 }).maxDurationMs, 43 * 60 * 1000);
});

test('MCP provider only calls allowed read tools and reuses its five-minute cache', async (t) => {
  const now = new Date('2026-06-12T01:00:00.000Z');
  const calls = [];
  let closeCount = 0;
  const connectionFactory = async () => ({
    client: {
      async listTools() { return toolList(); },
      async callTool(request) {
        calls.push(request);
        if (request.name === PRIMARY_TOOL) return primaryResult();
        if (request.name === EVENTS_TOOL) return eventResult(now);
        throw new Error(`unexpected tool: ${request.name}`);
      }
    },
    async close() { closeCount += 1; }
  });
  const provider = new McpScheduleProvider(providerConfig(), { connectionFactory, now: () => now });
  t.after(() => provider.close());

  const first = await provider.getUpcomingWindow({ date: now });
  const second = await provider.getUpcomingWindow({ date: new Date(now.getTime() + 60 * 1000) });

  assert.equal(first.context.nextEventCategory, 'exam');
  assert.equal(second.cached, true);
  assert.deepEqual(calls.map(call => call.name), [PRIMARY_TOOL, EVENTS_TOOL]);
  assert.equal(provider.getStatus().availableTools.includes(WRITE_TOOL), false);
  assert.equal(calls.some(call => call.name === WRITE_TOOL), false);
  assert.equal(calls[1].arguments.path.calendar_id, 'primary-calendar');
  assert.equal(typeof calls[1].arguments.query.start_time, 'string');
  assert.doesNotMatch(JSON.stringify(first.context), /高等数学|会议正文|敏感参与者/);

  await provider.close();
  assert.equal(closeCount, 1);
});

test('MCP provider reconnects once after a broken connection', async (t) => {
  const now = new Date('2026-06-12T01:00:00.000Z');
  let connectionCount = 0;
  const closed = [];
  const connectionFactory = async () => {
    connectionCount += 1;
    const connectionNumber = connectionCount;
    return {
      client: {
        async listTools() { return toolList(); },
        async callTool(request) {
          if (connectionNumber === 1) throw new Error('connection dropped');
          return request.name === PRIMARY_TOOL ? primaryResult() : eventResult(now);
        }
      },
      async close() { closed.push(connectionNumber); }
    };
  };
  const provider = new McpScheduleProvider(providerConfig(), { connectionFactory, now: () => now });
  t.after(() => provider.close());

  const result = await provider.getUpcomingWindow({ date: now });
  assert.equal(result.context.nextEventCategory, 'exam');
  assert.equal(connectionCount, 2);
  assert.deepEqual(closed, [1]);
});

test('MCP provider times out, closes the connection, and caches the failure', async () => {
  const now = new Date('2026-06-12T01:00:00.000Z');
  let connectionCount = 0;
  let closeCount = 0;
  const provider = new McpScheduleProvider(providerConfig({ timeoutMs: 250, failureCacheMs: 1000 }), {
    now: () => now,
    connectionFactory: async () => {
      connectionCount += 1;
      return {
        client: {
          async listTools() { return toolList(); },
          async callTool() { return new Promise(() => {}); }
        },
        async close() { closeCount += 1; }
      };
    }
  });

  const first = await provider.getUpcomingWindow({ date: now });
  const second = await provider.getUpcomingWindow({ date: new Date(now.getTime() + 100) });
  assert.equal(first.context, null);
  assert.equal(first.errorCode, 'timeout');
  assert.equal(second.errorCode, 'timeout');
  assert.equal(connectionCount, 2);
  assert.equal(closeCount, 2);
});

test('schedule service isolates snapshots by account and persists only sanitized JSON', async (t) => {
  const db = tempDb(t);
  const now = new Date('2026-06-12T01:00:00.000Z');
  let activeContext = buildScheduleContext([{
    title: '产品会议 - 敏感标题',
    start: new Date(now.getTime() + 40 * 60 * 1000).toISOString(),
    end: new Date(now.getTime() + 100 * 60 * 1000).toISOString()
  }], { now });
  const provider = {
    getStatus: () => ({ enabled: true, configured: true, connected: true, status: 'connected', source: 'fake', availableTools: [], errorCode: null }),
    getUpcomingWindow: async () => ({ context: activeContext, cached: false, errorCode: null }),
    close: async () => {}
  };
  const service = createScheduleService({ db, provider, config: { enabled: true } });
  const accountA = { accountId: 'test:schedule:a' };
  const accountB = { accountId: 'test:schedule:b' };

  await service.refresh({ accountContext: accountA, force: true, date: now });
  activeContext = buildScheduleContext([], { now, source: 'fake' });
  await service.refresh({ accountContext: accountB, force: true, date: now });

  const statusA = await service.getStatus({ accountContext: accountA });
  const statusB = await service.getStatus({ accountContext: accountB });
  assert.notEqual(statusA.context.fingerprint, statusB.context.fingerprint);
  assert.equal(statusA.context.nextEventCategory, 'meeting');
  assert.equal(statusB.context.nextEventCategory, 'unknown');

  const rows = db.prepare('SELECT account_id AS accountId, context_json AS contextJson FROM schedule_contexts ORDER BY account_id').all();
  assert.deepEqual(rows.map(row => row.accountId), ['test:schedule:a', 'test:schedule:b']);
  assert.doesNotMatch(JSON.stringify(rows), /产品会议|敏感标题|participants|attendees|description/);
});

test('schedule fingerprint changes invalidate prefetched queue without removing active playback', (t) => {
  const db = tempDb(t);
  const sessionId = 'schedule-queue-session';
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO radio_sessions (id, account_id, created_at, context_json, queue_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    sessionId,
    'local:default',
    createdAt,
    JSON.stringify({ currentTrack: { id: 'playing-now', name: '正在播放' }, externalContextVersion: 2 }),
    JSON.stringify([{ id: 'queued-1', status: 'ready', track: { id: 'next-track', name: '下一首' } }])
  );
  const scheduleContext = {
    source: 'fake',
    fingerprint: 'new-fingerprint',
    fetchedAt: createdAt,
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    freeWindowMinutes: 30,
    nextEventMinutes: 30,
    nextEventCategory: 'class',
    locationType: 'campus',
    dayLoad: 'medium',
    transitionType: 'pre_event'
  };

  const changed = applyScheduleContextToSession(db, sessionId, scheduleContext);
  const row = db.prepare('SELECT context_json AS contextJson, queue_json AS queueJson FROM radio_sessions WHERE id = ?').get(sessionId);
  const context = JSON.parse(row.contextJson);
  const queue = JSON.parse(row.queueJson);
  assert.equal(changed.changed, true);
  assert.equal(context.currentTrack.id, 'playing-now');
  assert.equal(context.externalContextVersion, 3);
  assert.equal(queue[0].status, 'stale');
  assert.equal(queue[0].staleReason, 'schedule_context_changed');

  const debug = getRadioDebugStatus(db, sessionId);
  assert.equal(debug.scheduleContext.fingerprint, 'new-fingerprint');
  assert.equal(debug.externalContextVersion, 3);
  assert.doesNotMatch(JSON.stringify(debug.scheduleContext), /正在播放|下一首/);
});
