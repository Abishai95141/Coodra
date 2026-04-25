PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`phase` text NOT NULL,
	`tool_name` text NOT NULL,
	`tool_use_id` text NOT NULL,
	`tool_input` text NOT NULL,
	`outcome` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_run_events`("id", "run_id", "phase", "tool_name", "tool_use_id", "tool_input", "outcome", "created_at") SELECT "id", "run_id", "phase", "tool_name", "tool_use_id", "tool_input", "outcome", "created_at" FROM `run_events`;--> statement-breakpoint
DROP TABLE `run_events`;--> statement-breakpoint
ALTER TABLE `__new_run_events` RENAME TO `run_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `run_events_run_created_idx` ON `run_events` (`run_id`,`created_at`);