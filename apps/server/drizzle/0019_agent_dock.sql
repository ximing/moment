CREATE TABLE `agent_messages` (
	`id` char(36) NOT NULL,
	`thread_id` char(36) NOT NULL,
	`role` enum('user','assistant') NOT NULL,
	`content` text NOT NULL,
	`moment_ids` json,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agent_threads` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`title` varchar(80) NOT NULL,
	`generating_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_threads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `agent_messages` ADD CONSTRAINT `agent_messages_thread_id_agent_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `agent_threads`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `agent_threads` ADD CONSTRAINT `agent_threads_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_agent_messages_thread_created` ON `agent_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_threads_user_updated` ON `agent_threads` (`user_id`,`updated_at`);