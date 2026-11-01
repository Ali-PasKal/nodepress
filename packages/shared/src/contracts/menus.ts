import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';
import { isSafeLinkHref } from './rich-text.js';

// ---------------------------------------------------------------------------------------------
// Navigation menus
// ---------------------------------------------------------------------------------------------

export const MENU_ITEM_KINDS = ['entry', 'term', 'home', 'url'] as const;
export type MenuItemKind = (typeof MENU_ITEM_KINDS)[number];
export const MENU_MAX_ITEMS = 200;
export const MENU_MAX_DEPTH = 3;

const menuName = z.string().trim().min(1, { message: 'Name is required.' }).max(100);
const locationKey = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);

/** Custom links: site paths, fragments, http(s), mailto and tel (the rich-text link rules). */
export const menuUrlSchema = z.string().trim().max(2_048).refine(isSafeLinkHref, {
  message: 'Use a site path ("/about") or an http(s), mailto or tel link.',
});

/**
 * One item of a menu save. Items are sent as a flat list in display order; `parentKey` refers to the
 * `key` of an earlier item, which keeps the tree acyclic by construction.
 */
export const menuItemInputSchema = z
  .object({
    key: z.string().min(1).max(40),
    parentKey: z.string().min(1).max(40).nullable().default(null),
    /** Empty: the title of the linked entry or term ("Home" for the home page). */
    label: z.string().trim().max(200).default(''),
    kind: z.enum(MENU_ITEM_KINDS),
    entryId: uuidSchema.nullable().default(null),
    termId: uuidSchema.nullable().default(null),
    url: menuUrlSchema.nullable().default(null),
    openInNewTab: z.boolean().default(false),
  })
  .superRefine((item, ctx) => {
    const require = (field: 'entryId' | 'termId' | 'url', message: string): void => {
      if (item[field] === null) ctx.addIssue({ code: 'custom', path: [field], message });
    };
    const forbid = (fields: readonly ('entryId' | 'termId' | 'url')[]): void => {
      for (const field of fields) {
        if (item[field] !== null) {
          ctx.addIssue({ code: 'custom', path: [field], message: 'Not allowed for this item.' });
        }
      }
    };
    switch (item.kind) {
      case 'entry':
        require('entryId', 'Choose an entry.');
        forbid(['termId', 'url']);
        break;
      case 'term':
        require('termId', 'Choose a term.');
        forbid(['entryId', 'url']);
        break;
      case 'url':
        require('url', 'Enter a link.');
        forbid(['entryId', 'termId']);
        if (item.label === '') {
          ctx.addIssue({ code: 'custom', path: ['label'], message: 'Custom links need a label.' });
        }
        break;
      case 'home':
        forbid(['entryId', 'termId', 'url']);
        break;
    }
  });
export type MenuItemInput = z.input<typeof menuItemInputSchema>;

export const createMenuSchema = z.object({
  name: menuName,
  location: locationKey.nullable().default(null),
});
export type CreateMenuInput = z.input<typeof createMenuSchema>;

/** Replaces a menu's name, location and complete item list. */
export const saveMenuSchema = z
  .object({
    name: menuName,
    location: locationKey.nullable(),
    items: z
      .array(menuItemInputSchema)
      .max(MENU_MAX_ITEMS, { message: `A menu can have at most ${String(MENU_MAX_ITEMS)} items.` }),
  })
  .superRefine((menu, ctx) => {
    const depth = new Map<string, number>();
    menu.items.forEach((item, index) => {
      if (depth.has(item.key)) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'key'], message: 'Duplicate key.' });
        return;
      }
      let level = 1;
      if (item.parentKey !== null) {
        const parentLevel = depth.get(item.parentKey);
        if (parentLevel === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['items', index, 'parentKey'],
            message: 'The parent must come before its children.',
          });
          return;
        }
        level = parentLevel + 1;
        if (level > MENU_MAX_DEPTH) {
          ctx.addIssue({
            code: 'custom',
            path: ['items', index, 'parentKey'],
            message: `Menus can be at most ${String(MENU_MAX_DEPTH)} levels deep.`,
          });
        }
      }
      depth.set(item.key, level);
    });
  });
export type SaveMenuInput = z.input<typeof saveMenuSchema>;

export const MENU_TARGET_STATES = ['available', 'unpublished', 'missing'] as const;

export const menuItemSchema = z.object({
  id: uuidSchema,
  parentId: uuidSchema.nullable(),
  label: z.string(),
  kind: z.enum(MENU_ITEM_KINDS),
  entryId: uuidSchema.nullable(),
  termId: uuidSchema.nullable(),
  url: z.string().nullable(),
  openInNewTab: z.boolean(),
  /** What the item points at, for the editor ("unpublished" items are hidden on the site). */
  target: z.object({
    title: z.string(),
    url: z.string().nullable(),
    state: z.enum(MENU_TARGET_STATES),
  }),
});
export type MenuItemInfo = z.infer<typeof menuItemSchema>;

export const menuSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  location: z.string().nullable(),
  itemCount: z.number().int().nonnegative(),
  updatedAt: isoDateTimeSchema,
});
export type MenuSummary = z.infer<typeof menuSummarySchema>;

export const menuDetailSchema = menuSummarySchema.extend({ items: z.array(menuItemSchema) });
export type MenuDetail = z.infer<typeof menuDetailSchema>;

export const menusResponseSchema = z.object({
  menus: z.array(menuSummarySchema),
  /** Menu locations of the active theme and the menu assigned to each. */
  locations: z.array(
    z.object({ key: z.string(), label: z.string(), menuId: uuidSchema.nullable() }),
  ),
});
export type MenusResponse = z.infer<typeof menusResponseSchema>;
