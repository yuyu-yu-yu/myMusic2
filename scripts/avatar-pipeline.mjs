import fs from 'node:fs';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

export const AVATAR_SOURCE = 'public/avatar/source/cancan-first-frame.png';
export const AVATAR_GENERATED_DIR = 'public/avatar/generated';
export const AVATAR_WEBM_DIR = 'public/avatar/webm';
export const AVATAR_MAX_WEBM_BYTES = 4 * 1024 * 1024;

export const avatarMotionPrompts = {
  idle: `
像素艺术动漫 AI DJ 电台主持人女孩，人物必须与参考图完全一致：相同的脸、黑色短发与蓝紫挑染、
蓝色大眼睛、耳机和服装。她轻柔呼吸，自然眨眼一次，露出很轻的微笑，耳机有克制的青色微光，
画面只有细微像素闪烁。固定正方形镜头，人物居中半身，深色蓝紫赛博电台背景，可自然循环。
不要文字，不要镜头运动，不要改变姿势，不要手部动作，不要写实化。
`,
  listening: `
像素艺术动漫 AI DJ 电台主持人女孩，人物脸、头发、眼睛、耳机和服装必须与参考图完全一致。
她认真听音乐，头部只有很小的节奏摆动，自然眨眼，轻轻微笑，耳机发出细微青紫脉冲光。
固定正方形镜头，人物居中半身，深色赛博电台背景，可自然循环。不要文字，不要大幅动作，
不要复杂手势，不要手部畸形，不要镜头运动，不要写实化。
`,
  talking: `
像素艺术动漫 AI 电台主持人女孩，人物脸、头发、眼睛、耳机和服装必须与参考图完全一致。
她温柔地向听众说话，只有小幅自然嘴型、轻柔眨眼和极轻微头部动作。
固定正方形镜头，人物居中半身，深色蓝紫赛博电台背景，可自然循环。
不要文字，不要大幅手势，不要手部畸形，不要镜头运动，不要改变人物身份，不要写实化。
`,
  searching_music: `
像素艺术动漫 AI DJ 女孩，人物与参考图完全一致。她安静浏览身旁一个小型蓝紫色全息歌单，
视线轻微移向面板再回来。固定正方形镜头，深色赛博电台背景，可自然循环。
手部保持简单且基本不动，不要可读文字，不要镜头运动，不要写实化。
`,
  reading_book: `
像素艺术动漫 AI DJ 女孩，人物与参考图完全一致。她阅读位于画面下方的小笔记本，
轻轻低头、眨眼并温柔微笑。固定正方形镜头，人物居中半身，深色蓝紫电台背景，可自然循环。
不要可读文字，不要复杂手部动作，不要镜头运动，不要写实化。
`,
  happy: `
像素艺术动漫 AI DJ 女孩，人物与参考图完全一致。好歌开始时她露出明亮笑容，
肩膀有很小的开心弹动，自然眨眼，耳机发出青色微光。固定正方形镜头，
深色蓝紫赛博电台背景，可自然循环。不要大幅动作，不要文字，不要镜头运动，不要写实化。
`,
  on_air: `
像素艺术动漫 AI 电台主持人女孩，人物与参考图完全一致。她进入安静自信的直播待机状态，
保持闭嘴浅笑，不做口型，只做一次轻微点头和自然眨眼，耳机有克制的霓虹脉冲。
固定正方形镜头，人物居中半身，深色蓝紫赛博电台背景，可自然循环。
不要说话，不要张嘴，不要可读文字，不要大幅手部动作，不要镜头运动，不要人物漂移，不要写实化。
`
};

export const avatarMotionAliases = {
  searching: 'searching_music',
  reading: 'reading_book'
};

export function parseCliArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

export function normalizeMotion(value = 'idle') {
  const motion = avatarMotionAliases[value] || value;
  if (!avatarMotionPrompts[motion]) {
    throw new Error(`Unsupported motion "${value}". Use: ${Object.keys(avatarMotionPrompts).join(', ')}`);
  }
  return motion;
}

export function resolveMotions(value = 'all') {
  if (value === 'all') return Object.keys(avatarMotionPrompts);
  return [normalizeMotion(value)];
}

export function getMotionPrompt(value) {
  return avatarMotionPrompts[normalizeMotion(value)].trim();
}

export function getFfmpegPath() {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) throw new Error('Bundled ffmpeg binary is unavailable.');
  return ffmpegPath;
}

export function getFfprobePath() {
  const probePath = ffprobeStatic?.path;
  if (!probePath || !fs.existsSync(probePath)) throw new Error('Bundled ffprobe binary is unavailable.');
  return probePath;
}

export async function ensureAvatarDirectories(rootDir = process.cwd()) {
  await Promise.all([
    mkdir(path.join(rootDir, AVATAR_GENERATED_DIR), { recursive: true }),
    mkdir(path.join(rootDir, AVATAR_WEBM_DIR), { recursive: true })
  ]);
}

export async function importAvatarVideo({ input, motion, rootDir = process.cwd(), force = false }) {
  const normalized = normalizeMotion(motion);
  const source = path.resolve(rootDir, input);
  const sourceInfo = await stat(source);
  if (!sourceInfo.isFile()) throw new Error(`Input is not a file: ${source}`);
  if (path.extname(source).toLowerCase() !== '.mp4') throw new Error('Jimeng export must be an MP4 file.');

  await ensureAvatarDirectories(rootDir);
  const destination = path.join(rootDir, AVATAR_GENERATED_DIR, `${normalized}.mp4`);
  if (!force && fs.existsSync(destination)) {
    throw new Error(`Destination already exists: ${destination}. Pass --force to replace it.`);
  }
  await copyFile(source, destination);
  return destination;
}

function normalizeSpeed(speed) {
  const value = Number(speed);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return value;
}

function playbackFilter(speed, interpolate = false) {
  const normalizedSpeed = normalizeSpeed(speed);
  if (normalizedSpeed === 1 && !interpolate) return '';
  const filters = [];
  if (normalizedSpeed !== 1) filters.push(`setpts=${(1 / normalizedSpeed).toFixed(6)}*PTS`);
  if (interpolate) filters.push('minterpolate=fps=24:mi_mode=mci');
  return filters.length ? `,${filters.join(',')}` : '';
}

export function buildAvatarVideoFilter(duration, loopFade = 0.32, options = {}) {
  const speed = normalizeSpeed(options.speed ?? 1);
  const interpolate = Boolean(options.interpolate);
  const fade = Math.max(0, Math.min(Number(loopFade) || 0, Math.max(0, duration / 4)));
  const base = "fps=24,crop='min(iw,ih)':'min(iw,ih)',scale=720:720:flags=lanczos,setsar=1,format=yuv420p";
  const outputDuration = duration / speed;
  const playback = playbackFilter(speed, interpolate);
  if (fade < 0.05 || duration < 1) return { filter: `${base}${playback}`, outputDuration };

  const bodyEnd = Math.max(0.1, duration - fade);
  const filter = [
    `[0:v]${base},split=3[body_src][head_src][tail_src]`,
    `[body_src]trim=start=0:end=${bodyEnd.toFixed(3)},setpts=PTS-STARTPTS[body]`,
    `[head_src]trim=start=0:end=${fade.toFixed(3)},setpts=PTS-STARTPTS,reverse[head]`,
    `[tail_src]trim=start=${bodyEnd.toFixed(3)}:end=${duration.toFixed(3)},setpts=PTS-STARTPTS[tail]`,
    `[tail][head]xfade=transition=fade:duration=${fade.toFixed(3)}:offset=0[seam]`,
    `[body][seam]concat=n=2:v=1:a=0${playback}[outv]`
  ].join(';');
  return { filter, outputDuration, complex: true };
}

export async function probeMedia(filePath) {
  const output = await runProcess(getFfprobePath(), [
    '-v', 'error',
    '-show_entries', 'format=duration,size:stream=index,codec_type,codec_name,width,height,avg_frame_rate',
    '-of', 'json',
    filePath
  ]);
  return JSON.parse(output.stdout);
}

export async function convertAvatarVideo({
  input,
  output,
  loopFade = 0.32,
  speed = 1,
  interpolate = false,
  maxBytes = AVATAR_MAX_WEBM_BYTES
}) {
  const metadata = await probeMedia(input);
  const duration = Number(metadata.format?.duration || 0);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Cannot determine video duration: ${input}`);
  const { filter, complex } = buildAvatarVideoFilter(duration, loopFade, { speed, interpolate });
  await mkdir(path.dirname(output), { recursive: true });

  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', input];
  if (complex) args.push('-filter_complex', filter, '-map', '[outv]');
  else args.push('-vf', filter);
  args.push(
    '-c:v', 'libvpx-vp9',
    '-deadline', 'good',
    '-cpu-used', '2',
    '-row-mt', '1',
    '-b:v', '0',
    '-crf', '34',
    '-an',
    output
  );
  await runProcess(getFfmpegPath(), args);

  const outputInfo = await stat(output);
  if (outputInfo.size > maxBytes) {
    const smallerOutput = `${output}.small.webm`;
    await runProcess(getFfmpegPath(), [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', output,
      '-c:v', 'libvpx-vp9',
      '-deadline', 'good',
      '-cpu-used', '3',
      '-row-mt', '1',
      '-b:v', '0',
      '-crf', '39',
      '-an',
      smallerOutput
    ]);
    await fs.promises.rename(smallerOutput, output);
  }
  return probeMedia(output);
}

export function validateAvatarMetadata(metadata, options = {}) {
  const maxBytes = options.maxBytes ?? AVATAR_MAX_WEBM_BYTES;
  const minDuration = Number(options.minDuration ?? 4);
  const maxDuration = Number(options.maxDuration ?? 12);
  const errors = [];
  const videoStreams = (metadata.streams || []).filter((stream) => stream.codec_type === 'video');
  const audioStreams = (metadata.streams || []).filter((stream) => stream.codec_type === 'audio');
  const duration = Number(metadata.format?.duration || 0);
  const size = Number(metadata.format?.size || 0);
  const video = videoStreams[0];

  if (videoStreams.length !== 1) errors.push(`expected one video stream, found ${videoStreams.length}`);
  if (audioStreams.length) errors.push('audio stream must be removed');
  if (video && video.codec_name !== 'vp9') errors.push(`expected VP9, found ${video.codec_name || 'unknown'}`);
  if (video && video.width !== video.height) errors.push(`video must be square, found ${video.width}x${video.height}`);
  if (video && (video.width !== 720 || video.height !== 720)) errors.push(`expected 720x720, found ${video.width}x${video.height}`);
  if (duration < minDuration || duration > maxDuration) {
    errors.push(`duration must be ${minDuration}-${maxDuration} seconds, found ${duration.toFixed(2)}s`);
  }
  if (size > maxBytes) errors.push(`file exceeds 4 MB (${(size / 1024 / 1024).toFixed(2)} MB)`);
  return errors;
}

export async function readSourceImageInfo(filePath) {
  const bytes = await readFile(filePath);
  if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`Avatar source is not a valid PNG: ${filePath}`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    size: bytes.length
  };
}

export function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(command)} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}
