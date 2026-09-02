CREATE TABLE `canvases` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`live_revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `canvas_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`canvas_id` text NOT NULL,
	`type` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`w` integer NOT NULL,
	`h` integer NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`params_json` text DEFAULT '{}' NOT NULL,
	`params_hash` text,
	`run_state` text DEFAULT 'idle' NOT NULL,
	`output_json` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `canvas_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`canvas_id` text NOT NULL,
	`source_id` text NOT NULL,
	`source_handle` text,
	`target_id` text NOT NULL,
	`target_handle` text,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `canvas_nodes_canvas_idx` ON `canvas_nodes` (`canvas_id`);
--> statement-breakpoint
CREATE INDEX `canvas_edges_canvas_idx` ON `canvas_edges` (`canvas_id`);
