#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  AVATAR_GENERATED_DIR,
  AVATAR_WEBM_DIR,
  convertAvatarVideo,
  ensureAvatarDirectories,
  parseCliArgs,
  resolveMotions
} from './avatar-pipeline.mjs';

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const motions = resolveMotions(args.motion || 'all');
  await ensureAvatarDirectories(rootDir);
  let converted = 0;

  for (const motion of motions) {
    const input = path.join(rootDir, AVATAR_GENERATED_DIR, `${motion}.mp4`);
    if (!fs.existsSync(input)) {
      if (args.motion && args.motion !== 'all') throw new Error(`Missing MP4: ${input}`);
      console.log(`Skip ${motion}: MP4 not found`);
      continue;
    }
    const output = path.join(rootDir, AVATAR_WEBM_DIR, `${motion}.webm`);
    console.log(`Converting ${motion}...`);
    await convertAvatarVideo({
      input,
      output,
      loopFade: Number(args.loopFade ?? 0.32),
      speed: Number(args.speed ?? 1),
      interpolate: Boolean(args.interpolate)
    });
    console.log(`Saved ${output}`);
    converted += 1;
  }

  if (!converted) console.log('No avatar MP4 files were available to convert.');
}

main().catch((error) => {
  console.error(`Avatar conversion failed: ${error.message}`);
  process.exitCode = 1;
});
