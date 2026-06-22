#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  AVATAR_GENERATED_DIR,
  AVATAR_WEBM_DIR,
  convertAvatarVideo,
  getFfmpegPath,
  parseCliArgs,
  resolveMotions,
  runProcess
} from './avatar-pipeline.mjs';

export const AVATAR_PROCESSED_DIR = 'public/avatar/processed';
export const AVATAR_BACKGROUND = 'public/avatar/background/cyber-radio-master.png';
export const AVATAR_BACKGROUND_LOOP = 'public/avatar/background/cyber-radio-loop.mp4';
export const AVATAR_SEGMENTATION_MODEL = 'models/avatar/isnetis.onnx';
export const AVATAR_UNIFY_PYTHON = '.venv-avatar/Scripts/python.exe';

export const motionPlaybackSpeeds = {
  idle: 0.5,
  talking: 0.5,
  listening: 1,
  searching_music: 1,
  reading_book: 1,
  happy: 1,
  on_air: 1
};

export function resolveUnifyPaths(rootDir, motion) {
  return {
    input: path.join(rootDir, AVATAR_GENERATED_DIR, `${motion}.mp4`),
    output: path.join(rootDir, AVATAR_PROCESSED_DIR, `${motion}.mp4`),
    metadata: path.join(rootDir, AVATAR_PROCESSED_DIR, `${motion}.json`),
    webm: path.join(rootDir, AVATAR_WEBM_DIR, `${motion}.webm`)
  };
}

function requireFile(filePath, setupHint = '') {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${filePath}${setupHint ? `. ${setupHint}` : ''}`);
  }
}

export async function unifyAvatarVideos(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const requestedMotion = options.motion || 'all';
  const motions = resolveMotions(requestedMotion);
  const python = path.join(rootDir, AVATAR_UNIFY_PYTHON);
  const model = path.join(rootDir, AVATAR_SEGMENTATION_MODEL);
  const background = path.join(rootDir, AVATAR_BACKGROUND);
  const loopOutput = path.join(rootDir, AVATAR_BACKGROUND_LOOP);
  const ffmpeg = getFfmpegPath();

  requireFile(python, 'Run npm run avatar:unify:setup');
  requireFile(model, 'Run npm run avatar:unify:setup');
  requireFile(background);
  fs.mkdirSync(path.join(rootDir, AVATAR_PROCESSED_DIR), { recursive: true });
  fs.mkdirSync(path.join(rootDir, AVATAR_WEBM_DIR), { recursive: true });

  console.log('Rendering shared background loop...');
  await runProcess(python, [
    path.join(rootDir, 'scripts/avatar_unify.py'),
    '--background', background,
    '--ffmpeg', ffmpeg,
    '--background-loop-output', loopOutput
  ], { cwd: rootDir });

  let processed = 0;
  for (const motion of motions) {
    const paths = resolveUnifyPaths(rootDir, motion);
    if (!fs.existsSync(paths.input)) {
      if (requestedMotion !== 'all') throw new Error(`Missing source MP4: ${paths.input}`);
      console.log(`Skip ${motion}: source MP4 not found`);
      continue;
    }

    console.log(`Unifying ${motion}...`);
    const result = await runProcess(python, [
      path.join(rootDir, 'scripts/avatar_unify.py'),
      '--motion', motion,
      '--input', paths.input,
      '--output', paths.output,
      '--metadata', paths.metadata,
      '--background', background,
      '--model', model,
      '--ffmpeg', ffmpeg
    ], { cwd: rootDir });
    if (result.stdout.trim()) console.log(result.stdout.trim());

    console.log(`Encoding ${motion} WebM...`);
    await convertAvatarVideo({
      input: paths.output,
      output: paths.webm,
      loopFade: 0,
      speed: motionPlaybackSpeeds[motion] || 1
    });
    processed += 1;
  }

  if (!processed) console.log('No generated avatar MP4 files were available to unify.');
  return processed;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  await unifyAvatarVideos({ motion: args.motion || 'all' });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`Avatar unification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
