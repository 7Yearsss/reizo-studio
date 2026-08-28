CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`workspace_path` text,
	`project_id` text,
	`active_turn_started_at` integer,
	`last_turn_ended_at` integer,
	`live_revision` integer DEFAULT 0 NOT NULL,
	`list_preview` text,
	`list_preview_role` text,
	`list_message_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`rowid` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`client_id` text,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_use_id` text,
	`agent_kind` text,
	`turn_id` text,
	`generation` integer,
	`rewind_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_id_unique` ON `messages` (`id`);
--> statement-breakpoint
CREATE INDEX `messages_session_idx` ON `messages` (`session_id`,`rowid`);
--> statement-breakpoint
CREATE INDEX `messages_session_active_idx` ON `messages` (`session_id`,`rowid`) WHERE `rewind_at` is null;
