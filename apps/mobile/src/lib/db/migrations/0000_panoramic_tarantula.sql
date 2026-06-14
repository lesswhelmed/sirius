CREATE TABLE `pending_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`local_id` text NOT NULL,
	`transport` text NOT NULL,
	`request_json` text NOT NULL,
	`batch_id` text,
	`image_index` integer,
	`total_count` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`last_error` text,
	`next_attempt_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pending_local_id_idx` ON `pending_submissions` (`local_id`);--> statement-breakpoint
CREATE INDEX `pending_status_idx` ON `pending_submissions` (`status`);--> statement-breakpoint
CREATE INDEX `pending_batch_id_idx` ON `pending_submissions` (`batch_id`);--> statement-breakpoint
CREATE TABLE `posts` (
	`local_id` text PRIMARY KEY NOT NULL,
	`server_id` text,
	`slug` text,
	`submission_id` text,
	`sync_state` text DEFAULT 'local_draft' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`excerpt` text,
	`type` text DEFAULT 'BLOG' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`categories` text DEFAULT '[]' NOT NULL,
	`image_url` text,
	`images` text,
	`draft_envelope_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`server_updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `posts_submission_id_idx` ON `posts` (`submission_id`);--> statement-breakpoint
CREATE INDEX `posts_server_id_idx` ON `posts` (`server_id`);--> statement-breakpoint
CREATE INDEX `posts_slug_idx` ON `posts` (`slug`);--> statement-breakpoint
CREATE INDEX `posts_sync_state_idx` ON `posts` (`sync_state`);--> statement-breakpoint
CREATE INDEX `posts_created_at_idx` ON `posts` (`created_at`);--> statement-breakpoint
CREATE TABLE `sync_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
