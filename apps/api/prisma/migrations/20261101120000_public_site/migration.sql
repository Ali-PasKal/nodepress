-- Milestone 4: public site. Route prefixes and visibility for content types and taxonomies, entry SEO fields,
-- site settings and theme settings, menus, redirects and preview links; appearance and SEO capabilities.

-- AlterTable
ALTER TABLE "content_types" ADD COLUMN     "is_public" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "route_prefix" VARCHAR(64);
-- Existing types: posts under /blog, pages at the root, custom types under their key.
UPDATE "content_types" SET "route_prefix" = CASE
  WHEN "key" = 'post' THEN 'blog'
  WHEN "key" = 'page' THEN ''
  WHEN "key" = 'blog' THEN 'blog-entries'
  ELSE replace("key", '_', '-') END;
ALTER TABLE "content_types" ALTER COLUMN "route_prefix" SET NOT NULL;

-- AlterTable
ALTER TABLE "entries" ADD COLUMN     "seo" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "active_theme" VARCHAR(64) NOT NULL DEFAULT 'starter',
ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "theme_settings" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "taxonomies" ADD COLUMN     "is_public" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "route_prefix" VARCHAR(64);
UPDATE "taxonomies" SET "route_prefix" = replace("key", '_', '-');
ALTER TABLE "taxonomies" ALTER COLUMN "route_prefix" SET NOT NULL;

-- CreateTable
CREATE TABLE "menus" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "location" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL,
    "menu_id" UUID NOT NULL,
    "parent_id" UUID,
    "position" INTEGER NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "entry_id" UUID,
    "term_id" UUID,
    "url" VARCHAR(2048),
    "open_in_new_tab" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redirects" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "from_path" VARCHAR(2000) NOT NULL,
    "to_path" VARCHAR(2048) NOT NULL,
    "status_code" SMALLINT NOT NULL DEFAULT 301,
    "source" VARCHAR(16) NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "redirects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preview_tokens" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preview_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "menus_site_id_location_key" ON "menus"("site_id", "location");

-- CreateIndex
CREATE INDEX "menu_items_menu_id_parent_id_position_idx" ON "menu_items"("menu_id", "parent_id", "position");

-- CreateIndex
CREATE INDEX "menu_items_entry_id_idx" ON "menu_items"("entry_id");

-- CreateIndex
CREATE INDEX "menu_items_term_id_idx" ON "menu_items"("term_id");

-- CreateIndex
CREATE INDEX "redirects_site_id_to_path_idx" ON "redirects"("site_id", "to_path");

-- CreateIndex
CREATE UNIQUE INDEX "redirects_site_id_from_path_key" ON "redirects"("site_id", "from_path");

-- CreateIndex
CREATE UNIQUE INDEX "preview_tokens_token_hash_key" ON "preview_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "preview_tokens_expires_at_idx" ON "preview_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "content_types_route_prefix_key" ON "content_types"("route_prefix");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomies_route_prefix_key" ON "taxonomies"("route_prefix");

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "menus_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redirects" ADD CONSTRAINT "redirects_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preview_tokens" ADD CONSTRAINT "preview_tokens_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preview_tokens" ADD CONSTRAINT "preview_tokens_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================================
-- Constraints Prisma cannot express
-- =============================================================================================
ALTER TABLE "content_types"
  ADD CONSTRAINT "content_types_route_prefix_format" CHECK ("route_prefix" ~ '^([a-z0-9]+(-[a-z0-9]+)*)?$'),
  ADD CONSTRAINT "content_types_root_only_pages" CHECK ("route_prefix" <> '' OR "key" = 'page');

ALTER TABLE "taxonomies"
  ADD CONSTRAINT "taxonomies_route_prefix_format" CHECK ("route_prefix" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "entries"
  ADD CONSTRAINT "entries_seo_object" CHECK (jsonb_typeof("seo") = 'object');

ALTER TABLE "sites"
  ADD CONSTRAINT "sites_settings_object" CHECK (jsonb_typeof("settings") = 'object'),
  ADD CONSTRAINT "sites_theme_settings_object" CHECK (jsonb_typeof("theme_settings") = 'object'),
  ADD CONSTRAINT "sites_active_theme_format" CHECK ("active_theme" ~ '^[a-z][a-z0-9-]{1,63}$');

ALTER TABLE "menu_items"
  ADD CONSTRAINT "menu_items_kind" CHECK ("kind" IN ('entry', 'term', 'home', 'url')),
  ADD CONSTRAINT "menu_items_target" CHECK (
    ("kind" = 'entry' AND "entry_id" IS NOT NULL AND "term_id" IS NULL AND "url" IS NULL) OR
    ("kind" = 'term' AND "term_id" IS NOT NULL AND "entry_id" IS NULL AND "url" IS NULL) OR
    ("kind" = 'home' AND "entry_id" IS NULL AND "term_id" IS NULL AND "url" IS NULL) OR
    ("kind" = 'url' AND "url" IS NOT NULL AND "entry_id" IS NULL AND "term_id" IS NULL)),
  ADD CONSTRAINT "menu_items_not_own_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
  ADD CONSTRAINT "menu_items_position" CHECK ("position" >= 0);

ALTER TABLE "redirects"
  ADD CONSTRAINT "redirects_status_code" CHECK ("status_code" IN (301, 302, 307, 308)),
  ADD CONSTRAINT "redirects_from_path" CHECK ("from_path" ~ '^/' AND "from_path" !~ '//' AND "from_path" <> '/'),
  ADD CONSTRAINT "redirects_source" CHECK ("source" IN ('auto', 'manual')),
  ADD CONSTRAINT "redirects_not_self" CHECK ("from_path" <> "to_path");

ALTER TABLE "preview_tokens"
  ADD CONSTRAINT "preview_tokens_hash_sha256" CHECK (octet_length("token_hash") = 32);

-- =============================================================================================
-- Seed: capabilities (keep in sync with packages/shared capabilities.ts) and role mapping
-- =============================================================================================
INSERT INTO "capabilities" ("key", "category", "description") VALUES
  ('appearance.manage', 'appearance', 'Choose and configure the theme, site identity, reading settings and menus'),
  ('seo.manage',        'appearance', 'Manage SEO settings and redirects');

INSERT INTO "role_capabilities" ("role_id", "capability_key")
  SELECT r."id", c."key" FROM "roles" r CROSS JOIN "capabilities" c
  WHERE r."key" = 'administrator' AND c."key" IN ('appearance.manage', 'seo.manage');

INSERT INTO "role_capabilities" ("role_id", "capability_key")
  SELECT r."id", 'seo.manage' FROM "roles" r WHERE r."key" = 'editor';
