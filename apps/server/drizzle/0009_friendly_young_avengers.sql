CREATE TABLE `templates` (
	`id` char(36) NOT NULL,
	`key` varchar(64) NOT NULL,
	`scope` enum('official','user') NOT NULL,
	`owner_id` char(36),
	`name` varchar(50) NOT NULL,
	`description` varchar(500),
	`icon` varchar(8) NOT NULL,
	`manifest` json NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`status` enum('active','archived') NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `templates_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
ALTER TABLE `templates` ADD CONSTRAINT `templates_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;