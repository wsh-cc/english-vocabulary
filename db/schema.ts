// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
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
