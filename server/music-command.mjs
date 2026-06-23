import { generateChatCompletion } from './ai.mjs';

export const MUSIC_COMMAND_ACTIONS = Object.freeze({
  CHAT_ONLY: 'chat_only',
  ASK_FOLLOWUP: 'ask_followup',
  RECOMMEND_AND_PLAY: 'recommend_and_play',
  CONTINUE_CURRENT_SONG: 'continue_current_song',
  UPDATE_CONSTRAINTS: 'update_constraints',
  ADJUST_CONCERT: 'adjust_concert'
});

export const MUSIC_VOCAL_POLICIES = Object.freeze({
  ANY: 'any',
  INSTRUMENTAL_ONLY: 'instrumental_only',
  VOCAL_REQUIRED: 'vocal_required'
});

const MUSIC_COMMAND_TIMEOUT_MS = 4000;
const COMMAND_FALLBACK_SENTINEL = '__MUSIC_COMMAND_FALLBACK__';
const ALLOWED_CONSTRAINT_TYPES = new Set(['term', 'language', 'style', 'artist', 'song', 'vocal']);
const ALLOWED_CONSTRAINT_OPERATIONS = new Set(['add', 'remove', 'clear']);

export async function compileMusicCommand({
  config = {},
  text = '',
  history = [],
  currentTrack = null,
  activeConcert = null,
  sessionConstraints = {},
  mode = {},
  baseMood = {},
  environmentContext = {},
  memoryContext = {}
} = {}) {
  const input = String(text || '').trim();
  const quick = compileDeterministicControl(input);
  if (quick) return quick;

  const startedAt = Date.now();
  if (config?.llm?.baseUrl && config?.llm?.apiKey && config?.llm?.model) {
    const raw = await withTimeout(
      generateChatCompletion(config.llm, buildCompilerMessages({
        text: input,
        history,
        currentTrack,
        activeConcert,
        sessionConstraints,
        mode,
        baseMood,
        environmentContext,
        memoryContext
      }), () => COMMAND_FALLBACK_SENTINEL),
      MUSIC_COMMAND_TIMEOUT_MS,
      COMMAND_FALLBACK_SENTINEL
    );
    if (raw !== COMMAND_FALLBACK_SENTINEL) {
      try {
        const parsed = parseJsonObject(raw);
        const command = applySemanticSafetyGuards(
          normalizeMusicCommand(parsed, { text: input }),
          input,
          { currentTrack, activeConcert, mode, baseMood }
        );
        if (command.confidence >= 0.55) {
          return {
            ...command,
            source: 'llm',
            latencyMs: Date.now() - startedAt,
            fallbackReason: ''
          };
        }
      } catch {}
    }
  }

  const fallbackReason = config?.llm?.baseUrl && config?.llm?.apiKey && config?.llm?.model
    ? 'model_unavailable_invalid_or_low_confidence'
    : 'model_not_configured';
  return {
    ...compileMusicCommandFallback(input, {
      currentTrack,
      activeConcert,
      sessionConstraints,
      mode,
      baseMood
    }),
    latencyMs: Date.now() - startedAt,
    fallbackReason
  };
}

function applySemanticSafetyGuards(command, text, context) {
  if (rejectsAllMusic(text)) {
    const deterministic = compileMusicCommandFallback(text, context);
    return {
      ...command,
      action: MUSIC_COMMAND_ACTIONS.CHAT_ONLY,
      targets: deterministic.targets,
      switchNow: false,
      normalizedSummary: deterministic.normalizedSummary,
      confidence: Math.max(command.confidence, deterministic.confidence),
      conflictCorrected: command.action !== MUSIC_COMMAND_ACTIONS.CHAT_ONLY || command.switchNow
    };
  }
  if (rejectsInstrumental(text) || allowsInstrumentalAgain(text) || requiresInstrumental(text)) {
    const deterministic = compileMusicCommandFallback(text, context);
    return {
      ...command,
      action: deterministic.action,
      targets: deterministic.targets,
      constraints: deterministic.constraints,
      vocalPolicy: deterministic.vocalPolicy,
      switchNow: deterministic.switchNow,
      scope: deterministic.scope,
      normalizedSummary: deterministic.normalizedSummary,
      confidence: Math.max(command.confidence, deterministic.confidence),
      conflictCorrected: command.vocalPolicy !== deterministic.vocalPolicy ||
        JSON.stringify(command.constraints) !== JSON.stringify(deterministic.constraints)
    };
  }
  return command;
}

export function compileMusicCommandFallback(text = '', {
  currentTrack = null,
  activeConcert = null,
  mode = {},
  baseMood = {}
} = {}) {
  const input = String(text || '').trim();
  const lower = input.toLowerCase();
  const result = createEmptyMusicCommand(input, 'fallback');
  const activeConcertPlaying = Boolean(activeConcert && activeConcert.phase === 'playing');
  const adjustConcert = activeConcertPlaying && /后面|接下来|剩下|后半场|下一幕/.test(input);

  if (!input) {
    return finalizeCommand({
      ...result,
      action: MUSIC_COMMAND_ACTIONS.RECOMMEND_AND_PLAY,
      confidence: 1,
      normalizedSummary: '继续当前电台'
    });
  }

  if (/恢复正常推荐|取消(?:全部|所有).*(?:限制|禁听|偏好|模式)|清空.*(?:限制|禁听)/.test(input)) {
    return finalizeCommand({
      ...result,
      action: MUSIC_COMMAND_ACTIONS.UPDATE_CONSTRAINTS,
      constraints: [{ operation: 'clear', type: 'term', value: '', scope: 'session' }],
      confidence: 1,
      normalizedSummary: '清除本次对话的临时音乐限制'
    });
  }

  if (allowsInstrumentalAgain(input)) {
    return finalizeCommand({
      ...result,
      action: MUSIC_COMMAND_ACTIONS.UPDATE_CONSTRAINTS,
      vocalPolicy: MUSIC_VOCAL_POLICIES.ANY,
      constraints: [{ operation: 'remove', type: 'vocal', value: 'instrumental', scope: 'session' }],
      confidence: 1,
      normalizedSummary: '取消本次对话对纯音乐的限制'
    });
  }

  if (rejectsInstrumental(input)) {
    return finalizeCommand({
      ...result,
      action: adjustConcert ? MUSIC_COMMAND_ACTIONS.ADJUST_CONCERT : MUSIC_COMMAND_ACTIONS.RECOMMEND_AND_PLAY,
      vocalPolicy: MUSIC_VOCAL_POLICIES.VOCAL_REQUIRED,
      constraints: [{ operation: 'add', type: 'vocal', value: 'instrumental', scope: 'session' }],
      switchNow: !adjustConcert,
      targets: {
        ...result.targets,
        searchHints: removeConflictingHints(extractPositiveMusicHints(input), ['纯音乐', '伴奏', '无人声', '无歌词', 'instrumental'])
      },
      confidence: 1,
      normalizedSummary: adjustConcert ? '后续曲目避开纯音乐' : '本次对话避开纯音乐'
    });
  }

  if (requiresInstrumental(input)) {
    return finalizeCommand({
      ...result,
      action: adjustConcert ? MUSIC_COMMAND_ACTIONS.ADJUST_CONCERT : MUSIC_COMMAND_ACTIONS.RECOMMEND_AND_PLAY,
      vocalPolicy: MUSIC_VOCAL_POLICIES.INSTRUMENTAL_ONLY,
      constraints: persistentNegativeVocalRequest(input)
        ? [{ operation: 'add', type: 'vocal', value: 'vocal', scope: 'session' }]
        : [],
      switchNow: !adjustConcert && /不想听|不要|别放|换|切|下一首/.test(input),
      targets: {
        ...result.targets,
        searchHints: uniqueStrings(['纯音乐', ...extractPositiveMusicHints(input)], 8)
      },
      confidence: 1,
      normalizedSummary: adjustConcert ? '后续曲目只使用纯音乐' : '推荐纯音乐'
    });
  }

  const genericConstraints = parseGenericNegativeConstraints(input);
  if (genericConstraints.length) {
    const currentOnly = /不想听(?:这首|这歌|这个版本|这版|它|当前)|这(?:首|歌|个版本|版).{0,8}不想听/.test(input);
    return finalizeCommand({
      ...result,
      action: adjustConcert ? MUSIC_COMMAND_ACTIONS.ADJUST_CONCERT : MUSIC_COMMAND_ACTIONS.RECOMMEND_AND_PLAY,
      constraints: currentOnly ? [] : genericConstraints,
      switchNow: !adjustConcert,
      targets: {
        ...result.targets,
        searchHints: removeConflictingHints(extractPositiveMusicHints(input), genericConstraints.map(item => item.value))
      },
      confidence: 0.94,
      normalizedSummary: currentOnly
        ? '切换当前歌曲'
        : `本次对话避开${genericConstraints.map(item => item.value).join('、')}`
    });
  }

  if (isPlaybackControl(input)) {
    return finalizeCommand({
      ...result,
      action: MUSIC_COMMAND_ACTIONS.CONTINUE_CURRENT_SONG,
      confidence: 1,
      normalizedSummary: /暂停|停一下|pause/i.test(input) ? '暂停当前播放' : '继续当前播放'
    });
  }

  if (isUnmodifiedNextRequest(input)) {
    return finalizeCommand({
      ...result,
      action: MUSIC_COMMAND_ACTIONS.RECOMMEND_AND_PLAY,
      switchNow: true,
      confidence: 1,
      normalizedSummary: '切换到下一首歌曲'
    });
  }

  if (rejectsAllMusic(input)) {
    return finalizeCommand({
      ...result,
      action: MUSIC_COMMAND_ACTIONS.CHAT_ONLY,
      targets: {
        ...result.targets,
        mood: baseMood?.mood || '',
        energy: baseMood?.energy || '',
        searchHints: uniqueStrings(extractPositiveMusicHints(input), 8)
      },
      confidence: 1,
      normalizedSummary: '暂不播放音乐'
    });
  }

  if (/我是|我是一名|我叫|我在读|我的专业|我专业|我来自|我住在|我今年|我最近|今天发生|今天我|最近我/.test(input)) {
    return finalizeCommand({
      ...result,
      action: MUSIC_COMMAND_ACTIONS.ASK_FOLLOWUP,
      confidence: 0.94,
      normalizedSummary: '回应听众分享的个人情况'
    });
  }

  if (/睡不着|失眠|准备睡觉|要睡了|睡觉啦|心情不好|难受|吵架|崩溃|委屈|emo|低落|伤心|难过|烦|累|疲惫|写代码.*麻|代码.*麻|有点累/.test(input)) {
    return finalizeCommand({
      ...result,
      action: MUSIC_COMMAND_ACTIONS.ASK_FOLLOWUP,
      targets: {
        ...result.targets,
        mood: baseMood?.mood || '',
        energy: baseMood?.energy || '',
        searchHints: uniqueStrings(extractPositiveMusicHints(input), 8)
      },
      confidence: 0.88,
      normalizedSummary: '先回应听众当前状态'
    });
  }

  const searchHints = extractPositiveMusicHints(input);
  const explicitMusic = isDirectMusicRequest(input);
  return finalizeCommand({
    ...result,
    action: adjustConcert
      ? MUSIC_COMMAND_ACTIONS.ADJUST_CONCERT
      : explicitMusic
        ? MUSIC_COMMAND_ACTIONS.RECOMMEND_AND_PLAY
        : baseMood?.shouldRecommend
          ? MUSIC_COMMAND_ACTIONS.ASK_FOLLOWUP
          : MUSIC_COMMAND_ACTIONS.CHAT_ONLY,
    switchNow: explicitMusic && /下一首|换一首|换歌|切歌|跳过/.test(input),
    targets: {
      ...result.targets,
      artist: extractTarget(input, /(?:想听|听|放|播放|来点|推荐)([^，。？！,.!?]{2,24}?)(?:的歌|的音乐|作品)/),
      song: extractTarget(input, /(?:听|放|播放|来一首|点播)[《“"]?([^》”"，。？！,.!?]{2,32})[》”"]?/),
      scene: extractTarget(input, /(?:适合|正在|用于)([^，。？！,.!?]{2,20})(?:的歌|音乐|听)/),
      mood: baseMood?.mood || '',
      energy: baseMood?.energy || '',
      searchHints: uniqueStrings(searchHints, 8)
    },
    styleConstraint: input.styleConstraint && typeof input.styleConstraint === 'object' ? input.styleConstraint : null,
    styleSearchQueries: uniqueStrings([
      ...(Array.isArray(input.searchQueries) ? input.searchQueries : []),
      ...(Array.isArray(input.styleSearchQueries) ? input.styleSearchQueries : []),
      ...(Array.isArray(input.styleConstraint?.searchQueries) ? input.styleConstraint.searchQueries : [])
    ], 8),
    confidence: explicitMusic ? 0.9 : 0.72,
    normalizedSummary: explicitMusic
      ? `按${searchHints.join('、') || mode?.genre || '当前要求'}推荐音乐`
      : '继续聊天'
  });
}

export function normalizeMusicCommand(input = {}, { text = '' } = {}) {
  const base = createEmptyMusicCommand(text || input.originalText || '', input.source || 'llm');
  const action = normalizeAction(input.action) || MUSIC_COMMAND_ACTIONS.CHAT_ONLY;
  const constraints = normalizeConstraints(input.constraints);
  const vocalPolicy = normalizeVocalPolicy(input.vocalPolicy);
  const negativeValues = constraints
    .filter(item => item.operation === 'add')
    .map(item => item.value)
    .filter(Boolean);
  const rawTargets = input.targets && typeof input.targets === 'object' ? input.targets : {};
  const searchHints = removeConflictingHints([
    ...(Array.isArray(rawTargets.searchHints) ? rawTargets.searchHints : []),
    ...(Array.isArray(input.searchHints) ? input.searchHints : [])
  ], negativeValues);
  return finalizeCommand({
    ...base,
    action,
    targets: {
      artist: cleanText(rawTargets.artist),
      song: cleanText(rawTargets.song),
      language: cleanText(rawTargets.language),
      style: cleanText(rawTargets.style),
      scene: cleanText(rawTargets.scene),
      mood: cleanText(rawTargets.mood || input.mood),
      energy: cleanText(rawTargets.energy || input.energy),
      searchHints: uniqueStrings(searchHints, 8)
    },
    constraints,
    vocalPolicy,
    switchNow: input.switchNow === true,
    scope: input.scope === 'account' ? 'account' : 'session',
    confidence: clampConfidence(input.confidence),
    needsClarification: input.needsClarification === true,
    normalizedSummary: cleanText(input.normalizedSummary || input.summary || input.reason).slice(0, 120),
    conflictCorrected: input.conflictCorrected === true
  });
}

export function commandHasConstraintChanges(command = {}) {
  return Array.isArray(command.constraints) && command.constraints.length > 0;
}

function buildCompilerMessages({
  text,
  history,
  currentTrack,
  activeConcert,
  sessionConstraints,
  mode,
  baseMood,
  environmentContext,
  memoryContext
}) {
  return [
    {
      role: 'system',
      content: [
        '你是音乐电台的统一语义编译器，替代旧的轻量意图路由器。把听众自然语言转换为严格 JSON，不写回复，不选歌。',
        '普通聊天如果没有询问当前歌曲，不要主动提及歌名，也不要根据当前歌曲擅自切歌。',
        '否定词必须与它修饰的对象绑定，禁止把负向对象放入正向 searchHints。',
        '例：“不想听纯音乐”表示需要有人声，vocalPolicy=vocal_required，并添加 vocal/instrumental 禁听限制；绝不是想听纯音乐。',
        '例：“不想听有人声”表示 vocalPolicy=instrumental_only；“不要没有人声”表示 vocalPolicy=vocal_required。',
        '未说明持续时间的“不想听/不要/别放”默认 scope=session。',
        'action 只能是 chat_only、ask_followup、recommend_and_play、continue_current_song、update_constraints、adjust_concert。',
        'constraints 数组元素格式：{"operation":"add|remove|clear","type":"term|language|style|artist|song|vocal","value":"值","scope":"session"}。',
        'vocal 类型 value 只能是 instrumental 或 vocal。',
        'vocalPolicy 只能是 any、instrumental_only、vocal_required。',
        '明确且精确的曲风请求可附加 styleConstraint：{"strict":true,"requiredGroups":[["同义词"]],"softTerms":[],"negativeTerms":[],"searchQueries":[]}。',
        '当前或后续歌曲需要立刻切换时 switchNow=true。音乐会中“后面/接下来/剩下”应 action=adjust_concert 且通常 switchNow=false。',
        '输出格式：{"action":"...","targets":{"artist":"","song":"","language":"","style":"","scene":"","mood":"","energy":"","searchHints":[]},"constraints":[],"vocalPolicy":"any","styleConstraint":null,"searchQueries":[],"switchNow":false,"scope":"session","confidence":0.0,"needsClarification":false,"normalizedSummary":"简短正式中文"}'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `听众输入：${text}`,
        `当前歌曲：${JSON.stringify(currentTrackForCompiler(text, currentTrack))}`,
        `活动音乐会：${JSON.stringify(activeConcert ? { phase: activeConcert.phase, currentIndex: activeConcert.currentIndex, remaining: Math.max(0, (activeConcert.items?.length || 0) - Number(activeConcert.currentIndex || 0) - 1) } : null)}`,
        `现有会话限制：${JSON.stringify(sessionConstraints || {})}`,
        `当前模式：${JSON.stringify(mode || {})}`,
        `启发式情绪：${JSON.stringify(baseMood || {})}`,
        `环境：${JSON.stringify(environmentContext || {})}`,
        `相关长期记忆：${memoryContext?.promptText || '无'}`,
        `会话摘要：${memoryContext?.sessionSummary || '无'}`,
        `最近对话：${history.slice(-6).map(item => `${item.role}: ${item.content}`).join('\n') || '无'}`
      ].join('\n')
    }
  ];
}

function currentTrackForCompiler(text, currentTrack) {
  if (!currentTrack) return null;
  if (!/(这首|这歌|当前|现在放的|正在放的|上一首|他的另一首|她的另一首|这个歌手|这位歌手|这个版本|这版|歌名|谁唱|当前歌曲)/.test(String(text || ''))) {
    return null;
  }
  return {
    id: currentTrack.id || currentTrack.trackId || '',
    name: currentTrack.name || '',
    artists: Array.isArray(currentTrack.artists) ? currentTrack.artists : [],
    semanticTags: currentTrack.semanticTags || null,
    language: currentTrack.language || '',
    genreFamily: currentTrack.genreFamily || ''
  };
}

function compileDeterministicControl(text) {
  const input = String(text || '').trim();
  if (!input) return null;
  if (isUnmodifiedRejectAllMusic(input)) {
    return finalizeCommand({
      ...createEmptyMusicCommand(input, 'hard_rule'),
      action: MUSIC_COMMAND_ACTIONS.CHAT_ONLY,
      confidence: 1,
      normalizedSummary: '暂不播放音乐'
    });
  }
  if (/^(下一首|换一首|换歌|切歌|跳过|skip)$/i.test(input)) {
    return finalizeCommand({
      ...createEmptyMusicCommand(input, 'hard_rule'),
      action: MUSIC_COMMAND_ACTIONS.RECOMMEND_AND_PLAY,
      switchNow: true,
      confidence: 1,
      normalizedSummary: '切换到下一首歌曲'
    });
  }
  if (/^(暂停|停一下|继续播放|继续放|接着放|resume|pause)$/i.test(input)) {
    return finalizeCommand({
      ...createEmptyMusicCommand(input, 'hard_rule'),
      action: MUSIC_COMMAND_ACTIONS.CONTINUE_CURRENT_SONG,
      confidence: 1,
      normalizedSummary: /暂停|停一下|pause/i.test(input) ? '暂停当前播放' : '继续当前播放'
    });
  }
  return null;
}

function createEmptyMusicCommand(originalText, source) {
  return {
    version: 1,
    originalText: String(originalText || ''),
    action: MUSIC_COMMAND_ACTIONS.CHAT_ONLY,
    targets: {
      artist: '',
      song: '',
      language: '',
      style: '',
      scene: '',
      mood: '',
      energy: '',
      searchHints: []
    },
    styleConstraint: null,
    styleSearchQueries: [],
    constraints: [],
    vocalPolicy: MUSIC_VOCAL_POLICIES.ANY,
    switchNow: false,
    scope: 'session',
    confidence: 0,
    needsClarification: false,
    normalizedSummary: '',
    source,
    latencyMs: 0,
    fallbackReason: ''
  };
}

function finalizeCommand(command) {
  const normalized = {
    ...command,
    targets: {
      ...createEmptyMusicCommand('', '').targets,
      ...(command.targets || {}),
      searchHints: uniqueStrings(command.targets?.searchHints || [], 8)
    },
    constraints: normalizeConstraints(command.constraints),
    vocalPolicy: normalizeVocalPolicy(command.vocalPolicy),
    confidence: clampConfidence(command.confidence),
    normalizedSummary: cleanText(command.normalizedSummary).slice(0, 120)
  };
  const negativeValues = normalized.constraints
    .filter(item => item.operation === 'add')
    .map(item => item.value);
  normalized.targets.searchHints = removeConflictingHints(normalized.targets.searchHints, negativeValues);
  if (normalized.vocalPolicy === MUSIC_VOCAL_POLICIES.VOCAL_REQUIRED) {
    normalized.targets.searchHints = removeConflictingHints(normalized.targets.searchHints, ['纯音乐', '伴奏', '无人声', '无歌词', 'instrumental']);
  }
  return normalized;
}

function normalizeConstraints(input) {
  const values = Array.isArray(input) ? input : [];
  const seen = new Set();
  const result = [];
  for (const item of values) {
    if (!item || typeof item !== 'object') continue;
    const operation = ALLOWED_CONSTRAINT_OPERATIONS.has(item.operation) ? item.operation : 'add';
    const type = ALLOWED_CONSTRAINT_TYPES.has(item.type) ? item.type : 'term';
    let value = cleanText(item.value);
    if (type === 'vocal') {
      value = value === 'vocal' ? 'vocal' : value === 'instrumental' ? 'instrumental' : '';
    }
    if (operation !== 'clear' && !value) continue;
    const key = `${operation}:${type}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ operation, type, value, scope: 'session' });
  }
  return result.slice(0, 16);
}

function normalizeAction(value) {
  const action = String(value || '').trim().toLowerCase();
  return Object.values(MUSIC_COMMAND_ACTIONS).includes(action) ? action : '';
}

function normalizeVocalPolicy(value) {
  const policy = String(value || '').trim().toLowerCase();
  return Object.values(MUSIC_VOCAL_POLICIES).includes(policy) ? policy : MUSIC_VOCAL_POLICIES.ANY;
}

function rejectsInstrumental(text) {
  const value = String(text || '');
  return /(?:不想听|不听|不要|别放|别听|不喜欢|避开|少放)(?:这类|这种|这些|一点|一些|任何)?(?:纯音乐|伴奏|器乐|无人声|无歌词|instrumental)/i.test(value)
    || /(?:不要|不想听|别放|避开)(?:没有人声|没歌词|没有歌词)/i.test(value)
    || /不要没有人声|不想听没有人声|别放没有人声/i.test(value);
}

function allowsInstrumentalAgain(text) {
  const value = String(text || '');
  return /可以(?:再)?听纯音乐|可以放纯音乐|纯音乐也可以|取消纯音乐(?:限制|禁听)|解除纯音乐(?:限制|禁听)|不用避开纯音乐/i.test(value);
}

function requiresInstrumental(text) {
  const value = String(text || '');
  if (rejectsInstrumental(value)) return false;
  return /(?:只听|只要|想听|来点|放点|播放|推荐|不要|不想听|别放)(?:这类|这种|这些|一点|一些)?(?:纯音乐|伴奏|器乐|无人声|无歌词|instrumental)/i.test(value)
    || /(?:只听|只要|想听|来点|放|播放|推荐).{0,16}(?:纯音乐|伴奏|器乐|无人声|无歌词|instrumental)/i.test(value)
    || /(?:不要|不想听|别放)(?:有人声|有歌词)/i.test(value);
}

function persistentNegativeVocalRequest(text) {
  return /(?:不要|不想听|不听|别放|避开)(?:有人声|有歌词)/i.test(String(text || ''));
}

function parseGenericNegativeConstraints(text) {
  const value = String(text || '');
  const result = [];
  const pattern = /(?:今晚|今天|后面|以后|接下来|之后|下面|本场|这场|暂时)?(?:都)?(?:不要再听|别再听|别再放|不要听|不再听|不想再听|不想听|不听|不要|别放|少放|不喜欢)([^，。？！,.!?]{1,40})/g;
  let match = null;
  while ((match = pattern.exec(value))) {
    const target = cleanConstraintTarget(match[1]);
    if (!target || /^(这首|这歌|这个版本|这版|当前|它|他|她)$/.test(target)) continue;
    for (const item of target.split(/(?:和|跟|与|及|还有|以及|、|，|,|\/|&|\+)+/)) {
      const clean = cleanConstraintTarget(item);
      if (clean) result.push({ operation: 'add', type: 'term', value: clean, scope: 'session' });
    }
  }
  return normalizeConstraints(result);
}

function cleanConstraintTarget(value) {
  return String(value || '')
    .replace(/[《》"'“”‘’]/g, '')
    .replace(/^(再|给我|帮我|请|一点|一些|这类|这种|这些)+/g, '')
    .replace(/(?:的)?(?:歌曲|歌手|作品|音乐|艺人|这类|这种|这些|歌|了|吧|啦)+$/g, '')
    .trim()
    .slice(0, 24);
}

function rejectsAllMusic(text) {
  return /不想听(?:歌|音乐)|先别放(?:歌|音乐)?|不要放(?:歌|音乐)?|别放(?:歌|音乐)?|先聊|陪我聊|不放歌|只是聊/.test(String(text || ''));
}

function isUnmodifiedRejectAllMusic(text) {
  const value = String(text || '').trim();
  return /^(?:(?:先)?(?:别|不要|不用|不想|不)放(?:歌|音乐)?(?:了)?(?:[，,\s]*(?:先)?(?:聊聊|陪我聊|只聊(?:聊)?)(?:吧)?)?|(?:别|不要|先别)切歌[，,\s]*(?:先)?聊聊(?:吧)?|(?:先)?(?:聊聊|陪我聊|只聊(?:聊)?)(?:吧)?)[。！!]?$/i.test(value);
}

function isPlaybackControl(text) {
  return /暂停|停一下|继续播放|继续放|接着放|resume|pause/i.test(String(text || ''));
}

function isUnmodifiedNextRequest(text) {
  return /^(下一首|换一首|换歌|切歌|跳过|skip)$/i.test(String(text || '').trim());
}

function isDirectMusicRequest(text) {
  const value = String(text || '');
  if (rejectsAllMusic(value)) return false;
  return /(?:想听|听听|来首|来一首|来点|放一首|放一点|放一些|放点|播放|推荐|给我放|帮我放|下一首|换一首|换歌|切歌|跳过).{0,28}(?:歌|音乐|曲|BGM|歌手|风格|曲风|场景|纯音乐|伴奏|国语|粤语|英语|日语|摇滚|民谣|电子|爵士|说唱)?/i.test(value);
}

function extractPositiveMusicHints(text) {
  const value = String(text || '');
  const patterns = ['国风', '古风', '电子', 'EDM', '摇滚', '民谣', '爵士', '说唱', '粤语', '日语', '英语', '中文', '安静', '治愈', '伤感', '开心', '提神', '专注', '睡前', '纯音乐', '伴奏', '无人声', '有人声'];
  return patterns.filter(item => value.toLowerCase().includes(item.toLowerCase()));
}

function removeConflictingHints(values, blockedValues) {
  const blocked = (blockedValues || []).map(item => normalizeText(item)).filter(Boolean);
  return uniqueStrings(values, 12).filter(value => {
    const normalized = normalizeText(value);
    return !blocked.some(item => normalized.includes(item) || item.includes(normalized));
  });
}

function extractTarget(text, pattern) {
  const match = String(text || '').match(pattern);
  return cleanText(match?.[1]).slice(0, 40);
}

function parseJsonObject(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(text);
  } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('music command is not JSON');
  return JSON.parse(match[0]);
}

function cleanText(value) {
  return String(value || '').trim();
}

function normalizeText(value) {
  return cleanText(value).toLowerCase().replace(/[\s·•・_\-—–,，。.!！?？:：;；'"“”‘’()[\]（）【】《》]/g, '');
}

function uniqueStrings(values, limit = 8) {
  return [...new Set((values || []).map(cleanText).filter(Boolean))].slice(0, limit);
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

async function withTimeout(promise, timeoutMs, fallbackValue) {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise(resolve => {
        timer = setTimeout(() => resolve(fallbackValue), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
