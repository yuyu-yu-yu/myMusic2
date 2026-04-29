import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { getSignContent, signParams } from '../server/netease.mjs';

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
