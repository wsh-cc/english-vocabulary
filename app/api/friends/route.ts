import { getAccount, validWriteOrigin } from '@/lib/auth';
import { friendActionSchema } from '@/lib/friends-protocol';
import { friendDetail, friendsOverview, mutateFriends, searchFriend } from '@/lib/friends-service';
import { createFriendInvite, listFriendInvites, revokeFriendInvite } from '@/lib/friend-invites';
import { MobileHttpError } from '@/lib/mobile-auth';

export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 24576;
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
const failure = (error: unknown) => {
  if (error instanceof MobileHttpError) return json({ error: error.message, code: error.code }, error.status);
  console.error('web-friends', error instanceof Error ? error.name : 'UnknownError');
  return json({ error: '好友服务暂时不可用，请稍后重试。', code: 'service_unavailable' }, 503);
};
async function requireAccount() {
  const account = await getAccount();
  if (!account) throw new MobileHttpError(401, '请登录后使用好友功能。', 'unauthorized');
  return account;
}

export async function GET(request: Request) {
  try {
    const user = await requireAccount(), query = new URL(request.url).searchParams;
    switch (query.get('view') ?? 'list') {
      case 'list': return json(await friendsOverview(user.userId));
      case 'search': return json(await searchFriend(user.userId, (query.get('username') ?? '').trim()));
      case 'detail': {
        const userId = query.get('userId');
        if (!userId || userId.length > 100) throw new MobileHttpError(400, '缺少好友编号。', 'invalid_request');
        return json(await friendDetail(user.userId, userId));
      }
      case 'invites': return json(await listFriendInvites(user.userId));
      default: throw new MobileHttpError(400, '不支持的好友查询。', 'invalid_request');
    }
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    // Consume the bounded body before rejecting: the local Worker proxy reuses
    // request streams. Identity still comes only from the website session.
    const reader = request.body?.getReader();
    if (!reader) throw new MobileHttpError(400, '缺少好友操作内容。', 'invalid_request');
    const parts: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new MobileHttpError(413, '好友操作不能超过 24 KB。', 'request_too_large');
      }
      parts.push(value);
    }
    const user = await requireAccount();
    if (!validWriteOrigin(request)) throw new MobileHttpError(403, '请求来源无效，请从本站重试。', 'forbidden');
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    let input: unknown;
    try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new MobileHttpError(400, '提交的数据格式不正确。', 'invalid_request'); }
    const parsed = friendActionSchema.safeParse(input);
    if (!parsed.success) return json({ error: '好友操作或个人资料格式不正确。', code: 'invalid_request' }, 400);
    const action = parsed.data;
    if (action.type === 'invite') return json(await createFriendInvite(user.userId, action.operationId));
    if (action.type === 'revoke-invite') return json(await revokeFriendInvite(user.userId, action.inviteId));
    return json(await mutateFriends(user.userId, action));
  } catch (error) { return failure(error); }
}
