const CACHE = 'mymusic-v39';
const ASSETS = ['/', '/styles.css', '/app.js', '/device-identity.js', '/track-identity.js', '/playback-sequence.js', '/assets/anime.esm.min.js', '/manifest.webmanifest', '/assets/icon.svg', '/avatar/source/cancan-first-frame.png'];
const previewAuth = parsePreviewAuth();

function parseRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');
  if (!match || (!match[1] && !match[2])) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

async function avatarVideoResponse(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request.url);
  const rangeHeader = request.headers.get('range');

  if (cached && rangeHeader) {
    const buffer = await cached.arrayBuffer();
    const range = parseRange(rangeHeader, buffer.byteLength);
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${buffer.byteLength}` }
      });
    }
    const body = buffer.slice(range.start, range.end + 1);
    return new Response(body, {
      status: 206,
      headers: {
        'accept-ranges': 'bytes',
        'cache-control': cached.headers.get('cache-control') || 'public, max-age=31536000, immutable',
        'content-length': String(body.byteLength),
        'content-range': `bytes ${range.start}-${range.end}/${buffer.byteLength}`,
        'content-type': cached.headers.get('content-type') || 'video/webm'
      }
    });
  }

  if (cached) return cached;

  const response = await fetch(withPreviewAuth(request));
  if (response.ok && response.status === 200 && !rangeHeader) {
    await cache.put(request.url, response.clone());
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => previewAuth
        ? Promise.allSettled(ASSETS.map((asset) => cachePreviewAsset(cache, asset)))
        : cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') && !previewAuth) return;
  if (event.request.method === 'GET' && url.pathname.startsWith('/avatar/webm/')) {
    event.respondWith(avatarVideoResponse(event.request));
    return;
  }
  event.respondWith(
    fetch(withPreviewAuth(event.request))
      .then((response) => {
        if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') return response;
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

function parsePreviewAuth() {
  const params = new URL(self.location.href).searchParams;
  const token = params.get('eo_token');
  const time = params.get('eo_time');
  return token && time ? { token, time } : null;
}

function withPreviewAuth(request) {
  if (!previewAuth) return request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.searchParams.has('eo_token')) return request;
  url.searchParams.set('eo_token', previewAuth.token);
  url.searchParams.set('eo_time', previewAuth.time);
  return new Request(url.href, request);
}

async function cachePreviewAsset(cache, asset) {
  const request = new Request(new URL(asset, self.location.origin).href, { cache: 'reload' });
  const response = await fetch(withPreviewAuth(request));
  if (response.ok) await cache.put(request, response.clone());
}
