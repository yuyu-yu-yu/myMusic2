import crypto from 'node:crypto';

export const DEFAULT_QUOTA_LIMITS = {
  llm: 80,
  tts: 100,
  aiMusic: 3
};

export class EdgeOneQuotaError extends Error {
  constructor(kind, limit) {
    super(`Daily ${kind} quota exceeded.`);
    this.name = 'EdgeOneQuotaError';
    this.status = 429;
    this.code = 'quota_exceeded';
    this.kind = kind;
    this.limit = limit;
  }
}

export async function enforceQuota({ store, kind, deviceId, ip, limit = DEFAULT_QUOTA_LIMITS[kind] || 50, now = new Date() } = {}) {
  if (!store || !kind || !limit) return { ok: true, skipped: true };
  const day = now.toISOString().slice(0, 10);
  const subjects = [
    deviceId ? `device:${deviceId}` : '',
    ip ? `ip:${hashIp(ip)}` : ''
  ].filter(Boolean);
  if (!subjects.length) return { ok: true, skipped: true };

  const records = [];
  for (const subject of subjects) {
    const key = `quota/${day}/${kind}/${subject}`;
    const record = await store.getJson(key, { count: 0, day, kind, subject });
    if (Number(record.count || 0) >= limit) throw new EdgeOneQuotaError(kind, limit);
    records.push({ key, record });
  }

  for (const { key, record } of records) {
    await store.setJson(key, {
      ...record,
      count: Number(record.count || 0) + 1,
      updatedAt: now.toISOString()
    });
  }

  return { ok: true, kind, limit, count: Math.max(...records.map(item => Number(item.record.count || 0) + 1)) };
}

export function getClientIp(request) {
  const headers = request?.headers;
  const forwarded = headers?.get?.('x-forwarded-for') || headers?.get?.('x-real-ip') || headers?.get?.('cf-connecting-ip') || '';
  return String(forwarded).split(',')[0].trim();
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || '')).digest('hex').slice(0, 16);
}
