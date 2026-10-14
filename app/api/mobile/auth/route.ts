import { z } from 'zod';
import { bearerToken, mobileDatabase, mobileFailure, mobileJson, mobileLogin, readMobileJson, requireMobileAccount } from '@/lib/mobile-auth';
import { digest } from '@/lib/auth-crypto';
export const dynamic = 'force-dynamic';
const credentials = z.object({ action: z.literal('login'), username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_\-\u4e00-\u9fff]+$/), password: z.string().min(12).max(128), deviceId: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/) }).strict();
export async function POST(request: Request) {
  try {
    const input = await readMobileJson(request, 4096);
    if (z.object({ action: z.literal('logout') }).strict().safeParse(input).success) {
      await requireMobileAccount(request);
      await mobileDatabase().prepare('DELETE FROM mobile_sessions WHERE token_hash = ?').bind(await digest(bearerToken(request)!)).run();
      return mobileJson({ ok: true });
    }
    const parsed = credentials.safeParse(input);
    if (!parsed.success) return mobileJson({ error: '请填写现有账号、密码和设备编号；此入口不支持注册。', code: 'invalid_credentials' }, 400);
    const { username, password, deviceId } = parsed.data;
    return mobileJson(await mobileLogin(username, password, deviceId, request.headers.get('cf-connecting-ip') ?? 'unknown'));
  } catch (error) { return mobileFailure(error); }
}
