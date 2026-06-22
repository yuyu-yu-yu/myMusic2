#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  AVATAR_WEBM_DIR,
  parseCliArgs,
  probeMedia,
  resolveMotions,
  validateAvatarMetadata
} from './avatar-pipeline.mjs';

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const motions = resolveMotions(args.motion || 'all');
  let checked = 0;
  let failed = 0;

  for (const motion of motions) {
    const filePath = path.join(process.cwd(), AVATAR_WEBM_DIR, `${motion}.webm`);
    if (!fs.existsSync(filePath)) {
      if (args.motion && args.motion !== 'all') {
        console.error(`${motion}: missing ${filePath}`);
        failed += 1;
      } else {
        console.log(`${motion}: not generated yet`);
      }
      continue;
    }
    checked += 1;
    const metadata = await probeMedia(filePath);
    const errors = validateAvatarMetadata(metadata);
    if (errors.length) {
      failed += 1;
      console.error(`${motion}: ${errors.join('; ')}`);
    } else {
      const sizeMb = Number(metadata.format.size) / 1024 / 1024;
      console.log(`${motion}: valid (${Number(metadata.format.duration).toFixed(2)}s, ${sizeMb.toFixed(2)} MB)`);
    }
  }

  if (!checked && !failed) console.log('No WebM files generated yet; fallback animation remains active.');
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Avatar validation failed: ${error.message}`);
  process.exitCode = 1;
});
