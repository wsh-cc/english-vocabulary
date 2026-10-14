import { env } from 'cloudflare:workers';
import { digest, equalHash, passwordHash, randomToken } from './auth-crypto';
import type { MobileLoginResponse, MobileUser } from './mobile-protocol';

const SESSION_MS = 14 * 86400000;
export class MobileHttpError extends Error {
  constructor(public status: number, message: string, public code = 'request_failed') { super(message); }
}
export function mobileDatabase() {
  if (!env.DB) throw new MobileHttpError(503, '账号服务暂时不可用。');
  return env.DB;
}
export async function readMobileJson(request: Request, maxBytes = 4000000): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new MobileHttpError(415, '请使用 JSON 格式。');
  const reader = request.body?.getReader();
  if (!reader) throw new MobileHttpError(400, '缺少请求内容。');
  let length = 0, text = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new MobileHttpError(413, '文件不能超过 4 MB。'); }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof MobileHttpError) throw error;
    throw new MobileHttpError(400, '提交的数据格式不正确。');
  }
}
export function mobileJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export function mobileFailure(error: unknown) {
  if (error instanceof MobileHttpError) return mobileJson({ error: error.message, code: error.code }, error.status);
  console.error('mobile-api', error instanceof Error ? error.name : 'UnknownError');
  return mobileJson({ error: '同步服务暂时不可用，本机记录已保留。', code: 'service_unavailable' }, 503);
}
export function bearerToken(request: Request) {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') ?? '');
  return match?.[1];
}
export async function requireMobileAccount(request: Request): Promise<MobileUser & { deviceId: string }> {
  const token = bearerToken(request);
  if (!token) throw new MobileHttpError(401, '请重新登录词间账号。', 'unauthorized');
  const account = await mobileDatabase().prepare('SELECT a.user_id AS userId, a.username AS name, s.device_id AS deviceId FROM mobile_sessions s JOIN app_accounts a ON a.user_id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await digest(token), Date.now()).first<MobileUser & { deviceId: string }>();
  if (!account) throw new MobileHttpError(401, '登录已过期，本机记录仍然保留，请重新登录。', 'unauthorized');
  return account;
}
async function rateLimit(key: string, limit: number) {
  const now = Date.now();
  const result = await mobileDatabase().prepare('INSERT INTO auth_attempts (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END, expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END RETURNING attempts')
    .bind(await digest(key), now + 15 * 60000, now, now).first<{ attempts: number }>();
  return (result?.attempts ?? limit + 1) <= limit;
}
export async function mobileLogin(username: string, password: string, deviceId: string, ip: string): Promise<MobileLoginResponse> {
  // Share both rate-limit keys with the website so switching clients cannot bypass them.
  const normalized = username.toLowerCase();
  if (!await rateLimit(`ip:${ip}`, 30) || !await rateLimit(`login:${ip}:${normalized}`, 10)) throw new MobileHttpError(429, '尝试次数较多，请 15 分钟后再试。', 'rate_limited');
  if (!env.PASSWORD_PEPPER) throw new MobileHttpError(503, '账号服务配置不可用。');
  const db = mobileDatabase();
  const account = await db.prepare('SELECT user_id, username, password_hash, salt FROM app_accounts WHERE username_normalized = ?').bind(normalized)
    .first<{ user_id: string; username: string; password_hash: string; salt: string }>();
  const actual = await passwordHash(password, account?.salt ?? 'unregistered-account', env.PASSWORD_PEPPER);
  if (!account || !equalHash(actual, account.password_hash)) throw new MobileHttpError(401, '用户名或密码不正确。', 'invalid_credentials');
  const token = randomToken(), now = Date.now(), expiresAt = now + SESSION_MS;
  await db.batch([
    db.prepare('DELETE FROM mobile_sessions WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM auth_attempts WHERE expires_at <= ?').bind(now),
    db.prepare('INSERT INTO mobile_sessions (token_hash, user_id, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(await digest(token), account.user_id, deviceId, now, expiresAt),
  ]);
  return { token, user: { userId: account.user_id, name: account.username }, expiresAt };
}
