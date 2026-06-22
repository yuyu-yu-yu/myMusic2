#!/usr/bin/env node
import { importAvatarVideo, normalizeMotion, parseCliArgs } from './avatar-pipeline.mjs';

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.input) throw new Error('Usage: npm run avatar:import -- --motion idle --input "C:\\path\\video.mp4"');
  const motion = normalizeMotion(args.motion || 'idle');
  const destination = await importAvatarVideo({
    input: args.input,
    motion,
    force: Boolean(args.force)
  });
  console.log(`Imported ${motion}: ${destination}`);
}

main().catch((error) => {
  console.error(`Avatar import failed: ${error.message}`);
  process.exitCode = 1;
});
