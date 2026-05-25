export const DEFAULT_PLAYBACK_SEQUENCE_LIMIT = 30;

export function normalizePlaybackSequenceState(state = {}) {
  const sequence = Array.isArray(state.sequence) ? state.sequence.filter(item => getPlaybackTrackId(item)) : [];
  const fallbackCursor = sequence.length ? sequence.length - 1 : -1;
  const requestedCursor = Number.isInteger(state.cursor) ? state.cursor : fallbackCursor;
  const cursor = sequence.length
    ? Math.max(0, Math.min(sequence.length - 1, requestedCursor))
    : -1;
  return { sequence, cursor };
}

export function getPlaybackTrackId(item = {}) {
  return String(item?.track?.id || item?.id || '').trim();
}

export function getCurrentPlaybackItem(state = {}) {
  const normalized = normalizePlaybackSequenceState(state);
  return normalized.cursor >= 0 ? normalized.sequence[normalized.cursor] || null : null;
}

export function getPreviousPlaybackItem(state = {}) {
  const normalized = normalizePlaybackSequenceState(state);
  return normalized.cursor > 0 ? normalized.sequence[normalized.cursor - 1] || null : null;
}

export function getNextPlaybackItem(state = {}) {
  const normalized = normalizePlaybackSequenceState(state);
  return normalized.cursor >= 0 && normalized.cursor < normalized.sequence.length - 1
    ? normalized.sequence[normalized.cursor + 1] || null
    : null;
}

export function canMovePlaybackPrevious(state = {}) {
  return Boolean(getPreviousPlaybackItem(state));
}

export function canMovePlaybackNext(state = {}) {
  return Boolean(getNextPlaybackItem(state));
}

export function movePlaybackCursor(state = {}, delta = 0) {
  const normalized = normalizePlaybackSequenceState(state);
  if (!normalized.sequence.length) return normalized;
  const cursor = Math.max(0, Math.min(normalized.sequence.length - 1, normalized.cursor + Number(delta || 0)));
  return { ...normalized, cursor };
}

export function addPlaybackItem(state = {}, item = null, options = {}) {
  const id = getPlaybackTrackId(item);
  const normalized = normalizePlaybackSequenceState(state);
  if (!id) return normalized;

  const limit = Math.max(1, Number(options.limit || DEFAULT_PLAYBACK_SEQUENCE_LIMIT));
  const truncateFuture = options.truncateFuture !== false;
  let sequence = normalized.sequence.slice();
  let cursor = normalized.cursor;
  const currentId = getPlaybackTrackId(sequence[cursor]);

  if (currentId === id) {
    sequence[cursor] = item;
    return { sequence, cursor };
  }

  if (truncateFuture && cursor >= 0 && cursor < sequence.length - 1) {
    sequence = sequence.slice(0, cursor + 1);
  }

  const tailId = getPlaybackTrackId(sequence.at(-1));
  if (tailId === id) {
    sequence[sequence.length - 1] = item;
    cursor = sequence.length - 1;
  } else {
    sequence.push(item);
    cursor = sequence.length - 1;
  }

  if (sequence.length > limit) {
    const overflow = sequence.length - limit;
    sequence = sequence.slice(overflow);
    cursor = Math.max(0, cursor - overflow);
  }

  return { sequence, cursor };
}
