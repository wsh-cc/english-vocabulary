'use client';

import { useSyncExternalStore } from 'react';
import { defaultProfile, profileSchema, readStoredProfile, type PersonalProfile } from '@/mobile/src/profile';

export type { PersonalProfile } from '@/mobile/src/profile';
const EMPTY_PROFILE = defaultProfile();
const CHANGE_EVENT = 'wordweave-browser-profile';
const cache = new Map<string, { raw: string | null; value: PersonalProfile }>();
const keyFor = (identity: string, draft = false) => `wordweave-web-profile-v1:${draft ? 'draft:' : ''}${encodeURIComponent(identity)}`;

export function browserProfileIdentity(username: string, userId?: string) {
  return userId ? `id:${userId}` : `name:${username}`;
}

export function readBrowserProfile(identity: string): PersonalProfile {
  if (!identity || typeof window === 'undefined') return EMPTY_PROFILE;
  try {
    const raw = window.localStorage.getItem(keyFor(identity));
    const prior = cache.get(identity);
    if (prior?.raw === raw) return prior.value;
    const stored = raw ? readStoredProfile(JSON.parse(raw), identity) : undefined;
    const value: PersonalProfile = stored ? { nickname: stored.nickname, signature: stored.signature, avatar: stored.avatar, ...(stored.avatarDataUrl ? { avatarDataUrl: stored.avatarDataUrl } : {}) } : EMPTY_PROFILE;
    cache.set(identity, { raw, value });
    return value;
  } catch { return EMPTY_PROFILE; }
}

function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => { window.removeEventListener('storage', listener); window.removeEventListener(CHANGE_EVENT, listener); };
}

export function useBrowserProfile(identity: string) {
  return useSyncExternalStore(subscribe, () => readBrowserProfile(identity), () => EMPTY_PROFILE);
}

export function saveBrowserProfile(identity: string, input: PersonalProfile): PersonalProfile {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) throw Error(parsed.error.issues[0].message);
  if (!identity) throw Error('请先登录，再保存个人资料。');
  try { window.localStorage.setItem(keyFor(identity), JSON.stringify({ userId: identity, ...parsed.data })); }
  catch { throw Error('当前浏览器无法保存资料，输入已保留。请检查存储空间或浏览器权限后重试。'); }
  try { window.localStorage.removeItem(keyFor(identity, true)); } catch { /* The saved profile remains durable even if draft cleanup fails. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return parsed.data;
}

export function readBrowserProfileDraft(identity: string): PersonalProfile | undefined {
  if (!identity || typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(keyFor(identity, true));
    const stored = raw ? readStoredProfile(JSON.parse(raw), identity) : undefined;
    return stored ? { nickname: stored.nickname, signature: stored.signature, avatar: stored.avatar, ...(stored.avatarDataUrl ? { avatarDataUrl: stored.avatarDataUrl } : {}) } : undefined;
  } catch { return undefined; }
}

export function saveBrowserProfileDraft(identity: string, value: PersonalProfile) {
  if (!identity) return;
  try { window.localStorage.setItem(keyFor(identity, true), JSON.stringify({ userId: identity, ...value })); }
  catch { throw Error('草稿暂时无法保存在浏览器中，请保持此页面打开并重试保存。'); }
}
