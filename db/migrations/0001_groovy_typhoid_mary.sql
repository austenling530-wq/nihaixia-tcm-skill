ALTER TABLE `invite_codes` ADD `expires_at` timestamp;--> statement-breakpoint
ALTER TABLE `invite_codes` ADD `total_limit` int;--> statement-breakpoint
ALTER TABLE `invite_codes` ADD `channel` varchar(64) DEFAULT '' NOT NULL;