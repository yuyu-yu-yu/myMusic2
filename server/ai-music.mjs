import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MODEL = 'music-2.6-free';
const DEFAULT_BASE_URL = 'https://api.minimaxi.com';
const DEFAULT_DURATION_MS = 150000;
const REQUEST_TIMEOUT_MS = 180000;

export async function generateAiMusic({ config = {}, rootDir = process.cwd(), profile = {}, payload = {} } = {}) {
  const minimax = normalizeMiniMaxConfig(config);
  const configuredModel = minimax.model;
  if (!minimax.allowPaidMusic && !isFreeModel(minimax.model)) {
    minimax.model = 'music-2.6-free';
  }
  if (!minimax.apiKey) {
    return {
      __error: true,
      ok: false,
      status: 400,
      error: 'MiniMax 未配置：请在 .env.local 中设置 MINIMAX_API_KEY。'
    };
  }

  const id = `ai-minimax-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const fallbackTitle = buildTitle(payload);
  const prompt = buildMusicPrompt({ payload, profile });
  const lyricsResult = await generateLyricsWithFallback(minimax, prompt);
  const title = lyricsResult.title || fallbackTitle;
  const lyrics = lyricsResult.lyrics;
  const requestPayload = {
    model: minimax.model,
    prompt,
    lyrics,
    lyrics_optimizer: !lyrics,
    is_instrumental: false,
    output_format: 'url',
    stream: false,
    audio_setting: {
      sample_rate: 44100,
      bitrate: 256000,
      format: 'mp3'
    }
  };

  const startedAt = Date.now();
  let usedModel = minimax.model;
  let response = null;
  try {
    response = await callMiniMaxMusic(minimax, requestPayload);
  } catch (error) {
    if (!isFreeModel(minimax.model) && shouldRetryWithFreeModel(error)) {
      usedModel = 'music-2.6-free';
      response = await callMiniMaxMusic(minimax, { ...requestPayload, model: usedModel });
    } else {
      throw error;
    }
  }
  const audioBuffer = await resolveAudioBuffer(response, minimax);
  if (!audioBuffer?.length) throw new Error('MiniMax 未返回可保存的音频。');

  const relativeFile = `/ai-music/generated/${id}.mp3`;
  const outputPath = path.join(rootDir, 'public', 'ai-music', 'generated', `${id}.mp3`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, audioBuffer);

  const durationMs = normalizeDurationMs(response?.extra_info?.music_duration);
  const generatedLyrics = lyrics || extractGeneratedLyrics(response);
  const track = {
    id,
    name: title,
    artists: ['灿灿 AI DJ'],
    album: 'AI 原创电台',
    coverUrl: '/assets/cover-3.svg',
    durationMs,
    playUrl: relativeFile,
    playbackMode: 'browser-ai',
    playable: true,
    lyric: generatedLyrics,
    lyricSync: 'plain',
    aiGenerated: true,
    provider: 'minimax',
    rawLyrics: generatedLyrics
  };

  return {
    ok: true,
    sessionId: payload.sessionId || '',
    chatText: `AI 原创电台已完成：${title}。这首歌是灿灿根据最近状态和音乐画像生成的。`,
    track,
    reason: 'minimax_ai_music',
    explanation: buildAiMusicExplanation({ payload, profile, lyricsResult, usedModel }),
    speech: { shouldSpeak: false, mode: 'off' },
    ttsUrl: null,
    ttsStatus: 'disabled',
    aiMusic: {
      provider: 'minimax',
      model: usedModel,
      fallbackModelFrom: usedModel === minimax.model ? null : minimax.model,
      configuredModel,
      paidModelBlocked: configuredModel !== minimax.model,
      prompt,
      lyrics: generatedLyrics,
      lyricsGeneration: {
        status: lyricsResult.status,
        title: lyricsResult.title,
        styleTags: lyricsResult.styleTags,
        error: lyricsResult.error,
        traceId: lyricsResult.traceId
      },
      durationMs,
      generatedMs: Date.now() - startedAt,
      traceId: response?.trace_id || null
    }
  };
}

export function buildMusicPrompt({ payload = {}, profile = {} } = {}) {
  const moment = inferMoment(payload);
  const scene = summarizeScene(payload, moment);
  const profileText = summarizeProfileForPrompt(profile);
  return [
    scene,
    `音乐画像：${profileText}`,
    '人声类型：女音',
    `生成一首${moment.songGoal}的完整中文流行歌曲。`
  ].filter(Boolean).join(' ').slice(0, 2000);
}

export function buildAiMusicExplanation({ payload = {}, profile = {}, lyricsResult = {}, usedModel = '' } = {}) {
  const factors = [];
  const add = (type, text) => {
    const value = cleanText(text, 80);
    if (!value) return;
    if (factors.some(factor => factor.text === value)) return;
    factors.push({ type, text: value });
  };

  const moment = inferMoment(payload);
  const env = getEnvironmentContext(payload);
  const location = cleanText(payload.location || env.city || env.location || '上海', 20);
  const time = summarizeLocalTime(env);
  const weather = summarizeWeather(payload.weather || env.weather || payload.sessionContext?.weather || '');
  const recent = getRecentUserMessages(payload).at(-1);
  const profileText = summarizeProfileForPrompt(profile);
  const vocal = '女音';

  add('scene', `当前场景：${[location, time, weather].filter(Boolean).join(' / ')}`);
  if (recent) add('chat', `最近表达：${recent.slice(0, 28)}`);
  add('mood', `当前氛围：${formatMomentForFactor(moment)}`);
  add('profile', `你的画像偏好：${profileText.replace(/、/g, ' / ')}`);
  add('voice', `人声类型：${vocal}`);

  return {
    summary: 'AI 原创歌曲：按此刻状态、场景和音乐画像生成。',
    source: 'minimax_music',
    factors: factors.slice(0, 6)
  };
}

export function buildStructuredLyrics({ payload = {}, profile = {} } = {}) {
  const mood = normalizeMoodWord(payload.preferences?.moodMode || payload.mood);
  const recentLine = buildRecentLyricLine(payload);
  const moment = inferMoment(payload);
  const theme = mood === '专注'
    ? '把杂音慢慢调低'
    : mood === '深夜'
      ? '把夜色放得更轻'
      : mood === '平静'
        ? '让呼吸慢慢落稳'
        : '把心情整理成拍点';
  return [
    '[Intro]',
    moment.introLine,
    '先让呼吸慢慢落在拍子里',
    '[Verse]',
    recentLine,
    `现在我想 ${theme}`,
    moment.verseLine,
    moment.profileInfluenceLine,
    '[Chorus]',
    moment.chorusLine1,
    moment.chorusLine2,
    '让你的心不必急着说明',
    '也能跟着这一段慢慢变轻',
    '[Bridge]',
    '那些没说出口的小小需要',
    moment.bridgeLine,
    '所以能量放到刚好',
    '不多不少 贴着心跳',
    '[Outro]',
    moment.outroLine,
    '余温留给现在的你'
  ].join('\n').slice(0, 3500);
}

export function buildLrcFromStructuredLyrics(lyrics = '', durationMs = DEFAULT_DURATION_MS) {
  const lines = String(lyrics)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^\[[A-Za-z ]+\]$/.test(line));
  if (!lines.length) return '[00:00.00] AI original music, please enjoy.';
  const totalSeconds = Math.max(30, Math.floor((Number(durationMs) || DEFAULT_DURATION_MS) / 1000));
  const spacing = Math.max(4, Math.floor(totalSeconds / (lines.length + 1)));
  return lines.map((line, index) => `[${formatLrcTime(index * spacing)}] ${line}`).join('\n');
}

async function generateLyricsWithFallback(minimax, prompt) {
  try {
    const response = await callMiniMaxLyrics(minimax, {
      mode: 'write_full_song',
      prompt
    });
    const lyrics = cleanTextBlock(response?.lyrics || '', 3500);
    if (!lyrics) {
      return {
        status: 'empty',
        lyrics: '',
        title: '',
        styleTags: cleanText(response?.style_tags || response?.styleTags || '', 240),
        error: '',
        traceId: response?.trace_id || null
      };
    }
    return {
      status: 'generated',
      lyrics,
      title: cleanText(response?.song_title || response?.songTitle || '', 80),
      styleTags: cleanText(response?.style_tags || response?.styleTags || '', 240),
      error: '',
      traceId: response?.trace_id || null
    };
  } catch (error) {
    return {
      status: 'fallback',
      lyrics: '',
      title: '',
      styleTags: '',
      error: error?.message || String(error || ''),
      traceId: null
    };
  }
}

async function callMiniMaxLyrics(minimax, body) {
  const url = `${minimax.baseUrl.replace(/\/+$/, '')}/v1/lyrics_generation`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${minimax.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout?.(REQUEST_TIMEOUT_MS)
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`MiniMax 返回了非 JSON 歌词响应：HTTP ${response.status}`);
  }

  const statusCode = data?.base_resp?.status_code;
  if (!response.ok || (statusCode !== undefined && Number(statusCode) !== 0)) {
    const message = data?.base_resp?.status_msg || data?.error || data?.message || `HTTP ${response.status}`;
    throw new Error(`MiniMax 歌词生成失败：${message}`);
  }
  return data;
}

async function callMiniMaxMusic(minimax, body) {
  const url = `${minimax.baseUrl.replace(/\/+$/, '')}/v1/music_generation`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${minimax.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout?.(REQUEST_TIMEOUT_MS)
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`MiniMax 返回了非 JSON 响应：HTTP ${response.status}`);
  }

  const statusCode = data?.base_resp?.status_code;
  if (!response.ok || (statusCode !== undefined && Number(statusCode) !== 0)) {
    const message = data?.base_resp?.status_msg || data?.error || data?.message || `HTTP ${response.status}`;
    throw new Error(`MiniMax 音乐生成失败：${message}`);
  }
  return data;
}

async function resolveAudioBuffer(response, minimax) {
  const audio = response?.data?.audio || response?.data?.audio_url || response?.data?.audioUrl || response?.data?.url;
  if (!audio) return null;
  if (/^https?:\/\//i.test(audio)) {
    const res = await fetch(audio, {
      headers: minimax.apiKey ? { authorization: `Bearer ${minimax.apiKey}` } : undefined,
      signal: AbortSignal.timeout?.(REQUEST_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`MiniMax 音频下载失败：HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return decodeHexAudio(audio);
}

function decodeHexAudio(value) {
  const hex = String(value || '').trim().replace(/^0x/i, '');
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error('MiniMax 返回的音频不是有效 hex 数据。');
  }
  return Buffer.from(hex, 'hex');
}

function extractGeneratedLyrics(response = {}) {
  const candidates = [
    response?.data?.lyrics,
    response?.data?.lyric,
    response?.lyrics,
    response?.lyric
  ];
  return cleanTextBlock(candidates.find(value => typeof value === 'string') || '', 3500);
}

function normalizeMiniMaxConfig(config = {}) {
  return {
    baseUrl: config.baseUrl || DEFAULT_BASE_URL,
    apiKey: config.apiKey || '',
    model: config.model || DEFAULT_MODEL,
    allowPaidMusic: Boolean(config.allowPaidMusic)
  };
}

function isFreeModel(model = '') {
  return String(model || '').includes('-free');
}

function shouldRetryWithFreeModel(error) {
  return /insufficient balance|balance|quota|payment|billing/i.test(String(error?.message || error || ''));
}

function buildTitle(payload = {}) {
  const date = new Date();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const moment = inferMoment(payload);
  return `${moment.title} ${hh}:${mm}`;
}

function summarizeScene(payload = {}, moment = inferMoment(payload)) {
  const env = getEnvironmentContext(payload);
  const location = cleanText(payload.location || env.city || env.location || '上海', 20);
  const time = summarizeLocalTime(env);
  const weather = summarizeWeather(payload.weather || env.weather || payload.sessionContext?.weather || '');
  return [
    location,
    time,
    weather,
    moment.userState
  ].filter(Boolean).join('，') + '。';
}

function summarizeProfile(profile = {}) {
  const structured = profile.structured || {};
  const names = [
    ...(structured.genres || []),
    ...(structured.moods || []),
    ...(structured.scenes || []),
    ...(structured.energy || [])
  ].map(item => cleanText(item?.name, 20)).filter(Boolean);
  if (names.length) return names.slice(0, 4).join('、');
  if (Array.isArray(profile.tags) && profile.tags.length) return profile.tags.slice(0, 4).map(tag => cleanText(tag, 20)).join('、');
  return cleanText(profile.summary || '温柔、流行、适合私人电台', 80);
}

function summarizeProfileForPrompt(profile = {}) {
  const text = summarizeProfile(profile)
    .replace(/影视\/游戏原声/g, '影视感')
    .replace(/影视和游戏画面感/g, '影视感')
    .replace(/电子\/DJ/gi, '轻电子')
    .replace(/电子节奏/g, '轻电子')
    .replace(/R&B/gi, 'R&B')
    .replace(/\s+/g, '');
  return text || '华语流行、轻电子、情绪陪伴';
}

function formatMomentForFactor(moment = {}) {
  const state = String(moment.userState || moment.label || '')
    .replace(/^用户/, '')
    .replace(/，/g, ' / ')
    .replace(/。/g, '')
    .trim();
  if (state) return state.slice(0, 48);
  return '贴近当下状态';
}

function summarizeProfileDetail(profile = {}) {
  const structured = profile.structured || {};
  const groups = [
    ['偏好艺人', structured.artists],
    ['偏好专辑', structured.albums],
    ['偏好场景', structured.scenes],
    ['回避信号', structured.avoidSignals]
  ].map(([label, items]) => {
    const names = (items || []).map(item => cleanText(item?.name, 20)).filter(Boolean).slice(0, 3);
    return names.length ? `${label}：${names.join('、')}` : '';
  }).filter(Boolean);
  return groups.join('；').slice(0, 260);
}

function describeCurrentState(payload = {}) {
  const prefs = payload.preferences || {};
  const mood = normalizeMoodWord(prefs.moodMode || payload.mood);
  const moment = inferMoment(payload);
  const recent = getRecentUserMessages(payload).slice(-2);
  const musicContext = getMusicContext(payload);
  const hints = [
    ...(musicContext.searchHints || []),
    ...(musicContext.preferenceHints || [])
  ].map(item => cleanText(item, 18)).filter(Boolean).slice(0, 4);
  const note = cleanText(prefs.note || payload.note || '', 120);
  return [
    moment.label,
    recent.length ? `最近表达：${recent.join(' / ')}` : '',
    musicContext.reason ? `对话分析：${cleanText(musicContext.reason, 80)}` : '',
    hints.length ? `偏好线索：${hints.join('、')}` : '',
    `当前偏好状态：${mood}`,
    note ? `用户备注：${note}` : ''
  ].filter(Boolean).join('，');
}

function getEnvironmentContext(payload = {}) {
  return payload.environmentContext || payload.sessionContext?.environmentContext || {};
}

function summarizeLocalTime(environmentContext = {}) {
  const raw = cleanText(environmentContext.localTime || '', 20);
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  const date = new Date();
  const hour = match ? Number(match[1]) : date.getHours();
  const minute = match ? Number(match[2]) : date.getMinutes();
  const period = hour < 6 ? '凌晨'
    : hour < 12 ? '上午'
      : hour < 14 ? '中午'
        : hour < 19 ? '下午'
          : hour < 23 ? '晚上'
            : '深夜';
  return `${period}${toChineseHour(hour)}${minuteLabel(minute)}`;
}

function toChineseHour(hour) {
  const normalized = Number(hour) % 12 || 12;
  const names = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  return `${names[normalized] || String(normalized)}点`;
}

function minuteLabel(minute) {
  const value = Number(minute) || 0;
  if (value === 0) return '';
  if (value === 30) return '半';
  if (value < 10) return `零${value}分`;
  return `${value}分`;
}

function summarizeWeather(value = '') {
  const text = cleanText(value, 120);
  if (!text) return '';
  if (/雷|暴雨/.test(text)) return '雷雨天';
  if (/雨/.test(text)) return '下雨';
  if (/雪/.test(text)) return '下雪';
  if (/阴/.test(text)) return '阴天';
  if (/多云|云/.test(text)) return '多云';
  if (/晴/.test(text)) return '晴天';
  if (/雾/.test(text)) return '有雾';
  return text.slice(0, 20);
}

function summarizeRecentContext(payload = {}) {
  const messages = getRecentMessages(payload).slice(-6);
  const userMessages = messages
    .filter(message => message.role === 'user')
    .map(message => cleanText(message.content, 80))
    .filter(Boolean)
    .slice(-3);
  const assistantMessages = messages
    .filter(message => message.role !== 'user')
    .map(message => cleanText(message.content, 70))
    .filter(Boolean)
    .slice(-2);
  const musicContext = getMusicContext(payload);
  const parts = [
    userMessages.length ? `用户最近说：${userMessages.join(' / ')}` : '',
    assistantMessages.length ? `灿灿最近回应：${assistantMessages.join(' / ')}` : '',
    musicContext.lastUserMessage ? `会话状态线索：${cleanText(musicContext.lastUserMessage, 80)}` : '',
    musicContext.mood ? `会话情绪：${cleanText(musicContext.mood, 30)}` : '',
    musicContext.energy ? `能量：${cleanText(musicContext.energy, 20)}` : ''
  ];
  return parts.filter(Boolean).join('；').slice(0, 520);
}

function getRecentMessages(payload = {}) {
  const raw = Array.isArray(payload.recentMessages) ? payload.recentMessages : [];
  return raw
    .map(message => ({
      role: String(message?.role || '').trim() || 'assistant',
      content: cleanText(message?.content || '', 120)
    }))
    .filter(message => message.content && !isOperationalMessage(message.content));
}

function getRecentUserMessages(payload = {}) {
  return getRecentMessages(payload)
    .filter(message => message.role === 'user')
    .map(message => message.content);
}

function getMusicContext(payload = {}) {
  return payload.musicContext || payload.sessionContext?.musicContext || {};
}

function isOperationalMessage(text = '') {
  const compact = String(text || '').replace(/\s+/g, '');
  return /^(AI)?原创?(下一首|电台|启动AI原创电台|启动电台|换一首|切歌|跳过)$/.test(compact)
    || /^(下一首|换一首|切歌|跳过|喜欢|不喜欢)$/.test(compact);
}

function inferMoment(payload = {}) {
  const signal = [
    ...getRecentUserMessages(payload),
    getMusicContext(payload).lastUserMessage,
    getMusicContext(payload).reason,
    (getMusicContext(payload).searchHints || []).join(' '),
    (getMusicContext(payload).preferenceHints || []).join(' '),
    payload.preferences?.note,
    payload.preferences?.moodMode,
    payload.mood
  ].map(value => String(value || '').toLowerCase()).join(' ');

  if (/饿|饥|吃饭|晚饭|午饭|早饭|夜宵|宵夜|外卖|食堂|hungry/.test(signal)) {
    return {
      label: '有点饿，适合轻暖、松弛、不过分刺激的陪伴感',
      title: '轻暖时刻',
      userState: '用户有点饿，情绪平稳',
      songGoal: '轻暖、松弛、有陪伴感',
      promptStyle: '轻暖中速，柔和贝斯，松弛鼓点，旋律明亮但不吵，像晚饭前后的陪伴感',
      introLine: '如果这会儿有一点饿',
      verseLine: '就把鼓点放轻 陪你等一口暖意',
      profileInfluenceLine: '把暖色的和弦悄悄铺进心里',
      chorusLine1: '让空空的心先被旋律抱住',
      chorusLine2: '把傍晚的光慢慢铺成归处',
      bridgeLine: '不催你马上热闹起来',
      outroLine: '等这一阵温柔慢慢落下'
    };
  }

  if (/累|困|疲惫|熬夜|睡觉|想睡|没精神|tired|sleep/.test(signal)) {
    return {
      label: '疲惫，需要低压、舒缓、能卸下紧绷感的音乐',
      title: '慢慢放松',
      userState: '用户有点累，需要放松',
      songGoal: '舒缓、低压、有安定感',
      promptStyle: '低到中速，柔软鼓组，温暖键盘或吉他，少量空气感合成器，整体舒缓不催促',
      introLine: '如果今天已经有一点累',
      verseLine: '就让灯光慢一点落在肩背',
      profileInfluenceLine: '把熟悉的温度藏进和声背面',
      chorusLine1: '把沉下来的呼吸交给旋律',
      chorusLine2: '不用再追赶谁的脚步声',
      bridgeLine: '把紧绷的地方慢慢松开',
      outroLine: '愿这一段陪你轻轻收尾'
    };
  }

  if (/学习|写作业|复习|考试|写代码|工作|专注|focus|study|code/.test(signal)) {
    return {
      label: '需要专注，适合稳定节奏、低干扰、清晰线条',
      title: '专注流速',
      userState: '用户需要专注，情绪稳定',
      songGoal: '稳定、低干扰、有流动感',
      promptStyle: '稳定中速，低干扰旋律，清晰鼓点，少歌词密度，适合写作业、学习或写代码时保持流动',
      introLine: '把桌面上的光调成安静',
      verseLine: '让杂念退到窗外的远处',
      profileInfluenceLine: '把清晰的线条留在每个小节',
      chorusLine1: '节奏一格一格推着时间',
      chorusLine2: '思绪在干净的线条里前进',
      bridgeLine: '旋律留白 不抢走注意力',
      outroLine: '把这一页慢慢写完整'
    };
  }

  if (/难过|低落|emo|焦虑|烦|崩溃|委屈|sad|anxious/.test(signal)) {
    return {
      label: '情绪低落或焦虑，需要温柔托住、不过度煽情',
      title: '温柔托住',
      userState: '用户情绪有点低，需要被温柔托住',
      songGoal: '温柔、治愈、有承接感',
      promptStyle: '温柔慢速到中速，暖色和弦，轻鼓或钢琴铺底，情绪有承接但不夸张煽情',
      introLine: '如果心里有一点点下雨',
      verseLine: '就让和弦先替你撑住安静',
      profileInfluenceLine: '把柔软的音色放在离你很近的地方',
      chorusLine1: '不用把所有话一次说清',
      chorusLine2: '我把柔软留在每个尾音',
      bridgeLine: '让不安在拍子里慢慢变轻',
      outroLine: '等云层过去 还会有光'
    };
  }

  if (/开心|高兴|兴奋|爽|庆祝|快乐|happy|excited/.test(signal)) {
    return {
      label: '心情变亮，适合明亮、有弹性、但不过度吵闹的旋律',
      title: '发光心情',
      userState: '用户心情不错，状态明亮',
      songGoal: '明亮、轻快、有弹性',
      promptStyle: '明亮中速到偏快，弹性贝斯，清爽鼓点，副歌有抬升感，适合轻快好心情',
      introLine: '今天的光像刚刚刷新',
      verseLine: '把笑意放进跳动的贝斯里',
      profileInfluenceLine: '把明亮的音色撒在路口',
      chorusLine1: '让心情沿着拍子发光',
      chorusLine2: '每一步都轻轻踩出回响',
      bridgeLine: '把明亮留在副歌的边缘',
      outroLine: '让这份轻快多停一会儿'
    };
  }

  const mood = normalizeMoodWord(payload.preferences?.moodMode || payload.mood);
  return {
    label: `以${mood}为主，需要贴近当前对话而不是固定电台片头`,
    title: '此刻画像',
    userState: `用户当前状态偏${mood}`,
    songGoal: '贴近当下状态、有陪伴感',
    promptStyle: `围绕${mood}状态选择风格和能量，优先贴近最近聊天语境，避免片头曲和主持词`,
    introLine: '这一刻先不用急着回答',
    verseLine: '让节奏靠近你现在的方向',
    profileInfluenceLine: '把合适的音色藏在旋律深处',
    chorusLine1: '把此刻的心情写进声波',
    chorusLine2: '从熟悉的旋律里取一束光',
    bridgeLine: '让风格跟着你的状态转向',
    outroLine: '等这一段慢慢落下'
  };
}

function buildRecentLyricLine(payload = {}) {
  const latest = getRecentUserMessages(payload).at(-1);
  if (!latest) return '我听见此刻安静的变化';
  if (latest.length <= 18) return `你说 ${latest}`;
  return `我听见你说 ${latest.slice(0, 18)}...`;
}

function normalizeMoodWord(value) {
  const mood = String(value || '').toLowerCase();
  if (mood.includes('focus')) return '专注';
  if (mood.includes('calm')) return '平静';
  if (mood.includes('night')) return '深夜';
  if (mood.includes('comfort')) return '需要陪伴';
  if (mood.includes('random')) return '新鲜';
  return '元气';
}

function normalizeDurationMs(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return DEFAULT_DURATION_MS;
  return duration > 1000 ? Math.round(duration) : Math.round(duration * 1000);
}

function formatLrcTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.00`;
}

function cleanText(value, maxLength = 120) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanTextBlock(value, maxLength = 3500) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, maxLength);
}
