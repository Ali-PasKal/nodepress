/**
 * Core capabilities. Authorisation checks capabilities, never role names. Plugins may register more
 * (Milestone 6), so APIs treat capability keys as strings validated against the database registry.
 *
 * Keep in sync with the seed in apps/api/prisma/migrations (verified by an integration test).
 */
export const CORE_CAPABILITIES = {
  'dashboard.access': { category: 'general', description: 'Sign in to the admin dashboard' },
  'users.read': { category: 'users', description: 'View user accounts' },
  'users.create': { category: 'users', description: 'Create user accounts' },
  'users.update': { category: 'users', description: 'Edit user profiles, status and passwords' },
  'users.assign_roles': { category: 'users', description: 'Change the role of other users' },
  'roles.read': { category: 'roles', description: 'View roles and their capabilities' },
  'roles.manage': { category: 'roles', description: 'Create, edit and delete roles' },
  'sessions.manage': { category: 'security', description: "View and revoke other users' sessions" },
  'audit.read': { category: 'security', description: 'View the audit log' },
  'system.manage': { category: 'system', description: 'Change site-wide settings' },
  'content.read': {
    category: 'content',
    description: "View all content in the dashboard, including other users' drafts",
  },
  'content.create': { category: 'content', description: 'Create content and edit own drafts' },
  'content.publish': {
    category: 'content',
    description: 'Publish, schedule and unpublish content, and edit own published content',
  },
  'content.edit_others': {
    category: 'content',
    description: 'Edit content written by other users',
  },
  'content.delete': {
    category: 'content',
    description:
      'Move content to the trash, restore it and delete it permanently (within the edit rules)',
  },
  'terms.manage': {
    category: 'content',
    description: 'Create, edit and delete categories, tags and other terms',
  },
  'content_types.manage': {
    category: 'content',
    description: 'Define content types, custom fields and taxonomies',
  },
  'media.upload': { category: 'media', description: 'Upload media and edit or delete own uploads' },
  'media.manage': {
    category: 'media',
    description: 'Edit and delete media uploaded by other users',
  },
  'jobs.manage': { category: 'system', description: 'View and retry background jobs' },
  'content.embed_html': {
    category: 'content',
    description: 'Add HTML embed widgets (third-party code, shown sandboxed)',
  },
  'appearance.manage': {
    category: 'appearance',
    description: 'Choose and configure the theme, site identity, reading settings and menus',
  },
  'seo.manage': { category: 'appearance', description: 'Manage SEO settings and redirects' },
  'plugins.manage': {
    category: 'system',
    description: 'Install, activate, configure, update and remove plugins (they run sandboxed)',
  },
} as const satisfies Record<string, { category: string; description: string }>;

export type CoreCapability = keyof typeof CORE_CAPABILITIES;
export const CORE_CAPABILITY_KEYS = Object.keys(CORE_CAPABILITIES) as CoreCapability[];

/** Built-in roles (seeded). `grantsAll` roles hold every capability, including future ones. */
export const SYSTEM_ROLE_KEYS = [
  'super_admin',
  'administrator',
  'editor',
  'author',
  'contributor',
  'viewer',
] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

/**
 * Capabilities of the built-in roles as seeded by the migrations ('all' = grantsAll). Used by tests and
 * tooling to restore defaults; the migrations are the source of truth for existing installations.
 */
export const SYSTEM_ROLE_DEFAULTS: Readonly<
  Record<SystemRoleKey, 'all' | readonly CoreCapability[]>
> = {
  super_admin: 'all',
  administrator: CORE_CAPABILITY_KEYS.filter((key) => key !== 'system.manage'),
  editor: [
    'dashboard.access',
    'content.read',
    'content.create',
    'content.publish',
    'content.edit_others',
    'content.delete',
    'terms.manage',
    'media.upload',
    'media.manage',
    'seo.manage',
    'content.embed_html',
  ],
  author: [
    'dashboard.access',
    'content.create',
    'content.publish',
    'content.delete',
    'media.upload',
  ],
  contributor: ['dashboard.access', 'content.create', 'content.delete'],
  viewer: ['dashboard.access', 'content.read'],
};
