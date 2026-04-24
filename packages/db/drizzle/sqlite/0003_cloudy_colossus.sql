CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`run_id` text,
	`description` text NOT NULL,
	`rationale` text NOT NULL,
	`alternatives` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decisions_idempotency_key_unique` ON `decisions` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `decisions_run_created_idx` ON `decisions` (`run_id`,`created_at`);