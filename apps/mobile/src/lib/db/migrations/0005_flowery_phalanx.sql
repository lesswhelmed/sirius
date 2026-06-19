CREATE TABLE `chat_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`mode` text DEFAULT 'ask' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_conversations_updated_at_idx` ON `chat_conversations` (`updated_at`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`sources_json` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_messages_conversation_id_idx` ON `chat_messages` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `chat_messages_created_at_idx` ON `chat_messages` (`created_at`);