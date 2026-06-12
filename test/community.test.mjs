import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { clearCookie, getCookie, getCookieStatus, loadCookie, normalizeSongComments } from '../server/community.mjs';

test('environment cookie takes precedence over the cookie file', (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mymusic-cookie-'));
  const cookieFile = path.join(rootDir, 'netease_cookie.txt');
  const previousCookie = process.env.NETEASE_COOKIE;
  const previousCookieFile = process.env.NETEASE_COOKIE_FILE;
  fs.writeFileSync(cookieFile, 'cookie-from-file', 'utf8');
  process.env.NETEASE_COOKIE = 'cookie-from-environment';
  delete process.env.NETEASE_COOKIE_FILE;

  t.after(() => {
    clearCookie(rootDir);
    if (previousCookie === undefined) delete process.env.NETEASE_COOKIE;
    else process.env.NETEASE_COOKIE = previousCookie;
    if (previousCookieFile === undefined) delete process.env.NETEASE_COOKIE_FILE;
    else process.env.NETEASE_COOKIE_FILE = previousCookieFile;
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  assert.equal(loadCookie(rootDir), true);
  assert.equal(getCookie(), 'cookie-from-environment');
  assert.deepEqual(getCookieStatus(), {
    configured: true,
    hasCookie: true,
    source: 'environment'
  });
  assert.equal(fs.readFileSync(cookieFile, 'utf8'), 'cookie-from-file');
});

test('song comments normalize safe hot comments for danmaku', () => {
  const comments = normalizeSongComments({
    body: {
      hotComments: [
        { commentId: 1, content: '  第一条  评论\n很短 ', likedCount: 12, user: { nickname: 'Alice' } },
        { commentId: 2, content: '该评论已删除', likedCount: 3, user: { nickname: 'Bob' } },
        { commentId: 3, content: 'x'.repeat(120), likedCount: 9, user: { nickname: 'Long' } },
        { commentId: 1, content: '重复评论', likedCount: 1, user: { nickname: 'Dup' } },
        { commentId: 4, content: '适合飘过的一句', likedCount: 0, user: { nickname: '  Carol  ' } }
      ]
    }
  }, 10);

  assert.deepEqual(comments, [
    { id: '1', content: '第一条 评论 很短', nickname: 'Alice', likedCount: 12 },
    { id: '3', content: 'x'.repeat(120), nickname: 'Long', likedCount: 9 },
    { id: '4', content: '适合飘过的一句', nickname: 'Carol', likedCount: 0 }
  ]);
});

test('song comments use only hot comments and respect limit', () => {
  const comments = normalizeSongComments({
    hotComments: [
      { commentId: 'hot-a', content: '热门评论 A', user: { nickname: 'Hot A' } },
      { commentId: 'hot-b', content: '热门评论 B', user: { nickname: 'Hot B' } }
    ],
    comments: [
      { commentId: 'a', content: '普通评论 A', user: { nickname: 'A' } },
      { commentId: 'b', content: '普通评论 B', user: { nickname: 'B' } }
    ]
  }, 1);

  assert.deepEqual(comments, [
    { id: 'hot-a', content: '热门评论 A', nickname: 'Hot A', likedCount: 0 }
  ]);
});

test('song comments return empty list for invalid or empty payload', () => {
  assert.deepEqual(normalizeSongComments(null), []);
  assert.deepEqual(normalizeSongComments({ body: { hotComments: [{ content: '' }] } }), []);
});
