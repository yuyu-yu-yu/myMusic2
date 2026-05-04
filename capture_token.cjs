const fs = require('fs');
const origFetch = globalThis.fetch;
globalThis.fetch = async function(url, opts) {
  const urlStr = typeof url === 'string' ? url : (url?.href || '');
  if (urlStr.includes('music.163.com')) {
    const match = urlStr.match(/accessToken=([^&]+)/);
    if (match) {
      const token = decodeURIComponent(match[1]);
      fs.writeFileSync('C:/myMusic2/fresh_token.txt', token);
      process.stderr.write('TOKEN CAPTURED: ' + token.slice(0,20) + '...\n');
    }
  }
  return origFetch(url, opts);
};
