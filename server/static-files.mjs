import fs from 'node:fs';
import path from 'node:path';

export function parseByteRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return { invalid: true };

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) {
    return { invalid: true };
  }
  return { start, end: Math.min(end, size - 1) };
}

export function getStaticCacheControl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.html', '.js', '.css'].includes(ext)) return 'no-store';
  if (['.webm', '.mp4'].includes(ext)) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}

export function serveStaticFile(req, res, filePath, contentType, cacheControl = getStaticCacheControl(filePath)) {
  const stat = fs.statSync(filePath);
  const baseHeaders = {
    'content-type': contentType,
    'cache-control': cacheControl,
    'accept-ranges': 'bytes'
  };
  const range = parseByteRange(req.headers.range, stat.size);

  if (range?.invalid) {
    res.writeHead(416, { ...baseHeaders, 'content-range': `bytes */${stat.size}` });
    res.end();
    return;
  }

  if (range) {
    const contentLength = range.end - range.start + 1;
    res.writeHead(206, {
      ...baseHeaders,
      'content-length': String(contentLength),
      'content-range': `bytes ${range.start}-${range.end}/${stat.size}`
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath, range).pipe(res);
    return;
  }

  res.writeHead(200, { ...baseHeaders, 'content-length': String(stat.size) });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}
