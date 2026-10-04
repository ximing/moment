CREATE TABLE `access_tokens` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`name` varchar(64) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`token_preview` varchar(32) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `access_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `access_tokens_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `access_tokens` ADD CONSTRAINT `access_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_access_tokens_user` ON `access_tokens` (`user_id`);