import { z } from 'zod';
import { getAccount, validWriteOrigin } from '@/lib/auth';
import { readState, updateState } from '@/db/state';
import { readingSummary } from '@/lib/reading';
import { coursePassages, nextReading } from '@/lib/curriculum';
import { stateEtag } from '@/lib/state-etag';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200, etag?: string) => Response.json(body, {status, headers: {'Cache-Control': 'no-store', ...(etag ? {ETag: etag} : {})}});
const key = z.string().uuid();
const inputSchema = z.discriminatedUnion('action', [
  z.object({action: z.literal('next'), afterId: key.optional()}),
  z.object({action: z.literal('complete'), id: key, operationId: key, advance: z.boolean().optional()}),
]);

export async function GET(request: Request) {
  try {
    const user = await getAccount();
    if (!user) return json({error: '请登录后阅读。'}, 401);
    const {state} = await readState(user.userId);
    const params = new URL(request.url).searchParams;
    const requested = params.get('id');
    const cursor = params.get('cursor');
    if ([requested, cursor].some(id => id && !key.safeParse(id).success)) return json({error: '段落编号无效。'}, 400);
    const passages = coursePassages(state);
    const passage = requested ? passages.find(p => p.id === requested) : nextReading(state);
    if (requested && !passage) return json({error: '当前词表中未找到这篇段落。'}, 404);
    const offset = cursor ? passages.findIndex(p => p.id === cursor) + 1 : 0;
    if (cursor && offset === 0) return json({error: '历史位置无效。'}, 404);
    const page = passages.slice(offset, offset + 30);
    return json({passage: passage ?? null, history: page.map(p => ({id: p.id, title: p.title, count: p.wordIds.length, completed: !!state.reading?.completed[p.id]})), nextCursor: offset + 30 < passages.length ? page.at(-1)?.id : null, summary: readingSummary(state), available: passages.length, completedCount: passages.filter(p => state.reading?.completed[p.id]).length});
  } catch {
    return json({error: '段落加载失败，请重新连接。'}, 503);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAccount();
    if (!user) return json({error: '请登录后继续阅读。'}, 401);
    if (!validWriteOrigin(request)) return json({error: '请求来源无效。'}, 403);
    const reader = request.body?.getReader();
    if (!reader) return json({error: '缺少内容。'}, 400);
    let length = 0; let text = ''; const decoder = new TextDecoder();
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2048) {await reader.cancel(); return json({error: '请求内容过长。'}, 413);}
      text += decoder.decode(value, {stream: true});
    }
    let input: unknown;
    try {input = JSON.parse(text + decoder.decode());} catch {return json({error: '请求格式不正确。'}, 400);}
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return json({error: '阅读请求格式不正确。'}, 400);
    const action = parsed.data;
    const {state} = await readState(user.userId);
    if (action.action === 'next') {
      if (action.afterId && !coursePassages(state).some(p => p.id === action.afterId)) return json({error: '当前词表中未找到这篇段落。'}, 404);
      return json({passage: nextReading(state, action.afterId), completedCount: coursePassages(state).filter(p => state.reading?.completed[p.id]).length});
    }
    const passage = coursePassages(state).find(p => p.id === action.id);
    if (!passage) return json({error: '当前词表中未找到这篇段落。'}, 404);
    const result = await updateState(user.userId, {type: 'reading-complete', operationId: action.operationId, passage});
    // Select from the committed (or deduplicated) snapshot, including CAS retries.
    return json({...result, summary: readingSummary(result.state), ...(action.advance ? {
      passage: nextReading(result.state, action.id),
      completedCount: coursePassages(result.state).filter(p => result.state.reading?.completed[p.id]).length,
    } : {})}, 200, stateEtag(user.userId, result.revision));
  } catch {
    return json({error: '阅读记录未保存，请重试。'}, 503);
  }
}
