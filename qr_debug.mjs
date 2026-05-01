// Debug: use community API modules directly for QR login
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const apiPath = process.env.APPDATA + '\\npm\\node_modules\\NeteaseCloudMusicApi\\main.js';
const require = createRequire('file:///' + apiPath.replace(/\\/g, '/'));
const api = require(apiPath);

async function main() {
  // Step 1: Get key
  const keyRes = await api.login_qr_key({});
  const unikey = keyRes.body.data?.unikey || keyRes.body.unikey;
  console.log('1. unikey:', unikey);

  // Step 2: Create QR
  const createRes = await api.login_qr_create({ key: unikey, qrimg: true });
  const qrurl = createRes.body.data?.qrurl;
  console.log('2. QR URL:', qrurl);

  // Save QR image
  const qrimg = createRes.body.data?.qrimg;
  if (qrimg) {
    const base64 = qrimg.replace('data:image/png;base64,', '');
    writeFileSync('qr.png', Buffer.from(base64, 'base64'));
    console.log('3. QR saved to qr.png');
  }

  console.log('\n=== Open this URL and scan with NetEase app ===');
  console.log(qrurl);
  console.log('=== Polling every 3s for 5 minutes ===\n');

  // Step 3: Poll aggressively
  for (let i = 0; i < 100; i++) {
    await sleep(3000);
    try {
      const checkRes = await api.login_qr_check({ key: unikey });
      const { code, message, cookie } = checkRes.body;
      console.log(`[${String(i+1).padStart(3)}] code=${code} ${message || ''}`);
      if (code === 803) {
        console.log('\n✅ LOGIN SUCCESS!');
        writeFileSync('netease_cookie.txt', cookie);
        console.log('Cookie saved, length:', cookie.length);

        // Test play URL immediately
        const playRes = await api.song_url_v1({
          id: '569870379',
          level: 'standard',
          cookie
        });
        const url = playRes.body.data?.[0]?.url;
        console.log('Test play URL:', url ? 'GOT URL!' : 'NULL');
        if (url) console.log('URL:', url.slice(0, 100));
        return;
      }
      if (code === 800) {
        console.log('QR expired, restarting...');
        return main();
      }
      if (code === 802) {
        console.log('>>> Scanned! Waiting for confirm...');
      }
    } catch(e) {
      console.log(`[${String(i+1).padStart(3)}] ERROR:`, e.message);
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(e => console.error('FATAL:', e));
