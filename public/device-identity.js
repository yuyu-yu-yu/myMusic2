export const DEMO_DEVICE_STORAGE_KEY = 'mymusic:demoDeviceId';
export const LEGACY_DEMO_VISITOR_STORAGE_KEY = 'mymusic:demoVisitorId';

const defaultVolatileState = { id: '' };

export function ensureDemoDeviceId({
  localStorage = globalThis.localStorage,
  sessionStorage = globalThis.sessionStorage,
  crypto = globalThis.crypto,
  volatileState = defaultVolatileState
} = {}) {
  const stored = readStorage(localStorage, DEMO_DEVICE_STORAGE_KEY);
  if (isValidDemoDeviceId(stored)) {
    volatileState.id = stored;
    return stored;
  }

  const legacy = readStorage(sessionStorage, LEGACY_DEMO_VISITOR_STORAGE_KEY);
  if (isValidDemoDeviceId(legacy)) {
    volatileState.id = legacy;
    writeStorage(localStorage, DEMO_DEVICE_STORAGE_KEY, legacy);
    removeStorage(sessionStorage, LEGACY_DEMO_VISITOR_STORAGE_KEY);
    return legacy;
  }

  if (isValidDemoDeviceId(volatileState.id)) return volatileState.id;

  const id = createDemoDeviceId(crypto);
  volatileState.id = id;
  writeStorage(localStorage, DEMO_DEVICE_STORAGE_KEY, id);
  return id;
}

export function rotateDemoDeviceId({
  localStorage = globalThis.localStorage,
  sessionStorage = globalThis.sessionStorage,
  crypto = globalThis.crypto,
  volatileState = defaultVolatileState
} = {}) {
  const previousId = ensureDemoDeviceId({ localStorage, sessionStorage, crypto, volatileState });
  let nextId = createDemoDeviceId(crypto);
  while (nextId === previousId) nextId = createDemoDeviceId(crypto);
  volatileState.id = nextId;
  writeStorage(localStorage, DEMO_DEVICE_STORAGE_KEY, nextId);
  removeStorage(sessionStorage, LEGACY_DEMO_VISITOR_STORAGE_KEY);
  return { previousId, nextId };
}

export function isValidDemoDeviceId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{7,80}$/.test(String(value || '').trim());
}

function createDemoDeviceId(crypto) {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readStorage(storage, key) {
  try {
    return String(storage?.getItem?.(key) || '').trim();
  } catch {
    return '';
  }
}

function writeStorage(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
  } catch {
    // A stable in-memory id remains available when browser storage is blocked.
  }
}

function removeStorage(storage, key) {
  try {
    storage?.removeItem?.(key);
  } catch {
    // Storage cleanup is best effort.
  }
}
