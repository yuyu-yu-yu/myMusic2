// Start both community API (port 4000) and myMusic (port 3000)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

// 1. Start community API
const community = spawn('node', [
  path.join(process.env.APPDATA, 'npm', 'node_modules', 'NeteaseCloudMusicApi', 'app.js')
], {
  cwd: rootDir,
  env: { ...process.env, PORT: '4000' },
  stdio: 'inherit',
  windowsHide: true
});

// 2. Give it a moment then start myMusic
await new Promise(r => setTimeout(r, 2000));

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
  community.kill();
  mymusic.kill();
  process.exit();
});
