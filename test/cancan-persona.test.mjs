import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCanCanPersonaPrompt,
  shouldUseCanCanCreatorContext
} from '../server/cancan-persona.mjs';

test('CanCan name-origin questions trigger creator background', () => {
  const nameOriginQuestions = [
    '你知道自己名字的由来吗',
    '你知道你的名字的由来吗',
    '你为什么叫这个名字',
    '为什么叫灿灿',
    '灿灿这个叫法是谁取的'
  ];

  for (const question of nameOriginQuestions) {
    assert.equal(shouldUseCanCanCreatorContext(question), true, question);
    const prompt = buildCanCanPersonaPrompt(question);
    assert.match(prompt, /女朋友的名字/);
    assert.match(prompt, /同济大学本科生/);
  }
});

test('CanCan persona trigger avoids unrelated memory and project mentions', () => {
  assert.equal(shouldUseCanCanCreatorContext('你记得我喜欢什么歌吗？'), false);
  assert.equal(shouldUseCanCanCreatorContext('我最近在写一个 AI DJ 项目'), false);
  assert.equal(shouldUseCanCanCreatorContext('来首适合写代码的歌'), false);
});
