CREATE TABLE IF NOT EXISTS mobile_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES app_accounts(user_id),
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mobile_sessions_user ON mobile_sessions(user_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mobile_sync_meta (
  user_id TEXT PRIMARY KEY NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  baseline_payload TEXT NOT NULL,
  baseline_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mobile_recovery (
  user_id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  revision INTEGER NOT NULL,
  generation INTEGER NOT NULL,
  saved_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO mobile_sync_meta(user_id, generation, baseline_payload, baseline_at)
  SELECT user_id, 1, payload, updated_at FROM learner_state;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mobile_operations (
  user_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  device_sequence INTEGER NOT NULL,
  occurred_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  action_payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('accepted', 'conflict')),
  conflict_payload TEXT,
  id_map_payload TEXT NOT NULL DEFAULT '{}',
  commit_id TEXT NOT NULL,
  PRIMARY KEY(user_id, operation_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mobile_operations_replay ON mobile_operations(user_id, generation, occurred_at, device_id, device_sequence);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mobile_operations_device ON mobile_operations(user_id, generation, device_id, device_sequence);
