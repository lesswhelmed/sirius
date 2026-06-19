CREATE TABLE `post_vectors` (
	`server_id` text NOT NULL,
	`embedding_model_id` text NOT NULL,
	`dim` integer NOT NULL,
	`vector` blob NOT NULL,
	`content_hash` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`server_id`, `embedding_model_id`)
);
--> statement-breakpoint
CREATE INDEX `post_vectors_model_idx` ON `post_vectors` (`embedding_model_id`);