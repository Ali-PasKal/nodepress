-- Milestone 6: plugins (packages stored in the database, run only in the sandbox process), their private
-- storage and logs, and the capability to manage them.

-- CreateTable
CREATE TABLE "plugins" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "version" VARCHAR(40) NOT NULL,
    "manifest" JSONB NOT NULL,
    "code" TEXT NOT NULL,
    "readme" TEXT NOT NULL DEFAULT '',
    "source" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'inactive',
    "granted_permissions" VARCHAR(32)[] DEFAULT ARRAY[]::VARCHAR(32)[],
    "granted_hosts" VARCHAR(253)[] DEFAULT ARRAY[]::VARCHAR(253)[],
    "hooks" VARCHAR(32)[] DEFAULT ARRAY[]::VARCHAR(32)[],
    "settings" JSONB NOT NULL DEFAULT '{}',
    "error" VARCHAR(1000),
    "installed_by_id" UUID,
    "installed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "activated_at" TIMESTAMPTZ(3),

    CONSTRAINT "plugins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugin_storage" (
    "plugin_id" UUID NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "value" JSONB NOT NULL,
    "size" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plugin_storage_pkey" PRIMARY KEY ("plugin_id","key")
);

-- CreateTable
CREATE TABLE "plugin_logs" (
    "id" UUID NOT NULL,
    "plugin_id" UUID NOT NULL,
    "level" VARCHAR(8) NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plugin_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plugins_site_id_status_idx" ON "plugins"("site_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "plugins_site_id_key_key" ON "plugins"("site_id", "key");

-- CreateIndex
CREATE INDEX "plugin_logs_plugin_id_created_at_idx" ON "plugin_logs"("plugin_id", "created_at");

-- AddForeignKey
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_installed_by_id_fkey" FOREIGN KEY ("installed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_storage" ADD CONSTRAINT "plugin_storage_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_logs" ADD CONSTRAINT "plugin_logs_plugin_id_fkey" FOREIGN KEY ("plugin_id") REFERENCES "plugins"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================================================
-- Constraints Prisma cannot express
-- =============================================================================================
ALTER TABLE "plugins"
  ADD CONSTRAINT "plugins_key_format" CHECK ("key" ~ '^[a-z][a-z0-9-]{0,30}(\.[a-z][a-z0-9-]{0,30}){1,3}$'),
  ADD CONSTRAINT "plugins_status" CHECK ("status" IN ('inactive', 'active', 'failed')),
  ADD CONSTRAINT "plugins_source" CHECK ("source" IN ('upload', 'bundled')),
  ADD CONSTRAINT "plugins_manifest_object" CHECK (jsonb_typeof("manifest") = 'object'),
  ADD CONSTRAINT "plugins_settings_object" CHECK (jsonb_typeof("settings") = 'object'),
  ADD CONSTRAINT "plugins_arrays_present" CHECK (
    "granted_permissions" IS NOT NULL AND "granted_hosts" IS NOT NULL AND "hooks" IS NOT NULL
  ),
  ADD CONSTRAINT "plugins_code_size" CHECK (octet_length("code") <= 524288);

ALTER TABLE "plugin_storage"
  ADD CONSTRAINT "plugin_storage_size" CHECK ("size" >= 0 AND "size" <= 16384);

ALTER TABLE "plugin_logs"
  ADD CONSTRAINT "plugin_logs_level" CHECK ("level" IN ('info', 'warn', 'error'));

-- =============================================================================================
-- Seed: capability (keep in sync with packages/shared capabilities.ts) and role mapping
-- =============================================================================================
INSERT INTO "capabilities" ("key", "category", "description") VALUES
  ('plugins.manage', 'system', 'Install, activate, configure, update and remove plugins (they run sandboxed)');

INSERT INTO "role_capabilities" ("role_id", "capability_key")
  SELECT r."id", 'plugins.manage' FROM "roles" r WHERE r."key" = 'administrator';
