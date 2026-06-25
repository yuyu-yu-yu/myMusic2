import crypto from 'node:crypto';

const QUEUE_TTL_MS = 10 * 60 * 1000;
const QUEUE_LIMIT = 2;
const PLAYLIST_SIZE = 5;
const CONCERT_LENGTHS = new Set([5, 8, 12]);
const RECENT_WINDOW = 8;

export async function edgeRadioTurn({ ctx, payload = {}, source = 'start', library, resolveTrack, hostLine, maybeSpeech, saveState }) {
  const sessionId = payload.sessionId || crypto.randomUUID();
  const session = ensureSession(ctx, sessionId);
  session.mode = 'single';

  const queued = source === 'next' ? consumeReadyQueue(session, ctx, payload) : null;
  const selected = queued || selectTrackPlan({ ctx, session, payload, tracks: library.tracks, source });
  const playable = await resolveTrack(selected.track);
  const chatText = await hostLine(ctx, playable, payload.message || '', source);
  const ttsUrl = await maybeSpeech(ctx, chatText, 'recommendation');

  recordPlay(ctx, session, playable, source, chatText);
  updateRadioDebug(session, selected, playable);
  await saveState(ctx);

  return radioResponse({
    ctx,
    sessionId,
    track: playable,
    chatText,
    ttsUrl,
    source,
    session
  });
}

export async function edgePrefetchRadio({ ctx, payload = {}, library, resolveTrack, saveState }) {
  const sessionId = payload.sessionId || crypto.randomUUID();
  const session = ensureSession(ctx, sessionId);
  session.mode = session.mode || 'single';
  pruneQueue(session);
  const hasReady = session.queue.some(item => item.status === 'ready');
  if (hasReady && !payload.force) {
    await saveState(ctx);
    return {
      ok: true,
      queued: true,
      reused: true,
      sessionId,
      queue: publicQueue(session.queue),
      queueMetrics: normalizeQueueMetrics(session.queueMetrics),
      runtime: 'edgeone'
    };
  }

  const selected = selectTrackPlan({ ctx, session, payload, tracks: library.tracks, source: 'prefetch', excludeIds: session.queue.map(item => item.track?.id) });
  const playable = await resolveTrack(selected.track);
  const item = {
    id: crypto.randomUUID(),
    status: 'ready',
    track: minimalTrack(playable),
    reason: selected.reason,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + QUEUE_TTL_MS).toISOString(),
    musicContext: selected.musicContext,
    diagnostics: selected.diagnostics
  };
  session.queue = [...session.queue.filter(entry => entry.status !== 'ready'), item].slice(-QUEUE_LIMIT);
  session.radioDebug = {
    ...session.radioDebug,
    updatedAt: nowIso(),
    musicContext: selected.musicContext,
    lastSongPlan: selected.lastSongPlan,
    lastSearchDiagnostics: selected.diagnostics
  };
  await saveState(ctx);
  return {
    ok: true,
    queued: true,
    reused: false,
    sessionId,
    item: publicQueueItem(item),
    queue: publicQueue(session.queue),
    queueMetrics: normalizeQueueMetrics(session.queueMetrics),
    runtime: 'edgeone'
  };
}

export function edgeRadioDebug({ ctx, sessionId = '' }) {
  const session = ensureSession(ctx, sessionId || crypto.randomUUID());
  return {
    ok: true,
    sessionId: session.id,
    runtime: 'edgeone',
    updatedAt: session.radioDebug?.updatedAt || session.updatedAt,
    queue: publicQueue(session.queue),
    queueMetrics: normalizeQueueMetrics(session.queueMetrics),
    musicContext: session.radioDebug?.musicContext || session.musicContext || {},
    lastSongPlan: session.radioDebug?.lastSongPlan || null,
    lastSearchDiagnostics: session.radioDebug?.lastSearchDiagnostics || [],
    lastRecommendationFailure: session.radioDebug?.lastRecommendationFailure || null,
    lastTtsDiagnostics: session.radioDebug?.lastTtsDiagnostics || null,
    sessionConstraints: session.sessionConstraints || { rules: [] }
  };
}

export async function edgeConcertStart({ ctx, payload = {}, library, resolveTrack, hostLine, maybeSpeech, saveState }) {
  const sessionId = payload.sessionId || crypto.randomUUID();
  const session = ensureSession(ctx, sessionId);
  const settings = normalizeConcertSettings(payload.settings);
  const plan = buildTrackProgram({ ctx, session, payload, tracks: library.tracks, length: settings.length, source: 'concert' });
  const concert = buildConcertProgram({ tracks: plan.tracks, settings, playlistMode: false, message: payload.message });
  session.mode = 'concert';
  session.activeConcert = concert;
  session.queue = [];
  session.radioDebug = {
    ...session.radioDebug,
    updatedAt: nowIso(),
    musicContext: plan.musicContext,
    lastSongPlan: plan.lastSongPlan,
    lastSearchDiagnostics: plan.diagnostics
  };

  const currentItem = concert.items[0];
  const playable = await resolveTrack(currentItem.track);
  currentItem.track = minimalTrack(playable);
  const chatText = await hostLine(ctx, playable, payload.message || settings.note || '', 'concert_start');
  markHostEventPlayed(concert, 'intro', chatText);
  const ttsUrl = await maybeSpeech(ctx, chatText, 'recommendation');
  recordPlay(ctx, session, playable, 'concert', chatText);
  await saveState(ctx);
  return concertResponse({ ctx, sessionId, concert, track: playable, chatText, ttsUrl, event: 'start' });
}

export async function edgeConcertNext({ ctx, payload = {}, library, resolveTrack, hostLine, maybeSpeech, saveState }) {
  const sessionId = payload.sessionId || crypto.randomUUID();
  const session = ensureSession(ctx, sessionId);
  const concert = session.activeConcert;
  if (!concert?.items?.length) {
    return await edgeConcertStart({ ctx, payload, library, resolveTrack, hostLine, maybeSpeech, saveState });
  }
  const nextIndex = Math.min(concert.items.length, Number(concert.currentIndex || 0) + 1);
  if (nextIndex >= concert.items.length) {
    concert.phase = 'curtain';
    concert.currentIndex = concert.items.length - 1;
    await saveState(ctx);
    return concertResponse({
      ctx,
      sessionId,
      concert,
      track: null,
      chatText: '这场节目单已经播完，感谢收听灿灿校园电台。',
      ttsUrl: null,
      event: 'curtain',
      hostPolicy: 'none'
    });
  }
  setProgramCurrent(concert, nextIndex, { skippedBefore: false });
  const item = concert.items[nextIndex];
  const playable = await resolveTrack(item.track);
  item.track = minimalTrack(playable);
  const chatText = concert.playlistMode ? '' : await hostLine(ctx, playable, '', 'concert_next');
  const ttsUrl = concert.playlistMode ? null : await maybeSpeech(ctx, chatText, 'recommendation');
  recordPlay(ctx, session, playable, concert.playlistMode ? 'playlist' : 'concert', chatText);
  await saveState(ctx);
  return concertResponse({ ctx, sessionId, concert, track: playable, chatText, ttsUrl, event: 'next', hostPolicy: concert.playlistMode ? 'none' : 'auto' });
}

export async function edgeConcertJump({ ctx, payload = {}, resolveTrack, hostLine, maybeSpeech, saveState }) {
  const sessionId = payload.sessionId || crypto.randomUUID();
  const session = ensureSession(ctx, sessionId);
  const concert = session.activeConcert;
  const index = Number(payload.index);
  if (!concert?.items?.[index]) return apiError(404, 'concert_item_not_found', 'Concert item not found.');
  setProgramCurrent(concert, index, { skippedBefore: true });
  const item = concert.items[index];
  const playable = await resolveTrack(item.track);
  item.track = minimalTrack(playable);
  const chatText = concert.playlistMode ? '' : await hostLine(ctx, playable, '', 'concert_jump');
  const ttsUrl = concert.playlistMode ? null : await maybeSpeech(ctx, chatText, 'recommendation');
  recordPlay(ctx, session, playable, concert.playlistMode ? 'playlist_jump' : 'concert_jump', chatText);
  await saveState(ctx);
  return concertResponse({ ctx, sessionId, concert, track: playable, chatText, ttsUrl, event: 'jump', hostPolicy: concert.playlistMode ? 'none' : 'auto' });
}

export async function edgeConcertHost({ ctx, payload = {}, maybeSpeech, saveState }) {
  const sessionId = payload.sessionId || crypto.randomUUID();
  const session = ensureSession(ctx, sessionId);
  const concert = session.activeConcert;
  const event = concert?.hostEvents?.find(item => String(item.id) === String(payload.eventId));
  if (!concert || !event) return apiError(404, 'concert_host_event_not_found', 'Concert host event not found.');
  event.status = 'played';
  event.playedAt = nowIso();
  if (event.type === 'curtain') {
    concert.phase = 'curtain';
  }
  const chatText = event.text || buildHostEventText(event, concert);
  event.text = chatText;
  const ttsUrl = await maybeSpeech(ctx, chatText, 'recommendation');
  await saveState(ctx);
  return concertResponse({
    ctx,
    sessionId,
    concert,
    track: null,
    chatText,
    ttsUrl,
    event: event.type === 'curtain' ? 'curtain' : 'host',
    hostPolicy: 'speak'
  });
}

export async function edgeConcertReplan({ ctx, payload = {}, library, saveState }) {
  const sessionId = payload.sessionId || crypto.randomUUID();
  const session = ensureSession(ctx, sessionId);
  const concert = session.activeConcert;
  if (!concert?.items?.length) {
    return apiError(404, 'concert_not_found', 'Concert session not found.');
  }
  const keepUntil = Math.max(0, Number(concert.currentIndex || 0));
  const kept = concert.items.slice(0, keepUntil + 1).map((item, index) => ({ ...item, index }));
  const remaining = Math.max(0, concert.items.length - kept.length);
  const excludeIds = kept.map(item => item.track?.id).filter(Boolean);
  const plan = buildTrackProgram({ ctx, session, payload, tracks: library.tracks, length: remaining, source: 'concert_replan', excludeIds });
  const additions = plan.tracks.map((track, offset) => ({
    id: crypto.randomUUID(),
    index: kept.length + offset,
    status: 'pending',
    track: minimalTrack(track),
    reason: reasonForTrack(track, plan.musicContext)
  }));
  concert.items = [...kept, ...additions].map((item, index) => ({ ...item, index }));
  concert.summary = payload.message ? `已按“${String(payload.message).slice(0, 36)}”调整后半场` : '后半场节目单已重新编排';
  concert.hostEvents = buildHostEvents(concert.items.length, concert.playlistMode, concert.hostEvents?.[0]?.text);
  concert.updatedAt = nowIso();
  session.radioDebug = {
    ...session.radioDebug,
    updatedAt: nowIso(),
    musicContext: plan.musicContext,
    lastSongPlan: plan.lastSongPlan,
    lastSearchDiagnostics: plan.diagnostics
  };
  await saveState(ctx);
  return concertResponse({ ctx, sessionId, concert, track: null, chatText: concert.summary, ttsUrl: null, event: 'replan', hostPolicy: 'none' });
}

export async function edgeConcertEncore({ ctx, payload = {}, library, resolveTrack, hostLine, maybeSpeech, saveState }) {
  const sessionId = payload.sessionId || crypto.randomUUID();
  const session = ensureSession(ctx, sessionId);
  const concert = session.activeConcert;
  if (!concert?.items?.length) return apiError(404, 'concert_not_found', 'Concert session not found.');
  if (concert.encoreUsed) return apiError(409, 'encore_already_used', 'Encore has already been used.');
  const excludeIds = concert.items.map(item => item.track?.id).filter(Boolean);
  const plan = buildTrackProgram({ ctx, session, payload, tracks: library.tracks, length: 1, source: 'concert_encore', excludeIds });
  const track = plan.tracks[0] || library.tracks[0];
  const index = concert.items.length;
  concert.items.forEach(item => {
    if (item.status === 'current') item.status = 'played';
  });
  concert.items.push({
    id: crypto.randomUUID(),
    index,
    status: 'current',
    track: minimalTrack(track),
    reason: '返场曲目'
  });
  concert.currentIndex = index;
  concert.phase = 'encore';
  concert.encoreUsed = true;
  concert.updatedAt = nowIso();
  const playable = await resolveTrack(track);
  concert.items[index].track = minimalTrack(playable);
  const chatText = await hostLine(ctx, playable, '返场', 'concert_encore');
  const ttsUrl = await maybeSpeech(ctx, chatText, 'recommendation');
  recordPlay(ctx, session, playable, 'concert_encore', chatText);
  await saveState(ctx);
  return concertResponse({ ctx, sessionId, concert, track: playable, chatText, ttsUrl, event: 'encore' });
}

export async function edgeConcertAudience({ ctx, payload = {}, saveState }) {
  const sessionId = payload.sessionId || crypto.randomUUID();
  const session = ensureSession(ctx, sessionId);
  const concert = session.activeConcert;
  const trackId = String(payload.trackId || '');
  const item = concert?.items?.find(entry => String(entry.track?.id) === trackId || String(entry.track?.originalId) === trackId);
  const track = item?.track || { id: trackId, name: '当前曲目', artists: [] };
  const comments = buildAudienceComments(track, concert);
  session.radioDebug = { ...session.radioDebug, updatedAt: nowIso(), lastAudienceTrackId: trackId };
  await saveState(ctx);
  return { ok: true, sessionId, comments, concertMode: true, runtime: 'edgeone' };
}

export async function edgePlaylistStart({ ctx, payload = {}, library, resolveTrack, saveState }) {
  const sessionId = payload.sessionId || crypto.randomUUID();
  const session = ensureSession(ctx, sessionId);
  const plan = buildTrackProgram({ ctx, session, payload, tracks: library.tracks, length: PLAYLIST_SIZE, source: 'playlist' });
  const concert = buildConcertProgram({
    tracks: plan.tracks,
    settings: { length: PLAYLIST_SIZE, scene: 'playlist', mood: 'auto', genres: [], note: '' },
    playlistMode: true,
    message: payload.message || 'playlist'
  });
  session.mode = 'playlist';
  session.activeConcert = concert;
  session.queue = [];
  session.radioDebug = {
    ...session.radioDebug,
    updatedAt: nowIso(),
    musicContext: plan.musicContext,
    lastSongPlan: plan.lastSongPlan,
    lastSearchDiagnostics: plan.diagnostics
  };
  const currentItem = concert.items[0];
  const playable = await resolveTrack(currentItem.track);
  currentItem.track = minimalTrack(playable);
  recordPlay(ctx, session, playable, 'playlist', 'playlist start');
  await saveState(ctx);
  return concertResponse({
    ctx,
    sessionId,
    concert,
    track: playable,
    chatText: '已为你排好一组连续播放的歌单。',
    ttsUrl: null,
    event: 'playlist_start',
    hostPolicy: 'none',
    playlistMode: true
  });
}

export async function edgePlaylistNext(args) {
  return await edgeConcertNext(args);
}

export async function edgePlaylistJump(args) {
  return await edgeConcertJump(args);
}

export function ensureSession(ctx, sessionId) {
  if (!ctx.state.sessions || typeof ctx.state.sessions !== 'object') ctx.state.sessions = {};
  const id = String(sessionId || '').trim() || crypto.randomUUID();
  const existing = ctx.state.sessions[id] || {};
  const session = {
    id,
    createdAt: existing.createdAt || nowIso(),
    updatedAt: nowIso(),
    mode: existing.mode || 'single',
    currentTrackId: existing.currentTrackId || '',
    queue: Array.isArray(existing.queue) ? existing.queue : [],
    queueMetrics: normalizeQueueMetrics(existing.queueMetrics || {}),
    radioDebug: existing.radioDebug && typeof existing.radioDebug === 'object' ? existing.radioDebug : {},
    musicContext: existing.musicContext && typeof existing.musicContext === 'object' ? existing.musicContext : {},
    sessionConstraints: existing.sessionConstraints && typeof existing.sessionConstraints === 'object' ? existing.sessionConstraints : { rules: [] },
    activeConcert: normalizeProgram(existing.activeConcert)
  };
  ctx.state.sessions[id] = session;
  return session;
}

function selectTrackPlan({ ctx, session, payload = {}, tracks = [], source = 'radio', excludeIds = [] }) {
  const musicContext = buildMusicContext(ctx, session, payload);
  const excluded = new Set(excludeIds.map(String).filter(Boolean));
  const candidates = buildCandidates({ ctx, session, tracks, musicContext, source, excluded });
  const selected = candidates[0] || { track: tracks.find(track => !excluded.has(String(track.id))) || tracks[0], score: 0, reason: 'fallback' };
  const diagnostics = [{
    source,
    pick: minimalTrack(selected.track),
    queries: buildSearchHints(musicContext),
    hits: candidates.slice(0, 6).map(candidate => ({
      track: minimalTrack(candidate.track),
      score: Math.round(candidate.score),
      playable: candidate.track?.playable !== false,
      filterReason: candidate.reason
    })),
    failedReason: candidates.length ? '' : 'no_candidates'
  }];
  return {
    track: selected.track,
    reason: selected.reason || reasonForTrack(selected.track, musicContext),
    musicContext,
    diagnostics,
    lastSongPlan: {
      source,
      picks: candidates.slice(0, 8).map(candidate => ({
        ...minimalTrack(candidate.track),
        reason: candidate.reason,
        score: Math.round(candidate.score)
      }))
    }
  };
}

function buildTrackProgram({ ctx, session, payload = {}, tracks = [], length = 5, source = 'program', excludeIds = [] }) {
  const selected = [];
  const selectedIds = new Set(excludeIds.map(String).filter(Boolean));
  let lastPlan = null;
  for (let index = 0; index < length; index += 1) {
    const plan = selectTrackPlan({ ctx, session, payload, tracks, source, excludeIds: [...selectedIds] });
    lastPlan = plan;
    if (!plan.track) break;
    selected.push(plan.track);
    selectedIds.add(String(plan.track.id));
    if (selectedIds.size >= tracks.length && selected.length < length) selectedIds.clear();
  }
  const fallback = tracks.filter(track => track?.id);
  while (selected.length < length && fallback.length) {
    selected.push(fallback[selected.length % fallback.length]);
  }
  return {
    tracks: selected.slice(0, length),
    musicContext: lastPlan?.musicContext || buildMusicContext(ctx, session, payload),
    diagnostics: lastPlan?.diagnostics || [],
    lastSongPlan: lastPlan?.lastSongPlan || { source, picks: selected.map(minimalTrack) }
  };
}

function buildCandidates({ ctx, session, tracks, musicContext, source, excluded }) {
  const feedback = feedbackByTrack(ctx.state.feedbackEvents || []);
  const recentIds = (ctx.state.plays || []).slice(-RECENT_WINDOW).map(play => String(play.trackId));
  const sessionRecentIds = new Set([...(session.queue || []).map(item => String(item.track?.id || '')), ...recentIds]);
  const recentArtists = recentArtistCounts(ctx.state.plays || [], tracks);
  return tracks
    .filter(track => track?.id && !excluded.has(String(track.id)))
    .map((track, index) => {
      const text = trackSearchText(track);
      const fb = feedback.get(String(track.id)) || {};
      let score = 100 - index * 0.01;
      const reasonParts = [];
      if (sessionRecentIds.has(String(track.id))) {
        score -= 75;
        reasonParts.push('recently played');
      }
      const artistHits = (track.artists || []).reduce((sum, artist) => sum + (recentArtists.get(normalizeText(artist)) || 0), 0);
      if (artistHits >= 2) {
        score -= artistHits * 14;
        reasonParts.push('artist density control');
      }
      score += (fb.like || 0) * 18 + (fb.complete || 0) * 10 - (fb.skip || 0) * 18 - (fb.dislike || 0) * 35;
      for (const hint of musicContext.searchHints || []) {
        if (hint && text.includes(normalizeText(hint))) {
          score += 28;
          reasonParts.push(`matches ${hint}`);
        }
      }
      for (const avoid of musicContext.avoidHints || []) {
        if (avoid && text.includes(normalizeText(avoid))) {
          score -= 60;
          reasonParts.push(`avoid ${avoid}`);
        }
      }
      if (musicContext.energy === 'low' && /live|remix|dj|舞曲|电音|rock|摇滚/i.test(text)) score -= 16;
      if (musicContext.energy === 'high' && /remix|dj|舞曲|电音|rock|摇滚|live/i.test(text)) score += 16;
      if (source.includes('concert')) score += concertFlowBonus(track, index, musicContext);
      return {
        track,
        score,
        source: sessionRecentIds.has(String(track.id)) ? 'library_recent' : 'library_deep',
        reason: reasonParts[0] || reasonForTrack(track, musicContext)
      };
    })
    .sort((a, b) => b.score - a.score);
}

function consumeReadyQueue(session, ctx, payload) {
  pruneQueue(session);
  const item = session.queue.find(entry => entry.status === 'ready');
  if (!item) {
    session.queueMetrics.queueMissCount += 1;
    session.queueMetrics.lastMissReason = 'queue_empty';
    return null;
  }
  session.queue = session.queue.filter(entry => entry.id !== item.id);
  session.queueMetrics.queueHitCount += 1;
  session.queueMetrics.lastQueueHitAt = nowIso();
  return {
    track: item.track,
    reason: item.reason || 'prefetched queue hit',
    musicContext: item.musicContext || buildMusicContext(ctx, session, payload),
    diagnostics: item.diagnostics || [],
    lastSongPlan: { source: 'prefetch_queue', picks: [minimalTrack(item.track)] }
  };
}

function pruneQueue(session) {
  const now = Date.now();
  session.queue = (session.queue || []).filter(item => {
    if (!item.expiresAt) return true;
    return Date.parse(item.expiresAt) > now;
  });
}

function buildMusicContext(ctx, session, payload) {
  const messages = ctx.state.messages || [];
  const text = [
    payload.message,
    payload.trigger,
    payload.planning?.source,
    ctx.state.preferences?.note,
    ...messages.slice(-6).map(item => item.content)
  ].map(value => String(value || '')).join(' ');
  const normalized = normalizeText(text);
  const mood = /难过|低落|emo|焦虑|压力|累|疲惫|sleep|tired/i.test(text) ? 'comfort'
    : /开心|高兴|兴奋|快乐|happy|excited/i.test(text) ? 'happy'
      : /学习|复习|工作|写作|代码|focus|study|code/i.test(text) ? 'focus'
        : /夜|晚|深夜|night/i.test(text) ? 'night'
          : ctx.state.preferences?.moodMode || 'auto';
  const energy = mood === 'happy' ? 'high' : ['comfort', 'focus', 'night'].includes(mood) ? 'low' : 'medium';
  const searchHints = unique([
    ...extractQuotedTerms(text),
    ...keywordHints(normalized),
    ctx.state.preferences?.moodMode
  ]).slice(0, 8);
  const avoidHints = unique([
    ...extractAvoidHints(text)
  ]).slice(0, 8);
  return {
    version: Number(session.musicContext?.version || 0) + 1,
    mood,
    energy,
    musicIntent: /歌|音乐|听|推荐|下一首|播放|song|music/i.test(text) ? 'music' : 'radio',
    searchHints,
    avoidHints,
    lastUserMessage: [...messages].reverse().find(item => item.role === 'user')?.content || '',
    updatedAt: nowIso()
  };
}

function buildConcertProgram({ tracks = [], settings = {}, playlistMode = false, message = '' }) {
  const length = tracks.length;
  const items = tracks.map((track, index) => ({
    id: crypto.randomUUID(),
    index,
    status: index === 0 ? 'current' : 'pending',
    track: minimalTrack(track),
    reason: playlistMode ? '歌单连续播放' : reasonForTrack(track, { searchHints: settings.genres || [], mood: settings.mood })
  }));
  const title = playlistMode ? '灿灿连续歌单' : buildConcertTitle(settings, message);
  return {
    id: crypto.randomUUID(),
    title,
    summary: playlistMode ? `${length} 首连续播放，尽量减少打断。` : `${length} 首歌的迷你音乐会。`,
    phase: 'playing',
    playlistMode,
    currentIndex: 0,
    requestedLength: length,
    items,
    acts: buildActs(length),
    hostEvents: buildHostEvents(length, playlistMode),
    encoreUsed: false,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function buildHostEvents(length, playlistMode, introText = '') {
  if (playlistMode) return [];
  const events = [
    {
      id: crypto.randomUUID(),
      type: 'intro',
      beforeIndex: 0,
      actIndex: 0,
      status: introText ? 'played' : 'pending',
      text: introText || '欢迎来到灿灿校园电台，这场小型音乐会现在开始。'
    }
  ];
  if (length >= 5) {
    const mid = Math.floor(length / 2);
    events.push({
      id: crypto.randomUUID(),
      type: 'interlude',
      beforeIndex: mid,
      actIndex: 1,
      status: 'pending',
      text: '上半场的情绪已经铺开，接下来把能量慢慢换一个方向。'
    });
  }
  events.push({
    id: crypto.randomUUID(),
    type: 'curtain',
    beforeIndex: length,
    actIndex: 2,
    status: 'pending',
    text: '今晚的节目单到这里暂时落幕，感谢收听。'
  });
  return events;
}

function buildActs(length) {
  if (length <= 1) return [{ index: 0, startIndex: 0, title: '第一幕' }];
  const mid = Math.floor(length / 2);
  return [
    { index: 0, startIndex: 0, title: '第一幕' },
    { index: 1, startIndex: mid, title: '第二幕' }
  ];
}

function setProgramCurrent(concert, index, { skippedBefore = false } = {}) {
  concert.items = concert.items.map((item, itemIndex) => {
    if (itemIndex === index) return { ...item, status: 'current' };
    if (item.status === 'current') return { ...item, status: skippedBefore ? 'skipped' : 'played' };
    if (itemIndex < index && item.status === 'pending') return { ...item, status: skippedBefore ? 'skipped' : 'played' };
    return item;
  });
  concert.currentIndex = index;
  concert.phase = concert.phase === 'curtain' ? 'playing' : concert.phase || 'playing';
  concert.updatedAt = nowIso();
}

function markHostEventPlayed(concert, type, text) {
  const event = concert.hostEvents?.find(item => item.type === type);
  if (!event) return;
  event.status = 'played';
  event.playedAt = nowIso();
  if (text) event.text = text;
}

function buildHostEventText(event, concert) {
  if (event.text) return event.text;
  if (event.type === 'curtain') return '这场节目单已经播完，感谢收听灿灿校园电台。';
  if (event.type === 'interlude') return '我们进入下一幕，换一个角度继续听。';
  return `欢迎来到${concert?.title || '灿灿校园电台'}。`;
}

function buildAudienceComments(track, concert) {
  const name = track?.name || '这首歌';
  const artist = (track?.artists || [])[0] || '灿灿';
  const base = [
    `这首《${name}》接得很顺。`,
    `${artist} 的声音一出来，现场感就有了。`,
    '这个位置放这首歌，情绪刚好被托住。',
    concert?.phase === 'encore' ? '返场这首可以。' : '继续听，别急着切。'
  ];
  return base.map((content, index) => ({
    id: crypto.randomUUID(),
    content,
    nickname: ['前排同学', '夜跑听众', '复习区观众', '弹幕席'][index] || '观众',
    displayName: ['前排同学', '夜跑听众', '复习区观众', '弹幕席'][index] || '观众',
    persona: ['warm', 'focus', 'memory', 'encore'][index] || 'warm',
    source: 'ai',
    likedCount: Math.max(1, 32 - index * 5),
    timeMs: 8000 + index * 12000
  }));
}

function recordPlay(ctx, session, track, source, reason) {
  const play = {
    trackId: String(track.id || ''),
    playedAt: nowIso(),
    source,
    reason: String(reason || '').slice(0, 160)
  };
  ctx.state.plays = [...(ctx.state.plays || []), play].slice(-200);
  session.currentTrackId = track.id;
  session.updatedAt = nowIso();
}

function updateRadioDebug(session, selected, playable) {
  session.musicContext = selected.musicContext;
  session.radioDebug = {
    ...session.radioDebug,
    updatedAt: nowIso(),
    musicContext: selected.musicContext,
    lastSongPlan: selected.lastSongPlan,
    lastSearchDiagnostics: selected.diagnostics,
    lastSelectedTrack: minimalTrack(playable)
  };
}

function radioResponse({ ctx, sessionId, track, chatText, ttsUrl, source, session }) {
  return {
    ok: true,
    sessionId,
    track,
    chatText,
    hostText: chatText,
    reason: source,
    explanation: explanationForTrack(track, session?.musicContext, source),
    sessionConstraints: session?.sessionConstraints || { rules: [] },
    speech: { shouldSpeak: Boolean(ttsUrl), mode: ttsUrl ? 'recommendations' : 'off' },
    ttsUrl,
    ttsStatus: ttsUrl ? 'ready' : 'disabled',
    account: ctx.account,
    runtime: 'edgeone'
  };
}

function concertResponse({ ctx, sessionId, concert, track, chatText, ttsUrl, event, hostPolicy = 'auto', playlistMode = false }) {
  return {
    ok: true,
    sessionId,
    concertMode: true,
    playlistMode: Boolean(playlistMode || concert?.playlistMode),
    concertEvent: event,
    hostPolicy,
    concert: publicProgram(concert),
    track,
    chatText,
    hostText: chatText,
    explanation: track ? explanationForTrack(track, { mood: concert?.title }, event) : null,
    speech: { shouldSpeak: Boolean(ttsUrl), mode: ttsUrl ? 'recommendations' : 'off' },
    ttsUrl,
    ttsStatus: ttsUrl ? 'ready' : 'disabled',
    account: ctx.account,
    runtime: 'edgeone'
  };
}

function publicProgram(program) {
  const normalized = normalizeProgram(program);
  if (!normalized) return null;
  return {
    ...normalized,
    items: normalized.items.map(item => ({ ...item, track: minimalTrack(item.track) }))
  };
}

function normalizeProgram(program) {
  if (!program || typeof program !== 'object') return null;
  return {
    ...program,
    items: Array.isArray(program.items) ? program.items : [],
    acts: Array.isArray(program.acts) ? program.acts : [],
    hostEvents: Array.isArray(program.hostEvents) ? program.hostEvents : []
  };
}

function explanationForTrack(track, musicContext = {}, source = '') {
  return {
    summary: source?.includes('ai') ? 'AI generated selection.' : 'EdgeOne recommendation.',
    source: 'edgeone_radio',
    factors: [
      { label: '状态', value: musicContext?.mood || 'auto' },
      { label: '能量', value: musicContext?.energy || 'medium' },
      { label: '来源', value: source || 'radio' },
      track?.artists?.length ? { label: '歌手', value: track.artists.join(' / ') } : null
    ].filter(Boolean)
  };
}

function normalizeConcertSettings(raw = {}) {
  const length = CONCERT_LENGTHS.has(Number(raw.length)) ? Number(raw.length) : 5;
  return {
    length,
    genres: Array.isArray(raw.genres) ? raw.genres.map(String).filter(Boolean).slice(0, 2) : [],
    mood: String(raw.mood || 'auto'),
    scene: String(raw.scene || 'auto'),
    audiencePreset: String(raw.audiencePreset || 'warm'),
    note: String(raw.note || '').trim().slice(0, 120)
  };
}

function buildConcertTitle(settings, message) {
  const hint = settings.note || message || settings.scene || settings.mood || '';
  return hint && hint !== 'auto' ? `灿灿音乐会：${String(hint).slice(0, 18)}` : '灿灿迷你音乐会';
}

function normalizeQueueMetrics(raw = {}) {
  return {
    queueHitCount: Number(raw.queueHitCount || 0),
    queueMissCount: Number(raw.queueMissCount || 0),
    syncFallbackCount: Number(raw.syncFallbackCount || 0),
    hardPreemptCount: Number(raw.hardPreemptCount || 0),
    softPreemptCount: Number(raw.softPreemptCount || 0),
    ttsFailedCount: Number(raw.ttsFailedCount || 0),
    lastMissReason: raw.lastMissReason || '',
    lastQueueHitAt: raw.lastQueueHitAt || null
  };
}

function publicQueue(queue = []) {
  return queue.map(publicQueueItem);
}

function publicQueueItem(item = {}) {
  return {
    id: item.id,
    status: item.status,
    track: minimalTrack(item.track),
    reason: item.reason || '',
    createdAt: item.createdAt || null,
    expiresAt: item.expiresAt || null
  };
}

function minimalTrack(track = {}) {
  if (!track) return null;
  return {
    id: String(track.id || ''),
    originalId: String(track.originalId || track.id || ''),
    name: String(track.name || 'Unknown Track'),
    artists: Array.isArray(track.artists) ? track.artists.map(String) : [],
    album: track.album || '',
    coverUrl: track.coverUrl || '/assets/cover-1.svg',
    durationMs: Number(track.durationMs || 0),
    playUrl: track.playUrl || null,
    lyric: track.lyric || null,
    lyricSync: track.lyricSync || undefined,
    playbackMode: track.playbackMode || null,
    playable: track.playable !== false
  };
}

function reasonForTrack(track, musicContext = {}) {
  const hints = [...(musicContext.searchHints || [])].filter(Boolean);
  if (hints.length) return `贴合 ${hints.slice(0, 2).join(' / ')}`;
  if (musicContext.mood && musicContext.mood !== 'auto') return `贴合 ${musicContext.mood} 状态`;
  return `来自共享曲库：${(track.artists || []).slice(0, 2).join(' / ') || '灿灿推荐'}`;
}

function feedbackByTrack(events = []) {
  const map = new Map();
  for (const event of events) {
    const id = String(event.trackId || '');
    if (!id) continue;
    const item = map.get(id) || { like: 0, dislike: 0, skip: 0, complete: 0 };
    if (event.eventType === 'like') item.like += 1;
    if (event.eventType === 'dislike') item.dislike += 1;
    if (event.eventType === 'skip') item.skip += 1;
    if (event.eventType === 'complete') item.complete += 1;
    map.set(id, item);
  }
  return map;
}

function recentArtistCounts(plays = [], tracks = []) {
  const tracksById = new Map(tracks.map(track => [String(track.id), track]));
  const counts = new Map();
  for (const play of plays.slice(-RECENT_WINDOW)) {
    const track = tracksById.get(String(play.trackId));
    for (const artist of track?.artists || []) {
      const key = normalizeText(artist);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

function concertFlowBonus(track, index, musicContext) {
  if (musicContext.energy === 'high') return index % 3 === 0 ? 4 : 0;
  if (musicContext.energy === 'low') return /ballad|民谣|钢琴|acoustic|piano|ost/i.test(trackSearchText(track)) ? 8 : 0;
  return 0;
}

function trackSearchText(track = {}) {
  return normalizeText([
    track.name,
    ...(track.artists || []),
    track.album,
    track.reason,
    track.genre,
    track.tags?.join?.(' ')
  ].filter(Boolean).join(' '));
}

function buildSearchHints(musicContext = {}) {
  return unique([
    ...(musicContext.searchHints || []),
    musicContext.mood,
    musicContext.energy
  ]).filter(Boolean).slice(0, 6);
}

function keywordHints(text = '') {
  const hints = [];
  const rules = [
    [/周杰伦|jay/, '周杰伦'],
    [/陈奕迅|eason/, '陈奕迅'],
    [/王菲/, '王菲'],
    [/粤语/, '粤语'],
    [/英文|english/, 'english'],
    [/钢琴|轻音乐|纯音乐/, '钢琴'],
    [/摇滚|rock/, 'rock'],
    [/电子|电音|dj|remix/, 'dj'],
    [/安静|平静|舒缓|放松/, '舒缓'],
    [/开心|快乐|明亮/, '明亮'],
    [/学习|专注|复习|代码/, '专注']
  ];
  for (const [regex, hint] of rules) {
    if (regex.test(text)) hints.push(hint);
  }
  return hints;
}

function extractQuotedTerms(text = '') {
  const terms = [];
  for (const match of String(text).matchAll(/[《"“]([^》"”]{1,40})[》"”]/g)) {
    terms.push(match[1]);
  }
  return terms;
}

function extractAvoidHints(text = '') {
  const hints = [];
  for (const match of String(text).matchAll(/(?:不要|别|不想听|跳过|避开)([^，。,.!?！？]{1,18})/g)) {
    hints.push(match[1].trim());
  }
  return hints;
}

function unique(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values.map(item => String(item || '').trim()).filter(Boolean)) {
    const key = normalizeText(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function normalizeText(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function apiError(status, code, error) {
  return { __error: true, ok: false, status, code, error };
}

function nowIso() {
  return new Date().toISOString();
}
