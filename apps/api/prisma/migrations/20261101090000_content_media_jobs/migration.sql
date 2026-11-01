-- Milestone 3: durable job queue, worker heartbeats, content types, taxonomies, terms, entries,
-- revisions and media. Adds content, media and job capabilities, maps them to the built-in roles, and
-- seeds the built-in Post and Page types and the Category and Tag taxonomies.

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('pending', 'running', 'succeeded', 'dead');

-- CreateEnum
CREATE TYPE "entry_status" AS ENUM ('draft', 'pending', 'scheduled', 'published');

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "job_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "run_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "locked_by" VARCHAR(120),
    "last_error" VARCHAR(2000),
    "dedupe_key" VARCHAR(200),
    "release_dedupe_key" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_workers" (
    "id" VARCHAR(120) NOT NULL,
    "hostname" VARCHAR(255) NOT NULL,
    "pid" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_types" (
    "id" UUID NOT NULL,
    "key" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "plural_name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "hierarchical" BOOLEAN NOT NULL DEFAULT false,
    "has_body" BOOLEAN NOT NULL DEFAULT true,
    "has_excerpt" BOOLEAN NOT NULL DEFAULT true,
    "has_featured_image" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "content_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxonomies" (
    "id" UUID NOT NULL,
    "key" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "plural_name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "hierarchical" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "taxonomies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_type_taxonomies" (
    "content_type_id" UUID NOT NULL,
    "taxonomy_id" UUID NOT NULL,

    CONSTRAINT "content_type_taxonomies_pkey" PRIMARY KEY ("content_type_id","taxonomy_id")
);

-- CreateTable
CREATE TABLE "terms" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "taxonomy_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entries" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "content_type_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "last_editor_id" UUID,
    "parent_id" UUID,
    "title" VARCHAR(300) NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "path" VARCHAR(2000) NOT NULL,
    "status" "entry_status" NOT NULL DEFAULT 'draft',
    "excerpt" VARCHAR(1000) NOT NULL DEFAULT '',
    "body" JSONB NOT NULL DEFAULT '{"type":"doc","content":[]}',
    "fields" JSONB NOT NULL DEFAULT '{}',
    "search_text" TEXT NOT NULL DEFAULT '',
    "featured_media_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "trashed_at" TIMESTAMPTZ(3),
    "trashed_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entry_terms" (
    "entry_id" UUID NOT NULL,
    "term_id" UUID NOT NULL,

    CONSTRAINT "entry_terms_pkey" PRIMARY KEY ("entry_id","term_id")
);

-- CreateTable
CREATE TABLE "entry_revisions" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "entry_version" INTEGER NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entry_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "uploader_id" UUID NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "title" VARCHAR(255) NOT NULL,
    "alt_text" VARCHAR(500) NOT NULL DEFAULT '',
    "caption" VARCHAR(1000) NOT NULL DEFAULT '',
    "variants" JSONB NOT NULL DEFAULT '[]',
    "checksum" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_dedupe_key_key" ON "jobs"("dedupe_key");

-- CreateIndex
CREATE INDEX "jobs_status_run_at_idx" ON "jobs"("status", "run_at");

-- CreateIndex
CREATE INDEX "jobs_name_status_idx" ON "jobs"("name", "status");

-- CreateIndex
CREATE INDEX "jobs_finished_at_idx" ON "jobs"("finished_at");

-- CreateIndex
CREATE INDEX "job_workers_last_seen_at_idx" ON "job_workers"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "content_types_key_key" ON "content_types"("key");

-- CreateIndex
CREATE UNIQUE INDEX "taxonomies_key_key" ON "taxonomies"("key");

-- CreateIndex
CREATE INDEX "content_type_taxonomies_taxonomy_id_idx" ON "content_type_taxonomies"("taxonomy_id");

-- CreateIndex
CREATE INDEX "terms_taxonomy_id_parent_id_idx" ON "terms"("taxonomy_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "terms_site_id_taxonomy_id_slug_key" ON "terms"("site_id", "taxonomy_id", "slug");

-- CreateIndex
CREATE INDEX "entries_site_id_content_type_id_trashed_at_updated_at_idx" ON "entries"("site_id", "content_type_id", "trashed_at", "updated_at");

-- CreateIndex
CREATE INDEX "entries_author_id_idx" ON "entries"("author_id");

-- CreateIndex
CREATE INDEX "entries_parent_id_idx" ON "entries"("parent_id");

-- CreateIndex
CREATE INDEX "entries_status_published_at_idx" ON "entries"("status", "published_at");

-- CreateIndex
CREATE INDEX "entries_trashed_at_idx" ON "entries"("trashed_at");

-- CreateIndex
CREATE INDEX "entries_featured_media_id_idx" ON "entries"("featured_media_id");

-- CreateIndex
CREATE UNIQUE INDEX "entries_site_id_content_type_id_path_key" ON "entries"("site_id", "content_type_id", "path");

-- CreateIndex
CREATE INDEX "entry_terms_term_id_idx" ON "entry_terms"("term_id");

-- CreateIndex
CREATE INDEX "entry_revisions_entry_id_created_at_idx" ON "entry_revisions"("entry_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "media_storage_key_key" ON "media"("storage_key");

-- CreateIndex
CREATE INDEX "media_site_id_created_at_idx" ON "media"("site_id", "created_at");

-- CreateIndex
CREATE INDEX "media_uploader_id_idx" ON "media"("uploader_id");

-- CreateIndex
CREATE INDEX "media_mime_type_idx" ON "media"("mime_type");

-- AddForeignKey
ALTER TABLE "content_type_taxonomies" ADD CONSTRAINT "content_type_taxonomies_content_type_id_fkey" FOREIGN KEY ("content_type_id") REFERENCES "content_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_type_taxonomies" ADD CONSTRAINT "content_type_taxonomies_taxonomy_id_fkey" FOREIGN KEY ("taxonomy_id") REFERENCES "taxonomies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terms" ADD CONSTRAINT "terms_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terms" ADD CONSTRAINT "terms_taxonomy_id_fkey" FOREIGN KEY ("taxonomy_id") REFERENCES "taxonomies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terms" ADD CONSTRAINT "terms_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_content_type_id_fkey" FOREIGN KEY ("content_type_id") REFERENCES "content_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_last_editor_id_fkey" FOREIGN KEY ("last_editor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_trashed_by_id_fkey" FOREIGN KEY ("trashed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entries" ADD CONSTRAINT "entries_featured_media_id_fkey" FOREIGN KEY ("featured_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_terms" ADD CONSTRAINT "entry_terms_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_terms" ADD CONSTRAINT "entry_terms_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_revisions" ADD CONSTRAINT "entry_revisions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_revisions" ADD CONSTRAINT "entry_revisions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================================
-- Constraints Prisma cannot express
-- =============================================================================================
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_name_format" CHECK ("name" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  ADD CONSTRAINT "jobs_attempts_range" CHECK ("attempts" >= 0 AND "max_attempts" BETWEEN 1 AND 25);

ALTER TABLE "content_types"
  ADD CONSTRAINT "content_types_key_format" CHECK ("key" ~ '^[a-z][a-z0-9_]{1,31}$'),
  ADD CONSTRAINT "content_types_fields_array" CHECK (jsonb_typeof("fields") = 'array');

ALTER TABLE "taxonomies"
  ADD CONSTRAINT "taxonomies_key_format" CHECK ("key" ~ '^[a-z][a-z0-9_]{1,31}$');

-- Slugs: lower-case, no whitespace or URL delimiters (Unicode letters are allowed).
ALTER TABLE "terms"
  ADD CONSTRAINT "terms_slug_format" CHECK ("slug" <> '' AND "slug" = lower("slug") AND "slug" !~ '[[:space:]/?#%&\\]'),
  ADD CONSTRAINT "terms_not_own_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

ALTER TABLE "entries"
  ADD CONSTRAINT "entries_slug_format" CHECK ("slug" <> '' AND "slug" = lower("slug") AND "slug" !~ '[[:space:]/?#%&\\]'),
  ADD CONSTRAINT "entries_path_format" CHECK ("path" <> '' AND "path" !~ '(^/|/$|//)' AND ("path" = "slug" OR "path" LIKE '%/' || "slug")),
  ADD CONSTRAINT "entries_not_own_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
  ADD CONSTRAINT "entries_publication_time" CHECK ("status" NOT IN ('scheduled', 'published') OR "published_at" IS NOT NULL),
  ADD CONSTRAINT "entries_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "entries_body_object" CHECK (jsonb_typeof("body") = 'object'),
  ADD CONSTRAINT "entries_fields_object" CHECK (jsonb_typeof("fields") = 'object');

ALTER TABLE "media"
  ADD CONSTRAINT "media_size_nonnegative" CHECK ("size_bytes" >= 0),
  ADD CONSTRAINT "media_checksum_sha256" CHECK (octet_length("checksum") = 32),
  ADD CONSTRAINT "media_variants_array" CHECK (jsonb_typeof("variants") = 'array');

-- =============================================================================================
-- Seed: capabilities (keep in sync with packages/shared capabilities.ts) and role mapping
-- =============================================================================================
INSERT INTO "capabilities" ("key", "category", "description") VALUES
  ('content.read',         'content', 'View all content in the dashboard, including other users'' drafts'),
  ('content.create',       'content', 'Create content and edit own drafts'),
  ('content.publish',      'content', 'Publish, schedule and unpublish content, and edit own published content'),
  ('content.edit_others',  'content', 'Edit content written by other users'),
  ('content.delete',       'content', 'Move content to the trash, restore it and delete it permanently (within the edit rules)'),
  ('terms.manage',         'content', 'Create, edit and delete categories, tags and other terms'),
  ('content_types.manage', 'content', 'Define content types, custom fields and taxonomies'),
  ('media.upload',         'media',   'Upload media and edit or delete own uploads'),
  ('media.manage',         'media',   'Edit and delete media uploaded by other users'),
  ('jobs.manage',          'system',  'View and retry background jobs');

-- Administrator: every new capability (it already holds everything except site-wide settings).
INSERT INTO "role_capabilities" ("role_id", "capability_key")
  SELECT r."id", c."key" FROM "roles" r CROSS JOIN "capabilities" c
  WHERE r."key" = 'administrator'
    AND c."key" IN ('content.read', 'content.create', 'content.publish', 'content.edit_others', 'content.delete',
                    'terms.manage', 'content_types.manage', 'media.upload', 'media.manage', 'jobs.manage');

INSERT INTO "role_capabilities" ("role_id", "capability_key")
  SELECT r."id", grant_key FROM "roles" r
  CROSS JOIN LATERAL unnest(CASE r."key"
    WHEN 'editor' THEN ARRAY['content.read', 'content.create', 'content.publish', 'content.edit_others',
                             'content.delete', 'terms.manage', 'media.upload', 'media.manage']
    WHEN 'author' THEN ARRAY['content.create', 'content.publish', 'content.delete', 'media.upload']
    WHEN 'contributor' THEN ARRAY['content.create', 'content.delete']
    WHEN 'viewer' THEN ARRAY['content.read']
  END) AS grant_key
  WHERE r."key" IN ('editor', 'author', 'contributor', 'viewer');

UPDATE "roles" SET "description" = 'Manages all content, terms and media.', "updated_at" = CURRENT_TIMESTAMP WHERE "key" = 'editor';
UPDATE "roles" SET "description" = 'Writes, publishes and manages own content and uploads.', "updated_at" = CURRENT_TIMESTAMP WHERE "key" = 'author';
UPDATE "roles" SET "description" = 'Writes own drafts and submits them for review.', "updated_at" = CURRENT_TIMESTAMP WHERE "key" = 'contributor';
UPDATE "roles" SET "description" = 'Read-only access to the dashboard and all content.', "updated_at" = CURRENT_TIMESTAMP WHERE "key" = 'viewer';

-- =============================================================================================
-- Seed: built-in content types and taxonomies
-- =============================================================================================
INSERT INTO "content_types" ("id", "key", "name", "plural_name", "description", "hierarchical", "is_system", "updated_at") VALUES
  (gen_random_uuid(), 'post', 'Post', 'Posts', 'Time-based articles, organised with categories and tags.', false, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'page', 'Page', 'Pages', 'Standalone pages such as About or Contact, organised in a hierarchy.', true, true, CURRENT_TIMESTAMP);

INSERT INTO "taxonomies" ("id", "key", "name", "plural_name", "description", "hierarchical", "is_system", "updated_at") VALUES
  (gen_random_uuid(), 'category', 'Category', 'Categories', 'Hierarchical groups for posts.', true, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'tag', 'Tag', 'Tags', 'Free-form keywords for posts.', false, true, CURRENT_TIMESTAMP);

INSERT INTO "content_type_taxonomies" ("content_type_id", "taxonomy_id")
  SELECT ct."id", t."id" FROM "content_types" ct CROSS JOIN "taxonomies" t
  WHERE ct."key" = 'post' AND t."key" IN ('category', 'tag');
