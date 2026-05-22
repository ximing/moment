CREATE TABLE `comments` (
	`id` char(36) NOT NULL,
	`moment_id` char(36) NOT NULL,
	`author_id` char(36) NOT NULL,
	`content` text NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`deleted_at` timestamp,
	CONSTRAINT `comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reactions` (
	`id` char(36) NOT NULL,
	`moment_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`emoji` varchar(16) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_reactions_moment_user` UNIQUE(`moment_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`type` varchar(32) NOT NULL,
	`payload` json NOT NULL,
	`read_at` timestamp,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `push_tokens` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`expo_token` varchar(128) NOT NULL,
	`platform` enum('ios','android','web') NOT NULL,
	`last_seen_at` timestamp NOT NULL DEFAULT (now()),
	`invalidated_at` timestamp,
	CONSTRAINT `push_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_push_tokens_expo_token` UNIQUE(`expo_token`)
);
--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_moment_id_moments_id_fk` FOREIGN KEY (`moment_id`) REFERENCES `moments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comments` ADD CONSTRAINT `comments_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reactions` ADD CONSTRAINT `reactions_moment_id_moments_id_fk` FOREIGN KEY (`moment_id`) REFERENCES `moments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reactions` ADD CONSTRAINT `reactions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `push_tokens` ADD CONSTRAINT `push_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_comments_moment_created` ON `comments` (`moment_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_reactions_moment` ON `reactions` (`moment_id`);--> statement-breakpoint
CREATE INDEX `idx_notifications_user_read` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `idx_push_tokens_user` ON `push_tokens` (`user_id`);