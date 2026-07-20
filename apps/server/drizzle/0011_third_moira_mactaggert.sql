CREATE TABLE `recaps` (
	`id` char(36) NOT NULL,
	`chain_id` char(36) NOT NULL,
	`period` char(7) NOT NULL,
	`status` enum('generating','ready','failed','degraded') NOT NULL DEFAULT 'generating',
	`content` text NOT NULL,
	`highlights` json NOT NULL DEFAULT ('[]'),
	`model` varchar(255),
	`prompt_version` int NOT NULL DEFAULT 1,
	`token_usage` json,
	`error` text,
	`generated_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recaps_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_recaps_chain_period` UNIQUE(`chain_id`,`period`)
);
--> statement-breakpoint
ALTER TABLE `recaps` ADD CONSTRAINT `recaps_chain_id_chains_id_fk` FOREIGN KEY (`chain_id`) REFERENCES `chains`(`id`) ON DELETE cascade ON UPDATE no action;