ALTER TABLE `proxy_logs` ADD `client_kind` text;
--> statement-breakpoint
ALTER TABLE `proxy_logs` ADD `client_session_id` text;
--> statement-breakpoint
ALTER TABLE `proxy_logs` ADD `client_trace_hint` text;
--> statement-breakpoint
ALTER TABLE `proxy_logs` ADD `downstream_path` text;
--> statement-breakpoint
ALTER TABLE `proxy_logs` ADD `upstream_path` text;
--> statement-breakpoint
CREATE INDEX `proxy_logs_client_kind_created_at_idx` ON `proxy_logs` (`client_kind`, `created_at`);
--> statement-breakpoint
CREATE INDEX `proxy_logs_downstream_path_created_at_idx` ON `proxy_logs` (`downstream_path`, `created_at`);
