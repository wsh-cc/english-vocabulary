CREATE TABLE `friend_links` (
	`pair_key` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`accepted_at` integer,
	FOREIGN KEY (`requester_id`) REFERENCES `app_accounts`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `app_accounts`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "friend_links_status" CHECK("friend_links"."status" IN ('pending', 'accepted', 'declined', 'cancelled', 'removed')),
	CONSTRAINT "friend_links_distinct" CHECK("friend_links"."requester_id" <> "friend_links"."recipient_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friend_links_request_id_unique` ON `friend_links` (`request_id`);--> statement-breakpoint
CREATE INDEX `friend_links_requester` ON `friend_links` (`requester_id`,`status`);--> statement-breakpoint
CREATE INDEX `friend_links_recipient` ON `friend_links` (`recipient_id`,`status`);--> statement-breakpoint
CREATE TABLE `friend_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`nickname` text DEFAULT '' NOT NULL,
	`signature` text DEFAULT '' NOT NULL,
	`avatar` text DEFAULT 'initial' NOT NULL,
	`avatar_data_url` text,
	`share_learning` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_accounts`(`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "friend_profiles_sharing" CHECK("friend_profiles"."share_learning" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `friend_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `social_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`consumed_at` integer,
	`consumed_by` text,
	FOREIGN KEY (`creator_id`) REFERENCES `app_accounts`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`consumed_by`) REFERENCES `app_accounts`(`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_invites_token_hash_unique` ON `social_invites` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `social_invites_operation` ON `social_invites` (`creator_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `social_invites_creator` ON `social_invites` (`creator_id`,`expires_at`);