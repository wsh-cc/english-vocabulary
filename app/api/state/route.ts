import { getAccount, validWriteOrigin } from '@/lib/auth';
import { readState, readRevision, updateState } from '@/db/state';
import { actionSchema } from '@/lib/validation';
import { stateEtag } from '@/lib/state-etag';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200, etag?: string) => Response.json(body, {status, headers: {'Cache-Control': 'no-store', ...(etag ? {ETag: etag} : {})}});

export async function GET(request: Request) {
  try {
    const user = await getAccount();
    if (!user) return json({error: '请登录后继续学习。'}, 401);
    // Authenticate first; only a matching account and revision may skip the payload.
    if (request.headers.get('if-none-match')) {
      const etag = stateEtag(user.userId, await readRevision(user.userId));
      if (request.headers.get('if-none-match') === etag) return new Response(null, {status: 304, headers: {'Cache-Control': 'no-store', ETag: etag}});
    }
    const current = await readState(user.userId);
    return json({...current, user: {name: user.name, userId: user.userId}}, 200, stateEtag(user.userId, current.revision));
  } catch (error) {
    console.error('load-state', error);
    return json({error: '学习记录加载失败，请检查连接后重试。'}, 503);
  }
}

export async function POST(request: Request) {
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({error: '缺少内容。'}, 400);
    let length = 0;
    const parts: Uint8Array[] = [];
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4000000) { await reader.cancel(); return json({error: '文件不能超过 4 MB。'}, 413); }
      parts.push(value);
    }
    const user = await getAccount();
    if (!user) return json({error: '请登录后保存记录。'}, 401);
    if (!validWriteOrigin(request)) return json({error: '请求来源无效。'}, 403);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const parsed = actionSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    if (!parsed.success) return json({error: '数据格式不正确：' + parsed.error.issues[0].message}, 400);
    const {delta, ...current} = await updateState(user.userId, parsed.data, request.headers.get('x-wordweave-delta-base'));
    return json(delta ?? current, 200, stateEtag(user.userId, current.revision));
  } catch (error) {
    console.error('save-state', error);
    return json({error: error instanceof Error && /备份|记录|词汇|设备|编号/.test(error.message) ? error.message : '保存未完成，请保留页面并重试。'}, 409);
  }
}
