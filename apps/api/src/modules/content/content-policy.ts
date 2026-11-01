import type { EntryPermissions, EntryStatus } from '@nexora/shared';

export interface PolicyActor {
  readonly userId: string;
  readonly capabilities: ReadonlySet<string>;
}

export interface PolicyEntry {
  readonly authorId: string;
  readonly status: EntryStatus;
  readonly trashed: boolean;
}

const LIVE_STATUSES: readonly EntryStatus[] = ['published', 'scheduled'];

function has(actor: PolicyActor, capability: string): boolean {
  return actor.capabilities.has(capability);
}

/** May the actor see everyone's entries (not just their own) in the dashboard? */
export function canSeeAllEntries(actor: PolicyActor): boolean {
  return has(actor, 'content.read') || has(actor, 'content.edit_others');
}

export function canView(actor: PolicyActor, entry: PolicyEntry): boolean {
  return entry.authorId === actor.userId
    ? has(actor, 'content.create') || canSeeAllEntries(actor)
    : canSeeAllEntries(actor);
}

/**
 * Editing rules, ignoring the trash:
 * - own entries need content.create; others' need content.edit_others;
 * - published or scheduled entries additionally need content.publish (contributors cannot change
 *   live content, and nobody can unpublish without the right to publish).
 */
function canEditContent(actor: PolicyActor, entry: PolicyEntry): boolean {
  const ownership =
    entry.authorId === actor.userId
      ? has(actor, 'content.create')
      : has(actor, 'content.edit_others');
  return ownership && (!LIVE_STATUSES.includes(entry.status) || has(actor, 'content.publish'));
}

export function canEdit(actor: PolicyActor, entry: PolicyEntry): boolean {
  return !entry.trashed && canEditContent(actor, entry);
}

export function canSetStatus(actor: PolicyActor, entry: PolicyEntry, to: EntryStatus): boolean {
  if (!canEdit(actor, entry)) {
    return false;
  }
  return !LIVE_STATUSES.includes(to) || has(actor, 'content.publish');
}

export function canCreate(actor: PolicyActor, status: EntryStatus): boolean {
  return (
    has(actor, 'content.create') &&
    (!LIVE_STATUSES.includes(status) || has(actor, 'content.publish'))
  );
}

export function canTrash(actor: PolicyActor, entry: PolicyEntry): boolean {
  return !entry.trashed && has(actor, 'content.delete') && canEditContent(actor, entry);
}

/** Restoring and permanently deleting follow the same rules as trashing, applied to trashed entries. */
export function canRestore(actor: PolicyActor, entry: PolicyEntry): boolean {
  return entry.trashed && has(actor, 'content.delete') && canEditContent(actor, entry);
}

export function permissionsFor(actor: PolicyActor, entry: PolicyEntry): EntryPermissions {
  return {
    edit: canEdit(actor, entry),
    publish: canSetStatus(actor, entry, 'published'),
    trash: canTrash(actor, entry),
    restore: canRestore(actor, entry),
    delete: canRestore(actor, entry),
  };
}
