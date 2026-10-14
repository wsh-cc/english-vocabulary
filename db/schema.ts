// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, integer, index, primaryKey, check } from 'drizzle-orm/sqlite-core';
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
