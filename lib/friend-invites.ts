import { digest, randomToken } from './auth-crypto';
import { mobileDatabase, MobileHttpError } from './mobile-auth';
import type { CreatedFriendInvite, FriendInvites } from './friends-protocol';

const INVITE_LIFETIME = 7 * 86400000;
const MAX_ACTIVE_INVITES = 5;
const INVITE_WINDOW = 86400000;
const MAX_DAILY_INVITES = 20;
const invalidInvite = () => new MobileHttpError(403, '邀请码无效、已失效或已被使用，请向好友获取新的邀请码。', 'invite_invalid');

export async function listFriendInvites(userId: string): Promise<FriendInvites> {
  const result = await mobileDatabase().prepare('SELECT id, created_at AS createdAt, expires_at AS expiresAt FROM social_invites WHERE creator_id = ? AND expires_at > ? AND revoked_at IS NULL AND consumed_at IS NULL ORDER BY created_at DESC, id')
    .bind(userId, Date.now()).all<{ id: string; createdAt: number; expiresAt: number }>();
  return { invites: result.results };
}

export async function createFriendInvite(userId: string, operationId: string): Promise<CreatedFriendInvite> {
  const db = mobileDatabase(), now = Date.now(), expiresAt = now + INVITE_LIFETIME;
  const id = crypto.randomUUID(), code = 'WW-' + randomToken();
  // One statement checks the active limit and inserts, so concurrent devices
  // cannot both consume the last slot. Only the digest ever reaches storage.
  const inserted = await db.prepare('INSERT OR IGNORE INTO social_invites (id, creator_id, operation_id, token_hash, created_at, expires_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM app_accounts WHERE user_id = ?) AND (SELECT COUNT(*) FROM social_invites WHERE creator_id = ? AND expires_at > ? AND revoked_at IS NULL AND consumed_at IS NULL) < ? AND (SELECT COUNT(*) FROM social_invites WHERE creator_id = ? AND created_at > ?) < ?')
    .bind(id, userId, operationId, await digest(code), now, expiresAt, userId, userId, now, MAX_ACTIVE_INVITES, userId, now - INVITE_WINDOW, MAX_DAILY_INVITES).run();
  if (inserted.meta.changes) return { id, code, createdAt: now, expiresAt };
  // Keep these receipts after expiry/revocation. A lost response must never
  // allow the same operation to mint a second usable invitation.
  const previous = await db.prepare('SELECT id FROM social_invites WHERE creator_id = ? AND operation_id = ?').bind(userId, operationId).first();
  if (previous) throw new MobileHttpError(409, '这次邀请码已生成，完整邀请码只显示一次。请查看有效邀请，撤回不需要的邀请后重新生成。', 'invite_operation_used');
  const account = await db.prepare('SELECT user_id FROM app_accounts WHERE user_id = ?').bind(userId).first();
  if (!account) throw new MobileHttpError(401, '请重新登录后生成邀请码。', 'unauthorized');
  const recent = await db.prepare('SELECT COUNT(*) AS count FROM social_invites WHERE creator_id = ? AND created_at > ?').bind(userId, now - INVITE_WINDOW).first<{ count: number }>();
  if ((recent?.count ?? 0) >= MAX_DAILY_INVITES) throw new MobileHttpError(429, '24 小时内最多生成 20 个邀请码，撤回或使用后仍计入次数，请稍后再试。', 'invite_daily_limit');
  throw new MobileHttpError(429, '最多保留 5 个有效邀请码，请先撤回一个或等待它失效。', 'invite_limit');
}

export async function revokeFriendInvite(userId: string, inviteId: string): Promise<FriendInvites> {
  const db = mobileDatabase();
  const owned = await db.prepare('SELECT id FROM social_invites WHERE id = ? AND creator_id = ?').bind(inviteId, userId).first();
  if (!owned) throw new MobileHttpError(404, '找不到这个邀请。', 'invite_not_found');
  await db.prepare('UPDATE social_invites SET revoked_at = ? WHERE id = ? AND creator_id = ? AND revoked_at IS NULL AND consumed_at IS NULL')
    .bind(Date.now(), inviteId, userId).run();
  return listFriendInvites(userId);
}

type InvitedAccount = { userId: string; username: string; normalized: string; passwordHash: string; salt: string };

export async function registerWithFriendInvite(code: string, account: InvitedAccount): Promise<void> {
  if (!/^WW-[a-f0-9]{64}$/.test(code)) throw invalidInvite();
  const db = mobileDatabase(), now = Date.now(), tokenHash = await digest(code);
  // D1 batches run as one transaction. The second statement can consume the
  // invite only if this exact new account was inserted by the first. A name
  // collision, concurrent redemption or storage failure leaves no partial user.
  const results = await db.batch([
    db.prepare('INSERT OR IGNORE INTO app_accounts (slot, user_id, username, username_normalized, password_hash, salt, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM social_invites WHERE token_hash = ? AND expires_at > ? AND revoked_at IS NULL AND consumed_at IS NULL)')
      .bind('member:' + account.userId, account.userId, account.username, account.normalized, account.passwordHash, account.salt, now, tokenHash, now),
    db.prepare('UPDATE social_invites SET consumed_at = ?, consumed_by = ? WHERE token_hash = ? AND expires_at > ? AND revoked_at IS NULL AND consumed_at IS NULL AND EXISTS (SELECT 1 FROM app_accounts WHERE user_id = ?)')
      .bind(now, account.userId, tokenHash, now, account.userId),
  ]);
  if (results[0].meta.changes && results[1].meta.changes) return;
  const active = await db.prepare('SELECT id FROM social_invites WHERE token_hash = ? AND expires_at > ? AND revoked_at IS NULL AND consumed_at IS NULL').bind(tokenHash, now).first();
  if (active) throw new MobileHttpError(409, '这个用户名已被使用，请换一个。邀请码仍可继续使用。', 'username_taken');
  throw invalidInvite();
}
