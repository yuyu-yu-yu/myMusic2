import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { getSignContent, NeteaseClient, signParams } from '../server/netease.mjs';

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
