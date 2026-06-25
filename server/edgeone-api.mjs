import crypto from 'node:crypto';
import { getConfig, publicConfigStatus } from './config.mjs';
import { generateChatCompletion } from './ai.mjs';
import { generateAiMusic } from './ai-music.mjs';
import {
  getCookieStatus,
  getCookieUserProfile,
  getLyric,
  getSongComments,
  getSongUrl,
  loadCookie,
  playlistTrackAll,
  userPlaylists
} from './community.mjs';
import { createEdgeOneStore, EdgeOneStorageError } from './edgeone-store.mjs';
import { DEFAULT_QUOTA_LIMITS, EdgeOneQuotaError, enforceQuota, getClientIp } from './edgeone-quota.mjs';
import { synthesizeEdgeSpeech } from './edgeone-tts.mjs';
import { runEdgeOneSelfCheck } from './edgeone-diagnostics.mjs';
import {
  edgeConcertAudience,
  edgeConcertEncore,
  edgeConcertHost,
  edgeConcertJump,
  edgeConcertNext,
  edgeConcertReplan,
  edgeConcertStart,
  edgePlaylistJump,
  edgePlaylistNext,
  edgePlaylistStart,
  edgePrefetchRadio,
  edgeRadioDebug,
  edgeRadioTurn,
  ensureSession
} from './edgeone-radio-engine.mjs';

const SHARED_LIBRARY_KEY = 'shared/library/v1';
const SHARED_PROFILE_KEY = 'shared/profile/v1';
const LIBRARY_SYNC_KEY = 'shared/library-sync-status/v1';
const DEFAULT_ACCOUNT = { source: 'guest', nickname: 'CanCan Guest', provider: 'edgeone', isAuthenticated: false };
const DEFAULT_PREFS = {
  chatMusicBalance: 'friend',
  recommendationFrequency: 'medium',
  voiceMode: 'recommendations',
  moodMode: 'auto',
  note: '',
  lowDistractionMode: false,
  scheduleAwareEnabled: false
};

const DEMO_TRACKS = [
  { id: '66285', originalId: '66285', name: '葡萄成熟时', artists: ['陈奕迅'], album: 'U87', coverUrl: '/assets/cover-1.svg', durationMs: 266000 },
  { id: '1842025914', originalId: '1842025914', name: '这世界那么多人', artists: ['莫文蔚'], album: '我要我们在一起', coverUrl: '/assets/cover-2.svg', durationMs: 286000 },
  { id: '386538', originalId: '386538', name: '晴天', artists: ['周杰伦'], album: '叶惠美', coverUrl: '/assets/cover-3.svg', durationMs: 269000 },
  { id: '167876', originalId: '167876', name: '红豆', artists: ['王菲'], album: '唱游', coverUrl: '/assets/cover-1.svg', durationMs: 258000 },
  { id: '25638273', originalId: '25638273', name: '夜空中最亮的星', artists: ['逃跑计划'], album: '世界', coverUrl: '/assets/cover-2.svg', durationMs: 252000 },
  { id: '29759733', originalId: '29759733', name: '平凡之路', artists: ['朴树'], album: '平凡之路', coverUrl: '/assets/cover-3.svg', durationMs: 302000 }
].map(track => ({ ...track, playable: true, playbackMode: 'browser-direct' }));

let initialized = false;

export async function handleEdgeOneRequest(context = {}) {
  const request = context.request || context;
  try {
    initializeRuntime();
    const store = await createEdgeOneStore(context);
    return await createEdgeOneApi({ store }).handle(request);
  } catch (error) {
    return errorResponse(error);
  }
}

export function createEdgeOneApi({ store, config = getConfig() } = {}) {
  if (!store) throw new EdgeOneStorageError();

  async function handle(request) {
    try {
      return await route(request);
    } catch (error) {
      return errorResponse(error);
    }
  }

  async function route(request) {
    if (request.method === 'OPTIONS') return emptyResponse(204);
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (pathname === '/api/health') return jsonResponse({ ok: true, runtime: 'edgeone', config: tokenStatus(publicConfigStatus(config)) });
    if (pathname === '/api/config/status') return jsonResponse(tokenStatus(publicConfigStatus(config)));
    if (pathname === '/api/environment') return jsonResponse({ ok: true, environment: edgeEnvironment(request, config) });
    if (pathname === '/api/track-comments') return handleTrackComments(url);
    if (pathname.startsWith('/api/tts/') && request.method === 'GET') return handleTts(pathname);
    if (pathname.startsWith('/api/ai-music/generated/') && request.method === 'GET') return handleAiMusicBlob(pathname);
    if (pathname === '/api/admin/library/import' && request.method === 'POST') return handleAdminImport(request);
    if (pathname === '/api/admin/library/sync-cookie' && request.method === 'POST') return handleAdminSyncCookie(request);
    if (pathname === '/api/admin/cleanup') return jsonResponse(await handleAdminCleanup(request));

    const ctx = await requestAccountContext(request);
    if (pathname === '/api/account/current') return jsonResponse({ ok: true, account: ctx.account });
    if (pathname === '/api/library' && request.method === 'GET') return jsonResponse(await buildLibrary(ctx));
    if (pathname === '/api/library/profile' && request.method === 'GET') return jsonResponse(await getSharedProfile());
    if (pathname === '/api/library/sync/status' && request.method === 'GET') return jsonResponse(await getSyncStatus());
    if (pathname === '/api/library/sync' && request.method === 'POST') return jsonResponse(locked('Library sync is locked on the public EdgeOne demo.'));
    if (pathname === '/api/library/profile/update' && request.method === 'POST') return jsonResponse(await getSharedProfile());
    if (pathname === '/api/library/profile-playlists' && request.method === 'PUT') return jsonResponse(await buildLibrary(ctx));

    if (pathname === '/api/preferences' && request.method === 'GET') return jsonResponse({ ok: true, preferences: ctx.state.preferences, feedbackSummary: feedbackSummary(ctx.state) });
    if (pathname === '/api/preferences' && request.method === 'PUT') return jsonResponse(await updatePreferences(ctx, await readJson(request)));

    if (pathname === '/api/memories' && request.method === 'GET') return jsonResponse({ ok: true, memories: ctx.state.memories || [] });
    if (pathname === '/api/memories' && request.method === 'DELETE') return jsonResponse(await updateDeviceState(ctx, { memories: [] }));
    if (/^\/api\/memories\/[^/]+$/.test(pathname)) return handleMemoryItem(ctx, request, pathname.split('/').pop());
    if (pathname === '/api/mood-stats' && request.method === 'GET') return jsonResponse({ ok: true, ...moodStats(ctx.state) });

    if (pathname === '/api/radio/start' && request.method === 'POST') return jsonResponse(await radioTurn(ctx, await readJson(request), 'start'));
    if (pathname === '/api/radio/next' && request.method === 'POST') return jsonResponse(await radioTurn(ctx, await readJson(request), 'next'));
    if (pathname === '/api/radio/prefetch' && request.method === 'POST') return jsonResponse(await prefetchTurn(ctx, await readJson(request)));
    if (pathname === '/api/radio/chat' && request.method === 'POST') return jsonResponse(await chatTurn(ctx, await readJson(request)));
    if (pathname === '/api/radio/debug' && request.method === 'GET') return jsonResponse(edgeRadioDebug({ ctx, sessionId: url.searchParams.get('sessionId') || '' }));
    if (pathname === '/api/radio/concert/start' && request.method === 'POST') return jsonResponse(await concertStart(ctx, await readJson(request)));
    if (pathname === '/api/radio/concert/next' && request.method === 'POST') return jsonResponse(await concertNext(ctx, await readJson(request)));
    if (pathname === '/api/radio/concert/host' && request.method === 'POST') return jsonResponse(await concertHost(ctx, await readJson(request)));
    if (pathname === '/api/radio/concert/jump' && request.method === 'POST') return jsonResponse(await concertJump(ctx, await readJson(request)));
    if (pathname === '/api/radio/concert/replan' && request.method === 'POST') return jsonResponse(await concertReplan(ctx, await readJson(request)));
    if (pathname === '/api/radio/concert/audience' && request.method === 'POST') return jsonResponse(await concertAudience(ctx, await readJson(request)));
    if (pathname === '/api/radio/concert/encore' && request.method === 'POST') return jsonResponse(await concertEncore(ctx, await readJson(request)));
    if (pathname === '/api/radio/playlist/start' && request.method === 'POST') return jsonResponse(await playlistStart(ctx, await readJson(request)));
    if (pathname === '/api/radio/playlist/next' && request.method === 'POST') return jsonResponse(await playlistNext(ctx, await readJson(request)));
    if (pathname === '/api/radio/playlist/jump' && request.method === 'POST') return jsonResponse(await playlistJump(ctx, await readJson(request)));
    if (pathname === '/api/feedback' && request.method === 'POST') return jsonResponse(await recordFeedback(ctx, await readJson(request)));
    if (pathname === '/api/play/report' && request.method === 'POST') return jsonResponse(await recordPlayReport(ctx, await readJson(request)));

    if (pathname === '/api/diary' && request.method === 'GET') return jsonResponse({ ok: true, diaries: ctx.state.diaries || [] });
    if (pathname === '/api/diary/today' && request.method === 'GET') return jsonResponse(await getDiary(ctx, today(config)));
    if (pathname === '/api/diary/generate' && request.method === 'POST') return jsonResponse(await generateDiary(ctx, (await readJson(request)).date || today(config)));
    if (pathname === '/api/diary/overview' && request.method === 'GET') return jsonResponse(diaryOverview(ctx, Number(url.searchParams.get('days') || 7)));
    if (pathname === '/api/diary/feedback' && request.method === 'POST') return jsonResponse({ ok: true });
    if (pathname === '/api/diary/radio' && request.method === 'POST') return jsonResponse(await radioTurn(ctx, await readJson(request), 'diary'));
    if (/^\/api\/diary\/[^/]+$/.test(pathname) && request.method === 'GET') return jsonResponse(await getDiary(ctx, decodeURIComponent(pathname.split('/').pop())));

    if (pathname === '/api/ai-music/generate' && request.method === 'POST') return jsonResponse(await generateAiMusicEdge(ctx, await readJson(request)));
    if (pathname.startsWith('/api/player/')) return jsonResponse({ ok: true, state: { status: 'browser-direct', runtime: 'edgeone' } });
    if (pathname.startsWith('/api/auth/netease')) return jsonResponse(locked('NetEase login changes are locked on the public EdgeOne demo.'));
    if (pathname.startsWith('/api/context/schedule/')) return jsonResponse({ ok: true, configured: false, connected: false, status: 'disabled', context: null });
    if (pathname === '/api/diagnostics/self-check') return jsonResponse(await diagnosticsSelfCheck(ctx, await readJson(request)));
    if (pathname.startsWith('/api/')) return jsonResponse({ ok: false, error: `API route not found: ${request.method} ${pathname}` }, 404);
    return jsonResponse({ ok: false, error: 'Not found' }, 404);
  }

  async function requestAccountContext(request) {
    const visitorId = normalizeVisitorId(request.headers.get('x-demo-visitor-id'));
    if (!visitorId) throw Object.assign(new Error('A valid X-Demo-Visitor-Id header is required.'), { status: 400, code: 'demo_visitor_id_required' });
    const state = await loadDeviceState(visitorId);
    return {
      request,
      visitorId,
      ip: getClientIp(request),
      state,
      account: {
        ...DEFAULT_ACCOUNT,
        accountId: `demo:guest:${visitorId}`,
        providerUserId: '',
        nickname: 'CanCan Guest'
      }
    };
  }

  async function loadDeviceState(visitorId) {
    const key = deviceKey(visitorId);
    const state = await store.getJson(key, null);
    if (state) return normalizeDeviceState(state);
    const next = normalizeDeviceState({ id: visitorId, createdAt: nowIso() });
    await store.setJson(key, next);
    return next;
  }

  async function saveDeviceState(ctx, state = ctx.state) {
    const next = normalizeDeviceState({ ...state, updatedAt: nowIso() });
    ctx.state = next;
    await store.setJson(deviceKey(ctx.visitorId), next);
    return next;
  }

  async function updateDeviceState(ctx, patch) {
    const state = await saveDeviceState(ctx, { ...ctx.state, ...patch });
    return { ok: true, ...patch, state: { updatedAt: state.updatedAt } };
  }

  async function getSharedLibrary() {
    const existing = await store.getJson(SHARED_LIBRARY_KEY, null);
    if (existing?.tracks?.length) return normalizeLibrarySnapshot(existing);
    const seed = normalizeLibrarySnapshot({
      source: 'edgeone-seed',
      syncedAt: nowIso(),
      tracks: DEMO_TRACKS,
      playlists: [{ id: 'edgeone-demo-liked', name: 'CanCan Demo Library', kind: 'demo', trackIds: DEMO_TRACKS.map(track => track.id) }]
    });
    await store.setJson(SHARED_LIBRARY_KEY, seed);
    await store.setJson(SHARED_PROFILE_KEY, buildSharedProfile(seed));
    return seed;
  }

  async function getSharedProfile() {
    const profile = await store.getJson(SHARED_PROFILE_KEY, null);
    if (profile?.summary) return { ok: true, profile };
    const library = await getSharedLibrary();
    const next = buildSharedProfile(library);
    await store.setJson(SHARED_PROFILE_KEY, next);
    return { ok: true, profile: next };
  }

  async function buildLibrary(ctx) {
    const library = await getSharedLibrary();
    const profile = (await getSharedProfile()).profile;
    return {
      ok: true,
      account: ctx.account,
      tracks: library.tracks,
      playlists: library.playlists.map(playlist => ({
        ...playlist,
        tracks: playlist.trackIds.map(id => library.tracks.find(track => track.id === id)).filter(Boolean),
        profileSelected: true
      })),
      recent: (ctx.state.plays || []).slice(-50).reverse().map(play => library.tracks.find(track => track.id === play.trackId)).filter(Boolean),
      profile,
      totalTracks: library.tracks.length
    };
  }

  async function getSyncStatus() {
    return await store.getJson(LIBRARY_SYNC_KEY, { ok: true, status: 'idle', phase: 'idle', runtime: 'edgeone' });
  }

  async function radioTurn(ctx, payload = {}, source = 'start') {
    const library = await getSharedLibrary();
    return await edgeRadioTurn({
      ctx,
      payload,
      source,
      library,
      resolveTrack: resolvePlayableTrack,
      hostLine,
      maybeSpeech,
      saveState: saveDeviceState
    });
  }

  async function prefetchTurn(ctx, payload = {}) {
    const library = await getSharedLibrary();
    return await edgePrefetchRadio({
      ctx,
      payload,
      library,
      resolveTrack: resolvePlayableTrack,
      saveState: saveDeviceState
    });
  }

  async function concertStart(ctx, payload = {}) {
    const library = await getSharedLibrary();
    return await edgeConcertStart({
      ctx,
      payload,
      library,
      resolveTrack: resolvePlayableTrack,
      hostLine,
      maybeSpeech,
      saveState: saveDeviceState
    });
  }

  async function concertNext(ctx, payload = {}) {
    const library = await getSharedLibrary();
    return await edgeConcertNext({
      ctx,
      payload,
      library,
      resolveTrack: resolvePlayableTrack,
      hostLine,
      maybeSpeech,
      saveState: saveDeviceState
    });
  }

  async function concertHost(ctx, payload = {}) {
    return await edgeConcertHost({ ctx, payload, maybeSpeech, saveState: saveDeviceState });
  }

  async function concertJump(ctx, payload = {}) {
    return await edgeConcertJump({
      ctx,
      payload,
      resolveTrack: resolvePlayableTrack,
      hostLine,
      maybeSpeech,
      saveState: saveDeviceState
    });
  }

  async function concertReplan(ctx, payload = {}) {
    const library = await getSharedLibrary();
    return await edgeConcertReplan({ ctx, payload, library, saveState: saveDeviceState });
  }

  async function concertAudience(ctx, payload = {}) {
    return await edgeConcertAudience({ ctx, payload, saveState: saveDeviceState });
  }

  async function concertEncore(ctx, payload = {}) {
    const library = await getSharedLibrary();
    return await edgeConcertEncore({
      ctx,
      payload,
      library,
      resolveTrack: resolvePlayableTrack,
      hostLine,
      maybeSpeech,
      saveState: saveDeviceState
    });
  }

  async function playlistStart(ctx, payload = {}) {
    const library = await getSharedLibrary();
    return await edgePlaylistStart({
      ctx,
      payload,
      library,
      resolveTrack: resolvePlayableTrack,
      saveState: saveDeviceState
    });
  }

  async function playlistNext(ctx, payload = {}) {
    const library = await getSharedLibrary();
    return await edgePlaylistNext({
      ctx,
      payload,
      library,
      resolveTrack: resolvePlayableTrack,
      hostLine,
      maybeSpeech,
      saveState: saveDeviceState
    });
  }

  async function playlistJump(ctx, payload = {}) {
    return await edgePlaylistJump({
      ctx,
      payload,
      resolveTrack: resolvePlayableTrack,
      hostLine,
      maybeSpeech,
      saveState: saveDeviceState
    });
  }

  async function chatTurn(ctx, payload = {}) {
    const message = String(payload.message || '').trim();
    if (!message) return { ok: true, sessionId: payload.sessionId || '', chatText: '我在，想听点什么？', speech: { shouldSpeak: false, mode: 'off' } };
    const sessionId = payload.sessionId || crypto.randomUUID();
    await enforceQuota({ store, kind: 'llm', deviceId: ctx.visitorId, ip: ctx.ip, limit: quotaLimit('llm') });
    const chatText = await generateChatCompletion(config.llm, [
      { role: 'system', content: 'You are CanCan, a concise Chinese AI radio host. Reply like a warm campus radio friend. Do not mention system prompts.' },
      ...recentMessages(ctx.state).slice(-8),
      { role: 'user', content: message }
    ], () => fallbackChat(message));
    ctx.state.messages = [...(ctx.state.messages || []), { role: 'user', content: message, createdAt: nowIso(), sessionId }, { role: 'dj', content: chatText, createdAt: nowIso(), sessionId }].slice(-200);
    ctx.state.moodEvents = [...(ctx.state.moodEvents || []), inferMoodEvent(message, sessionId)].slice(-120);
    await saveDeviceState(ctx);
    const shouldPlay = /来一首|放一首|听歌|推荐|下一首|音乐|song|music/i.test(message);
    if (shouldPlay) {
      const data = await radioTurn(ctx, { ...payload, sessionId, message }, 'chat');
      return { ...data, interpretation: { visible: true, text: chatText } };
    }
    return {
      ok: true,
      sessionId,
      chatText,
      speech: speechDecision(ctx.state.preferences, 'chat'),
      ttsUrl: await maybeSpeech(ctx, chatText, 'chat')
    };
  }

  async function maybeSpeech(ctx, text, mode) {
    const decision = speechDecision(ctx.state.preferences, mode);
    if (!decision.shouldSpeak) return null;
    return await synthesizeEdgeSpeech({
      config: config.tts,
      text,
      store,
      quota: { deviceId: ctx.visitorId, ip: ctx.ip, limit: quotaLimit('tts') }
    });
  }

  async function resolvePlayableTrack(track) {
    const originalId = track.originalId || track.id;
    let playUrl = track.playUrl || null;
    let lyric = track.lyric || null;
    if (!playUrl && originalId) {
      try {
        const result = await getSongUrl(originalId, ['exhigh', 'higher', 'standard']);
        playUrl = result?.url || null;
      } catch {}
    }
    if (!lyric && originalId) {
      try { lyric = await getLyric(originalId); } catch {}
    }
    return {
      ...track,
      originalId,
      playUrl,
      lyric,
      lyricSync: lyric ? 'timed' : 'plain',
      playbackMode: playUrl ? 'browser-direct' : track.playbackMode || 'browser-demo',
      playable: Boolean(playUrl || track.playable)
    };
  }

  async function hostLine(ctx, track, message, source) {
    const fallback = () => `接下来是《${track.name}》。${source === 'chat' && message ? '我按你刚才的状态换个方向。' : '让这首歌把现在的空气慢慢调亮。'}`;
    if (!config.llm?.baseUrl || !config.llm?.apiKey || !config.llm?.model) return fallback();
    await enforceQuota({ store, kind: 'llm', deviceId: ctx.visitorId, ip: ctx.ip, limit: quotaLimit('llm') });
    return await generateChatCompletion(config.llm, [
      { role: 'system', content: 'You are CanCan, a concise Chinese AI radio host. Write one natural host line under 80 Chinese characters.' },
      { role: 'user', content: `Song: ${track.name} - ${(track.artists || []).join('/')}. User message: ${message || 'none'}.` }
    ], fallback);
  }

  async function recordFeedback(ctx, payload = {}) {
    const eventType = ['like', 'dislike', 'complete', 'skip'].includes(payload.eventType) ? payload.eventType : '';
    if (!eventType || !payload.trackId) return { ok: false, error: 'Invalid feedback payload', status: 400 };
    const event = {
      id: crypto.randomUUID(),
      trackId: String(payload.trackId),
      eventType,
      sessionId: payload.sessionId || '',
      elapsedMs: Number(payload.elapsedMs || 0),
      durationMs: Number(payload.durationMs || 0),
      source: payload.source || 'edgeone',
      createdAt: nowIso()
    };
    ctx.state.feedbackEvents = [...(ctx.state.feedbackEvents || []), event].slice(-300);
    await saveDeviceState(ctx);
    return { ok: true, event, feedbackSummary: feedbackSummary(ctx.state), preferences: ctx.state.preferences };
  }

  async function recordPlayReport(ctx, payload = {}) {
    if (payload.trackId) {
      ctx.state.plays = [...(ctx.state.plays || []), { trackId: String(payload.trackId), playedAt: nowIso(), source: payload.playType || 'report' }].slice(-200);
      await saveDeviceState(ctx);
    }
    return { ok: true };
  }

  async function updatePreferences(ctx, payload = {}) {
    ctx.state.preferences = sanitizePreferences({ ...ctx.state.preferences, ...payload });
    await saveDeviceState(ctx);
    return { ok: true, preferences: ctx.state.preferences, feedbackSummary: feedbackSummary(ctx.state) };
  }

  async function handleMemoryItem(ctx, request, id) {
    const memories = ctx.state.memories || [];
    if (request.method === 'DELETE') {
      ctx.state.memories = memories.filter(memory => String(memory.id) !== String(id));
      await saveDeviceState(ctx);
      return jsonResponse({ ok: true, deleted: 1 });
    }
    if (request.method === 'PUT') {
      const body = await readJson(request);
      ctx.state.memories = memories.map(memory => String(memory.id) === String(id) ? { ...memory, content: String(body.content || memory.content || '').slice(0, 500), updatedAt: nowIso() } : memory);
      await saveDeviceState(ctx);
      return jsonResponse({ ok: true, memory: ctx.state.memories.find(memory => String(memory.id) === String(id)) || null });
    }
    return jsonResponse({ ok: false, error: 'Unsupported memory operation' }, 405);
  }

  async function getDiary(ctx, date) {
    const diary = (ctx.state.diaries || []).find(item => item.date === date) || await generateDiary(ctx, date);
    return { ok: true, diary };
  }

  async function generateDiary(ctx, date) {
    const tracks = (ctx.state.plays || []).filter(play => String(play.playedAt || '').startsWith(date));
    const diary = {
      date,
      title: tracks.length ? '今天的电台回声' : '今天还没有足够记录',
      content: tracks.length ? `今天灿灿陪你播过 ${tracks.length} 首歌，情绪信号会继续留在本设备画像里。` : '今天还没有足够的播放和聊天记录，等你开一会儿电台再回来看看。',
      moodTags: tracks.length ? ['radio', 'memory'] : [],
      trackIds: tracks.map(play => play.trackId).filter(Boolean),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    ctx.state.diaries = [...(ctx.state.diaries || []).filter(item => item.date !== date), diary].slice(-60);
    await saveDeviceState(ctx);
    return diary;
  }

  async function handleTrackComments(url) {
    const songId = url.searchParams.get('songId') || '';
    if (!/^\d+$/.test(songId)) return jsonResponse({ ok: true, songId, comments: [] });
    const comments = (await getSongComments(songId, { limit: 40 })).map(comment => ({
      ...comment,
      source: 'real',
      persona: null,
      displayName: comment.nickname || '网易云听众'
    }));
    return jsonResponse({ ok: true, songId, comments });
  }

  async function handleTts(pathname) {
    const id = pathname.split('/').pop()?.replace(/\.mp3$/, '') || '';
    if (!/^[a-f0-9]{64}$/i.test(id)) return emptyResponse(404);
    const bytes = await store.getBytes(`tts/${id}.mp3`);
    if (!bytes?.length) return emptyResponse(404);
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': 'audio/mpeg',
        'cache-control': 'public, max-age=31536000'
      }
    });
  }

  async function handleAdminImport(request) {
    assertAdmin(request);
    const body = await readJson(request);
    const library = normalizeLibrarySnapshot(body.library || body);
    if (!library.tracks.length) return jsonResponse({ ok: false, error: 'Library snapshot has no tracks.' }, 400);
    await store.setJson(SHARED_LIBRARY_KEY, library);
    await store.setJson(SHARED_PROFILE_KEY, body.profile || buildSharedProfile(library));
    await store.setJson(LIBRARY_SYNC_KEY, { ok: true, status: 'success', source: 'admin-import', tracks: library.tracks.length, syncedAt: nowIso() });
    return jsonResponse({ ok: true, tracks: library.tracks.length, playlists: library.playlists.length });
  }

  async function handleAdminSyncCookie(request) {
    assertAdmin(request);
    const result = await syncLibraryFromCookie();
    await store.setJson(SHARED_LIBRARY_KEY, result.library);
    await store.setJson(SHARED_PROFILE_KEY, buildSharedProfile(result.library));
    await store.setJson(LIBRARY_SYNC_KEY, { ok: true, status: 'success', source: 'cookie', tracks: result.library.tracks.length, playlists: result.library.playlists.length, user: result.user, syncedAt: nowIso() });
    return jsonResponse({ ok: true, tracks: result.library.tracks.length, playlists: result.library.playlists.length, user: result.user });
  }

  async function syncLibraryFromCookie() {
    const profile = await getCookieUserProfile();
    const playlistLimit = Math.max(1, Number(process.env.EDGEONE_SYNC_PLAYLIST_LIMIT || 8) || 8);
    const trackLimit = Math.max(20, Number(process.env.EDGEONE_SYNC_TRACK_LIMIT_PER_PLAYLIST || 200) || 200);
    const playlistsPayload = await userPlaylists(profile.userId, 0, playlistLimit);
    const playlistRecords = extractRecords(playlistsPayload.data).slice(0, playlistLimit);
    const tracksById = new Map();
    const playlists = [];
    for (const item of playlistRecords) {
      const playlist = normalizePlaylist(item, profile.userId);
      const songsPayload = await playlistTrackAll(playlist.id, 0, trackLimit);
      const tracks = extractRecords(songsPayload.data).map(normalizeTrack).filter(track => track.id);
      for (const track of tracks) tracksById.set(track.id, track);
      playlists.push({ ...playlist, trackIds: tracks.map(track => track.id) });
    }
    return {
      user: profile,
      library: normalizeLibrarySnapshot({
        source: 'cookie',
        syncedAt: nowIso(),
        tracks: [...tracksById.values()],
        playlists
      })
    };
  }

  async function generateAiMusicEdge(ctx, payload = {}) {
    if (!config.minimax?.apiKey) {
      return {
        __error: true,
        ok: false,
        status: 503,
        code: 'provider_unavailable',
        error: 'MiniMax music API is not configured.'
      };
    }
    await enforceQuota({ store, kind: 'aiMusic', deviceId: ctx.visitorId, ip: ctx.ip, limit: quotaLimit('aiMusic') });
    const profile = (await getSharedProfile()).profile;
    const environmentContext = edgeEnvironment(ctx.request, config);
    let result;
    try {
      result = await generateAiMusic({
        config: config.minimax,
        profile,
        payload: {
          ...payload,
          environmentContext,
          recentMessages: (ctx.state.messages || []).slice(-12),
          musicContext: latestMusicContext(ctx, payload.sessionId)
        },
        saveAudio: async ({ id, audioBuffer, title, prompt, lyrics, model, response }) => {
          const audioKey = aiMusicAudioKey(id);
          const meta = {
            id,
            title,
            prompt,
            lyrics,
            model,
            traceId: response?.trace_id || null,
            ownerDeviceId: ctx.visitorId,
            createdAt: nowIso(),
            expiresAt: new Date(Date.now() + aiMusicTtlMs()).toISOString(),
            contentType: 'audio/mpeg',
            size: Buffer.from(audioBuffer || []).length
          };
          await store.setBytes(audioKey, audioBuffer, meta);
          await store.setJson(aiMusicMetaKey(id), meta);
          return { playUrl: `/api/ai-music/generated/${id}.mp3` };
        }
      });
    } catch (error) {
      return {
        __error: true,
        ok: false,
        status: 503,
        code: 'provider_unavailable',
        error: `AI music provider failed: ${String(error?.message || error).slice(0, 180)}`
      };
    }
    if (result?.ok && result.track?.id) {
      ctx.state.aiMusic = [...(ctx.state.aiMusic || []), {
        id: result.track.id,
        name: result.track.name,
        playUrl: result.track.playUrl,
        createdAt: nowIso(),
        expiresAt: new Date(Date.now() + aiMusicTtlMs()).toISOString()
      }].slice(-50);
      if (result.sessionId) {
        const session = ensureSession(ctx, result.sessionId);
        session.currentTrackId = result.track.id;
        session.mode = 'ai_music';
      }
      ctx.state.plays = [...(ctx.state.plays || []), {
        trackId: result.track.id,
        playedAt: nowIso(),
        source: 'ai_music',
        reason: result.chatText || ''
      }].slice(-200);
      await saveDeviceState(ctx);
    }
    return result;
  }

  async function handleAiMusicBlob(pathname) {
    const id = pathname.split('/').pop()?.replace(/\.mp3$/, '') || '';
    if (!/^ai-minimax-[A-Za-z0-9-]+$/.test(id)) return emptyResponse(404);
    const bytes = await store.getBytes(aiMusicAudioKey(id));
    if (!bytes?.length) return emptyResponse(404);
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': 'audio/mpeg',
        'cache-control': 'public, max-age=604800'
      }
    });
  }

  async function diagnosticsSelfCheck(ctx, payload = {}) {
    const sessionId = payload.sessionId || '';
    const session = sessionId && ctx.state.sessions ? ctx.state.sessions[sessionId] : null;
    return await runEdgeOneSelfCheck({
      config,
      store,
      ctx,
      session,
      trackId: payload.trackId || '',
      getSharedLibrary,
      getSyncStatus,
      resolveTrack: resolvePlayableTrack
    });
  }

  async function handleAdminCleanup(request) {
    if (request.method === 'POST') {
      try { assertAdmin(request); } catch (error) {
        if (process.env.EDGEONE_ADMIN_TOKEN) throw error;
      }
    }
    const now = Date.now();
    let cleaned = 0;
    const keys = await store.list('ai-music/meta/');
    for (const key of keys) {
      const meta = await store.getJson(key, null);
      const expired = Date.parse(meta?.expiresAt || '') || 0;
      if (!expired || expired > now) continue;
      await store.delete(key);
      await store.delete(aiMusicAudioKey(meta.id));
      cleaned += 1;
    }
    return { ok: true, cleaned, runtime: 'edgeone' };
  }

  return { handle };
}

function initializeRuntime() {
  if (initialized) return;
  loadCookie(process.cwd());
  initialized = true;
}

function radioResponse({ sessionId, track, chatText, ttsUrl, source }) {
  return {
    ok: true,
    sessionId,
    track,
    chatText,
    hostText: chatText,
    reason: source,
    explanation: {
      factors: [
        { label: '运行环境', value: 'EdgeOne 全栈版' },
        { label: '推荐来源', value: source === 'chat' ? '根据当前对话接歌' : '共享曲库轮播' }
      ]
    },
    speech: { shouldSpeak: Boolean(ttsUrl), mode: ttsUrl ? 'recommendations' : 'off' },
    ttsUrl,
    ttsStatus: ttsUrl ? 'ready' : 'disabled',
    runtime: 'edgeone'
  };
}

function selectNextTrack(tracks, state, payload = {}) {
  const candidates = tracks.filter(track => track?.id);
  if (!candidates.length) return DEMO_TRACKS[0];
  const requested = String(payload.trackId || '').trim();
  if (requested) {
    const track = candidates.find(item => String(item.id) === requested || String(item.originalId) === requested);
    if (track) return track;
  }
  const recentIds = new Set((state.plays || []).slice(-8).map(play => String(play.trackId)));
  const fresh = candidates.find(track => !recentIds.has(String(track.id)));
  return fresh || candidates[(state.plays || []).length % candidates.length];
}

function normalizeDeviceState(raw = {}) {
  return {
    id: String(raw.id || '').trim(),
    createdAt: raw.createdAt || nowIso(),
    updatedAt: raw.updatedAt || nowIso(),
    preferences: sanitizePreferences(raw.preferences || {}),
    messages: Array.isArray(raw.messages) ? raw.messages.slice(-200) : [],
    plays: Array.isArray(raw.plays) ? raw.plays.slice(-200) : [],
    feedbackEvents: Array.isArray(raw.feedbackEvents) ? raw.feedbackEvents.slice(-300) : [],
    memories: Array.isArray(raw.memories) ? raw.memories.slice(-120) : [],
    moodEvents: Array.isArray(raw.moodEvents) ? raw.moodEvents.slice(-120) : [],
    diaries: Array.isArray(raw.diaries) ? raw.diaries.slice(-60) : [],
    aiMusic: Array.isArray(raw.aiMusic) ? raw.aiMusic.slice(-50) : [],
    sessions: raw.sessions && typeof raw.sessions === 'object' && !Array.isArray(raw.sessions) ? raw.sessions : {}
  };
}

function sanitizePreferences(raw = {}) {
  const pick = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
  return {
    chatMusicBalance: pick(raw.chatMusicBalance, ['friend', 'dj', 'music-first'], DEFAULT_PREFS.chatMusicBalance),
    recommendationFrequency: pick(raw.recommendationFrequency, ['low', 'medium', 'high'], DEFAULT_PREFS.recommendationFrequency),
    voiceMode: pick(raw.voiceMode, ['off', 'recommendations', 'all'], DEFAULT_PREFS.voiceMode),
    moodMode: pick(raw.moodMode, ['auto', 'focus', 'random'], DEFAULT_PREFS.moodMode),
    note: String(raw.note || '').slice(0, 500),
    lowDistractionMode: raw.lowDistractionMode === true,
    scheduleAwareEnabled: raw.scheduleAwareEnabled === true
  };
}

function normalizeLibrarySnapshot(raw = {}) {
  const tracks = Array.isArray(raw.tracks) ? raw.tracks.map(normalizeTrack).filter(track => track.id) : [];
  const trackIds = new Set(tracks.map(track => track.id));
  const playlists = (Array.isArray(raw.playlists) && raw.playlists.length ? raw.playlists : [{ id: 'edgeone-demo-liked', name: 'CanCan Library', kind: 'playlist', trackIds: tracks.map(track => track.id) }])
    .map(playlist => ({
      id: String(playlist.id || crypto.randomUUID()),
      name: String(playlist.name || 'CanCan Library').slice(0, 80),
      kind: String(playlist.kind || 'playlist'),
      coverUrl: playlist.coverUrl || '',
      trackIds: (playlist.trackIds || playlist.tracks?.map(track => track.id) || []).map(String).filter(id => trackIds.has(id))
    }));
  return {
    source: raw.source || 'edgeone',
    syncedAt: raw.syncedAt || nowIso(),
    tracks,
    playlists
  };
}

function normalizeTrack(raw = {}) {
  const song = raw.song || raw.track || raw;
  const id = song.id ?? song.originalId ?? song.songId ?? raw.id;
  const artists = Array.isArray(song.artists)
    ? song.artists
    : Array.isArray(song.ar)
      ? song.ar.map(artist => artist.name || artist)
      : Array.isArray(song.artist)
        ? song.artist
        : [];
  const album = song.album || song.al || {};
  return {
    id: id === undefined || id === null ? '' : String(id),
    originalId: String(song.originalId ?? id ?? ''),
    name: String(song.name || song.title || 'Unknown Track').slice(0, 120),
    artists: artists.map(artist => typeof artist === 'string' ? artist : artist?.name).filter(Boolean).slice(0, 8),
    album: typeof album === 'string' ? album : String(album.name || ''),
    coverUrl: song.coverUrl || song.cover_url || album.picUrl || album.coverUrl || '/assets/cover-1.svg',
    durationMs: Number(song.durationMs || song.duration || song.dt || 0) || 0,
    playUrl: typeof song.playUrl === 'string' ? song.playUrl : null,
    playbackMode: song.playbackMode || null,
    playable: song.playable !== false
  };
}

function normalizePlaylist(raw = {}, userId = '') {
  const ownerId = raw.userId ?? raw.creator?.userId ?? raw.creatorId;
  const kind = Number(raw.specialType) === 5 ? 'star' : String(ownerId || '') === String(userId || '') ? 'created' : raw.subscribed ? 'subscribed' : 'playlist';
  return {
    id: String(raw.id || raw.playlistId || crypto.randomUUID()),
    name: String(raw.name || raw.title || 'NetEase Playlist').slice(0, 80),
    kind,
    coverUrl: raw.coverImgUrl || raw.coverUrl || raw.picUrl || ''
  };
}

function extractRecords(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.records)) return data.records;
  if (Array.isArray(data.list)) return data.list;
  if (Array.isArray(data.songs)) return data.songs;
  if (Array.isArray(data.songList)) return data.songList;
  if (Array.isArray(data.playlists)) return data.playlists;
  if (Array.isArray(data.playlist)) return data.playlist;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.privileges) && Array.isArray(data.songs)) return data.songs;
  if (Array.isArray(data.playlist?.tracks)) return data.playlist.tracks;
  return [];
}

function buildSharedProfile(library) {
  const artists = countBy(library.tracks.flatMap(track => track.artists || []));
  const topArtists = [...artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name]) => name);
  return {
    summary: topArtists.length
      ? `共享曲库偏向 ${topArtists.join('、')} 等线索，适合做一间温暖、偏私人化的校园 AI 电台。`
      : '共享曲库已准备好，等待更多歌曲同步后生成更完整的音乐画像。',
    tags: ['EdgeOne', '共享曲库', 'AI 电台'],
    structured: {
      source: 'edgeone-shared-library',
      trackCount: library.tracks.length,
      playlistCount: library.playlists.length,
      artists: topArtists.map(name => ({ name, weight: 0.8 })),
      genres: [],
      moods: [{ name: '温暖', weight: 0.7 }],
      scenes: [{ name: '校园电台', weight: 0.8 }]
    },
    updatedAt: nowIso()
  };
}

function countBy(values) {
  const map = new Map();
  for (const value of values.map(item => String(item || '').trim()).filter(Boolean)) {
    map.set(value, (map.get(value) || 0) + 1);
  }
  return map;
}

function speechDecision(preferences = {}, mode = 'recommendation') {
  const prefs = sanitizePreferences(preferences);
  if (prefs.lowDistractionMode || prefs.voiceMode === 'off') return { mode: 'off', shouldSpeak: false };
  if (prefs.voiceMode === 'all') return { mode: 'all', shouldSpeak: true };
  return { mode: prefs.voiceMode, shouldSpeak: mode === 'recommendation' };
}

function feedbackSummary(state) {
  const summary = {};
  for (const event of state.feedbackEvents || []) {
    const item = summary[event.trackId] || { likes: 0, dislikes: 0, completions: 0, skips: 0 };
    if (event.eventType === 'like') item.likes += 1;
    if (event.eventType === 'dislike') item.dislikes += 1;
    if (event.eventType === 'complete') item.completions += 1;
    if (event.eventType === 'skip') item.skips += 1;
    summary[event.trackId] = item;
  }
  return summary;
}

function moodStats(state) {
  const events = state.moodEvents || [];
  const buckets = [...countBy(events.map(event => event.mood || 'neutral')).entries()].map(([mood, count]) => ({ mood, count }));
  return { total: events.length, buckets };
}

function inferMoodEvent(message, sessionId) {
  const text = String(message || '');
  const mood = /累|难受|焦虑|压力|烦|崩/i.test(text) ? 'tired' : /开心|高兴|顺利|喜欢/i.test(text) ? 'happy' : 'neutral';
  return { mood, energy: mood === 'tired' ? 'low' : 'medium', musicIntent: /歌|音乐|听/i.test(text) ? 'music' : 'chat', sessionId, source: 'chat', createdAt: nowIso() };
}

function recentMessages(state) {
  return (state.messages || []).map(message => ({ role: message.role === 'dj' ? 'assistant' : message.role, content: message.content || '' }));
}

function fallbackChat(message) {
  if (/累|压力|焦虑|难受/i.test(message)) return '我听见了。先不用急着把状态调好，我们可以让音乐慢一点，把注意力放回呼吸里。';
  if (/开心|高兴|顺利/i.test(message)) return '这份好状态值得被留住。要不要我接一首更明亮一点的歌？';
  return '我在。你可以直接告诉我现在的心情、场景，或者想听的方向。';
}

function diaryOverview(ctx, days = 7) {
  const list = ctx.state.diaries || [];
  return {
    ok: true,
    days: list.slice(-Math.max(1, Math.min(30, days))).reverse().map(item => ({ date: item.date, hasActivity: Boolean(item.trackIds?.length), title: item.title })),
    selectedDate: today({ app: { timeZone: 'Asia/Shanghai' } }),
    overview: list.at(-1) || null
  };
}

function edgeEnvironment(request, config) {
  const timeZone = request.headers.get('x-demo-time-zone') || config.weather?.timeZone || config.app?.timeZone || 'Asia/Shanghai';
  return {
    timeZone,
    locale: request.headers.get('x-demo-locale') || 'zh-CN',
    city: config.weather?.city || 'Shanghai',
    countryCode: config.weather?.countryCode || 'CN',
    source: 'edgeone'
  };
}

function locked(message) {
  return { ok: true, locked: true, message };
}

function tokenStatus(status) {
  return {
    ...status,
    neteaseToken: false,
    neteaseCookie: getCookieStatus().hasCookie
  };
}

function assertAdmin(request) {
  const expected = process.env.EDGEONE_ADMIN_TOKEN || '';
  if (!expected) throw Object.assign(new Error('EDGEONE_ADMIN_TOKEN is not configured.'), { status: 403, code: 'admin_token_missing' });
  const actual = request.headers.get('x-admin-token') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (actual !== expected) throw Object.assign(new Error('Invalid admin token.'), { status: 403, code: 'admin_forbidden' });
}

function quotaLimit(kind) {
  const envKey = `EDGEONE_DAILY_${kind.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}_LIMIT`;
  return Math.max(1, Number(process.env[envKey] || DEFAULT_QUOTA_LIMITS[kind] || 50) || DEFAULT_QUOTA_LIMITS[kind] || 50);
}

async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  return JSON.parse(text);
}

function jsonResponse(data, status = data?.status || 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
}

function errorResponse(error) {
  const status = Number(error?.status || error?.statusCode || 500);
  if (status >= 500) console.error(error);
  const body = {
    ok: false,
    __error: true,
    error: error?.message || 'Unexpected EdgeOne error',
    code: error?.code || undefined
  };
  if (error instanceof EdgeOneQuotaError) {
    body.kind = error.kind;
    body.limit = error.limit;
  }
  return jsonResponse(body, status);
}

function normalizeVisitorId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{7,80}$/.test(id) ? id : '';
}

function deviceKey(visitorId) {
  return `devices/${visitorId}/state`;
}

function aiMusicAudioKey(id) {
  return `ai-music/generated/${id}.mp3`;
}

function aiMusicMetaKey(id) {
  return `ai-music/meta/${id}.json`;
}

function aiMusicTtlMs() {
  const days = Math.max(1, Number(process.env.EDGEONE_AI_MUSIC_TTL_DAYS || 7) || 7);
  return days * 24 * 60 * 60 * 1000;
}

function latestMusicContext(ctx, sessionId = '') {
  const session = sessionId && ctx.state?.sessions ? ctx.state.sessions[sessionId] : null;
  return session?.musicContext || session?.radioDebug?.musicContext || {};
}

function today(config = {}) {
  const timeZone = config.app?.timeZone || 'Asia/Shanghai';
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function nowIso() {
  return new Date().toISOString();
}
