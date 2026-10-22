// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const learnerState=sqliteTable('learner_state', { userId:text('user_id').primaryKey(),payload:text('payload').notNull(),revision:integer('revision').notNull().default(0),updatedAt:integer('updated_at').notNull() });
export const accounts = sqliteTable('app_accounts', {
  slot: text('slot').primaryKey(), userId: text('user_id').notNull().unique(),
  username: text('username').notNull(), usernameNormalized: text('username_normalized').notNull().unique(),
  passwordHash: text('password_hash').notNull(), salt: text('salt').notNull(), createdAt: integer('created_at').notNull(),
});
export const sessions = sqliteTable('app_sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull().references(() => accounts.userId), expiresAt: integer('expires_at').notNull(),
});
export const authAttempts = sqliteTable('auth_attempts', {
  key: text('key').primaryKey(), attempts: integer('attempts').notNull(), expiresAt: integer('expires_at').notNull(),
});
export const mobileSessions = sqliteTable('mobile_sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull().references(() => accounts.userId),
  deviceId: text('device_id').notNull(), createdAt: integer('created_at').notNull(), expiresAt: integer('expires_at').notNull(),
}, table => [index('mobile_sessions_user').on(table.userId)]);
export const mobileSyncMeta = sqliteTable('mobile_sync_meta', {
  userId: text('user_id').primaryKey(), generation: integer('generation').notNull().default(1),
  baselinePayload: text('baseline_payload').notNull(), baselineAt: integer('baseline_at').notNull(),
});
export const mobileRecovery = sqliteTable('mobile_recovery', {
  userId: text('user_id').primaryKey(), payload: text('payload').notNull(), revision: integer('revision').notNull(),
  generation: integer('generation').notNull(), savedAt: integer('saved_at').notNull(),
});
export const mobileOperations = sqliteTable('mobile_operations', {
  userId: text('user_id').notNull(), operationId: text('operation_id').notNull(), generation: integer('generation').notNull(),
  deviceId: text('device_id').notNull(), deviceSequence: integer('device_sequence').notNull(),
  occurredAt: integer('occurred_at').notNull(), receivedAt: integer('received_at').notNull(), requestHash: text('request_hash').notNull(),
  actionPayload: text('action_payload').notNull(), status: text('status').notNull(), conflictPayload: text('conflict_payload'),
  idMapPayload: text('id_map_payload').notNull().default('{}'), commitId: text('commit_id').notNull(),
}, table => [
  primaryKey({ columns: [table.userId, table.operationId] }),
  index('mobile_operations_replay').on(table.userId, table.generation, table.occurredAt, table.deviceId, table.deviceSequence),
  index('mobile_operations_device').on(table.userId, table.generation, table.deviceId, table.deviceSequence),
  check('mobile_operations_status', sql`${table.status} IN ('accepted', 'conflict')`),
]);

export const friendProfiles = sqliteTable('friend_profiles', {
  userId: text('user_id').primaryKey().references(() => accounts.userId),
  nickname: text('nickname').notNull().default(''), signature: text('signature').notNull().default(''),
  avatar: text('avatar').notNull().default('initial'), avatarDataUrl: text('avatar_data_url'),
  shareLearning: integer('share_learning').notNull().default(0), updatedAt: integer('updated_at').notNull(),
}, table => [check('friend_profiles_sharing', sql`${table.shareLearning} IN (0, 1)`)]);

// A canonical pair is unique regardless of who initiated the request. Keeping
// the last terminal state makes retries safe without retaining an event log.
export const friendLinks = sqliteTable('friend_links', {
  pairKey: text('pair_key').primaryKey(), requestId: text('request_id').notNull().unique(),
  requesterId: text('requester_id').notNull().references(() => accounts.userId),
  recipientId: text('recipient_id').notNull().references(() => accounts.userId),
  status: text('status').notNull(), createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(), acceptedAt: integer('accepted_at'),
}, table => [
  index('friend_links_requester').on(table.requesterId, table.status),
  index('friend_links_recipient').on(table.recipientId, table.status),
  check('friend_links_status', sql`${table.status} IN ('pending', 'accepted', 'declined', 'cancelled', 'removed')`),
  check('friend_links_distinct', sql`${table.requesterId} <> ${table.recipientId}`),
]);

export const friendRateLimits = sqliteTable('friend_rate_limits', {
  key: text('key').primaryKey(), count: integer('count').notNull(), expiresAt: integer('expires_at').notNull(),
});

export const socialInvites = sqliteTable('social_invites', {
  id: text('id').primaryKey(), creatorId: text('creator_id').notNull().references(() => accounts.userId),
  operationId: text('operation_id').notNull(), tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(), expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'), consumedAt: integer('consumed_at'),
  consumedBy: text('consumed_by').references(() => accounts.userId),
}, table => [
  uniqueIndex('social_invites_operation').on(table.creatorId, table.operationId),
  index('social_invites_creator').on(table.creatorId, table.expiresAt),
]);
