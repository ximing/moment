CREATE TABLE `moment_tags` (
	`moment_id` char(36) NOT NULL,
	`tag_id` char(36) NOT NULL,
	CONSTRAINT `moment_tags_moment_id_tag_id_pk` PRIMARY KEY(`moment_id`,`tag_id`)
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` char(36) NOT NULL,
	`chain_id` char(36) NOT NULL,
	`name` varchar(50) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_tags_chain_name` UNIQUE(`chain_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `moment_tags` ADD CONSTRAINT `moment_tags_moment_id_moments_id_fk` FOREIGN KEY (`moment_id`) REFERENCES `moments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `moment_tags` ADD CONSTRAINT `moment_tags_tag_id_tags_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tags` ADD CONSTRAINT `tags_chain_id_chains_id_fk` FOREIGN KEY (`chain_id`) REFERENCES `chains`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_moment_tags_tag_moment` ON `moment_tags` (`tag_id`,`moment_id`);