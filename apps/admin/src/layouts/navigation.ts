import type { ContentModelResponse, CoreCapability } from '@nexora/shared';
import {
  Activity,
  Blocks,
  Boxes,
  FileText,
  FolderTree,
  Image,
  LayoutDashboard,
  ListChecks,
  ListTree,
  Newspaper,
  Palette,
  Route,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Tags,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Hidden unless the user holds this capability (a UI hint; the API enforces access). */
  readonly capability?: CoreCapability;
  /** Hidden unless the user holds at least one of these. */
  readonly anyOf?: readonly CoreCapability[];
  /** Active only on this exact path (not on sub-paths). */
  readonly end?: boolean;
}

export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

const CONTENT_READERS: readonly CoreCapability[] = [
  'content.read',
  'content.create',
  'content.edit_others',
];

const TYPE_ICONS: Readonly<Record<string, LucideIcon>> = { post: Newspaper, page: FileText };

/** Content navigation is built from the content model: one entry per content type and taxonomy. */
function contentGroup(model: ContentModelResponse | undefined): NavGroup {
  const types: NavItem[] = (model?.contentTypes ?? []).map((type) => ({
    to: `/content/${type.key}`,
    label: type.pluralName,
    icon: TYPE_ICONS[type.key] ?? Boxes,
    anyOf: CONTENT_READERS,
  }));
  const taxonomies: NavItem[] = (model?.taxonomies ?? []).map((taxonomy) => ({
    to: `/taxonomies/${taxonomy.key}`,
    label: taxonomy.pluralName,
    icon: taxonomy.hierarchical ? FolderTree : Tags,
    capability: 'terms.manage',
  }));
  return {
    label: 'Content',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      ...types,
      {
        to: '/media',
        label: 'Media',
        icon: Image,
        anyOf: ['media.upload', 'media.manage', 'content.read'],
      },
      ...taxonomies,
    ],
  };
}

/** Only routes that exist and work are listed; sections are added as their milestones land. */
export function buildNavigation(model?: ContentModelResponse): readonly NavGroup[] {
  return [
    contentGroup(model),
    {
      label: 'Site',
      items: [
        {
          to: '/appearance',
          label: 'Appearance',
          icon: Palette,
          capability: 'appearance.manage',
          end: true,
        },
        {
          to: '/appearance/menus',
          label: 'Menus',
          icon: ListTree,
          capability: 'appearance.manage',
        },
        { to: '/seo', label: 'SEO', icon: Search, capability: 'seo.manage', end: true },
        { to: '/seo/redirects', label: 'Redirects', icon: Route, capability: 'seo.manage' },
      ],
    },
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
        {
          to: '/system/jobs',
          label: 'Background jobs',
          icon: ListChecks,
          capability: 'jobs.manage',
        },
        { to: '/audit', label: 'Audit log', icon: ScrollText, capability: 'audit.read' },
        {
          to: '/settings/content-types',
          label: 'Content types',
          icon: Blocks,
          capability: 'content_types.manage',
        },
        {
          to: '/settings',
          label: 'Settings',
          icon: Settings,
          capability: 'system.manage',
          end: true,
        },
      ],
    },
  ];
}

export function isVisible(item: NavItem, capabilities: ReadonlySet<string>): boolean {
  return (
    (item.capability === undefined || capabilities.has(item.capability)) &&
    (item.anyOf === undefined || item.anyOf.some((capability) => capabilities.has(capability)))
  );
}

export function visibleNavigation(
  capabilities: ReadonlySet<string>,
  model?: ContentModelResponse,
): NavGroup[] {
  return buildNavigation(model)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => isVisible(item, capabilities)),
    }))
    .filter((group) => group.items.length > 0);
}
