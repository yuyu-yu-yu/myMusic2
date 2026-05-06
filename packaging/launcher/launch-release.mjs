import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(rootDir, 'app');
const runtimeDir = path.join(rootDir, 'runtime');
const nodeExe = path.join(runtimeDir, 'node.exe');
const logsDir = path.join(rootDir, 'logs');
const browserProfile = path.join(rootDir, 'browser-profile');
const appPort = process.env.PORT || '3005';
const communityPort = process.env.COMMUNITY_API_PORT || '4005';
const appUrl = `http://127.0.0.1:${appPort}`;
const healthUrl = `${appUrl}/api/health`;

fs.mkdirSync(logsDir, { recursive: true });
fs.mkdirSync(browserProfile, { recursive: true });

if (!fs.existsSync(nodeExe)) throw new Error(`Bundled node.exe was not found: ${nodeExe}`);
if (!fs.existsSync(path.join(appDir, 'server', 'index.mjs'))) throw new Error(`App server was not found: ${appDir}`);

const out = fs.openSync(path.join(logsDir, 'server.log'), 'a');
const err = fs.openSync(path.join(logsDir, 'server.err.log'), 'a');
const children = [];

const baseEnv = {
  ...process.env,
  PATH: `${runtimeDir};${process.env.PATH || ''}`,
  APPDATA: appDir,
  PORT: appPort,
  HOST: '127.0.0.1',
  COMMUNITY_API_BASE_URL: `http://127.0.0.1:${communityPort}`,
  NODE_ENV: 'production'
};

const communityApp = path.join(appDir, 'npm', 'node_modules', 'NeteaseCloudMusicApi', 'app.js');
if (fs.existsSync(communityApp)) {
  const community = spawn(nodeExe, [communityApp], {
    cwd: appDir,
    env: { ...baseEnv, PORT: communityPort },
    windowsHide: true,
    stdio: ['ignore', out, err]
  });
  children.push(community);
}

const server = spawn(nodeExe, ['--experimental-sqlite', path.join('server', 'index.mjs')], {
  cwd: appDir,
  env: baseEnv,
  windowsHide: true,
  stdio: ['ignore', out, err]
});
children.push(server);

let browser = null;

try {
  await waitForHealth();
  const browserPath = findBrowser();
  if (!browserPath) {
    throw new Error('Chrome or Microsoft Edge was not found. Please install one of them and run again.');
  }

  browser = spawn(browserPath, [
    `--app=${appUrl}`,
    `--user-data-dir=${browserProfile}`,
    '--no-first-run',
    '--disable-extensions',
    '--window-size=1280,860'
  ], {
    windowsHide: false,
    stdio: 'ignore'
  });

  await waitForExit(browser);
} finally {
  await cleanup();
}

async function waitForHealth() {
  for (let i = 0; i < 90; i += 1) {
    if (server.exitCode !== null) throw new Error(`App server exited early. See logs in ${logsDir}`);
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {}
    await delay(500);
  }
  throw new Error(`App server did not become ready at ${healthUrl}`);
}

function findBrowser() {
  const env = process.env;
  const candidates = [
    path.join(env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(env.LocalAppData || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.once('error', resolve);
  });
}

async function cleanup() {
  if (browser && browser.exitCode === null) {
    try { browser.kill(); } catch {}
  }

  for (const child of children) {
    if (child?.pid) await runTaskkill(child.pid);
  }

  try { fs.closeSync(out); } catch {}
  try { fs.closeSync(err); } catch {}
}

function runTaskkill(pid) {
  return new Promise((resolve) => {
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    killer.once('exit', resolve);
    killer.once('error', resolve);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
