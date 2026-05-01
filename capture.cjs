// capture.js - CommonJS preload to capture ALL HTTP requests
const http = require('http');
const https = require('https');

const origFetch = globalThis.fetch;
globalThis.fetch = async function(url, opts) {
  const urlStr = typeof url === 'string' ? url : (url?.href || '');
  process.stderr.write('=== FETCH: ' + urlStr.slice(0, 180) + ' ===\n');
  return origFetch(url, opts);
};

const origHttpReq = http.request;
http.request = function(opts, ...rest) {
  const host = opts?.hostname || opts?.host || '';
  const path = opts?.path || '';
  process.stderr.write('=== HTTP: ' + host + path + ' ===\n');
  return origHttpReq.call(this, opts, ...rest);
};

const origHttpsReq = https.request;
https.request = function(opts, ...rest) {
  const host = opts?.hostname || opts?.host || '';
  const path = opts?.path || '';
  process.stderr.write('=== HTTPS: ' + host + path + ' ===\n');
  return origHttpsReq.call(this, opts, ...rest);
};

const origHttpGet = http.get;
http.get = function(opts, ...rest) {
  const host = opts?.hostname || opts?.host || '';
  const path = opts?.path || '';
  process.stderr.write('=== HTTP GET: ' + host + path + ' ===\n');
  return origHttpGet.call(this, opts, ...rest);
};

const origHttpsGet = https.get;
https.get = function(opts, ...rest) {
  const host = opts?.hostname || opts?.host || '';
  const path = opts?.path || '';
  process.stderr.write('=== HTTPS GET: ' + host + path + ' ===\n');
  return origHttpsGet.call(this, opts, ...rest);
};
