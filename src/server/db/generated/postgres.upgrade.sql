ALTER TABLE "model_availability" ADD COLUMN "is_manual" BOOLEAN DEFAULT false;
ALTER TABLE "proxy_logs" ADD COLUMN "downstream_api_key_id" INTEGER;
CREATE INDEX "proxy_logs_downstream_api_key_created_at_idx" ON "proxy_logs" ("downstream_api_key_id", "created_at");
