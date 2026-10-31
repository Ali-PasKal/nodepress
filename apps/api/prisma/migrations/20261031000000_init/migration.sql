-- NEXORA CMS initial migration (Milestone 1): instance installation state.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "system_state" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "installed_at" TIMESTAMPTZ(3),
    "installed_version" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_state_pkey" PRIMARY KEY ("id")
);


-- Prisma cannot express CHECK constraints; enforce the singleton invariant in the database.
ALTER TABLE "system_state" ADD CONSTRAINT "system_state_singleton" CHECK ("id" = 1);
