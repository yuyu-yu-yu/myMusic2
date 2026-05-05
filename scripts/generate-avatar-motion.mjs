#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

const motionPrompts = {
  idle: `
Pixel art anime AI DJ radio host girl, same character and outfit as reference image.
She gently breathes, blinks, smiles softly, headphones glow cyan, subtle neon pixel shimmer.
Camera locked, no zoom, no scene change, seamless loop, preserve identity.
`,
  listening: `
Same pixel art AI DJ girl. She slightly tilts her head and touches one side of her headphones,
listening carefully to music, soft smile, cyan and purple neon glow, seamless loop.
Preserve face, outfit, headphones, pixel art style.
`,
  talking: `
Same pixel art AI radio host girl speaking warmly to the audience.
Small mouth movement, gentle blinking, friendly expression, subtle head movement.
No major pose change, preserve identity, pixel art, seamless loop.
`,
  searching_music: `
Same pixel art AI DJ girl browsing a floating holographic music playlist.
Her eyes look slightly to the side, one hand gestures toward a small neon panel.
Cute focused expression, cyber radio aesthetic, seamless loop.
Preserve character identity and outfit.
`,
  reading_book: `
Same pixel art anime AI DJ girl reading a small notebook or book cutely.
She glances down, blinks, then smiles gently. Minimal movement, cozy radio host vibe.
Preserve headphones, outfit, blue-purple pixel art style, seamless loop.
`,
  happy: `
Same pixel art anime AI DJ girl reacting happily when a perfect song starts.
Bright smile, subtle shoulder bounce, cyan headphones glow, small neon heart sparkle.
Keep the camera locked, preserve identity, outfit, headphones, pixel art style, seamless loop.
`,
  on_air: `
Same pixel art AI radio host girl presenting a late-night cyber radio show.
Warm confident smile, small hand movement near headphones, ON AIR neon mood, gentle blinking.
Preserve character identity, blue-purple pixel art style, dark radio studio background, seamless loop.
`
};

const motionAliases = {
  searching: 'searching_music',
  reading: 'reading_book'
};

const negativePrompt = [
  'realistic rendering',
  'different person',
  'identity drift',
  'distorted face',
  'extra fingers',
  'distorted hands',
  'unreadable text',
  'outfit change',
  'camera zoom',
  'scene change'
].join(', ');

function parseArgs(argv) {
  const args = {
    provider: 'fal',
    motion: 'all',
    imageUrl: '',
    duration: 5,
    resolution: '720p',
    model: 'gen4_turbo',
    outDir: 'public/avatar/generated'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--provider') { args.provider = next; i += 1; }
    else if (arg === '--motion') { args.motion = next; i += 1; }
    else if (arg === '--image-url') { args.imageUrl = next; i += 1; }
    else if (arg === '--duration') { args.duration = Number(next); i += 1; }
    else if (arg === '--resolution') { args.resolution = next; i += 1; }
    else if (arg === '--model') { args.model = next; i += 1; }
    else if (arg === '--out-dir') { args.outDir = next; i += 1; }
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/generate-avatar-motion.mjs --provider fal --motion idle --image-url <public-url>
  node scripts/generate-avatar-motion.mjs --provider runway --motion all --image-url <public-url>

Options:
  --provider fal|runway
  --motion idle|listening|talking|searching_music|reading_book|happy|on_air|all
  --image-url <url>        Public URL or provider-supported data URL for public/avatar/source/cancan.png
  --duration <seconds>     Default: 5
  --resolution <value>     Default: 720p
  --model <model>          Runway default: gen4_turbo
  --out-dir <path>         Default: public/avatar/generated
`);
}

function resolveMotions(value) {
  if (value === 'all') return Object.keys(motionPrompts);
  const motion = motionAliases[value] || value;
  if (!motionPrompts[motion]) {
    throw new Error(`Unsupported motion "${value}". Use one of: ${Object.keys(motionPrompts).join(', ')}, all`);
  }
  return [motion];
}

function requireImageUrl(imageUrl) {
  if (!imageUrl) {
    throw new Error('Missing --image-url. Most image-to-video providers need a public URL or provider-supported data URL for public/avatar/source/cancan.png.');
  }
}

async function generateWithFal({ motion, imageUrl, duration, resolution }) {
  if (!process.env.FAL_KEY) throw new Error('FAL_KEY is required for --provider fal.');
  let fal;
  try {
    ({ fal } = await import('@fal-ai/client'));
  } catch {
    throw new Error('Install fal client first: npm install @fal-ai/client');
  }

  const result = await fal.subscribe('fal-ai/pika/v2.2/image-to-video', {
    input: {
      image_url: imageUrl,
      prompt: motionPrompts[motion].trim(),
      negative_prompt: negativePrompt,
      resolution,
      duration
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === 'IN_PROGRESS') {
        for (const log of update.logs || []) console.log(log.message);
      }
    }
  });

  const url = result?.data?.video?.url || result?.video?.url;
  if (!url) throw new Error(`fal result did not include a video URL: ${JSON.stringify(result)}`);
  return url;
}

async function generateWithRunway({ motion, imageUrl, duration, model }) {
  const apiKey = process.env.RUNWAY_API_KEY || process.env.RUNWAYML_API_SECRET;
  if (!apiKey) throw new Error('RUNWAY_API_KEY or RUNWAYML_API_SECRET is required for --provider runway.');

  const createResponse = await fetch('https://api.dev.runwayml.com/v1/image_to_video', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Runway-Version': '2024-11-06'
    },
    body: JSON.stringify({
      model,
      promptImage: imageUrl,
      promptText: motionPrompts[motion].trim(),
      duration
    })
  });

  if (!createResponse.ok) {
    throw new Error(`Runway create failed (${createResponse.status}): ${await createResponse.text()}`);
  }

  const task = await createResponse.json();
  const taskId = task.id || task.taskId;
  if (!taskId) throw new Error(`Runway create response did not include a task id: ${JSON.stringify(task)}`);

  for (;;) {
    await sleep(5000);
    const statusResponse = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Runway-Version': '2024-11-06'
      }
    });
    if (!statusResponse.ok) {
      throw new Error(`Runway status failed (${statusResponse.status}): ${await statusResponse.text()}`);
    }

    const status = await statusResponse.json();
    console.log(`Runway ${motion}: ${status.status || status.state || 'unknown'}`);

    if (status.status === 'SUCCEEDED' || status.state === 'SUCCEEDED') {
      const output = Array.isArray(status.output) ? status.output[0] : status.output;
      const url = typeof output === 'string' ? output : output?.url;
      if (!url) throw new Error(`Runway completed without a downloadable output: ${JSON.stringify(status)}`);
      return url;
    }

    if (status.status === 'FAILED' || status.state === 'FAILED') {
      throw new Error(`Runway task failed: ${JSON.stringify(status)}`);
    }
  }
}

async function downloadFile(url, destination) {
  await mkdir(dirname(destination), { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  await pipeline(response.body, createWriteStream(destination));
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requireImageUrl(args.imageUrl);
  const motions = resolveMotions(args.motion);

  for (const motion of motions) {
    console.log(`Generating ${motion} with ${args.provider}...`);
    const videoUrl = args.provider === 'fal'
      ? await generateWithFal({ ...args, motion })
      : await generateWithRunway({ ...args, motion });
    const destination = resolve(args.outDir, `${motion}.mp4`);
    await downloadFile(videoUrl, destination);
    console.log(`Saved ${destination}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

export { motionPrompts };
