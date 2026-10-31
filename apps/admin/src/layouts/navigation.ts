import type { CoreCapability } from '@nexora/shared';
import { Activity, ScrollText, Settings, ShieldCheck, Users, type LucideIcon } from 'lucide-react';

export interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Hidden unless the user holds this capability (a UI hint; the API enforces access). */
  readonly capability?: CoreCapability;
}

export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

/** Only routes that exist and work are listed; sections are added as their milestones land. */
export const NAVIGATION: readonly NavGroup[] = [
  {
    label: 'People',
    items: [
      { to: '/users', label: 'Users', icon: Users, capability: 'users.read' },
      { to: '/roles', label: 'Roles', icon: ShieldCheck, capability: 'roles.read' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/system/status', label: 'System status', icon: Activity },
      { to: '/audit', label: 'Audit log', icon: ScrollText, capability: 'audit.read' },
      { to: '/settings', label: 'Settings', icon: Settings, capability: 'system.manage' },
    ],
  },
];

export function visibleNavigation(capabilities: ReadonlySet<string>): NavGroup[] {
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => item.capability === undefined || capabilities.has(item.capability),
    ),
  })).filter((group) => group.items.length > 0);
}
