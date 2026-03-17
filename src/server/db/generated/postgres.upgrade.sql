ALTER TABLE "proxy_logs" ADD COLUMN "client_kind" TEXT;
ALTER TABLE "proxy_logs" ADD COLUMN "client_session_id" TEXT;
ALTER TABLE "proxy_logs" ADD COLUMN "client_trace_hint" TEXT;
ALTER TABLE "proxy_logs" ADD COLUMN "downstream_path" TEXT;
ALTER TABLE "proxy_logs" ADD COLUMN "upstream_path" TEXT;
CREATE INDEX "proxy_logs_client_kind_created_at_idx" ON "proxy_logs" ("client_kind", "created_at");
CREATE INDEX "proxy_logs_downstream_path_created_at_idx" ON "proxy_logs" ("downstream_path", "created_at");
