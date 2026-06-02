CREATE TABLE `share_links` (
	`id` char(36) NOT NULL,
	`chain_id` char(36) NOT NULL,
	`token` char(64) NOT NULL,
	`created_by` char(36) NOT NULL,
	`expires_at` timestamp(3),
	`revoked_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `share_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `share_links_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
ALTER TABLE `share_links` ADD CONSTRAINT `share_links_chain_id_chains_id_fk` FOREIGN KEY (`chain_id`) REFERENCES `chains`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `share_links` ADD CONSTRAINT `share_links_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_share_links_chain` ON `share_links` (`chain_id`);