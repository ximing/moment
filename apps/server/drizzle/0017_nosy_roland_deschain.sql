ALTER TABLE `moments` ADD `embed_hash` char(64);--> statement-breakpoint
ALTER TABLE `media` ADD `derived_s3_key` varchar(512);--> statement-breakpoint
ALTER TABLE `media` ADD `derived_mime` varchar(100);--> statement-breakpoint
ALTER TABLE `media` ADD `derived_size` bigint;--> statement-breakpoint
ALTER TABLE `media` ADD `derived_width` int;--> statement-breakpoint
ALTER TABLE `media` ADD `derived_height` int;--> statement-breakpoint
ALTER TABLE `media` ADD `derived_status` enum('pending','ready','skipped','failed');--> statement-breakpoint
ALTER TABLE `outbox` ADD `last_error` varchar(512);