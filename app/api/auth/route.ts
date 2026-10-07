import { z } from 'zod';
import { cookies } from 'next/headers';
import { authConfig, authDatabase, SESSION_COOKIE, SESSION_SECONDS, sessionCookie, validWriteOrigin } from '@/lib/auth';
import { digest, equalHash, passwordHash, randomToken } from '@/lib/auth-crypto';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200, cookie?: string) => Response.json(body, {status, headers: {'Cache-Control': 'no-store', ...(cookie ? {'Set-Cookie': cookie} : {})}});
const credentials = z.object({
  action: z.enum(['login', 'register']),
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_\-\u4e00-\u9fff]+$/),
  password: z.string().min(12).max(128),
  invitation: z.string().max(200).optional(),
});

async function rateLimit(key: string, limit: number) {
  const now = Date.now();
  const row = await authDatabase().prepare('INSERT INTO auth_attempts (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END, expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END RETURNING attempts')
    .bind(await digest(key), now + 15 * 60000, now, now).first<{attempts: number}>();
  return (row?.attempts ?? limit + 1) <= limit;
}

export async function POST(request: Request) {
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({error: '请填写账号信息。'}, 400);
    let raw = ''; let size = 0; const decoder = new TextDecoder();
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 4096) { await reader.cancel(); return json({error: '提交内容过长。'}, 413); } raw += decoder.decode(chunk.value, {stream: true}); }
    raw += decoder.decode();
    // Finish reading before rejecting: the local Worker proxy reuses request streams.
    if (!validWriteOrigin(request)) return json({error: '请求来源无效，请从本站重试。'}, 403);
    let input: unknown; try { input = JSON.parse(raw); } catch { return json({error: '提交格式不正确。'}, 400); }
    const db = authDatabase();
    if ((input as {action?: string})?.action === 'logout') {
      const token = (await cookies()).get(SESSION_COOKIE)?.value;
      if (token) await db.prepare('DELETE FROM app_sessions WHERE token_hash = ?').bind(await digest(token)).run();
      return json({ok: true}, 200, sessionCookie('', request, true));
    }
    const parsed = credentials.safeParse(input);
    if (!parsed.success) return json({error: '用户名需 3–32 个字母、数字、中文或下划线；密码需 12–128 位。'}, 400);
    const {action, username, password, invitation} = parsed.data;
    const normalized = username.toLowerCase();
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (!await rateLimit(`ip:${ip}`, 30) || !await rateLimit(`${action}:${ip}:${normalized}`, 10)) return json({error: '尝试次数较多，请 15 分钟后再试。'}, 429);
    const {inviteHash, pepper} = authConfig();
    let userId: string;
    if (action === 'register') {
      if (!equalHash(await digest((invitation ?? '').trim()), inviteHash)) return json({error: '注册密钥不正确。'}, 403);
      const salt = randomToken();
      userId = 'local-' + crypto.randomUUID();
      const hash = await passwordHash(password, salt, pepper);
      // The singleton primary key makes simultaneous registration attempts atomic.
      const result = await db.prepare('INSERT OR IGNORE INTO app_accounts (slot, user_id, username, username_normalized, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind('owner', userId, username, normalized, hash, salt, Date.now()).run();
      if (!result.meta.changes) return json({error: '私人账号已经注册，请切换到登录。'}, 409);
    } else {
      const account = await db.prepare('SELECT user_id, password_hash, salt FROM app_accounts WHERE username_normalized = ?').bind(normalized).first<{user_id: string; password_hash: string; salt: string}>();
      const actual = await passwordHash(password, account?.salt ?? 'unregistered-account', pepper);
      if (!account || !equalHash(actual, account.password_hash)) return json({error: '用户名或密码不正确。'}, 401);
      userId = account.user_id;
    }
    const token = randomToken();
    await db.batch([
      db.prepare('DELETE FROM app_sessions WHERE expires_at <= ?').bind(Date.now()),
      db.prepare('DELETE FROM auth_attempts WHERE expires_at <= ?').bind(Date.now()),
      db.prepare('INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await digest(token), userId, Date.now() + SESSION_SECONDS * 1000),
    ]);
    return json({ok: true}, 200, sessionCookie(token, request));
  } catch {
    return json({error: '账号服务暂时不可用，请稍后重试。'}, 503);
  }
}
