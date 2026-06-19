CREATE TABLE `comments` (
	`local_id` text PRIMARY KEY NOT NULL,
	`server_id` text,
	`post_slug` text NOT NULL,
	`sync_state` text DEFAULT 'local_draft' NOT NULL,
	`author_kind` text DEFAULT 'USER' NOT NULL,
	`author_label` text,
	`author_image` text,
	`author_id` text,
	`body` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`server_updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `comments_post_slug_idx` ON `comments` (`post_slug`);--> statement-breakpoint
CREATE INDEX `comments_server_id_idx` ON `comments` (`server_id`);--> statement-breakpoint
CREATE INDEX `comments_sync_state_idx` ON `comments` (`sync_state`);--> statement-breakpoint
CREATE INDEX `comments_created_at_idx` ON `comments` (`created_at`);--> statement-breakpoint
CREATE TABLE `pending_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`local_id` text NOT NULL,
	`post_slug` text NOT NULL,
	`request_json` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`last_error` text,
	`next_attempt_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pending_comments_local_id_idx` ON `pending_comments` (`local_id`);--> statement-breakpoint
CREATE INDEX `pending_comments_status_idx` ON `pending_comments` (`status`);--> statement-breakpoint
CREATE INDEX `pending_comments_post_slug_idx` ON `pending_comments` (`post_slug`);