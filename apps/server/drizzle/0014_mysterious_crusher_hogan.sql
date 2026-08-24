ALTER TABLE `chain_members` ADD `sort_order` int DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE chain_members cm
JOIN (
  SELECT cm2.user_id, cm2.chain_id,
         ROW_NUMBER() OVER (PARTITION BY cm2.user_id ORDER BY c.created_at DESC, c.id) AS rn
  FROM chain_members cm2 JOIN chains c ON c.id = cm2.chain_id
) ranked ON ranked.user_id = cm.user_id AND ranked.chain_id = cm.chain_id
SET cm.sort_order = ranked.rn;
