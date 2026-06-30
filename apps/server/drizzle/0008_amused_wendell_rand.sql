-- 那年今日（spec memories-today §1）：三步走无条件执行——先允许 NULL 避免 strict mode 对存量表加 NOT NULL 报错，
-- 单语句回填存量（数据修正，share_links 迁移先例同性质），再收紧 NOT NULL。
-- 回滚 = ALTER TABLE `moments` DROP COLUMN `wall_date`;（纯投影，无损）
ALTER TABLE `moments` ADD `wall_date` date NULL;--> statement-breakpoint
UPDATE `moments` SET `wall_date` = DATE(`happened_at` - INTERVAL `happened_tz_offset` MINUTE);--> statement-breakpoint
ALTER TABLE `moments` MODIFY `wall_date` date NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_moments_wall_date` ON `moments` (`wall_date`);
