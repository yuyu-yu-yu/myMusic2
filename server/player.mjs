import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getTrackById, listTracks } from './db.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultMpvDir = 'C:\\Program Files\\MPV Player';
const ncmCliScriptCandidates = [
  process.env.NCM_CLI_SCRIPT,
  process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'node_modules', '@music163', 'ncm-cli', 'dist', 'index.js') : null,
  path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@music163', 'ncm-cli', 'dist', 'index.js'),
  path.join(rootDir, 'node_modules', '@music163', 'ncm-cli', 'dist', 'index.js')
].filter(Boolean);

export function createNcmPlayer({ db, runner = runNcmCli } = {}) {
  return {
    play: (trackId, options = {}) => playTrackWithFallback({ db, runner, trackId, ...options }),
    pause: () => runControlCommand(runner, 'pause'),
    resume: () => runControlCommand(runner, 'resume'),
    stop: () => runControlCommand(runner, 'stop'),
    next: () => runControlCommand(runner, 'next'),
    state: () => getPlayerState(runner)
  };
}

export async function playTrackWithFallback({ db, runner = runNcmCli, trackId, maxSkips = 6 } = {}) {
  if (!db) return { ok: false, error: 'Database is required.' };
  const firstTrack = getTrackById(db, trackId);
  if (!firstTrack) return { ok: false, error: 'Track not found.' };

  const skipped = [];
  const tried = new Set();
  const queue = [firstTrack, ...listTracks(db, 200).filter((track) => track.id !== firstTrack.id)];
  const limit = Math.max(0, Number(maxSkips) || 0) + 1;

  for (const track of queue) {
    if (tried.size >= limit) break;
    if (!track || tried.has(track.id)) continue;
    tried.add(track.id);
    try {
      const response = await playOneTrack(runner, track);
      return {
        ok: true,
        mode: 'ncm-cli',
        track,
        skipped,
        response
      };
    } catch (error) {
      const reason = normalizePlaybackError(error);
      skipped.push({ trackId: track.id, name: track.name, error: reason });
      if (!isSkippablePlaybackError(reason)) break;
    }
  }

  const lastError = skipped.at(-1)?.error || 'No playable track found.';
  return {
    ok: false,
    mode: 'ncm-cli',
    track: firstTrack,
    skipped,
    error: lastError
  };
}

export async function playOneTrack(runner, track) {
  if (!track?.id) throw new Error('Track id is required.');
  if (!track.originalId) {
    throw new Error(`歌曲缺少 originalId，ncm-cli 无法播放：${track.name || track.id}`);
  }

  await runner(['stop', '--output', 'json']).catch(() => {});
  const result = await runner([
    'play',
    '--song',
    '--encrypted-id',
    String(track.id),
    '--original-id',
    String(track.originalId),
    '--output',
    'json'
  ]);
  assertNcmSuccess(result);
  await waitForPlaybackStart(runner, track.id);
  return result.data ?? result;
}

export async function runControlCommand(runner, command) {
  const result = await runner([command, '--output', 'json']);
  assertNcmSuccess(result);
  return { ok: true, mode: 'ncm-cli', command, response: result.data ?? result };
}

export async function getPlayerState(runner = runNcmCli) {
  try {
    const result = await runner(['state', '--output', 'json']);
    assertNcmSuccess(result);
    return {
      ok: true,
      mode: 'ncm-cli',
      ncmCli: true,
      mpv: findMpvPath() !== null,
      state: result.state ?? result.data?.state ?? result.data ?? result
    };
  } catch (error) {
    return {
      ok: false,
      mode: 'ncm-cli',
      ncmCli: false,
      mpv: findMpvPath() !== null,
      error: normalizePlaybackError(error)
    };
  }
}

export async function runNcmCli(args) {
  const script = resolveNcmCliScript();
  if (!script) {
    throw new Error('ncm-cli is not installed. Please install @music163/ncm-cli.');
  }

  const env = buildCommandEnv();
  const { stdout, stderr } = await execFilePromise(process.execPath, [script, ...args], {
    cwd: rootDir,
    env,
    timeout: 45000,
    windowsHide: true
  });
  return parseNcmOutput(stdout, stderr);
}

export function resolveNcmCliScript() {
  return ncmCliScriptCandidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

export function findMpvPath() {
  const candidates = [
    process.env.MPV_PATH,
    path.join(defaultMpvDir, 'mpv.exe'),
    path.join(defaultMpvDir, 'mpv.com')
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function buildCommandEnv() {
  const env = { ...process.env };
  if (fs.existsSync(defaultMpvDir)) {
    env.Path = `${env.Path || env.PATH || ''};${defaultMpvDir}`;
    env.PATH = env.Path;
  }
  return env;
}

function execFilePromise(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout = '', stderr = '') => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseNcmOutput(stdout, stderr) {
  const text = String(stdout || '').trim();
  if (!text) return { success: true, stderr: String(stderr || '').trim() };
  try {
    return JSON.parse(text);
  } catch {
    return { success: true, output: text, stderr: String(stderr || '').trim() };
  }
}

function assertNcmSuccess(result) {
  if (result?.success === false || result?.ok === false) {
    throw new Error(result.error || result.message || 'ncm-cli command failed.');
  }
  if (result?.code && Number(result.code) !== 0 && Number(result.code) !== 200) {
    throw new Error(result.error || result.message || `ncm-cli returned code ${result.code}.`);
  }
}

async function waitForPlaybackStart(runner, trackId) {
  const deadline = Date.now() + 6000;
  let lastState = null;
  while (Date.now() < deadline) {
    await sleep(500);
    const stateResult = await runner(['state', '--output', 'json']).catch((error) => ({ error: normalizePlaybackError(error) }));
    lastState = stateResult?.state ?? stateResult?.data?.state ?? stateResult;
    if (lastState?.status === 'playing') return;
  }

  const logReason = readRecentNcmFailure(trackId);
  if (logReason) throw new Error(logReason);
  throw new Error(`ncm-cli 没有进入播放状态，当前状态：${lastState?.status || 'unknown'}`);
}

function readRecentNcmFailure(trackId) {
  const logPath = path.join(os.homedir(), '.config', 'ncm-cli', 'bg-worker.log');
  if (!fs.existsSync(logPath)) return null;
  const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-80);
  const related = [...lines].reverse().find((line) => line.includes(String(trackId)) && /获取失败|失败|暂无|权限|跳过/.test(line));
  if (!related) return null;
  const match = related.match(/:\s*([^:]+)$/);
  return match?.[1]?.trim() || related.trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePlaybackError(error) {
  const stdout = error?.stdout ? String(error.stdout).trim() : '';
  if (stdout) {
    try {
      const json = JSON.parse(stdout);
      return json.error || json.message || stdout;
    } catch {
      return stdout;
    }
  }
  const stderr = error?.stderr ? String(error.stderr).trim() : '';
  return error?.message || stderr || 'Playback failed.';
}

function isSkippablePlaybackError(message) {
  const text = String(message || '').toLowerCase();
  return /originalid|无法播放|不能播放|版权|会员|vip|svip|地区|无资源|暂无|获取链接失败|失败|not playable|unavailable|failed|播放失败/.test(text);
}
