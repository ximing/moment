ALTER TABLE `chains` MODIFY COLUMN `icon` varchar(64);--> statement-breakpoint
ALTER TABLE `chains` ADD `avatar_media_id` char(36);--> statement-breakpoint
ALTER TABLE `chains` ADD `avatar_focus_x` int DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE `chains` ADD `avatar_focus_y` int DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE `chains` ADD `cover_focus_x` int DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE `chains` ADD `cover_focus_y` int DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE `media` ADD `orphaned_at` timestamp;--> statement-breakpoint
ALTER TABLE `chains` ADD CONSTRAINT `chk_chains_avatar_focus_x` CHECK (`chains`.`avatar_focus_x` between 0 and 10000);--> statement-breakpoint
ALTER TABLE `chains` ADD CONSTRAINT `chk_chains_avatar_focus_y` CHECK (`chains`.`avatar_focus_y` between 0 and 10000);--> statement-breakpoint
ALTER TABLE `chains` ADD CONSTRAINT `chk_chains_cover_focus_x` CHECK (`chains`.`cover_focus_x` between 0 and 10000);--> statement-breakpoint
ALTER TABLE `chains` ADD CONSTRAINT `chk_chains_cover_focus_y` CHECK (`chains`.`cover_focus_y` between 0 and 10000);--> statement-breakpoint
ALTER TABLE `chains` ADD CONSTRAINT `chains_avatar_media_id_media_id_fk` FOREIGN KEY (`avatar_media_id`) REFERENCES `media`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
UPDATE `chains` SET `color` = NULL WHERE `icon` IS NOT NULL;
--> statement-breakpoint
UPDATE `media` SET `orphaned_at` = `created_at`
WHERE `status` = 'orphaned' AND `orphaned_at` IS NULL;
