import { Activity, type LucideIcon } from 'lucide-react';

export interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

/**
 * Admin navigation. Only routes that exist and work are listed; sections are added as their
 * milestones land (content, media, appearance, plugins, users, settings).
 */
export const NAVIGATION: readonly NavGroup[] = [
  {
    label: 'System',
    items: [{ to: '/system/status', label: 'System status', icon: Activity }],
  },
];
