import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryEdgeObjectStore, wrapObjectStore } from '../server/edgeone-store.mjs';

test('memory EdgeOne store persists JSON and byte blobs independently', async () => {
  const store = new MemoryEdgeObjectStore();

  await store.setJson('devices/a/state', { note: 'alpha' });
  await store.setBytes('tts/a.mp3', Buffer.from('audio-bytes'));

  assert.deepEqual(await store.getJson('devices/a/state'), { note: 'alpha' });
  assert.equal((await store.getBytes('tts/a.mp3')).toString('utf8'), 'audio-bytes');
  assert.deepEqual(await store.list('devices/'), ['devices/a/state']);
  assert.deepEqual(await store.list('tts/'), ['tts/a.mp3']);
});

test('wrapped object store supports JSON helpers from Blob-like primitives', async () => {
  const raw = new Map();
  const wrapped = wrapObjectStore({
    async get(key) {
      return raw.get(key) ?? null;
    },
    async put(key, value) {
      raw.set(key, value);
    },
    async list({ prefix }) {
      return [...raw.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key }));
    }
  });

  await wrapped.setJson('shared/library/v1', { tracks: [{ id: '1' }] });

  assert.deepEqual(await wrapped.getJson('shared/library/v1'), { tracks: [{ id: '1' }] });
  assert.deepEqual(await wrapped.list('shared/'), ['shared/library/v1']);
});
