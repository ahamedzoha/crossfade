CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_user_idx` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`credentials_enc` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`status_message` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connections_user_provider_ext_idx` ON `connections` (`user_id`,`provider`,`external_user_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`dedupe_key` text,
	`run_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`locked_until` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_status_run_idx` ON `jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_active_dedupe_idx` ON `jobs` (`dedupe_key`) WHERE "jobs"."status" in ('queued', 'running') and "jobs"."dedupe_key" is not null;--> statement-breakpoint
CREATE TABLE `match_misses` (
	`track_id` text NOT NULL,
	`provider` text NOT NULL,
	`candidates` text NOT NULL,
	`checked_at` integer NOT NULL,
	PRIMARY KEY(`track_id`, `provider`),
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`verifier` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `playlist_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`playlist_id` text NOT NULL,
	`track_id` text NOT NULL,
	`position` real NOT NULL,
	`added_at` integer NOT NULL,
	`added_from` text NOT NULL,
	`removed_at` integer,
	`removed_reason` text,
	`duplicate_of_entry_id` text,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entries_playlist_idx` ON `playlist_entries` (`playlist_id`,`removed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `entries_playlist_track_idx` ON `playlist_entries` (`playlist_id`,`track_id`);--> statement-breakpoint
CREATE TABLE `playlist_links` (
	`id` text PRIMARY KEY NOT NULL,
	`playlist_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_playlist_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text,
	`direction` text DEFAULT 'both' NOT NULL,
	`snapshot` text,
	`track_count` integer,
	`last_synced_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `links_playlist_idx` ON `playlist_links` (`playlist_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `links_connection_remote_idx` ON `playlist_links` (`connection_id`,`provider_playlist_id`);--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`kind` text DEFAULT 'playlist' NOT NULL,
	`sync_enabled` integer DEFAULT true NOT NULL,
	`schedule_minutes` integer,
	`dedupe_mode` text,
	`guard_percent` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_run_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `playlists_user_idx` ON `playlists` (`user_id`);--> statement-breakpoint
CREATE TABLE `provider_configs` (
	`provider` text PRIMARY KEY NOT NULL,
	`config_enc` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_tracks` (
	`provider` text NOT NULL,
	`provider_track_id` text NOT NULL,
	`track_id` text NOT NULL,
	`title` text NOT NULL,
	`artists` text NOT NULL,
	`album` text,
	`duration_ms` integer,
	`isrc` text,
	`url` text,
	`method` text NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`provider`, `provider_track_id`),
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `provider_tracks_track_idx` ON `provider_tracks` (`track_id`,`provider`);--> statement-breakpoint
CREATE TABLE `review_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`playlist_id` text NOT NULL,
	`track_id` text NOT NULL,
	`provider` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`candidates` text NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_user_status_idx` ON `review_items` (`user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_unique_idx` ON `review_items` (`playlist_id`,`track_id`,`provider`,`reason`);--> statement-breakpoint
CREATE TABLE `run_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`action` text NOT NULL,
	`provider` text,
	`track_id` text,
	`detail` text,
	`position` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `changes_run_idx` ON `run_changes` (`run_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`playlist_id` text,
	`playlist_name` text,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`dry_run` integer DEFAULT false NOT NULL,
	`override_guard` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`stats` text,
	`log` text,
	`error` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `runs_user_created_idx` ON `sync_runs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `runs_playlist_created_idx` ON `sync_runs` (`playlist_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`artists` text NOT NULL,
	`album` text,
	`duration_ms` integer,
	`isrc` text,
	`title_key` text NOT NULL,
	`artist_key` text NOT NULL,
	`version_tag` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tracks_isrc_idx` ON `tracks` (`isrc`);--> statement-breakpoint
CREATE INDEX `tracks_key_idx` ON `tracks` (`title_key`,`artist_key`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`secret_enc` text NOT NULL,
	`events` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`last_status` integer,
	`last_error` text,
	`last_delivery_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhooks_user_idx` ON `webhooks` (`user_id`);