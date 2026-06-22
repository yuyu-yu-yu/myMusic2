import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEMO_DEVICE_STORAGE_KEY,
  LEGACY_DEMO_VISITOR_STORAGE_KEY,
  ensureDemoDeviceId,
  rotateDemoDeviceId
} from '../public/device-identity.js';

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function cryptoSequence(...ids) {
  let index = 0;
  return { randomUUID: () => ids[index++] || ids.at(-1) };
}

test('device identity migrates the tab-scoped visitor id into local storage', () => {
  const local = storage();
  const session = storage({ [LEGACY_DEMO_VISITOR_STORAGE_KEY]: 'legacy-visitor-1234' });
  const volatileState = { id: '' };

  const id = ensureDemoDeviceId({ localStorage: local, sessionStorage: session, volatileState });

  assert.equal(id, 'legacy-visitor-1234');
  assert.equal(local.getItem(DEMO_DEVICE_STORAGE_KEY), id);
  assert.equal(session.getItem(LEGACY_DEMO_VISITOR_STORAGE_KEY), null);
  assert.equal(ensureDemoDeviceId({ localStorage: local, sessionStorage: storage(), volatileState: { id: '' } }), id);
});

test('device identity persists across tabs and rotates on device reset', () => {
  const local = storage();
  const firstTab = ensureDemoDeviceId({
    localStorage: local,
    sessionStorage: storage(),
    crypto: cryptoSequence('device-first-1234'),
    volatileState: { id: '' }
  });
  const secondTab = ensureDemoDeviceId({
    localStorage: local,
    sessionStorage: storage(),
    crypto: cryptoSequence('unused-device-1234'),
    volatileState: { id: '' }
  });
  const rotated = rotateDemoDeviceId({
    localStorage: local,
    sessionStorage: storage(),
    crypto: cryptoSequence('device-second-5678'),
    volatileState: { id: '' }
  });

  assert.equal(firstTab, 'device-first-1234');
  assert.equal(secondTab, firstTab);
  assert.deepEqual(rotated, { previousId: firstTab, nextId: 'device-second-5678' });
  assert.equal(local.getItem(DEMO_DEVICE_STORAGE_KEY), 'device-second-5678');
});
