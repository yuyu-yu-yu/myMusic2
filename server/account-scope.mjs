import { DEFAULT_ACCOUNT_ID, getAccountSetting, getSetting, normalizeAccountId } from './db.mjs';

export function resolveAccountContext(db) {
  const loginSource = String(getSetting(db, 'netease_login_source') || '').trim();
  const cookieUserId = String(getSetting(db, 'netease_cookie_user_id') || '').trim();
  const cookieNickname = String(getSetting(db, 'netease_cookie_user_nickname') || '').trim();
  const openapiUserId = String(getSetting(db, 'netease_user_id') || '').trim();
  const openapiNickname = String(getSetting(db, 'netease_user_nickname') || '').trim();

  if (loginSource === 'cookie' && cookieUserId) {
    return accountContext({
      accountId: `netease:cookie:${cookieUserId}`,
      provider: 'netease',
      providerUserId: cookieUserId,
      source: 'cookie',
      nickname: cookieNickname
    }, db);
  }

  if (loginSource === 'openapi' && openapiUserId) {
    return accountContext({
      accountId: `netease:openapi:${openapiUserId}`,
      provider: 'netease',
      providerUserId: openapiUserId,
      source: 'openapi',
      nickname: openapiNickname
    }, db);
  }

  if (cookieUserId) {
    return accountContext({
      accountId: `netease:cookie:${cookieUserId}`,
      provider: 'netease',
      providerUserId: cookieUserId,
      source: 'cookie',
      nickname: cookieNickname
    }, db);
  }

  if (openapiUserId) {
    return accountContext({
      accountId: `netease:openapi:${openapiUserId}`,
      provider: 'netease',
      providerUserId: openapiUserId,
      source: 'openapi',
      nickname: openapiNickname
    }, db);
  }

  return accountContext({
    accountId: DEFAULT_ACCOUNT_ID,
    provider: 'local',
    providerUserId: '',
    source: 'local',
    nickname: ''
  }, db);
}

export function normalizeAccountContext(context = {}) {
  context = context || {};
  const accountId = normalizeAccountId(context.accountId);
  const isLocal = accountId === DEFAULT_ACCOUNT_ID;
  return {
    accountId,
    provider: String(context.provider || (isLocal ? 'local' : '')).trim() || 'unknown',
    providerUserId: String(context.providerUserId || '').trim(),
    source: String(context.source || (isLocal ? 'local' : '')).trim() || 'unknown',
    nickname: String(context.nickname || '').trim(),
    isAuthenticated: Boolean(context.isAuthenticated ?? !isLocal),
    cloudAccountId: context.cloudAccountId ? String(context.cloudAccountId) : ''
  };
}

export function publicAccountContext(context = {}) {
  const normalized = normalizeAccountContext(context);
  return {
    provider: normalized.provider,
    source: normalized.source,
    nickname: normalized.nickname,
    isAuthenticated: normalized.isAuthenticated,
    providerUserIdMasked: maskAccountId(normalized.providerUserId),
    cloudAccountId: normalized.cloudAccountId ? maskAccountId(normalized.cloudAccountId) : ''
  };
}

function accountContext(base, db) {
  const normalized = normalizeAccountContext({
    ...base,
    isAuthenticated: base.accountId !== DEFAULT_ACCOUNT_ID
  });
  return {
    ...normalized,
    cloudAccountId: getAccountSetting(db, normalized.accountId, 'cloud_account_id') || ''
  };
}

function maskAccountId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
}
