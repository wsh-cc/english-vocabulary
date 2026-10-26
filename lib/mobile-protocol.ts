import type { State } from './learning';

export const MOBILE_PROTOCOL_VERSION = 1;
export const MOBILE_CONTENT_VERSION = 'wordweave-2026-10-v3';
// This release only appends content. Preserve queued completions from the old APK.
export const MOBILE_READING_CONTENT_VERSIONS = ['wordweave-2026-10-v1', 'wordweave-2026-10-v2', MOBILE_CONTENT_VERSION] as const;
// Leave headroom below D1's 2,000,000-byte row and 50-query free-tier limits.
export const MOBILE_STATE_MAX_BYTES = 1900000;
export const MOBILE_SYNC_BATCH_SIZE = 3;
export type MobileUser = { userId: string; name: string };
export type MobileOperation = {
  operationId: string;
  deviceId: string;
  deviceSequence: number;
  occurredAt: number;
  generation: number;
  action: Record<string, unknown>;
  baseNote?: string;
};
export type MobileConflict = {
  operationId: string;
  code: string;
  message: string;
  wordId?: string;
  local?: string;
  remote?: string;
};
export type MobileSyncVersion = {
  revision: number;
  generation: number;
  user: MobileUser;
  serverTime: number;
  contentVersion: string;
  protocolVersion: number;
};
export type MobileSnapshot = MobileSyncVersion & { state: State };
export type MobileSyncResponse = MobileSnapshot & {
  accepted: string[];
  conflicts: MobileConflict[];
  idMap: Record<string, string>;
};
export type MobileLoginResponse = { token: string; user: MobileUser; expiresAt: number };
export type MobileRestoreRequest = {
  operationId: string;
  revision: number;
  generation: number;
  backup: State;
};
