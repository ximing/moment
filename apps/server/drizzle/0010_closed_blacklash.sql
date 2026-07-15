-- 链模板系统 P3（spec §2.2–2.3）：chains.template/payload + moments.kind/payload 加列。
-- chains.template 无默认值，沿用 wall_date（0008）三阶段先例：ADD NULL → 回填 'daily' → MODIFY NOT NULL。
-- moments.kind 有默认值 'standard'，可单步到位。
ALTER TABLE `chains` ADD `template` varchar(64) NULL;--> statement-breakpoint
ALTER TABLE `chains` ADD `payload` json;--> statement-breakpoint
UPDATE `chains` SET `template` = 'daily';--> statement-breakpoint
ALTER TABLE `chains` MODIFY `template` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `moments` ADD `kind` varchar(64) NOT NULL DEFAULT 'standard';--> statement-breakpoint
ALTER TABLE `moments` ADD `payload` json;
