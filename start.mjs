// Start both community API (port 4000) and myMusic (port 3000)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const communityApp = resolveCommunityApiFile('app.js');
const communityPort = Number(process.env.COMMUNITY_API_PORT || 4000);
let community = null;

// 1. Start community API
if (await isPortOpen('127.0.0.1', communityPort)) {
  console.log(`[community] reuse existing service on port ${communityPort}`);
} else {
  community = spawn('node', [
    communityApp
  ], {
    cwd: rootDir,
    env: { ...process.env, PORT: String(communityPort) },
    stdio: 'inherit',
    windowsHide: true
  });
}

// 2. Give it a moment then start myMusic
await new Promise(r => setTimeout(r, community ? 2000 : 300));

const mymusic = spawn('node', [
  '--experimental-sqlite',
  path.join('server', 'index.mjs')
], {
  cwd: rootDir,
  env: { ...process.env, PORT: '3000' },
  stdio: 'inherit'
});

// Cleanup on exit
process.on('SIGINT', () => {
  if (community) community.kill();
  mymusic.kill();
  process.exit();
});

process.on('SIGTERM', () => {
  if (community) community.kill();
  mymusic.kill();
  process.exit();
});

const exitCode = await new Promise((resolve) => {
  mymusic.on('exit', (code) => resolve(code ?? 0));
});

if (community) community.kill();
process.exit(exitCode);

function resolveCommunityApiFile(fileName) {
  const candidates = [
    path.join(rootDir, 'node_modules', 'NeteaseCloudMusicApi', fileName),
    path.join(rootDir, 'packaging', 'work', 'payload', 'app', 'npm', 'node_modules', 'NeteaseCloudMusicApi', fileName),
    path.join(rootDir, 'packaging', 'verify', 'app', 'npm', 'node_modules', 'NeteaseCloudMusicApi', fileName),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'NeteaseCloudMusicApi', fileName)
  ];
  const found = candidates.find((candidate) => candidate && fsExists(candidate));
  if (!found) {
    throw new Error(`Cannot find NeteaseCloudMusicApi ${fileName}. Run packaging/build-release.ps1 or install NeteaseCloudMusicApi.`);
  }
  return found;
}

function fsExists(filePath) {
  try {
    return Boolean(filePath && path.isAbsolute(filePath) && fs.existsSync(filePath));
  } catch {
    return false;
  }
}

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(700);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}
