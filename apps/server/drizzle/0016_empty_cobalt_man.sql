CREATE TABLE `persons` (
	`id` char(36) NOT NULL,
	`chain_id` char(36) NOT NULL,
	`name` varchar(50) NOT NULL,
	`user_id` char(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `persons_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_persons_chain_name` UNIQUE(`chain_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `moment_persons` (
	`moment_id` char(36) NOT NULL,
	`person_id` char(36) NOT NULL,
	`source` enum('manual','ai') NOT NULL,
	CONSTRAINT `moment_persons_moment_id_person_id_pk` PRIMARY KEY(`moment_id`,`person_id`)
);
--> statement-breakpoint
ALTER TABLE `moments` ADD `place_lat` decimal(10,7);--> statement-breakpoint
ALTER TABLE `moments` ADD `place_lng` decimal(10,7);--> statement-breakpoint
ALTER TABLE `moments` ADD `place_name` varchar(255);--> statement-breakpoint
ALTER TABLE `moments` ADD `place_source` enum('manual','exif','ai');--> statement-breakpoint
ALTER TABLE `moments` ADD `ai_extract_hash` char(64);--> statement-breakpoint
ALTER TABLE `persons` ADD CONSTRAINT `persons_chain_id_chains_id_fk` FOREIGN KEY (`chain_id`) REFERENCES `chains`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `persons` ADD CONSTRAINT `persons_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `moment_persons` ADD CONSTRAINT `moment_persons_moment_id_moments_id_fk` FOREIGN KEY (`moment_id`) REFERENCES `moments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `moment_persons` ADD CONSTRAINT `moment_persons_person_id_persons_id_fk` FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_moment_persons_person_moment` ON `moment_persons` (`person_id`,`moment_id`);