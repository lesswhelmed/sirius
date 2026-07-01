ALTER TABLE `pending_submissions` ADD COLUMN `progress_pct` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pending_submissions` ADD COLUMN `progress_bytes` integer;--> statement-breakpoint
ALTER TABLE `pending_submissions` ADD COLUMN `progress_total` integer;--> statement-breakpoint
ALTER TABLE `pending_submissions` ADD COLUMN `phase` text;
