CREATE TABLE `moments` (
	`id` char(36) NOT NULL,
	`chain_id` char(36) NOT NULL,
	`author_id` char(36) NOT NULL,
	`type` enum('text','media','video') NOT NULL,
	`content` text NOT NULL,
	`happened_at` timestamp(3) NOT NULL,
	`happened_tz_offset` int NOT NULL,
	`is_backfill` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp,
	CONSTRAINT `moments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` char(36) NOT NULL,
	`moment_id` char(36),
	`uploader_id` char(36) NOT NULL,
	`s3_key` varchar(512) NOT NULL,
	`mime` varchar(100) NOT NULL,
	`size` bigint NOT NULL,
	`width` int,
	`height` int,
	`duration` int,
	`poster_media_id` char(36),
	`sort_order` int NOT NULL DEFAULT 0,
	`status` enum('uploading','ready','orphaned') NOT NULL,
	`storage_meta` json NOT NULL,
	`upload_id` varchar(128),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `media_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` char(36) NOT NULL,
	`type` varchar(64) NOT NULL,
	`payload` json NOT NULL,
	`status` enum('pending','done','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`next_retry_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`processed_at` timestamp,
	CONSTRAINT `outbox_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `avatar_media_id` char(36);--> statement-breakpoint
ALTER TABLE `moments` ADD CONSTRAINT `moments_chain_id_chains_id_fk` FOREIGN KEY (`chain_id`) REFERENCES `chains`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `moments` ADD CONSTRAINT `moments_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `media` ADD CONSTRAINT `media_moment_id_moments_id_fk` FOREIGN KEY (`moment_id`) REFERENCES `moments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `media` ADD CONSTRAINT `media_uploader_id_users_id_fk` FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_moments_chain_happened` ON `moments` (`chain_id`,`happened_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_media_moment` ON `media` (`moment_id`);--> statement-breakpoint
CREATE INDEX `idx_media_uploader` ON `media` (`uploader_id`);--> statement-breakpoint
CREATE INDEX `idx_outbox_status_next_retry` ON `outbox` (`status`,`next_retry_at`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_avatar_media_id_media_id_fk` FOREIGN KEY (`avatar_media_id`) REFERENCES `media`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chains` ADD CONSTRAINT `chains_cover_media_id_media_id_fk` FOREIGN KEY (`cover_media_id`) REFERENCES `media`(`id`) ON DELETE set null ON UPDATE no action;