import { setSetting } from './db.mjs';

const QR_STATUS_CODES = new Set(['800', '801', '802', '803']);

export async function resolveQrOpenApiLogin({ db, netease, result }) {
  const directToken = extractOpenApiTokenPayload(result);
  if (directToken) {
    saveOpenApiToken(db, netease, directToken);
    return verifySavedLogin({ db, netease, tokenSource: 'direct', fallbackMessage: 'token saved from QR status' });
  }

  const authorizationCode = extractQrAuthorizationCode(result);
  if (authorizationCode) {
    try {
      const tokenResult = await netease.tokenFromCode(authorizationCode);
      const token = extractOpenApiTokenPayload(tokenResult);
      if (token) {
        saveOpenApiToken(db, netease, token);
        return verifySavedLogin({ db, netease, tokenSource: 'authorization_code', fallbackMessage: 'token saved from authorization code' });
      }
      return loginMeta(false, 'authorization_code', 'authorization code did not return accessToken');
    } catch (error) {
      return loginMeta(false, 'authorization_code', `authorization code exchange failed: ${error.message}`);
    }
  }

  return loginMeta(false, null, loginPendingMessage(result));
}

export async function getNeteaseLoginStatus({ db, netease }) {
  const configured = typeof netease.isConfigured === 'function' ? netease.isConfigured() : true;
  const hasToken = typeof netease.hasToken === 'function' ? netease.hasToken() : false;
  const saved = getSavedNeteaseUser(db);
  if (!configured) {
    return {
      configured,
      hasToken,
      profileReadable: false,
      userId: saved.userId,
      nickname: saved.nickname,
      message: 'NetEase OpenAPI is not configured'
    };
  }
  if (!hasToken) {
    return {
      configured,
      hasToken,
      profileReadable: false,
      userId: saved.userId,
      nickname: saved.nickname,
      message: '请先在设置页扫码登录网易云'
    };
  }
  try {
    const profile = await readNeteaseUserProfile(netease);
    saveNeteaseUserProfile(db, profile);
    return {
      configured,
      hasToken,
      profileReadable: true,
      userId: profile.userId,
      nickname: profile.nickname,
      message: '已登录'
    };
  } catch (error) {
    return {
      configured,
      hasToken,
      profileReadable: false,
      userId: saved.userId,
      nickname: saved.nickname,
      message: `登录状态异常，请重新扫码：${error.message}`
    };
  }
}

export function extractOpenApiTokenPayload(result) {
  const data = result?.data || result || {};
  const candidates = [
    data.accessToken,
    data.token,
    data.oauthToken,
    data.loginToken
  ];
  for (const candidate of candidates) {
    const token = normalizeTokenCandidate(candidate, data);
    if (token) return token;
  }
  return null;
}

export function extractQrAuthorizationCode(result) {
  const data = result?.data || result || {};
  const candidates = [
    data.authorizationCode,
    data.authCode,
    data.auth_code,
    data.authorizeCode,
    data.oauthCode,
    data.loginCode
  ];
  for (const candidate of candidates) {
    const code = normalizeAuthorizationCode(candidate);
    if (code) return code;
  }

  const code = normalizeAuthorizationCode(data.code);
  const statusCode = normalizeQrStatusCode(data.status ?? data.qrStatus ?? data.qrCodeStatus);
  if (code && !QR_STATUS_CODES.has(code) && (!statusCode || code !== statusCode)) return code;
  return null;
}

export function saveOpenApiToken(db, netease, token) {
  const accessToken = String(token?.accessToken || '').trim();
  if (!accessToken || accessToken === 'null') return false;
  const refreshToken = String(token?.refreshToken || '').trim();
  netease.setTokens(accessToken, refreshToken);
  setSetting(db, 'netease_access_token', accessToken);
  setSetting(db, 'netease_refresh_token', refreshToken);
  return true;
}

export async function readNeteaseUserProfile(netease) {
  if (!netease || typeof netease.userProfile !== 'function') {
    throw new Error('userProfile API is unavailable');
  }
  const response = await netease.userProfile();
  const profile = extractNeteaseUserProfile(response);
  if (!profile.userId) {
    throw new Error('userProfile did not return userId');
  }
  return profile;
}

export function extractNeteaseUserProfile(result) {
  const data = result?.data || result || {};
  const profile = data.profile || data.userProfile || data.user || data.account || data;
  const userId = profile.userId ?? profile.userID ?? profile.id ?? profile.user_id ?? data.userId ?? data.userID ?? data.id;
  const nickname = profile.nickname ?? profile.nickName ?? profile.name ?? profile.userName ?? data.nickname ?? data.nickName ?? data.name ?? '';
  return {
    userId: userId === undefined || userId === null || userId === '' ? '' : String(userId),
    nickname: String(nickname || '').trim()
  };
}

export function saveNeteaseUserProfile(db, profile = {}) {
  const userId = String(profile.userId || '').trim();
  if (!userId) return false;
  setSetting(db, 'netease_user_id', userId);
  setSetting(db, 'netease_user_nickname', String(profile.nickname || '').trim());
  setSetting(db, 'netease_login_checked_at', new Date().toISOString());
  return true;
}

function getSavedNeteaseUser(db) {
  return {
    userId: getSettingSafe(db, 'netease_user_id'),
    nickname: getSettingSafe(db, 'netease_user_nickname')
  };
}

function getSettingSafe(db, key) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : '';
  } catch {
    return '';
  }
}

async function verifySavedLogin({ db, netease, tokenSource, fallbackMessage }) {
  const status = await getNeteaseLoginStatus({ db, netease });
  if (!status.profileReadable) {
    return {
      ...loginMeta(false, tokenSource, status.message || fallbackMessage),
      tokenSaved: true,
      hasToken: status.hasToken,
      profileReadable: false,
      userId: status.userId,
      nickname: status.nickname
    };
  }
  return {
    ...loginMeta(true, tokenSource, `登录成功：${status.nickname || status.userId}`),
    profileReadable: true,
    userId: status.userId,
    nickname: status.nickname
  };
}

function normalizeTokenCandidate(candidate, container = {}) {
  if (!candidate) return null;
  if (typeof candidate === 'string') {
    const accessToken = candidate.trim();
    if (!accessToken || accessToken === 'null') return null;
    return {
      accessToken,
      refreshToken: String(container.refreshToken || container.refresh_token || '').trim()
    };
  }
  if (typeof candidate !== 'object') return null;
  const accessToken = String(candidate.accessToken || candidate.access_token || '').trim();
  if (!accessToken || accessToken === 'null') return null;
  return {
    accessToken,
    refreshToken: String(candidate.refreshToken || candidate.refresh_token || container.refreshToken || container.refresh_token || '').trim()
  };
}

function normalizeAuthorizationCode(value) {
  if (value === undefined || value === null) return '';
  const code = String(value).trim();
  if (!code || code === 'null') return '';
  return code;
}

function normalizeQrStatusCode(value) {
  if (value === undefined || value === null) return '';
  const code = String(value).trim();
  return QR_STATUS_CODES.has(code) ? code : '';
}

function loginPendingMessage(result) {
  const data = result?.data || result || {};
  const status = normalizeQrStatusCode(data.status ?? data.qrStatus ?? data.qrCodeStatus ?? data.code);
  if (status === '801') return 'waiting for QR scan';
  if (status === '802') return 'waiting for phone confirmation';
  if (status === '800') return 'QR code expired';
  if (status === '803') return 'authorized, but no token or authorization code was returned';
  return 'token not available in QR status';
}

function loginMeta(loggedIn, tokenSource, loginMessage) {
  return {
    loggedIn,
    tokenSaved: loggedIn,
    hasToken: loggedIn,
    tokenSource,
    loginMessage
  };
}
