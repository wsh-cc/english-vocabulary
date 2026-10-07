import { env } from 'cloudflare:workers';
import { cookies } from 'next/headers';
import { digest } from './auth-crypto';

export const SESSION_COOKIE = 'wordweave_session';
export const SESSION_SECONDS = 60 * 60 * 24 * 14;
export function authDatabase() {
  if (!env.DB) throw Error('Account storage unavailable');
  return env.DB;
}
export function authConfig() {
  if (!env.REGISTRATION_KEY_HASH || !env.PASSWORD_PEPPER) throw Error('Account configuration unavailable');
  return {inviteHash: env.REGISTRATION_KEY_HASH, pepper: env.PASSWORD_PEPPER};
}
export async function getAccount() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return authDatabase().prepare('SELECT a.user_id AS userId, a.username AS name FROM app_sessions s JOIN app_accounts a ON a.user_id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await digest(token), Date.now()).first<{userId: string; name: string}>();
}
export function validWriteOrigin(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  if (!request.headers.get('content-type')?.startsWith('application/json')) return false;
  const origin = request.headers.get('origin');
  return !!origin && origin === new URL(request.url).origin;
}
export function sessionCookie(token: string, request: Request, clear = false) {
  const secure = new URL(request.url).protocol === 'https:';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_SECONDS}${secure ? '; Secure' : ''}`;
}
