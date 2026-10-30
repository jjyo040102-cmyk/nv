CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`format` text NOT NULL,
	`storage_key` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `artifacts_owner_task` ON `artifacts` (`owner_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `task_events` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_owner_task` ON `task_events` (`owner_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`goal` text NOT NULL,
	`source_name` text NOT NULL,
	`source_text` text NOT NULL,
	`participants_json` text NOT NULL,
	`recipient` text NOT NULL,
	`response_text` text NOT NULL,
	`expense_krw` integer DEFAULT 0 NOT NULL,
	`is_sample` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `tasks_owner_updated` ON `tasks` (`owner_id`,`updated_at`);