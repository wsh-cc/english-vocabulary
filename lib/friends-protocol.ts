import { z } from 'zod';

export const friendAvatarSchema = z.enum(['initial', 'book', 'sprout', 'sun', 'mountain', 'coffee', 'custom']);
export const avatarDataSchema = z.string().max(16384).regex(/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/);
export const sharedProfileSchema = z.object({
  nickname: z.string().trim().max(24),
  signature: z.string().trim().max(80),
  avatar: friendAvatarSchema,
  avatarDataUrl: avatarDataSchema.optional(),
  shareLearning: z.boolean(),
}).strict().refine(value => value.avatar !== 'custom' || !!value.avatarDataUrl, {message: '请选择头像照片。', path: ['avatarDataUrl']});
export type SharedProfile = z.infer<typeof sharedProfileSchema>;
export type FriendIdentity = { userId: string; username: string; nickname: string; signature: string; avatar: z.infer<typeof friendAvatarSchema>; avatarDataUrl?: string };
export type FriendCard = { user: FriendIdentity; since: number };
export type FriendRequest = { requestId: string; user: FriendIdentity; createdAt: number };
export type FriendsOverview = { friends: FriendCard[]; incoming: FriendRequest[]; outgoing: FriendRequest[]; profile: SharedProfile; published: boolean; serverTime: number };
export type FriendSearch = { user: FriendIdentity | null; relationship: 'none' | 'self' | 'friend' | 'incoming' | 'outgoing'; requestId?: string };
export type FriendDetail = { user: FriendIdentity; since: number; stats: { passages: number; encountered: number; practices: number; level: 'CET4' | 'CET6'; updatedAt: number } | null };
export type FriendInvite = { id: string; createdAt: number; expiresAt: number };
export type FriendInvites = { invites: FriendInvite[] };
export type CreatedFriendInvite = FriendInvite & { code: string };

const id = z.string().min(1).max(100);
export const friendActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('request'), userId: id }).strict(),
  z.object({ type: z.literal('accept'), requestId: id }).strict(),
  z.object({ type: z.literal('decline'), requestId: id }).strict(),
  z.object({ type: z.literal('cancel'), requestId: id }).strict(),
  z.object({ type: z.literal('remove'), userId: id }).strict(),
  z.object({ type: z.literal('profile'), profile: sharedProfileSchema }).strict(),
  z.object({ type: z.literal('invite'), operationId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('revoke-invite'), inviteId: id }).strict(),
]);
export type FriendAction = z.infer<typeof friendActionSchema>;

const timestamp = z.number().int().nonnegative().safe();
export const friendIdentitySchema = z.object({userId:id, username:z.string().max(32), nickname:z.string().max(24), signature:z.string().max(80), avatar:friendAvatarSchema, avatarDataUrl:avatarDataSchema.optional()});
export const friendsOverviewSchema = z.object({
  friends:z.array(z.object({user:friendIdentitySchema,since:timestamp})).max(200),
  incoming:z.array(z.object({requestId:id,user:friendIdentitySchema,createdAt:timestamp})).max(100),
  outgoing:z.array(z.object({requestId:id,user:friendIdentitySchema,createdAt:timestamp})).max(100),
  profile:sharedProfileSchema, published:z.boolean(), serverTime:timestamp,
});
export const friendSearchSchema = z.object({user:friendIdentitySchema.nullable(),relationship:z.enum(['none','self','friend','incoming','outgoing']),requestId:id.optional()});
export const friendDetailSchema = z.object({user:friendIdentitySchema,since:timestamp,stats:z.object({passages:timestamp,encountered:timestamp,practices:timestamp,level:z.enum(['CET4','CET6']),updatedAt:timestamp}).nullable()});
const inviteSchema = z.object({id,createdAt:timestamp,expiresAt:timestamp});
export const friendInvitesSchema = z.object({invites:z.array(inviteSchema).max(5)});
export const createdFriendInviteSchema = inviteSchema.extend({code:z.string().min(8).max(200)});
