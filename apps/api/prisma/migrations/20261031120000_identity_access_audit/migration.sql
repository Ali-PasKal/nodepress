-- NEXORA CMS migration (Milestone 2): sites, identity, sessions, roles and capabilities, password
-- resets, append-only audit log, rate-limit counters. Seeds core capabilities and system roles.

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'suspended');

-- AlterTable
ALTER TABLE "system_state" ADD COLUMN     "setup_token_hash" BYTEA;

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "base_url" VARCHAR(2048) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_credentials" (
    "user_id" UUID NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" VARCHAR(64),
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(512),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "grants_all" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capabilities" (
    "key" VARCHAR(100) NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "description" VARCHAR(300) NOT NULL,

    CONSTRAINT "capabilities_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role_capabilities" (
    "role_id" UUID NOT NULL,
    "capability_key" VARCHAR(100) NOT NULL,

    CONSTRAINT "role_capabilities_pkey" PRIMARY KEY ("role_id","capability_key")
);

-- CreateTable
CREATE TABLE "role_assignments" (
    "user_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("user_id","site_id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" VARCHAR(100) NOT NULL,
    "actor_user_id" UUID,
    "target_type" VARCHAR(64),
    "target_id" VARCHAR(64),
    "ip_address" VARCHAR(64),
    "request_id" VARCHAR(128),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" VARCHAR(255) NOT NULL,
    "count" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "sites_key_key" ON "sites"("key");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE INDEX "role_capabilities_capability_key_idx" ON "role_capabilities"("capability_key");

-- CreateIndex
CREATE INDEX "role_assignments_role_id_idx" ON "role_assignments"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_action_occurred_at_idx" ON "audit_events"("action", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_user_id_occurred_at_idx" ON "audit_events"("actor_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_expires_at_idx" ON "rate_limit_buckets"("expires_at");

-- AddForeignKey
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_capabilities" ADD CONSTRAINT "role_capabilities_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_capabilities" ADD CONSTRAINT "role_capabilities_capability_key_fkey" FOREIGN KEY ("capability_key") REFERENCES "capabilities"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================================
-- Constraints Prisma cannot express
-- =============================================================================================
ALTER TABLE "sites" ADD CONSTRAINT "sites_key_format" CHECK ("key" ~ '^[a-z0-9][a-z0-9_-]{0,63}$');
ALTER TABLE "sites" ADD CONSTRAINT "sites_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "sites" ADD CONSTRAINT "sites_base_url_http" CHECK ("base_url" ~ '^https?://');

ALTER TABLE "users" ADD CONSTRAINT "users_email_normalised" CHECK ("email" = lower(btrim("email")) AND position('@' in "email") > 1);
ALTER TABLE "users" ADD CONSTRAINT "users_display_name_not_blank" CHECK (length(btrim("display_name")) > 0);

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_token_hash_sha256" CHECK (octet_length("token_hash") = 32);
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_expiry_after_creation" CHECK ("expires_at" > "created_at");
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_hash_sha256" CHECK (octet_length("token_hash") = 32);
ALTER TABLE "system_state" ADD CONSTRAINT "system_state_setup_token_sha256" CHECK ("setup_token_hash" IS NULL OR octet_length("setup_token_hash") = 32);

ALTER TABLE "roles" ADD CONSTRAINT "roles_key_format" CHECK ("key" ~ '^[a-z][a-z0-9_]{1,63}$');
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_key_format" CHECK ("key" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$');
ALTER TABLE "rate_limit_buckets" ADD CONSTRAINT "rate_limit_buckets_count_positive" CHECK ("count" > 0);

-- =============================================================================================
-- Append-only audit log: the application can insert but never rewrite history.
-- (A database superuser can still bypass this; see docs/security/threat-model.md.)
-- =============================================================================================
CREATE FUNCTION "audit_events_reject_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% rejected)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_events_append_only"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit_events_reject_change"();

-- =============================================================================================
-- Seed: core capabilities and system roles (keep in sync with packages/shared capabilities.ts)
-- =============================================================================================
INSERT INTO "capabilities" ("key", "category", "description") VALUES
  ('dashboard.access',   'general',  'Sign in to the admin dashboard'),
  ('users.read',         'users',    'View user accounts'),
  ('users.create',       'users',    'Create user accounts'),
  ('users.update',       'users',    'Edit user profiles, status and passwords'),
  ('users.assign_roles', 'users',    'Change the role of other users'),
  ('roles.read',         'roles',    'View roles and their capabilities'),
  ('roles.manage',       'roles',    'Create, edit and delete roles'),
  ('sessions.manage',    'security', 'View and revoke other users'' sessions'),
  ('audit.read',         'security', 'View the audit log'),
  ('system.manage',      'system',   'Change site-wide settings');

INSERT INTO "roles" ("id", "key", "name", "description", "is_system", "grants_all", "updated_at") VALUES
  (gen_random_uuid(), 'super_admin',   'Super Administrator', 'Full control of the instance, including site-wide settings. Always holds every capability.', true, true,  CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'administrator', 'Administrator',       'Manages users, roles and security, but not site-wide settings.',                           true, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'editor',        'Editor',              'Manages all content (content capabilities arrive with the content model).',                true, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'author',        'Author',              'Writes and publishes own content (content capabilities arrive with the content model).',   true, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'contributor',   'Contributor',         'Writes own drafts for review (content capabilities arrive with the content model).',       true, false, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'viewer',        'Viewer',              'Read-only access to the dashboard.',                                                       true, false, CURRENT_TIMESTAMP);

-- Administrator: everything except site-wide settings.
INSERT INTO "role_capabilities" ("role_id", "capability_key")
  SELECT r."id", c."key" FROM "roles" r CROSS JOIN "capabilities" c
  WHERE r."key" = 'administrator' AND c."key" <> 'system.manage';

-- Editor, Author, Contributor, Viewer: dashboard access (content capabilities are added in Milestone 3).
INSERT INTO "role_capabilities" ("role_id", "capability_key")
  SELECT r."id", 'dashboard.access' FROM "roles" r
  WHERE r."key" IN ('editor', 'author', 'contributor', 'viewer');
