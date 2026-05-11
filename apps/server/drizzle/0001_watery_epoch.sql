CREATE TABLE `chains` (
	`id` char(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	`cover_media_id` char(36),
	`visibility` enum('private','link','public') NOT NULL DEFAULT 'private',
	`owner_id` char(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chains_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chain_members` (
	`chain_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`role` enum('owner','editor','viewer') NOT NULL,
	`joined_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chain_members_chain_id_user_id_pk` PRIMARY KEY(`chain_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `chain_invites` (
	`id` char(36) NOT NULL,
	`chain_id` char(36) NOT NULL,
	`token` char(64) NOT NULL,
	`email` varchar(255),
	`role` enum('editor','viewer') NOT NULL DEFAULT 'editor',
	`created_by` char(36) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`accepted_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chain_invites_id` PRIMARY KEY(`id`),
	CONSTRAINT `chain_invites_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
ALTER TABLE `chains` ADD CONSTRAINT `chains_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chain_members` ADD CONSTRAINT `chain_members_chain_id_chains_id_fk` FOREIGN KEY (`chain_id`) REFERENCES `chains`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chain_members` ADD CONSTRAINT `chain_members_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chain_invites` ADD CONSTRAINT `chain_invites_chain_id_chains_id_fk` FOREIGN KEY (`chain_id`) REFERENCES `chains`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chain_invites` ADD CONSTRAINT `chain_invites_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_chain_members_user` ON `chain_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_chain_invites_chain` ON `chain_invites` (`chain_id`);