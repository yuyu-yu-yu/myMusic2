import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import {
  buildAvatarVideoFilter,
  getMotionPrompt,
  importAvatarVideo,
  normalizeMotion,
  parseCliArgs,
  validateAvatarMetadata
} from '../scripts/avatar-pipeline.mjs';

test('normalizes frontend aliases to generated motion names', () => {
  assert.equal(normalizeMotion('searching'), 'searching_music');
  assert.equal(normalizeMotion('reading'), 'reading_book');
  assert.equal(normalizeMotion('idle'), 'idle');
  assert.throws(() => normalizeMotion('dance'), /Unsupported motion/);
});

test('parses Windows-friendly CLI options', () => {
  assert.deepEqual(
    parseCliArgs(['--motion', 'idle', '--input', 'C:\\Downloads\\clip.mp4', '--force']),
    { motion: 'idle', input: 'C:\\Downloads\\clip.mp4', force: true }
  );
});

test('Jimeng prompts preserve identity and fixed camera constraints', () => {
  const prompt = getMotionPrompt('talking');
  assert.match(prompt, /参考图完全一致/);
  assert.match(prompt, /固定正方形镜头/);
  assert.match(prompt, /不要写实化/);
});

test('loop filter builds square 720p output with a crossfade seam', () => {
  const result = buildAvatarVideoFilter(5, 0.32);
  assert.equal(result.complex, true);
  assert.match(result.filter, /crop=/);
  assert.match(result.filter, /scale=720:720/);
  assert.match(result.filter, /xfade=/);
  assert.match(result.filter, /reverse/);
});

test('loop filter supports slower playback and optional interpolation', () => {
  const result = buildAvatarVideoFilter(5, 0.32, { speed: 0.5, interpolate: true });
  assert.equal(result.outputDuration, 10);
  assert.match(result.filter, /setpts=2\.000000\*PTS/);
  assert.match(result.filter, /minterpolate=fps=24/);
});

test('validates WebM codec, dimensions, duration, audio and size', () => {
  const valid = {
    streams: [{ codec_type: 'video', codec_name: 'vp9', width: 720, height: 720 }],
    format: { duration: '10.00', size: String(2 * 1024 * 1024) }
  };
  assert.deepEqual(validateAvatarMetadata(valid), []);

  const invalid = {
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
      { codec_type: 'audio', codec_name: 'aac' }
    ],
    format: { duration: '13.00', size: String(5 * 1024 * 1024) }
  };
  const errors = validateAvatarMetadata(invalid);
  assert.ok(errors.some((error) => error.includes('VP9')));
  assert.ok(errors.some((error) => error.includes('square')));
  assert.ok(errors.some((error) => error.includes('audio')));
  assert.ok(errors.some((error) => error.includes('duration')));
  assert.ok(errors.some((error) => error.includes('4 MB')));
});

test('imports a Jimeng MP4 without overwriting by default', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'avatar-pipeline-'));
  try {
    const input = path.join(rootDir, 'download.mp4');
    await writeFile(input, Buffer.from('test-video'));
    const destination = await importAvatarVideo({ input, motion: 'idle', rootDir });
    assert.equal(fs.existsSync(destination), true);
    assert.equal((await readFile(destination)).toString(), 'test-video');
    await assert.rejects(
      () => importAvatarVideo({ input, motion: 'idle', rootDir }),
      /Destination already exists/
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
