const DEFAULT_NAMESPACE = 'cancan-radio';
const globalMemoryStores = new Map();

export class EdgeOneStorageError extends Error {
  constructor(message = 'EdgeOne storage is unavailable.') {
    super(message);
    this.name = 'EdgeOneStorageError';
    this.status = 503;
    this.code = 'storage_unavailable';
  }
}

export class MemoryEdgeObjectStore {
  constructor(seed = {}) {
    this.items = new Map();
    for (const [key, value] of Object.entries(seed)) {
      this.items.set(key, cloneValue(value));
    }
  }

  async getJson(key, fallback = null) {
    return this.items.has(key) ? cloneValue(this.items.get(key)) : fallback;
  }

  async setJson(key, value) {
    this.items.set(key, cloneValue(value));
    return value;
  }

  async getBytes(key) {
    const value = this.items.get(key);
    if (!value || value.__bytes !== true) return null;
    return Buffer.from(value.base64, 'base64');
  }

  async setBytes(key, bytes, meta = {}) {
    const buffer = Buffer.from(bytes || []);
    this.items.set(key, {
      __bytes: true,
      base64: buffer.toString('base64'),
      meta: { ...meta },
      size: buffer.length,
      updatedAt: new Date().toISOString()
    });
    return { key, size: buffer.length };
  }

  async delete(key) {
    return this.items.delete(key);
  }

  async list(prefix = '') {
    return [...this.items.keys()].filter(key => key.startsWith(prefix)).sort();
  }
}

export async function createEdgeOneStore(context = {}, options = {}) {
  const namespace = options.namespace || process.env.EDGEONE_BLOB_STORE || DEFAULT_NAMESPACE;
  const injected = options.store || context.store || context.env?.CANCAN_STORE || context.env?.EDGEONE_STORE;
  if (injected) return wrapObjectStore(injected);

  const blobStore = await tryCreateBlobStore(namespace);
  if (blobStore) return blobStore;

  if (!globalMemoryStores.has(namespace)) globalMemoryStores.set(namespace, new MemoryEdgeObjectStore());
  return globalMemoryStores.get(namespace);
}

export function wrapObjectStore(store) {
  if (store?.getJson && store?.setJson) return store;
  return {
    async getJson(key, fallback = null) {
      if (typeof store.getJSON === 'function') {
        const value = await store.getJSON(key);
        return value === undefined || value === null ? fallback : value;
      }
      const raw = typeof store.get === 'function' ? await store.get(key) : null;
      if (raw === undefined || raw === null) return fallback;
      if (typeof raw === 'string') return parseJson(raw, fallback);
      if (raw && typeof raw.text === 'function') return parseJson(await raw.text(), fallback);
      if (raw instanceof Uint8Array || Buffer.isBuffer(raw)) return parseJson(Buffer.from(raw).toString('utf8'), fallback);
      return raw;
    },
    async setJson(key, value) {
      if (typeof store.setJSON === 'function') return store.setJSON(key, value);
      const text = JSON.stringify(value);
      if (typeof store.put === 'function') return store.put(key, text);
      if (typeof store.set === 'function') return store.set(key, text);
      throw new EdgeOneStorageError();
    },
    async getBytes(key) {
      const raw = typeof store.get === 'function' ? await store.get(key) : null;
      if (!raw) return null;
      if (raw instanceof Uint8Array || Buffer.isBuffer(raw)) return Buffer.from(raw);
      if (typeof raw.arrayBuffer === 'function') return Buffer.from(await raw.arrayBuffer());
      if (typeof raw === 'string') return Buffer.from(raw, 'base64');
      return null;
    },
    async setBytes(key, bytes, meta = {}) {
      const buffer = Buffer.from(bytes || []);
      if (typeof store.put === 'function') return store.put(key, buffer, meta);
      if (typeof store.set === 'function') return store.set(key, buffer, meta);
      throw new EdgeOneStorageError();
    },
    async delete(key) {
      if (typeof store.delete === 'function') return store.delete(key);
      if (typeof store.del === 'function') return store.del(key);
      return false;
    },
    async list(prefix = '') {
      if (typeof store.list === 'function') {
        const result = await store.list({ prefix });
        if (Array.isArray(result)) return result.map(item => typeof item === 'string' ? item : item.key).filter(Boolean);
        if (Array.isArray(result?.objects)) return result.objects.map(item => item.key).filter(Boolean);
        if (Array.isArray(result?.keys)) return result.keys.map(item => typeof item === 'string' ? item : item.name || item.key).filter(Boolean);
      }
      return [];
    }
  };
}

async function tryCreateBlobStore(namespace) {
  try {
    const mod = await import('@edgeone/pages-blob');
    const store = typeof mod.getStore === 'function' ? mod.getStore(namespace) : null;
    return store ? wrapObjectStore(store) : null;
  } catch {
    return null;
  }
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
