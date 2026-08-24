ALTER TABLE `moments` MODIFY COLUMN `type` enum('text','media','video','voice') NOT NULL;--> statement-breakpoint
ALTER TABLE `moments` ADD `transcript` text;--> statement-breakpoint
ALTER TABLE `moments` ADD `transcription_status` enum('pending','done','failed');