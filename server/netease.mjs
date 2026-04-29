import crypto from 'node:crypto';

export class NeteaseClient {
  constructor(config) {
    this.config = config;
    this._accessToken = config.accessToken || '';
    this._refreshToken = '';
  }

  setTokens(accessToken, refreshToken) {
    this._accessToken = accessToken;
    if (refreshToken) this._refreshToken = refreshToken;
    this.onTokenChange?.(accessToken, refreshToken);
  }

  isConfigured() {
    return Boolean(this.config.appId && this.config.privateKey);
  }

  hasToken() {
    return Boolean(this._accessToken);
  }

  buildCommonParams(bizContent = {}, options = {}) {
    const timestamp = String(options.timestamp || Date.now());
    const deviceJson = JSON.stringify(this.config.device);
    const bizJson = JSON.stringify(bizContent || {});
    const params = {
      appId: this.config.appId,
      signType: 'RSA_SHA256',
      timestamp,
      bizContent: bizJson,
      device: deviceJson
    };
    if (this.config.appSecret) params.appSecret = this.config.appSecret;
    const token = options.accessToken ?? this._accessToken ?? this.config.accessToken;
    if (token) params.accessToken = token;
    params.sign = signParams(params, this.config.privateKey);
    return params;
  }

  async request(pathname, bizContent = {}, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('NetEase OpenAPI is not configured.');
    }
    const params = this.buildCommonParams(bizContent, options);
    const method = options.method || 'GET';
    const url = new URL(pathname, this.config.baseUrl);
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
    }

    const fetchOptions = { method };
    if (method.toUpperCase() === 'POST') {
      fetchOptions.headers = { 'content-type': 'application/x-www-form-urlencoded' };
      fetchOptions.body = search;
    } else {
      url.search = search.toString();
    }

    let response = await fetch(url, fetchOptions);
    let text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`NetEase returned non-JSON response: ${text.slice(0, 200)}`);
    }

    // Auto-refresh on token expiration
    if (!response.ok && isTokenExpired(json) && this._refreshToken && !options._retry) {
      try {
        const refreshResult = await this.refreshToken(this._refreshToken);
        const data = refreshResult?.data || refreshResult;
        const token = data?.accessToken;
        if (token && typeof token === 'object' && token.accessToken && token.accessToken !== 'null') {
          this.setTokens(token.accessToken, token.refreshToken || this._refreshToken);
          // Retry the original request with new token
          const retryParams = this.buildCommonParams(bizContent, { ...options, _retry: true });
          const retryUrl = new URL(pathname, this.config.baseUrl);
          if (method.toUpperCase() === 'POST') {
            const retrySearch = new URLSearchParams();
            for (const [k, v] of Object.entries(retryParams)) {
              if (v !== undefined && v !== null && v !== '') retrySearch.set(k, String(v));
            }
            response = await fetch(retryUrl, { method, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: retrySearch });
          } else {
            const retrySearch = new URLSearchParams();
            for (const [k, v] of Object.entries(retryParams)) {
              if (v !== undefined && v !== null && v !== '') retrySearch.set(k, String(v));
            }
            retryUrl.search = retrySearch.toString();
            response = await fetch(retryUrl);
          }
          text = await response.text();
          try { json = JSON.parse(text); } catch {
            throw new Error(`NetEase returned non-JSON response: ${text.slice(0, 200)}`);
          }
        }
      } catch {
        // refresh failed, fall through to original error
      }
    }

    if (!response.ok) {
      throw new Error(`NetEase HTTP ${response.status}: ${json.message || text.slice(0, 200)}`);
    }
    return json;
  }

  qrcode() {
    return this.request('/openapi/music/basic/user/oauth2/qrcodekey/get/v2', { type: 2, expiredKey: '604800' });
  }

  qrcodeStatus(qrCodeKey) {
    return this.request('/openapi/music/basic/oauth2/device/login/qrcode/get', { qrCodeKey });
  }

  tokenFromCode(code) {
    return this.request('/openapi/music/basic/user/oauth2/token/get/v2', { code });
  }

  refreshToken(refreshToken) {
    return this.request('/openapi/music/basic/user/oauth2/token/refresh/v2', { refreshToken });
  }

  userProfile() {
    return this.request('/openapi/music/basic/user/profile/get/v2', {});
  }

  starPlaylist() {
    return this.request('/openapi/music/basic/playlist/star/get/v2', {});
  }

  subscribedPlaylists(offset = 0, limit = 50) {
    return this.request('/openapi/music/basic/playlist/subed/get/v2', { offset, limit });
  }

  createdPlaylists(offset = 0, limit = 50) {
    return this.request('/openapi/music/basic/playlist/created/get/v2', { offset, limit });
  }

  playlistSongs(playlistId, offset = 0, limit = 100) {
    return this.request('/openapi/music/basic/playlist/song/list/get/v3', { playlistId: String(playlistId), offset, limit });
  }

  songDetail(songId) {
    return this.request('/openapi/music/basic/song/detail/get/v2', { songId: String(songId) });
  }

  lyric(songId) {
    return this.request('/openapi/music/basic/song/lyric/get/v2', { songId: String(songId) });
  }

  wordLyric(songId) {
    return this.request('/openapi/music/basic/song/lyric/word/by/word/get', { songId: String(songId) });
  }

  playUrl(songId, bitrate = 320) {
    return this.request('/openapi/music/basic/song/playurl/get/v2', { songId: String(songId), bitrate });
  }

  batchPlayUrl(songIds, bitrate = 320) {
    return this.request('/openapi/music/basic/batch/song/playurl/get', { songIds: songIds.map(String), bitrate });
  }

  searchSongs(keyword, offset = 0, limit = 20) {
    return this.request('/openapi/music/basic/search/song/get/v3', { keyword, offset, limit });
  }

  dailyRecommend() {
    return this.request('/openapi/music/basic/recommend/songlist/get/v2', {});
  }

  similarSongs(songId, limit = 20) {
    return this.request('/openapi/music/song/simulation/get', { songId: String(songId), limit });
  }

  moreRecommend(songIds = []) {
    return this.request('/openapi/music/basic/recommend/more/song', { songIds: songIds.map(String) });
  }

  recentSongs(offset = 0, limit = 50) {
    return this.request('/openapi/music/basic/song/play/record/list', { offset, limit });
  }

  reportPlay(payload) {
    return this.request('/openapi/music/basic/play/data/record', payload, { method: 'POST' });
  }
}

export function signParams(params, privateKey) {
  const content = getSignContent(params);
  const key = normalizePrivateKey(privateKey);
  return crypto.createSign('RSA-SHA256').update(content, 'utf8').sign(key, 'base64');
}

export function getSignContent(params) {
  return Object.entries(params)
    .filter(([key, value]) => key !== 'sign' && value !== undefined && value !== null && String(value) !== '')
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: false }))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function isTokenExpired(json) {
  if (!json) return false;
  const msg = (json.message || json.msg || '').toLowerCase();
  return msg.includes('accesstoken') && (msg.includes('过期') || msg.includes('expired') || msg.includes('无效') || msg.includes('invalid'));
}

export function normalizePrivateKey(privateKey) {
  const key = String(privateKey || '').trim();
  if (key.includes('BEGIN')) return key;
  const body = key.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') || key;
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
}
