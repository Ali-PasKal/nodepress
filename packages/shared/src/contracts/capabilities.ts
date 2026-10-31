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
