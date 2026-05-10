CREATE TABLE `users` (
	`id` char(36) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(100) NOT NULL,
	`nickname` varchar(50) NOT NULL,
	`password_changed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`user_id` char(36) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`device_info` varchar(255),
	`expires_at` timestamp NOT NULL,
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `refresh_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `refresh_tokens_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_refresh_tokens_user` ON `refresh_tokens` (`user_id`);