CREATE TABLE `reflection_prompts` (
	`server_id` text PRIMARY KEY NOT NULL,
	`post_slug` text NOT NULL,
	`post_id` text,
	`batch_id` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`question` text NOT NULL,
	`rationale` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reflection_prompts_post_slug_idx` ON `reflection_prompts` (`post_slug`);--> statement-breakpoint
CREATE INDEX `reflection_prompts_status_idx` ON `reflection_prompts` (`status`);--> statement-breakpoint
CREATE TABLE `reflection_responses` (
	`server_id` text PRIMARY KEY NOT NULL,
	`prompt_server_id` text NOT NULL,
	`post_slug` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`has_audio` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reflection_responses_prompt_server_id_unique` ON `reflection_responses` (`prompt_server_id`);--> statement-breakpoint
CREATE INDEX `reflection_responses_post_slug_idx` ON `reflection_responses` (`post_slug`);--> statement-breakpoint
ALTER TABLE `posts` ADD `ai_treatment` text;