import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getSetting, openDatabase } from '../server/db.mjs';
import { extractQrAuthorizationCode, resolveQrOpenApiLogin } from '../server/netease-auth.mjs';
import { getSignContent, NeteaseClient, signParams } from '../server/netease.mjs';

function testDb(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-netease-'));
  const db = openDatabase(rootDir);
  t.after(() => {
    db.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
  return db;
}

test('getSignContent sorts params and removes sign/empty values', () => {
  const content = getSignContent({
    timestamp: '1591172872339',
    signType: 'RSA_SHA256',
    sign: 'remove-me',
    empty: '',
    appId: 'app',
    bizContent: '{"songId":"1"}'
  });
  assert.equal(content, 'appId=app&bizContent={"songId":"1"}&signType=RSA_SHA256&timestamp=1591172872339');
});

test('signParams creates verifiable SHA256WithRSA signature', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const params = {
    appId: 'app',
    signType: 'RSA_SHA256',
    timestamp: '1591172872339',
    bizContent: '{"songId":"1"}',
    device: '{"deviceId":"mymusiclocal001"}'
  };
  const sign = signParams(params, privatePem);
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(getSignContent(params), 'utf8');
  assert.equal(verifier.verify(publicPem, sign, 'base64'), true);
});

test('NeteaseClient refreshes token when business response reports accessToken expired', async () => {
  const privatePem = createPrivatePem();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    calls.push({ pathname: parsed.pathname, accessToken: parsed.searchParams.get('accessToken'), options });
    if (parsed.pathname.includes('/playlist/star/get')) {
      if (calls.length === 1) {
        return jsonResponse({ code: 1406, message: 'accessToken过期，请重新授权登录' });
      }
      return jsonResponse({ code: 200, data: { records: [{ id: 'pl-1', name: '喜欢的音乐' }] } });
    }
    if (parsed.pathname.includes('/token/refresh')) {
      return jsonResponse({
        code: 200,
        data: {
          accessToken: {
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token'
          }
        }
      });
    }
    return jsonResponse({ code: 404, message: 'unexpected request' });
  };

  try {
    const client = new NeteaseClient({
      appId: 'app',
      privateKey: privatePem,
      baseUrl: 'https://netease.test',
      device: { deviceId: 'device' }
    });
    let savedTokens = null;
    client.onTokenChange = (accessToken, refreshToken) => {
      savedTokens = { accessToken, refreshToken };
    };
    client.setTokens('old-access-token', 'refresh-token');

    const result = await client.starPlaylist();

    assert.equal(result.data.records[0].id, 'pl-1');
    assert.equal(calls.length, 3);
    assert.equal(calls[0].accessToken, 'old-access-token');
    assert.equal(calls[2].accessToken, 'new-access-token');
    assert.deepEqual(savedTokens, {
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token'
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('NeteaseClient QR login uses anonymous token instead of stale user token', async () => {
  const privatePem = createPrivatePem();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    if (parsed.pathname.includes('/login/anonymous')) {
      return jsonResponse({
        code: 200,
        data: {
          accessToken: 'anonymous-token',
          refreshToken: 'anonymous-refresh-token'
        }
      });
    }
    return jsonResponse({
      code: 200,
      data: {
        qrCodeUrl: 'https://163cn.tv/demo',
        uniKey: 'qr-key'
      }
    });
  };

  try {
    const client = new NeteaseClient({
      appId: 'app',
      privateKey: privatePem,
      baseUrl: 'https://netease.test',
      device: { deviceId: 'device' }
    });
    client.setTokens('expired-access-token', 'refresh-token');

    const result = await client.qrcode();

    assert.equal(result.data.uniKey, 'qr-key');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].searchParams.has('accessToken'), false);
    assert.equal(calls[1].searchParams.get('accessToken'), 'anonymous-token');
    assert.equal(calls[1].searchParams.get('accessToken') === 'expired-access-token', false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('NeteaseClient QR status sends key and clientId with anonymous token', async () => {
  const privatePem = createPrivatePem();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    if (parsed.pathname.includes('/login/anonymous')) {
      return jsonResponse({
        code: 200,
        data: {
          accessToken: 'anonymous-token',
          refreshToken: 'anonymous-refresh-token'
        }
      });
    }
    return jsonResponse({
      code: 200,
      data: {
        status: 801,
        msg: '等待扫码',
        accessToken: {
          accessToken: 'null',
          refreshToken: 'null'
        }
      }
    });
  };

  try {
    const client = new NeteaseClient({
      appId: 'app',
      privateKey: privatePem,
      baseUrl: 'https://netease.test',
      device: { deviceId: 'device' }
    });

    const result = await client.qrcodeStatus('qr-key');
    const checkCall = calls.find(call => call.pathname.includes('/qrcode/get'));
    const biz = JSON.parse(checkCall.searchParams.get('bizContent'));

    assert.equal(result.data.status, 801);
    assert.equal(checkCall.searchParams.get('accessToken'), 'anonymous-token');
    assert.deepEqual(biz, { key: 'qr-key', clientId: 'app' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('NeteaseClient throws when accessToken is expired and cannot refresh', async () => {
  const privatePem = createPrivatePem();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ code: 1406, message: 'accessToken过期，请重新授权登录' });

  try {
    const client = new NeteaseClient({
      appId: 'app',
      privateKey: privatePem,
      baseUrl: 'https://netease.test',
      device: { deviceId: 'device' }
    });
    client.setTokens('old-access-token', '');

    await assert.rejects(() => client.starPlaylist(), /accessToken过期/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('QR OpenAPI login saves direct accessToken payload', async (t) => {
  const db = testDb(t);
  const saved = [];
  const netease = {
    setTokens: (accessToken, refreshToken) => saved.push({ accessToken, refreshToken }),
    hasToken: () => Boolean(saved.at(-1)?.accessToken),
    userProfile: async () => ({ data: { profile: { userId: 'user-direct', nickname: 'Direct User' } } })
  };

  const result = await resolveQrOpenApiLogin({
    db,
    netease,
    result: {
      data: {
        status: 803,
        accessToken: {
          accessToken: 'direct-access',
          refreshToken: 'direct-refresh'
        }
      }
    }
  });

  assert.equal(result.loggedIn, true);
  assert.equal(result.tokenSource, 'direct');
  assert.deepEqual(saved.at(-1), { accessToken: 'direct-access', refreshToken: 'direct-refresh' });
  assert.equal(getSetting(db, 'netease_access_token'), 'direct-access');
  assert.equal(getSetting(db, 'netease_refresh_token'), 'direct-refresh');
  assert.equal(getSetting(db, 'netease_user_id'), 'user-direct');
  assert.equal(getSetting(db, 'netease_user_nickname'), 'Direct User');
});

test('QR OpenAPI login exchanges authorization code before saving token', async (t) => {
  const db = testDb(t);
  const calls = [];
  const saved = [];
  const netease = {
    tokenFromCode: async (code) => {
      calls.push(code);
      return {
        data: {
          accessToken: {
            accessToken: 'code-access',
            refreshToken: 'code-refresh'
          }
        }
      };
    },
    setTokens: (accessToken, refreshToken) => saved.push({ accessToken, refreshToken }),
    hasToken: () => Boolean(saved.at(-1)?.accessToken),
    userProfile: async () => ({ data: { profile: { userId: 'user-code', nickname: 'Code User' } } })
  };

  const result = await resolveQrOpenApiLogin({
    db,
    netease,
    result: { data: { status: 803, authorizationCode: 'auth-code-1' } }
  });

  assert.equal(result.loggedIn, true);
  assert.equal(result.tokenSource, 'authorization_code');
  assert.deepEqual(calls, ['auth-code-1']);
  assert.deepEqual(saved.at(-1), { accessToken: 'code-access', refreshToken: 'code-refresh' });
  assert.equal(getSetting(db, 'netease_access_token'), 'code-access');
  assert.equal(getSetting(db, 'netease_refresh_token'), 'code-refresh');
  assert.equal(getSetting(db, 'netease_user_id'), 'user-code');
});

test('QR OpenAPI login requires readable user profile before reporting logged in', async (t) => {
  const db = testDb(t);
  const saved = [];
  const netease = {
    setTokens: (accessToken, refreshToken) => saved.push({ accessToken, refreshToken }),
    hasToken: () => Boolean(saved.at(-1)?.accessToken),
    userProfile: async () => { throw new Error('profile unreadable'); }
  };

  const result = await resolveQrOpenApiLogin({
    db,
    netease,
    result: {
      data: {
        status: 803,
        accessToken: {
          accessToken: 'direct-access',
          refreshToken: 'direct-refresh'
        }
      }
    }
  });

  assert.equal(result.loggedIn, false);
  assert.equal(result.tokenSaved, true);
  assert.equal(result.hasToken, true);
  assert.equal(result.profileReadable, false);
  assert.match(result.loginMessage, /profile unreadable|重新扫码/);
  assert.equal(getSetting(db, 'netease_access_token'), 'direct-access');
  assert.equal(getSetting(db, 'netease_user_id'), null);
});

test('QR OpenAPI login does not treat QR status codes as authorization codes', async (t) => {
  const db = testDb(t);
  const netease = {
    tokenFromCode: async () => { throw new Error('should not exchange status code'); },
    setTokens: () => { throw new Error('should not save token'); },
    hasToken: () => false
  };

  const result = await resolveQrOpenApiLogin({
    db,
    netease,
    result: { data: { status: 803, code: 803 } }
  });

  assert.equal(result.loggedIn, false);
  assert.equal(result.tokenSaved, false);
  assert.equal(result.tokenSource, null);
  assert.equal(extractQrAuthorizationCode({ data: { status: 802, code: 802 } }), null);
});

function createPrivatePem() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}
