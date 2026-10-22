import { friendActionSchema } from '@/lib/friends-protocol';
import { friendDetail, friendsOverview, mutateFriends, searchFriend } from '@/lib/friends-service';
import { createFriendInvite, listFriendInvites, revokeFriendInvite } from '@/lib/friend-invites';
import { MobileHttpError, mobileFailure, mobileJson, readMobileJson, requireMobileAccount } from '@/lib/mobile-auth';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const user = await requireMobileAccount(request), query = new URL(request.url).searchParams;
    switch (query.get('view') ?? 'list') {
      case 'list': return mobileJson(await friendsOverview(user.userId));
      case 'search': return mobileJson(await searchFriend(user.userId, (query.get('username') ?? '').trim()));
      case 'detail': {
        const userId = query.get('userId');
        if (!userId || userId.length > 100) throw new MobileHttpError(400, '缺少好友编号。', 'invalid_request');
        return mobileJson(await friendDetail(user.userId, userId));
      }
      case 'invites': return mobileJson(await listFriendInvites(user.userId));
      default: throw new MobileHttpError(400, '不支持的好友查询。', 'invalid_request');
    }
  } catch (error) { return mobileFailure(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireMobileAccount(request);
    const parsed = friendActionSchema.safeParse(await readMobileJson(request, 24576));
    if (!parsed.success) return mobileJson({ error: '好友操作或个人资料格式不正确。', code: 'invalid_request' }, 400);
    const action = parsed.data;
    if (action.type === 'invite') return mobileJson(await createFriendInvite(user.userId, action.operationId));
    if (action.type === 'revoke-invite') return mobileJson(await revokeFriendInvite(user.userId, action.inviteId));
    return mobileJson(await mutateFriends(user.userId, action));
  } catch (error) { return mobileFailure(error); }
}
