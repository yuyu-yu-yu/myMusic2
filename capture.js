// capture.js - preload script to capture NetEase API parameters
const origFetch = globalThis.fetch;
globalThis.fetch = async function(url, opts) {
  const urlStr = typeof url === 'string' ? url : url.href;
  if (urlStr.includes('music.163.com')) {
    const u = new URL(urlStr);
    process.stderr.write('=== CAPTURED ===\n');
    process.stderr.write('Path: ' + u.pathname + '\n');
    u.searchParams.forEach((v, k) => {
      if (k === 'device' || k === 'bizContent') {
        process.stderr.write(k + ': ' + decodeURIComponent(v) + '\n');
      } else if (k === 'accessToken') {
        process.stderr.write('TOKEN: ' + v + '\n');
      } else if (k !== 'sign') {
        process.stderr.write(k + ': ' + (v.length > 100 ? v.slice(0, 100) + '...' : v) + '\n');
      }
    });
    process.stderr.write('\n');
  }
  return origFetch(url, opts);
};
