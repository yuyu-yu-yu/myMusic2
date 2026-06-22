import crypto from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getScheduleContext, saveScheduleContext } from './db.mjs';
import { normalizeAccountContext } from './account-scope.mjs';

const DEFAULT_ALLOWED_TOOLS = Object.freeze([
  'calendar.v4.calendar.primary',
  'calendar.v4.calendarEvent.list',
  'calendar.v4.freebusy.list'
]);
const EVENT_CATEGORIES = new Set(['class', 'exam', 'meeting', 'commute', 'personal', 'unknown']);
const LOCATION_TYPES = new Set(['campus', 'online', 'offsite', 'home', 'unknown']);

export function createScheduleProvider(config = {}, options = {}) {
  if (!config.enabled || !config.command || !Array.isArray(config.args) || !config.args.length) {
    return new DisabledScheduleProvider(config);
  }
  return new McpScheduleProvider(config, options);
}

export function createScheduleService({ db, provider, config = {} }) {
  return {
    async getStatus({ accountContext = null } = {}) {
      const account = normalizeAccountContext(accountContext);
      const stored = getScheduleContext(db, account.accountId);
      return {
        ok: true,
        ...provider.getStatus(),
        context: publicScheduleContext(stored?.context || null),
        version: Number(stored?.version || 0),
        cachedAt: stored?.fetchedAt || null,
        expiresAt: stored?.expiresAt || null
      };
    },

    async refresh({ accountContext = null, force = false, date = new Date() } = {}) {
      const account = normalizeAccountContext(accountContext);
      if (!config.enabled) return this.getStatus({ accountContext: account });
      const result = await provider.getUpcomingWindow({ force, date });
      if (!result?.context) {
        return {
          ...(await this.getStatus({ accountContext: account })),
          refreshed: false,
          errorCode: result?.errorCode || provider.getStatus().errorCode || null
        };
      }
      const previous = getScheduleContext(db, account.accountId);
      const changed = previous?.fingerprint !== result.context.fingerprint;
      const version = Math.max(1, Number(previous?.version || 0) + (changed ? 1 : 0));
      const context = normalizeScheduleContext({ ...result.context, version });
      saveScheduleContext(db, {
        accountId: account.accountId,
        context,
        fingerprint: context.fingerprint,
        version,
        fetchedAt: context.fetchedAt,
        expiresAt: context.expiresAt
      });
      return {
        ok: true,
        ...provider.getStatus(),
        refreshed: true,
        changed,
        context: publicScheduleContext(context),
        version,
        cachedAt: context.fetchedAt,
        expiresAt: context.expiresAt,
        errorCode: null
      };
    },

    async getForPlanning({ accountContext = null, refresh = false, date = new Date() } = {}) {
      const account = normalizeAccountContext(accountContext);
      const stored = getScheduleContext(db, account.accountId);
      const expired = !stored?.expiresAt || Date.parse(stored.expiresAt) <= date.getTime();
      if (refresh || expired) {
        const updated = await this.refresh({ accountContext: account, force: refresh, date });
        if (updated.refreshed && updated.context && Date.parse(updated.context.expiresAt) > date.getTime()) {
          return updated.context;
        }
        if (expired) return null;
      }
      return publicScheduleContext(stored?.context || null);
    },

    close() {
      return provider.close();
    }
  };
}

export class McpScheduleProvider {
  constructor(config = {}, { connectionFactory = createStdioConnection, now = () => new Date() } = {}) {
    this.config = normalizeProviderConfig(config);
    this.connectionFactory = connectionFactory;
    this.now = now;
    this.connection = null;
    this.availableTools = new Map();
    this.cache = null;
    this.failure = null;
    this.connecting = null;
    this.status = 'idle';
    this.errorCode = null;
  }

  getStatus() {
    return {
      enabled: true,
      configured: true,
      connected: this.status === 'connected',
      status: this.status,
      source: 'feishu_mcp',
      availableTools: [...this.availableTools.keys()],
      cachedAt: this.cache?.context?.fetchedAt || null,
      expiresAt: this.cache?.context?.expiresAt || null,
      errorCode: this.errorCode
    };
  }

  async getUpcomingWindow({ force = false, date = this.now() } = {}) {
    const nowMs = date.getTime();
    if (!force && this.cache && this.cache.expiresAtMs > nowMs) {
      return { context: this.cache.context, cached: true, errorCode: null };
    }
    if (!force && this.failure && this.failure.expiresAtMs > nowMs) {
      return { context: this.cache?.context || null, cached: Boolean(this.cache), errorCode: this.failure.errorCode };
    }

    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const context = await this.fetchUpcomingWindow(date);
        this.cache = { context, expiresAtMs: Date.parse(context.expiresAt) };
        this.failure = null;
        this.errorCode = null;
        return { context, cached: false, errorCode: null };
      } catch (error) {
        lastError = error;
        await this.resetConnection();
      }
    }
    const errorCode = scheduleErrorCode(lastError);
    this.status = 'error';
    this.errorCode = errorCode;
    this.failure = {
      errorCode,
      expiresAtMs: nowMs + this.config.failureCacheMs
    };
    const validCache = this.cache && this.cache.expiresAtMs > nowMs ? this.cache : null;
    return { context: validCache?.context || null, cached: Boolean(validCache), errorCode };
  }

  async fetchUpcomingWindow(date) {
    const client = await this.ensureConnected();
    const primaryTool = this.availableTools.get(this.config.tools.primary);
    const eventsTool = this.availableTools.get(this.config.tools.events);
    if (!primaryTool || !eventsTool) throw taggedError('required_tools_missing');

    const primaryResult = await this.callTool(client, primaryTool, {});
    const calendarId = extractCalendarId(primaryResult);
    if (!calendarId) throw taggedError('primary_calendar_missing');

    const horizon = new Date(date.getTime() + this.config.lookaheadHours * 60 * 60 * 1000);
    const eventArgs = buildCalendarToolArguments(eventsTool.inputSchema, {
      calendarId,
      start: date,
      end: horizon
    });
    const eventResult = await this.callTool(client, eventsTool, eventArgs);
    const events = extractScheduleEvents(eventResult);
    return buildScheduleContext(events, {
      source: 'feishu_mcp',
      now: date,
      horizon,
      cacheMs: this.config.cacheMs
    });
  }

  async ensureConnected() {
    if (this.connection?.client && this.status === 'connected') return this.connection.client;
    if (this.connecting) return this.connecting;
    this.status = 'connecting';
    this.connecting = withTimeout((async () => {
      const connection = await this.connectionFactory(this.config);
      this.connection = connection;
      try {
        const toolsResult = await withTimeout(
          connection.client.listTools({}, { timeout: this.config.timeoutMs }),
          this.config.timeoutMs,
          'tools_list_timeout'
        );
        const allow = new Set(Object.values(this.config.tools));
        this.availableTools = new Map((toolsResult.tools || [])
          .filter(tool => allow.has(tool.name))
          .map(tool => [tool.name, tool]));
        this.status = 'connected';
        this.errorCode = null;
        return connection.client;
      } catch (error) {
        await this.resetConnection();
        throw error;
      }
    })(), this.config.timeoutMs, 'connect_timeout').finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async callTool(client, tool, args) {
    if (!this.availableTools.has(tool.name)) throw taggedError('tool_not_allowed');
    return withTimeout(
      client.callTool({ name: tool.name, arguments: args }, undefined, { timeout: this.config.timeoutMs }),
      this.config.timeoutMs,
      'tool_timeout'
    );
  }

  async resetConnection() {
    const connection = this.connection;
    this.connection = null;
    this.availableTools = new Map();
    this.status = 'idle';
    if (!connection) return;
    try { await connection.close?.(); } catch {}
  }

  close() {
    return this.resetConnection();
  }
}

class DisabledScheduleProvider {
  constructor(config = {}) {
    this.config = config;
  }

  getStatus() {
    return {
      enabled: Boolean(this.config.enabled),
      configured: false,
      connected: false,
      status: this.config.enabled ? 'not_configured' : 'disabled',
      source: 'feishu_mcp',
      availableTools: [],
      cachedAt: null,
      expiresAt: null,
      errorCode: this.config.enabled ? 'not_configured' : null
    };
  }

  async getUpcomingWindow() {
    return { context: null, cached: false, errorCode: this.getStatus().errorCode };
  }

  async close() {}
}

async function createStdioConnection(config) {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args.map(expandEnvReferences),
    env: buildChildEnvironment(config.env),
    cwd: config.cwd || process.cwd(),
    stderr: 'pipe'
  });
  const client = new Client({ name: 'cancan-radio-schedule', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  return {
    client,
    transport,
    close: async () => {
      try { await client.close(); } catch {}
      try { await transport.close(); } catch {}
    }
  };
}

function normalizeProviderConfig(config = {}) {
  const tools = Array.isArray(config.allowedTools) && config.allowedTools.length
    ? config.allowedTools
    : DEFAULT_ALLOWED_TOOLS;
  return {
    command: String(config.command || '').trim(),
    args: Array.isArray(config.args) ? config.args.map(String) : [],
    env: config.env && typeof config.env === 'object' ? config.env : {},
    cwd: String(config.cwd || '').trim(),
    timeoutMs: Math.max(250, Number(config.timeoutMs || 2500)),
    cacheMs: Math.max(1000, Number(config.cacheMs || 5 * 60 * 1000)),
    failureCacheMs: Math.max(1000, Number(config.failureCacheMs || 30 * 60 * 1000)),
    lookaheadHours: Math.max(1, Math.min(72, Number(config.lookaheadHours || 24))),
    tools: {
      primary: tools[0] || DEFAULT_ALLOWED_TOOLS[0],
      events: tools[1] || DEFAULT_ALLOWED_TOOLS[1],
      freebusy: tools[2] || DEFAULT_ALLOWED_TOOLS[2]
    }
  };
}

export function buildScheduleContext(rawEvents = [], {
  source = 'schedule',
  now = new Date(),
  horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000),
  cacheMs = 5 * 60 * 1000
} = {}) {
  const events = rawEvents
    .map(normalizeRawEvent)
    .filter(Boolean)
    .filter(event => event.end.getTime() > now.getTime() && event.start.getTime() < horizon.getTime())
    .sort((a, b) => a.start - b.start);
  const merged = mergeBusyIntervals(events);
  const current = events.find(event => event.start <= now && event.end > now) || null;
  const next = current || events.find(event => event.start > now) || null;
  const nextStartMs = next ? Math.max(now.getTime(), next.start.getTime()) : horizon.getTime();
  const freeWindowMinutes = current ? 0 : Math.max(0, Math.floor((nextStartMs - now.getTime()) / 60000));
  const nextEventMinutes = next ? Math.max(0, Math.floor((next.start.getTime() - now.getTime()) / 60000)) : null;
  const todayEnd = endOfLocalDay(now);
  const busyMinutes = merged.reduce((total, interval) => {
    const start = Math.max(now.getTime(), interval.start.getTime());
    const end = Math.min(todayEnd.getTime(), interval.end.getTime());
    return total + Math.max(0, end - start) / 60000;
  }, 0);
  const nextEventCategory = EVENT_CATEGORIES.has(next?.category) ? next.category : 'unknown';
  const locationType = LOCATION_TYPES.has(next?.locationType) ? next.locationType : 'unknown';
  const base = {
    source: String(source || 'schedule').slice(0, 40),
    freeWindowMinutes: Math.min(24 * 60, freeWindowMinutes),
    nextEventMinutes,
    nextEventCategory,
    locationType,
    dayLoad: busyMinutes >= 300 ? 'heavy' : busyMinutes >= 120 ? 'medium' : 'light',
    transitionType: inferTransitionType({ current, next, now, nextEventCategory })
  };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex').slice(0, 16);
  return normalizeScheduleContext({
    ...base,
    fingerprint,
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + cacheMs).toISOString()
  });
}

export function getSchedulePlaylistPolicy(context = null) {
  const freeMinutes = Math.max(0, Number(context?.freeWindowMinutes || 0));
  if (freeMinutes < 6) {
    return { canStart: false, targetLength: 0, minLength: 0, maxDurationMs: 0, reason: 'schedule_window_too_short' };
  }
  const maxDurationMs = Math.max(0, Math.floor((freeMinutes - 2) * 60 * 1000));
  if (freeMinutes < 15) {
    return { canStart: true, targetLength: 1, minLength: 1, maxDurationMs, reason: 'schedule_single_track' };
  }
  const targetLength = freeMinutes < 22 ? 3 : freeMinutes < 30 ? 4 : 5;
  return { canStart: true, targetLength, minLength: 3, maxDurationMs, reason: 'schedule_playlist' };
}

export function scheduleMoodSignal(context = null) {
  if (!context) return null;
  const category = context.nextEventCategory;
  if (['class', 'exam', 'meeting'].includes(category)) {
    return {
      mood: 'focus',
      energy: category === 'exam' ? 'medium' : 'low',
      reason: `距离下一项${scheduleCategoryLabel(category)}还有 ${context.nextEventMinutes ?? 0} 分钟，先保持稳定专注`,
      preferenceHints: ['稳定', '专注', '熟悉'],
      searchHints: ['专注', '低干扰']
    };
  }
  if (category === 'commute' || context.transitionType === 'commute') {
    return {
      mood: 'energy',
      energy: 'medium',
      reason: '正在进入通勤或场地转换时段，节奏可以稍微提起来',
      preferenceHints: ['有节奏', '通勤'],
      searchHints: ['通勤', '提神']
    };
  }
  return null;
}

export function publicScheduleContext(context = null) {
  if (!context) return null;
  const normalized = normalizeScheduleContext(context);
  return {
    source: normalized.source,
    fingerprint: normalized.fingerprint,
    fetchedAt: normalized.fetchedAt,
    expiresAt: normalized.expiresAt,
    freeWindowMinutes: normalized.freeWindowMinutes,
    nextEventMinutes: normalized.nextEventMinutes,
    nextEventCategory: normalized.nextEventCategory,
    locationType: normalized.locationType,
    dayLoad: normalized.dayLoad,
    transitionType: normalized.transitionType,
    version: normalized.version
  };
}

export function normalizeScheduleContext(context = {}) {
  const nextEventMinutes = context.nextEventMinutes === null || context.nextEventMinutes === undefined
    ? null
    : Math.max(0, Math.min(7 * 24 * 60, Number(context.nextEventMinutes) || 0));
  return {
    source: String(context.source || 'schedule').slice(0, 40),
    fingerprint: String(context.fingerprint || '').slice(0, 64),
    fetchedAt: validIso(context.fetchedAt),
    expiresAt: validIso(context.expiresAt),
    freeWindowMinutes: Math.max(0, Math.min(24 * 60, Number(context.freeWindowMinutes) || 0)),
    nextEventMinutes,
    nextEventCategory: EVENT_CATEGORIES.has(context.nextEventCategory) ? context.nextEventCategory : 'unknown',
    locationType: LOCATION_TYPES.has(context.locationType) ? context.locationType : 'unknown',
    dayLoad: ['light', 'medium', 'heavy'].includes(context.dayLoad) ? context.dayLoad : 'light',
    transitionType: ['busy', 'pre_event', 'between_events', 'commute', 'open_block'].includes(context.transitionType)
      ? context.transitionType
      : 'open_block',
    version: Math.max(0, Number(context.version || 0))
  };
}

function normalizeRawEvent(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const start = parseEventDate(raw.start || raw.start_time || raw.startTime || raw.begin_time || raw.beginTime);
  const end = parseEventDate(raw.end || raw.end_time || raw.endTime || raw.finish_time || raw.finishTime);
  if (!start || !end || end <= start) return null;
  const title = String(raw.summary || raw.subject || raw.title || raw.name || '').slice(0, 300);
  const location = readLocation(raw.location || raw.event_location || raw.location_name || '');
  return {
    start,
    end,
    category: classifyEventCategory(title),
    locationType: classifyLocationType(location, title)
  };
}

export function classifyEventCategory(title = '') {
  const text = String(title || '').toLowerCase();
  if (/考试|测验|期中|期末|答辩|考核|exam|quiz|test|midterm|final/.test(text)) return 'exam';
  if (/上课|课程|讲座|实验课|讨论课|自习|class|lecture|seminar|course|lab\b|tutorial/.test(text)) return 'class';
  if (/会议|例会|面试|评审|同步|沟通|meeting|interview|review|sync/.test(text)) return 'meeting';
  if (/通勤|出发|赶路|乘车|地铁|公交|航班|火车|commute|travel|flight|train/.test(text)) return 'commute';
  if (/吃饭|午餐|晚餐|锻炼|健身|购物|约会|休息|生日|lunch|dinner|gym|workout|personal/.test(text)) return 'personal';
  return 'unknown';
}

export function classifyLocationType(location = '', title = '') {
  const text = `${location} ${title}`.toLowerCase();
  if (/线上|腾讯会议|飞书会议|zoom|teams|online|meet\.google/.test(text)) return 'online';
  if (/宿舍|家里|在家|home|dorm/.test(text)) return 'home';
  if (/教学楼|实验楼|图书馆|校区|学院|教室|校园|campus|classroom|library/.test(text)) return 'campus';
  if (String(location || '').trim()) return 'offsite';
  return 'unknown';
}

function extractScheduleEvents(result) {
  const parsed = parseToolResult(result);
  const arrays = [];
  collectArrays(parsed, arrays);
  const candidates = arrays
    .filter(items => items.some(item => item && typeof item === 'object' && hasEventTime(item)))
    .sort((a, b) => b.length - a.length);
  return candidates[0] || [];
}

function extractCalendarId(result) {
  const parsed = parseToolResult(result);
  return findFirstValue(parsed, new Set(['calendar_id', 'calendarId', 'id']), value => typeof value === 'string' && value.length > 2);
}

function parseToolResult(result) {
  if (result?.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
  for (const item of result?.content || []) {
    if (item?.type !== 'text') continue;
    try { return JSON.parse(item.text); } catch {}
  }
  return result || {};
}

function buildCalendarToolArguments(schema = {}, { calendarId, start, end }) {
  const startSeconds = String(Math.floor(start.getTime() / 1000));
  const endSeconds = String(Math.floor(end.getTime() / 1000));
  const values = {
    calendar_id: calendarId,
    calendarId,
    start_time: startSeconds,
    startTime: startSeconds,
    time_min: start.toISOString(),
    timeMin: start.toISOString(),
    end_time: endSeconds,
    endTime: endSeconds,
    time_max: end.toISOString(),
    timeMax: end.toISOString(),
    page_size: 100,
    pageSize: 100
  };
  return fillKnownSchemaValues(schema, values);
}

function fillKnownSchemaValues(schema = {}, values = {}) {
  if (!schema || typeof schema !== 'object') return {};
  const result = {};
  for (const [key, childSchema] of Object.entries(schema.properties || {})) {
    if (Object.hasOwn(values, key)) {
      result[key] = values[key];
      continue;
    }
    if (childSchema?.type === 'object' || childSchema?.properties) {
      const nested = fillKnownSchemaValues(childSchema, values);
      if (Object.keys(nested).length) result[key] = nested;
    }
  }
  return result;
}

function parseEventDate(value) {
  if (value && typeof value === 'object') {
    value = value.timestamp ?? value.time_stamp ?? value.timeStamp ?? value.datetime ?? value.date_time ?? value.dateTime ?? value.date;
  }
  if (value === null || value === undefined || value === '') return null;
  if (/^\d{10}$/.test(String(value))) return new Date(Number(value) * 1000);
  if (/^\d{13}$/.test(String(value))) return new Date(Number(value));
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readLocation(value) {
  if (typeof value === 'string') return value.slice(0, 300);
  if (!value || typeof value !== 'object') return '';
  return String(value.name || value.display_name || value.address || value.location || '').slice(0, 300);
}

function hasEventTime(item) {
  return Boolean(item.start || item.start_time || item.startTime) && Boolean(item.end || item.end_time || item.endTime);
}

function collectArrays(value, output, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    output.push(value);
    for (const item of value) collectArrays(item, output, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  for (const nested of Object.values(value)) collectArrays(nested, output, depth + 1);
}

function findFirstValue(value, keys, predicate, depth = 0) {
  if (depth > 8 || !value || typeof value !== 'object') return null;
  for (const [key, nested] of Object.entries(value)) {
    if (keys.has(key) && predicate(nested)) return nested;
  }
  for (const nested of Object.values(value)) {
    const found = findFirstValue(nested, keys, predicate, depth + 1);
    if (found !== null && found !== undefined) return found;
  }
  return null;
}

function mergeBusyIntervals(events) {
  const merged = [];
  for (const event of events) {
    const last = merged.at(-1);
    if (!last || event.start > last.end) {
      merged.push({ start: event.start, end: event.end });
    } else if (event.end > last.end) {
      last.end = event.end;
    }
  }
  return merged;
}

function inferTransitionType({ current, next, now, nextEventCategory }) {
  if (current) return 'busy';
  if (nextEventCategory === 'commute') return 'commute';
  if (next && next.start.getTime() - now.getTime() <= 30 * 60 * 1000) return 'pre_event';
  return 'open_block';
}

function endOfLocalDay(date) {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function scheduleCategoryLabel(category) {
  return { class: '课程', exam: '考试', meeting: '会议' }[category] || '安排';
}

function buildChildEnvironment(extra = {}) {
  const inherited = { ...process.env };
  for (const [key, value] of Object.entries(extra)) inherited[key] = expandEnvReferences(String(value));
  return inherited;
}

function expandEnvReferences(value) {
  return String(value).replace(/\$\{([A-Z0-9_]+)\}/gi, (_, key) => process.env[key] || '');
}

function validIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function taggedError(code) {
  return Object.assign(new Error(code), { code });
}

function scheduleErrorCode(error) {
  const value = String(error?.code || error?.message || 'mcp_unavailable').toLowerCase();
  if (value.includes('timeout')) return 'timeout';
  if (value.includes('required_tools_missing')) return 'required_tools_missing';
  if (value.includes('primary_calendar_missing')) return 'primary_calendar_missing';
  if (value.includes('tool_not_allowed')) return 'tool_not_allowed';
  return 'mcp_unavailable';
}

function withTimeout(promise, timeoutMs, code) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(taggedError(code)), timeoutMs);
      timer.unref?.();
    })
  ]).finally(() => clearTimeout(timer));
}
