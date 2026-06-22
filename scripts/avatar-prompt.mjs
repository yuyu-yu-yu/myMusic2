#!/usr/bin/env node
import { getMotionPrompt, normalizeMotion, parseCliArgs } from './avatar-pipeline.mjs';

try {
  const args = parseCliArgs(process.argv.slice(2));
  const motion = normalizeMotion(args.motion || 'idle');
  console.log(`Motion: ${motion}`);
  console.log('Jimeng settings: image-to-video, 1:1, 5 seconds, 720p or higher, no generated audio.');
  console.log('');
  console.log(getMotionPrompt(motion));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
