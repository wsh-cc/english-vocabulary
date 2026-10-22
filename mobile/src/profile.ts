import { z } from 'zod';
import { avatarDataSchema } from '@/lib/friends-protocol';

export const PROFILE_AVATARS = ['initial', 'book', 'sprout', 'sun', 'mountain', 'coffee', 'custom'] as const;
export type ProfileAvatar = typeof PROFILE_AVATARS[number];

// Personal presentation is local to this account and device. It deliberately
// stays outside the learning state, sync protocol and learning backup format.
export const profileSchema = z.object({
  nickname: z.string().trim().max(24, '昵称最多 24 个字符。'),
  signature: z.string().trim().max(80, '签名最多 80 个字符。'),
  avatar: z.enum(PROFILE_AVATARS),
  avatarDataUrl: avatarDataSchema.optional(),
}).refine(value => value.avatar !== 'custom' || !!value.avatarDataUrl, {message: '请选择头像照片。', path: ['avatarDataUrl']});
export type PersonalProfile = z.infer<typeof profileSchema>;
export type StoredProfile = PersonalProfile & { userId: string };

export function defaultProfile(): PersonalProfile {
  return { nickname: '', signature: '', avatar: 'initial' };
}

export function readStoredProfile(value: unknown, userId?: string): StoredProfile | undefined {
  if (!userId || !value || typeof value !== 'object' || !('userId' in value) || value.userId !== userId) return undefined;
  const result = profileSchema.safeParse(value);
  return result.success ? { userId, ...result.data } : undefined;
}
