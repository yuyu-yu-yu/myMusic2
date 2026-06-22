#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  AVATAR_GENERATED_DIR,
  AVATAR_SOURCE,
  AVATAR_WEBM_DIR,
  ensureAvatarDirectories,
  getFfmpegPath,
  getFfprobePath,
  readSourceImageInfo,
  runProcess
} from './avatar-pipeline.mjs';

async function main() {
  const rootDir = process.cwd();
  await ensureAvatarDirectories(rootDir);
  const sourcePath = path.join(rootDir, AVATAR_SOURCE);
  if (!fs.existsSync(sourcePath)) throw new Error(`Missing avatar source: ${sourcePath}`);

  const image = await readSourceImageInfo(sourcePath);
  const ffmpeg = getFfmpegPath();
  const ffprobe = getFfprobePath();
  const ffmpegVersion = await runProcess(ffmpeg, ['-version']);
  const ffprobeVersion = await runProcess(ffprobe, ['-version']);

  console.log('Avatar pipeline is ready.');
  console.log(`Source: ${AVATAR_SOURCE} (${image.width}x${image.height}, ${(image.size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`MP4 input: ${AVATAR_GENERATED_DIR}/<motion>.mp4`);
  console.log(`WebM output: ${AVATAR_WEBM_DIR}/<motion>.webm`);
  console.log(`FFmpeg: ${ffmpegVersion.stdout.split(/\r?\n/)[0]}`);
  console.log(`FFprobe: ${ffprobeVersion.stdout.split(/\r?\n/)[0]}`);
  console.log('Generation provider: Jimeng website (no API key required).');
}

main().catch((error) => {
  console.error(`Avatar doctor failed: ${error.message}`);
  process.exitCode = 1;
});
