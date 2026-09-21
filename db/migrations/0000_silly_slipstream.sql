CREATE TABLE `chat_logs` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`code_id` bigint unsigned NOT NULL,
	`ip` varchar(64) NOT NULL DEFAULT '',
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`sources` text,
	`duration_ms` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invite_codes` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`code` varchar(64) NOT NULL,
	`label` varchar(128) NOT NULL DEFAULT '',
	`daily_limit` int NOT NULL DEFAULT 20,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invite_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `invite_codes_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE INDEX `chat_logs_code_created` ON `chat_logs` (`code_id`,`created_at`);