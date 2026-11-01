-- Milestone 5: visual builder documents on entries, builder opt-in per content type, and the capability to save
-- sandboxed HTML embeds.

-- AlterTable
ALTER TABLE "content_types" ADD COLUMN     "has_builder" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "entries" ADD COLUMN     "builder" JSONB,
ADD COLUMN     "editor" VARCHAR(16) NOT NULL DEFAULT 'rich_text';

-- =============================================================================================
-- Constraints Prisma cannot express
-- =============================================================================================
ALTER TABLE "entries"
  ADD CONSTRAINT "entries_editor" CHECK ("editor" IN ('rich_text', 'builder')),
  ADD CONSTRAINT "entries_builder_object" CHECK ("builder" IS NULL OR jsonb_typeof("builder") = 'object'),
  ADD CONSTRAINT "entries_builder_present" CHECK ("editor" = 'rich_text' OR "builder" IS NOT NULL);

-- Pages are laid out with the builder by default.
UPDATE "content_types" SET "has_builder" = true WHERE "key" = 'page';

-- =============================================================================================
-- Seed: capability (keep in sync with packages/shared capabilities.ts) and role mapping
-- =============================================================================================
INSERT INTO "capabilities" ("key", "category", "description") VALUES
  ('content.embed_html', 'content', 'Add HTML embed widgets (third-party code, shown sandboxed)');

INSERT INTO "role_capabilities" ("role_id", "capability_key")
  SELECT r."id", 'content.embed_html' FROM "roles" r WHERE r."key" IN ('administrator', 'editor');
