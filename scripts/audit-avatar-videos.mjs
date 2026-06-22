#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  AVATAR_WEBM_DIR,
  parseCliArgs,
  probeMedia,
  resolveMotions,
  runProcess,
  validateAvatarMetadata
} from './avatar-pipeline.mjs';
import { AVATAR_UNIFY_PYTHON } from './unify-avatar-videos.mjs';

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const motions = resolveMotions(args.motion || 'all');
  const python = path.join(rootDir, AVATAR_UNIFY_PYTHON);
  const outputDir = path.join(rootDir, 'public/avatar/audit');
  const videos = [];
  let failed = 0;

  if (!fs.existsSync(python)) {
    throw new Error(`Missing ${python}. Run npm run avatar:unify:setup`);
  }

  for (const motion of motions) {
    const filePath = path.join(rootDir, AVATAR_WEBM_DIR, `${motion}.webm`);
    if (!fs.existsSync(filePath)) {
      if (args.motion && args.motion !== 'all') {
        console.error(`${motion}: missing ${filePath}`);
        failed += 1;
      }
      continue;
    }
    const metadata = await probeMedia(filePath);
    const errors = validateAvatarMetadata(metadata);
    if (errors.length) {
      console.error(`${motion}: ${errors.join('; ')}`);
      failed += 1;
    } else {
      videos.push(filePath);
    }
  }

  if (videos.length) {
    fs.mkdirSync(outputDir, { recursive: true });
    const result = await runProcess(python, [
      path.join(rootDir, 'scripts/avatar_audit.py'),
      '--output-dir', outputDir,
      ...videos
    ], { cwd: rootDir });
    const summary = JSON.parse(result.stdout);
    for (const [motion, audit] of Object.entries(summary)) {
      console.log(
        `${motion}: ${audit.watermark_check} `
        + `(near-white corner ${(audit.max_near_white_corner_ratio * 100).toFixed(3)}%)`
      );
      if (audit.watermark_check !== 'pass') failed += 1;
    }
    console.log(`Audit sheets: ${outputDir}`);
  }

  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Avatar audit failed: ${error.message}`);
  process.exitCode = 1;
});
