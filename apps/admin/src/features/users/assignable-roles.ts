import type { RoleInfo } from '@nexora/shared';

/** Roles the actor may assign: those whose capabilities the actor holds (the API enforces this too). */
export function assignableRoles(
  roles: readonly RoleInfo[],
  capabilities: ReadonlySet<string>,
): RoleInfo[] {
  return roles.filter((role) =>
    role.capabilities.every((capability) => capabilities.has(capability)),
  );
}
