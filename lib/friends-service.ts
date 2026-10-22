import { readingPassages } from './curriculum';
import { seedWords, type State } from './learning';
import { MobileHttpError, mobileDatabase } from './mobile-auth';
import { sharedProfileSchema, type FriendAction, type FriendDetail, type FriendIdentity, type FriendSearch, type FriendsOverview, type SharedProfile } from './friends-protocol';

export const FRIEND_LIMIT = 200;
export const FRIEND_PENDING_LIMIT = 50;
type Link = { pair_key: string; request_id: string; requester_id: string; recipient_id: string; status: string; created_at: number; updated_at: number; accepted_at: number | null };
type ProfileRow = { nickname: string | null; signature: string | null; avatar: string | null; avatar_data_url: string | null; share_learning: number | null };
type IdentityRow = ProfileRow & { user_id: string; username: string };
const pairKey = (one: string, two: string) => JSON.stringify([one, two].sort());
const defaultProfile = (): SharedProfile => ({ nickname: '', signature: '', avatar: 'initial', shareLearning: false });
const profileColumns = 'p.nickname, p.signature, p.avatar, p.avatar_data_url, p.share_learning';
const knownPassages = new Set(readingPassages.map(passage => passage.id));
const knownWords = new Set(seedWords.map(word => word.id));

function profile(row: ProfileRow | null): SharedProfile {
  if (!row) return defaultProfile();
  const parsed = sharedProfileSchema.safeParse({ nickname: row.nickname ?? '', signature: row.signature ?? '', avatar: row.avatar ?? 'initial', ...(row.avatar === 'custom' && row.avatar_data_url ? { avatarDataUrl: row.avatar_data_url } : {}), shareLearning: row.share_learning === 1 });
  return parsed.success ? parsed.data : defaultProfile();
}
function identity(row: IdentityRow, shared = true): FriendIdentity {
  const value = shared ? profile(row) : defaultProfile();
  return { userId: row.user_id, username: row.username, nickname: value.nickname, signature: value.signature, avatar: value.avatar, ...(value.avatarDataUrl ? { avatarDataUrl: value.avatarDataUrl } : {}) };
}
async function linkBetween(userId: string, otherId: string) {
  return mobileDatabase().prepare('SELECT * FROM friend_links WHERE pair_key = ?').bind(pairKey(userId, otherId)).first<Link>();
}
async function throttle(userId: string, operation: string, limit: number, duration: number) {
  const db = mobileDatabase(), now = Date.now();
  // Only a fixed set of operation names is used; no attacker-supplied search
  // strings or target ids can grow the rate-limit table without bound.
  const result = await db.prepare('INSERT INTO friend_rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires_at <= ? THEN 1 ELSE count + 1 END, expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END RETURNING count')
    .bind(`${userId}:${operation}`, now + duration, now, now).first<{ count: number }>();
  if (!result || result.count > limit) throw new MobileHttpError(429, '操作较频繁，请稍后再试。', 'rate_limited');
}

export async function friendsOverview(userId: string): Promise<FriendsOverview> {
  const db = mobileDatabase();
  const own = await db.prepare('SELECT nickname, signature, avatar, avatar_data_url, share_learning FROM friend_profiles WHERE user_id = ?').bind(userId).first<ProfileRow>();
  const friends = await db.prepare(`SELECT a.user_id, a.username, ${profileColumns}, l.accepted_at FROM friend_links l JOIN app_accounts a ON a.user_id = CASE WHEN l.requester_id = ? THEN l.recipient_id ELSE l.requester_id END LEFT JOIN friend_profiles p ON p.user_id = a.user_id WHERE (l.requester_id = ? OR l.recipient_id = ?) AND l.status = 'accepted' ORDER BY l.accepted_at DESC, a.user_id LIMIT ?`)
    .bind(userId, userId, userId, FRIEND_LIMIT).all<IdentityRow & { accepted_at: number }>();
  // Pending requests deliberately do not join the profile table.
  const pending = await db.prepare("SELECT a.user_id, a.username, l.request_id, l.requester_id, l.created_at FROM friend_links l JOIN app_accounts a ON a.user_id = CASE WHEN l.requester_id = ? THEN l.recipient_id ELSE l.requester_id END WHERE (l.requester_id = ? OR l.recipient_id = ?) AND l.status = 'pending' ORDER BY l.created_at DESC, l.request_id LIMIT ?")
    .bind(userId, userId, userId, FRIEND_PENDING_LIMIT).all<IdentityRow & { request_id: string; requester_id: string; created_at: number }>();
  const request = (row: IdentityRow & { request_id: string; created_at: number }) => ({ requestId: row.request_id, user: identity(row, false), createdAt: row.created_at });
  return {
    friends: friends.results.map(row => ({ user: identity(row), since: row.accepted_at })),
    incoming: pending.results.filter(row => row.requester_id !== userId).map(request),
    outgoing: pending.results.filter(row => row.requester_id === userId).map(request),
    profile: profile(own), published: !!own, serverTime: Date.now(),
  };
}

export async function searchFriend(userId: string, username: string): Promise<FriendSearch> {
  if (!/^[a-zA-Z0-9_\-\u4e00-\u9fff]{3,32}$/.test(username)) throw new MobileHttpError(400, '请输入完整用户名。', 'invalid_request');
  await throttle(userId, 'search', 30, 60000);
  const row = await mobileDatabase().prepare('SELECT user_id, username FROM app_accounts WHERE username_normalized = ?').bind(username.toLowerCase()).first<IdentityRow>();
  if (!row) return { user: null, relationship: 'none' };
  if (row.user_id === userId) return { user: identity(row, false), relationship: 'self' };
  const link = await linkBetween(userId, row.user_id);
  // Search always returns the minimal identity, even for an existing friend.
  // A separate authorized detail request supplies shared profile fields.
  return { user: identity(row, false), relationship: link?.status === 'accepted' ? 'friend' : link?.status === 'pending' ? link.requester_id === userId ? 'outgoing' : 'incoming' : 'none', ...(link?.status === 'pending' ? { requestId: link.request_id } : {}) };
}

export async function friendDetail(userId: string, otherId: string): Promise<FriendDetail> {
  const row = await mobileDatabase().prepare(`SELECT a.user_id, a.username, ${profileColumns}, l.accepted_at, s.payload, s.updated_at FROM friend_links l JOIN app_accounts a ON a.user_id = ? LEFT JOIN friend_profiles p ON p.user_id = a.user_id LEFT JOIN learner_state s ON s.user_id = a.user_id AND p.share_learning = 1 WHERE l.pair_key = ? AND l.status = 'accepted' AND ((l.requester_id = ? AND l.recipient_id = ?) OR (l.requester_id = ? AND l.recipient_id = ?))`)
    .bind(otherId, pairKey(userId, otherId), userId, otherId, otherId, userId).first<IdentityRow & { accepted_at: number; payload: string | null; updated_at: number | null }>();
  if (!row) throw new MobileHttpError(404, '好友不存在或关系已变更。', 'friend_not_found');
  let stats: FriendDetail['stats'] = null;
  if (row.share_learning === 1) {
    // Only aggregate server-owned learning state. Never return notes, answers,
    // custom vocabulary, individual events, or the serialized snapshot.
    const state = row.payload ? JSON.parse(row.payload) as State : null;
    stats = {
      passages: Object.keys(state?.reading?.completed ?? {}).filter(id => knownPassages.has(id)).length,
      encountered: Object.entries(state?.reading?.encounters ?? {}).filter(([id, encounter]) => knownWords.has(id) && encounter.count > 0).length,
      practices: state?.events.length ?? 0,
      level: state?.settings.level ?? 'CET6', updatedAt: row.updated_at ?? 0,
    };
  }
  return { user: identity(row), since: row.accepted_at, stats };
}

function capacityCondition(kind: 'accepted' | 'pending') {
  return `(SELECT COUNT(*) FROM friend_links c WHERE c.status = '${kind}' AND (c.requester_id = ? OR c.recipient_id = ?)) < ?`;
}
const bothHaveSpace = `${capacityCondition('accepted')} AND ${capacityCondition('accepted')}`;
const pendingSpace = `${capacityCondition('pending')} AND ${capacityCondition('pending')}`;
const capacityValues = (a: string, b: string, limit: number) => [a, a, limit, b, b, limit] as const;

async function requestFriend(userId: string, otherId: string) {
  if (userId === otherId) throw new MobileHttpError(400, '不能添加自己为好友。', 'invalid_request');
  const db = mobileDatabase();
  if (!await db.prepare('SELECT user_id FROM app_accounts WHERE user_id = ?').bind(otherId).first()) throw new MobileHttpError(404, '未找到这个账号。', 'user_not_found');
  const previous = await linkBetween(userId, otherId);
  if (previous?.status === 'pending' || previous?.status === 'accepted') return;
  await throttle(userId, 'request', 20, 3600000);
  const now = Date.now(), requestId = crypto.randomUUID();
  // Capacity predicates are inside the one write statement, so competing
  // requests cannot pass a stale preflight count and exceed either bound.
  await db.prepare(`INSERT INTO friend_links (pair_key, request_id, requester_id, recipient_id, status, created_at, updated_at, accepted_at) SELECT ?, ?, ?, ?, 'pending', ?, ?, NULL WHERE ${bothHaveSpace} AND ${pendingSpace} ON CONFLICT(pair_key) DO UPDATE SET request_id = excluded.request_id, requester_id = excluded.requester_id, recipient_id = excluded.recipient_id, status = 'pending', created_at = excluded.created_at, updated_at = excluded.updated_at, accepted_at = NULL WHERE friend_links.status IN ('declined', 'cancelled', 'removed')`)
    .bind(pairKey(userId, otherId), requestId, userId, otherId, now, now, ...capacityValues(userId, otherId, FRIEND_LIMIT), ...capacityValues(userId, otherId, FRIEND_PENDING_LIMIT)).run();
  const current = await linkBetween(userId, otherId);
  if (current?.status !== 'pending' && current?.status !== 'accepted') throw new MobileHttpError(409, '双方好友最多 200 位、待处理申请最多 50 条，请先整理后再添加。', 'friend_limit');
}

async function updateRequest(userId: string, requestId: string, action: 'accept' | 'decline' | 'cancel') {
  const db = mobileDatabase();
  const previous = await db.prepare('SELECT * FROM friend_links WHERE request_id = ?').bind(requestId).first<Link>();
  if (!previous) throw new MobileHttpError(404, '申请不存在或已更新。', 'request_not_found');
  const actor = action === 'cancel' ? previous.requester_id : previous.recipient_id;
  if (actor !== userId) throw new MobileHttpError(403, '不能处理他人的好友申请。', 'forbidden');
  const status = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'cancelled';
  if (previous.status === status) return;
  if (previous.status !== 'pending') throw new MobileHttpError(409, '这条申请已处理，请刷新列表。', 'request_changed');
  const now = Date.now();
  const result = await db.prepare(`UPDATE friend_links SET status = ?, updated_at = ?, accepted_at = ? WHERE request_id = ? AND status = 'pending' AND ${action === 'cancel' ? 'requester_id' : 'recipient_id'} = ?${action === 'accept' ? ` AND ${bothHaveSpace}` : ''}`)
    .bind(status, now, action === 'accept' ? now : null, requestId, userId, ...(action === 'accept' ? capacityValues(previous.requester_id, previous.recipient_id, FRIEND_LIMIT) : [])).run();
  if (!result.meta.changes) {
    const current = await db.prepare('SELECT status FROM friend_links WHERE request_id = ?').bind(requestId).first<{ status: string }>();
    if (current?.status === status) return;
    throw new MobileHttpError(409, action === 'accept' ? '申请已变更或好友数量已达上限，请刷新后重试。' : '申请已变更，请刷新后重试。', 'request_changed');
  }
}

async function removeFriend(userId: string, otherId: string) {
  const db = mobileDatabase(), key = pairKey(userId, otherId);
  const previous = await linkBetween(userId, otherId);
  if (!previous || (previous.requester_id !== userId && previous.recipient_id !== userId)) throw new MobileHttpError(404, '好友不存在。', 'friend_not_found');
  if (previous.status === 'removed') return;
  if (previous.status !== 'accepted') throw new MobileHttpError(409, '你们尚未成为好友，请刷新列表。', 'request_changed');
  const result = await db.prepare("UPDATE friend_links SET status = 'removed', updated_at = ? WHERE pair_key = ? AND request_id = ? AND status = 'accepted' AND (requester_id = ? OR recipient_id = ?)")
    .bind(Date.now(), key, previous.request_id, userId, userId).run();
  if (!result.meta.changes && (await linkBetween(userId, otherId))?.status !== 'removed') throw new MobileHttpError(409, '好友关系已变更，请刷新后重试。', 'request_changed');
}

export async function mutateFriends(userId: string, action: Exclude<FriendAction, { type: 'invite' | 'revoke-invite' }>): Promise<FriendsOverview> {
  await throttle(userId, 'write', 120, 15 * 60000);
  if (action.type === 'profile') {
    const value = sharedProfileSchema.parse(action.profile);
    await mobileDatabase().prepare('INSERT INTO friend_profiles (user_id, nickname, signature, avatar, avatar_data_url, share_learning, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET nickname = excluded.nickname, signature = excluded.signature, avatar = excluded.avatar, avatar_data_url = excluded.avatar_data_url, share_learning = excluded.share_learning, updated_at = excluded.updated_at')
      .bind(userId, value.nickname, value.signature, value.avatar, value.avatar === 'custom' ? value.avatarDataUrl! : null, value.shareLearning ? 1 : 0, Date.now()).run();
  } else if (action.type === 'request') await requestFriend(userId, action.userId);
  else if (action.type === 'remove') await removeFriend(userId, action.userId);
  else await updateRequest(userId, action.requestId, action.type);
  return friendsOverview(userId);
}
