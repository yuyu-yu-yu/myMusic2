import { nowIso } from './db.mjs';
import { normalizeAccountContext } from './account-scope.mjs';

export const DEFAULT_RECAP_TIME_ZONE = 'Asia/Shanghai';
export const DIARY_FEEDBACK_ACTIONS = new Set(['accurate', 'inaccurate', 'disable', 'restore']);

const SIGNAL_DEFINITIONS = Object.freeze({
  low_energy_day: { type: 'energy', label: '低能量收听' },
  afternoon_skipped_slow: { type: 'tempo', label: '下午跳过慢歌' },
  evening_electronic_rhythm: { type: 'style', label: '夜间偏好电子与节奏' },
  three_day_energy_lift: { type: 'energy_lift', label: '近期使用音乐提神' },
  dominant_listening_period: { type: 'time_period', label: '主要收听时段' },
  high_completion_day: { type: 'completion', label: '完整收听较多' },
  frequent_skipping_day: { type: 'skip_pattern', label: '跳过行为较多' },
  yesterday_listened: { type: 'activity', label: '昨日收听记录' }
});

const PERIODS = Object.freeze([
  { id: 'morning', label: '上午', start: 6, end: 12 },
  { id: 'afternoon', label: '下午', start: 12, end: 18 },
  { id: 'evening', label: '傍晚', start: 18, end: 22 },
  { id: 'night', label: '夜间', start: 22, end: 30 }
]);

export function buildDailyMusicRecap(db, {
  accountContext = null,
  localDate = '',
  timeZone = DEFAULT_RECAP_TIME_ZONE
} = {}) {
  const currentDate = localDate || zonedDateParts(new Date(), timeZone).localDate;
  const targetDate = shiftLocalDate(currentDate, -1);
  if (!targetDate) return null;
  const model = buildRecapModel(db, {
    accountContext,
    dates: [targetDate, shiftLocalDate(targetDate, -1), shiftLocalDate(targetDate, -2)],
    selectedDate: targetDate,
    timeZone
  });
  const detail = model.detail;
  if (!detail?.hasActivity) return null;
  const signals = detail.signals.filter(signal => signal.effective).slice(0, 4);
  if (!signals.length && detail.metrics.plays > 0) {
    signals.push(applySignalFeedback({
      id: 'yesterday_listened',
      type: SIGNAL_DEFINITIONS.yesterday_listened.type,
      label: SIGNAL_DEFINITIONS.yesterday_listened.label,
      text: `昨天共播放 ${detail.metrics.plays} 首歌曲`,
      evidence: [`${detail.metrics.plays} 条播放记录`],
      confidence: 1
    }, model.feedbackState, targetDate));
  }
  const effectiveSignals = signals.filter(signal => signal.effective);
  if (!effectiveSignals.length) return null;
  return {
    date: targetDate,
    currentDate,
    signals: effectiveSignals,
    openingLine: buildOpeningLine(effectiveSignals),
    recommendationHint: buildRecommendationHint(effectiveSignals),
    trackCount: detail.metrics.plays,
    feedbackCount: detail.metrics.completed + detail.metrics.skipped + detail.metrics.liked,
    generatedAt: nowIso()
  };
}

export function getDiaryOverview(db, {
  accountContext = null,
  days = 7,
  date = '',
  localDate = '',
  timeZone = DEFAULT_RECAP_TIME_ZONE
} = {}) {
  const boundedDays = Math.min(14, Math.max(1, Number(days) || 7));
  const today = localDate || zonedDateParts(new Date(), timeZone).localDate;
  const dates = Array.from({ length: boundedDays }, (_, index) => shiftLocalDate(today, index - boundedDays + 1));
  const requestedDate = String(date || '').trim();
  if (requestedDate && !isLocalDate(requestedDate)) throw new Error('date must use YYYY-MM-DD');
  const historyDates = [...new Set([
    ...dates,
    ...dates.flatMap(item => [shiftLocalDate(item, -1), shiftLocalDate(item, -2)]),
    requestedDate
  ].filter(Boolean))];
  const model = buildRecapModel(db, {
    accountContext,
    dates: historyDates,
    selectedDate: requestedDate || shiftLocalDate(today, -1),
    timeZone
  });
  const timeline = dates.map(item => summarizeDay(model.activity.byDate.get(item) || emptyDay(item), {
    today,
    timeZone,
    activity: model.activity,
    feedbackState: model.feedbackState
  }));
  const fallbackDate = [...timeline].reverse().find(item => item.hasActivity)?.date || shiftLocalDate(today, -1) || today;
  const selectedDate = requestedDate || (timeline.find(item => item.date === shiftLocalDate(today, -1) && item.hasActivity)?.date || fallbackDate);
  const detail = buildDayDetail(model.activity.byDate.get(selectedDate) || emptyDay(selectedDate), {
    today,
    timeZone,
    activity: model.activity,
    feedbackState: model.feedbackState
  });
  return {
    ok: true,
    generatedAt: nowIso(),
    timeZone,
    today,
    selectedDate,
    timeline,
    detail,
    disabledSignalTypes: [...model.feedbackState.disabledTypes]
  };
}

export function recordDiarySignalFeedback(db, {
  accountContext = null,
  date = '',
  signalId = '',
  signalType = '',
  action = ''
} = {}) {
  const account = normalizeAccountContext(accountContext);
  const cleanAction = String(action || '').trim();
  const cleanSignalId = String(signalId || '').trim();
  const definition = SIGNAL_DEFINITIONS[cleanSignalId];
  const cleanSignalType = String(signalType || definition?.type || '').trim();
  if (!DIARY_FEEDBACK_ACTIONS.has(cleanAction)) throw new Error('action must be accurate, inaccurate, disable, or restore');
  if (!isLocalDate(date)) throw new Error('date must use YYYY-MM-DD');
  if (!definition || !cleanSignalType) throw new Error('unknown diary signal');
  const eventDate = cleanAction === 'disable' || cleanAction === 'restore' ? '*' : date;
  db.prepare(`
    INSERT INTO diary_signal_feedback
      (account_id, date, signal_id, signal_type, action, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(account.accountId, eventDate, cleanSignalId, cleanSignalType, cleanAction, nowIso());
  return {
    ok: true,
    date,
    signalId: cleanSignalId,
    signalType: cleanSignalType,
    action: cleanAction
  };
}

export function getDiaryRadioContext(db, {
  accountContext = null,
  date = '',
  timeZone = DEFAULT_RECAP_TIME_ZONE
} = {}) {
  if (!isLocalDate(date)) throw new Error('date must use YYYY-MM-DD');
  const model = buildRecapModel(db, {
    accountContext,
    dates: [date, shiftLocalDate(date, -1), shiftLocalDate(date, -2)],
    selectedDate: date,
    timeZone
  });
  const detail = model.detail;
  if (!detail.hasActivity) return null;
  const signals = detail.signals.filter(signal => signal.effective).slice(0, 4);
  const signalText = signals.map(signal => signal.text).join('；');
  const periodText = detail.dominantPeriod?.label ? `主要收听时段是${detail.dominantPeriod.label}` : '';
  const instruction = [signalText, periodText].filter(Boolean).join('；');
  return {
    date,
    signals,
    detail,
    message: `根据 ${date} 的音乐回顾生成 5 首相似状态的歌单。${instruction || '沿用当天的整体收听节奏'}。不要直接重复当天已经播放的歌曲。`
  };
}

export function getDiaryRecommendationContext(db, {
  accountContext = null,
  localDate = '',
  timeZone = DEFAULT_RECAP_TIME_ZONE
} = {}) {
  const today = localDate || zonedDateParts(new Date(), timeZone).localDate;
  const overview = getDiaryOverview(db, { accountContext, days: 7, localDate: today, timeZone });
  const recentSignals = [...overview.timeline]
    .reverse()
    .flatMap(day => day.signals || [])
    .filter(signal => signal.effective)
    .filter((signal, index, list) => list.findIndex(item => item.type === signal.type && item.text === signal.text) === index)
    .slice(0, 4);
  return {
    signals: recentSignals,
    disabledSignalTypes: overview.disabledSignalTypes,
    updatedAt: overview.generatedAt
  };
}

export function isLocalDate(value = '') {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

function buildRecapModel(db, { accountContext, dates, selectedDate, timeZone }) {
  const account = normalizeAccountContext(accountContext);
  const activity = loadListeningActivity(db, { accountId: account.accountId, dates, timeZone });
  const feedbackState = loadDiaryFeedbackState(db, account.accountId);
  const selectedDay = activity.byDate.get(selectedDate) || emptyDay(selectedDate);
  return {
    account,
    activity,
    feedbackState,
    detail: buildDayDetail(selectedDay, {
      today: zonedDateParts(new Date(), timeZone).localDate,
      timeZone,
      activity,
      feedbackState
    })
  };
}

function loadListeningActivity(db, { accountId, dates = [], timeZone }) {
  const cleanDates = new Set(dates.filter(isLocalDate));
  const byDate = new Map([...cleanDates].map(date => [date, emptyDay(date)]));
  if (!cleanDates.size) return { byDate };
  const earliestDate = [...cleanDates].sort()[0];
  const cutoff = `${shiftLocalDate(earliestDate, -1) || earliestDate}T00:00:00.000Z`;
  db.prepare(`
    SELECT p.track_id AS trackId, p.played_at AS playedAt, p.source, p.reason,
           t.name, t.artists, t.album, t.cover_url AS coverUrl
    FROM plays p
    JOIN tracks t ON t.id = p.track_id
    WHERE p.account_id = ? AND p.played_at >= ?
    ORDER BY p.played_at DESC
    LIMIT 600
  `).all(accountId, cutoff).forEach(row => {
    const date = zonedDateParts(new Date(row.playedAt), timeZone).localDate;
    if (!cleanDates.has(date)) return;
    byDate.get(date).plays.push({ ...row, artists: safeJsonArray(row.artists) });
  });
  db.prepare(`
    SELECT e.track_id AS trackId, e.event_type AS eventType, e.created_at AS createdAt,
           e.elapsed_ms AS elapsedMs, e.duration_ms AS durationMs,
           t.name, t.artists, t.album, t.cover_url AS coverUrl
    FROM track_feedback_events e
    LEFT JOIN tracks t ON t.id = e.track_id
    WHERE e.account_id = ? AND e.created_at >= ?
    ORDER BY e.created_at DESC
    LIMIT 600
  `).all(accountId, cutoff).forEach(row => {
    const date = zonedDateParts(new Date(row.createdAt), timeZone).localDate;
    if (!cleanDates.has(date)) return;
    byDate.get(date).feedback.push({ ...row, artists: safeJsonArray(row.artists) });
  });
  db.prepare(`
    SELECT mood, energy, music_intent AS musicIntent, source, created_at AS createdAt
    FROM mood_events
    WHERE account_id = ? AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT 600
  `).all(accountId, cutoff).forEach(row => {
    const date = zonedDateParts(new Date(row.createdAt), timeZone).localDate;
    if (cleanDates.has(date)) byDate.get(date).moods.push(row);
  });
  return { byDate };
}

function loadDiaryFeedbackState(db, accountId) {
  const rows = db.prepare(`
    SELECT date, signal_id AS signalId, signal_type AS signalType, action, created_at AS createdAt
    FROM diary_signal_feedback
    WHERE account_id = ?
    ORDER BY id ASC
  `).all(accountId);
  const specific = new Map();
  const global = new Map();
  for (const row of rows) {
    if (row.date === '*') global.set(row.signalType, row);
    else specific.set(`${row.date}\u0000${row.signalId}`, row);
  }
  const disabledTypes = new Set([...global.values()].filter(row => row.action === 'disable').map(row => row.signalType));
  return { specific, global, disabledTypes };
}

function summarizeDay(day, context) {
  const detail = buildDayDetail(day, context);
  return {
    date: day.date,
    isToday: day.date === context.today,
    hasActivity: detail.hasActivity,
    metrics: detail.metrics,
    dominantPeriod: detail.dominantPeriod,
    signals: detail.signals
  };
}

function buildDayDetail(day, { today, timeZone, activity, feedbackState }) {
  const periods = PERIODS.map(period => ({ ...period, count: 0 }));
  for (const play of day.plays) {
    const hour = zonedDateParts(new Date(play.playedAt), timeZone).hour;
    const period = periodForHour(hour);
    const bucket = periods.find(item => item.id === period.id);
    if (bucket) bucket.count += 1;
  }
  const metrics = {
    plays: day.plays.length,
    completed: day.feedback.filter(item => item.eventType === 'complete').length,
    skipped: day.feedback.filter(item => item.eventType === 'skip').length,
    liked: day.feedback.filter(item => item.eventType === 'like').length,
    disliked: day.feedback.filter(item => item.eventType === 'dislike').length
  };
  const dominantPeriod = [...periods].sort((a, b) => b.count - a.count)[0];
  const signals = buildSignals(day, { activity, timeZone, dominantPeriod, metrics })
    .map(signal => applySignalFeedback(signal, feedbackState, day.date));
  return {
    date: day.date,
    isToday: day.date === today,
    hasActivity: day.plays.length > 0 || day.feedback.length > 0 || day.moods.length > 0,
    metrics,
    periods: periods.map(({ id, label, count }) => ({ id, label, count })),
    dominantPeriod: dominantPeriod?.count ? { id: dominantPeriod.id, label: dominantPeriod.label, count: dominantPeriod.count } : null,
    signals,
    tracks: buildTrackRows(day, timeZone)
  };
}

function buildSignals(day, { activity, dominantPeriod, metrics, timeZone }) {
  const signals = [];
  const add = (id, text, evidence, confidence = 0.75) => {
    const definition = SIGNAL_DEFINITIONS[id];
    signals.push({ id, type: definition.type, label: definition.label, text, evidence, confidence });
  };
  const lowEnergy = day.moods.filter(item => item.energy === 'low' || ['comfort', 'calm', 'night', 'melancholy', 'healing'].includes(item.mood));
  const highEnergy = day.moods.filter(item => item.energy === 'high' || item.mood === 'energy');
  if (lowEnergy.length >= 2 && lowEnergy.length >= highEnergy.length) {
    add('low_energy_day', '当日收听状态偏低能量', [`${lowEnergy.length} 条低能量或安静情绪记录`], 0.82);
  }
  const afternoonSlowSkips = day.feedback.filter(item => item.eventType === 'skip' && hourFromIso(item.createdAt, timeZone) >= 12 && hourFromIso(item.createdAt, timeZone) < 18 && trackLooksSlow(item));
  if (afternoonSlowSkips.length) add('afternoon_skipped_slow', '下午更常跳过慢歌', afternoonSlowSkips.map(item => `跳过《${item.name || '未知歌曲'}》`).slice(0, 3), 0.86);
  const eveningElectronic = [
    ...day.plays.filter(item => hourFromIso(item.playedAt, timeZone) >= 18 && trackLooksElectronic(item)),
    ...day.feedback.filter(item => ['like', 'complete'].includes(item.eventType) && hourFromIso(item.createdAt, timeZone) >= 18 && trackLooksElectronic(item))
  ];
  if (eveningElectronic.length) add('evening_electronic_rhythm', '夜间更偏好电子或节奏型歌曲', eveningElectronic.map(item => `《${item.name || '未知歌曲'}》`).slice(0, 3), 0.8);
  const recentDates = [day.date, shiftLocalDate(day.date, -1), shiftLocalDate(day.date, -2)];
  const energyDates = recentDates.filter(date => dayHasEnergyLiftSignal(activity.byDate.get(date) || emptyDay(date)));
  if (new Set(energyDates).size >= 2) add('three_day_energy_lift', '最近三天多次使用音乐提神', energyDates.map(date => `${date} 出现高能量或提神信号`), 0.78);
  if (metrics.plays >= 2 && dominantPeriod?.count / metrics.plays >= 0.5) {
    add('dominant_listening_period', `主要收听时段为${dominantPeriod.label}`, [`${metrics.plays} 次播放中有 ${dominantPeriod.count} 次发生在${dominantPeriod.label}`], 0.9);
  }
  if (metrics.completed >= 2 && metrics.completed > metrics.skipped) add('high_completion_day', '完整收听的歌曲多于跳过', [`完整播放 ${metrics.completed} 次`, `跳过 ${metrics.skipped} 次`], 0.95);
  if (metrics.skipped >= 2 && metrics.skipped > metrics.completed) add('frequent_skipping_day', '跳过的歌曲多于完整收听', [`跳过 ${metrics.skipped} 次`, `完整播放 ${metrics.completed} 次`], 0.95);
  return signals;
}

function applySignalFeedback(signal, feedbackState, date) {
  const global = feedbackState.global.get(signal.type);
  const specific = feedbackState.specific.get(`${date}\u0000${signal.id}`);
  const globallyDisabled = global?.action === 'disable';
  const status = globallyDisabled ? 'disabled' : specific?.action === 'inaccurate' ? 'inaccurate' : specific?.action === 'accurate' ? 'accurate' : 'unreviewed';
  return { ...signal, status, effective: status === 'unreviewed' || status === 'accurate' };
}

function buildTrackRows(day, timeZone) {
  const rows = new Map();
  const ensure = item => {
    const id = String(item.trackId || '');
    if (!id) return null;
    if (!rows.has(id)) rows.set(id, {
      id,
      name: item.name || '未知歌曲',
      artists: item.artists || [],
      album: item.album || '',
      coverUrl: item.coverUrl || '',
      events: [],
      occurredAt: item.playedAt || item.createdAt || ''
    });
    return rows.get(id);
  };
  day.plays.forEach(item => {
    const row = ensure(item);
    if (row && !row.events.includes('played')) row.events.push('played');
  });
  day.feedback.forEach(item => {
    const row = ensure(item);
    if (row && !row.events.includes(item.eventType)) row.events.push(item.eventType);
    if (row && new Date(item.createdAt).getTime() > new Date(row.occurredAt).getTime()) row.occurredAt = item.createdAt;
  });
  return [...rows.values()]
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
    .map(row => ({ ...row, localTime: zonedDateParts(new Date(row.occurredAt), timeZone).localTime }));
}

function buildOpeningLine(signals) {
  const texts = signals.map(signal => signal.text).slice(0, 2);
  return texts.length ? `昨天的音乐记录显示：${texts.join('；')}。` : '';
}

function buildRecommendationHint(signals) {
  const ids = new Set(signals.map(signal => signal.id));
  if (ids.has('evening_electronic_rhythm') || ids.has('three_day_energy_lift')) return '近期更偏向节奏清晰的声音，下一次推荐将减少慢歌和过慢的开场。';
  if (ids.has('afternoon_skipped_slow')) return '下午对慢歌的接受度较低，下一次推荐将避免节奏过于拖沓。';
  if (ids.has('low_energy_day')) return '近期状态偏低能量，下一次推荐会优先选择不压迫情绪的歌曲。';
  return signals[0]?.text ? `${signals[0].text}，下一次推荐会将其作为轻量参考。` : '';
}

function periodForHour(hour) {
  if (hour >= 6 && hour < 12) return PERIODS[0];
  if (hour >= 12 && hour < 18) return PERIODS[1];
  if (hour >= 18 && hour < 22) return PERIODS[2];
  return PERIODS[3];
}

function hourFromIso(value, timeZone) {
  if (!value) return -1;
  return zonedDateParts(new Date(value), timeZone).hour;
}

function trackLooksSlow(item = {}) {
  const text = normalizeText(`${item.name || ''} ${item.album || ''} ${item.reason || ''} ${(item.artists || []).join(' ')}`);
  return /慢|安静|舒缓|轻|钢琴|民谣|抒情|睡|calm|slow|piano|acoustic|ballad/.test(text);
}

function trackLooksElectronic(item = {}) {
  const text = normalizeText(`${item.name || ''} ${item.album || ''} ${item.reason || ''} ${(item.artists || []).join(' ')}`);
  return /电子|电音|节奏|律动|合成器|轻电子|dj|edm|beat|electro|electronic|synth|citypop|city pop/.test(text);
}

function dayHasEnergyLiftSignal(day) {
  if (day.moods.some(item => item.energy === 'high' || item.mood === 'energy' || /focus|提神|energy/.test(String(item.musicIntent || item.source || '')))) return true;
  return [...day.plays, ...day.feedback].some(item => /提神|专注|运动|健身|跑步|节奏|电子|energy|focus|workout|beat/.test(normalizeText(`${item.name || ''} ${item.album || ''} ${item.reason || ''}`)));
}

function emptyDay(date) {
  return { date, plays: [], feedback: [], moods: [] };
}

function shiftLocalDate(date, days) {
  if (!isLocalDate(date)) return '';
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return parsed.toISOString().slice(0, 10);
}

function zonedDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).reduce((result, item) => ({ ...result, [item.type]: item.value }), {});
  return {
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localTime: `${parts.hour}:${parts.minute}`,
    hour: Number(parts.hour)
  };
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
