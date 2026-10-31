import { zodResolver } from '@hookform/resolvers/zod';
import { roleSchema, type CapabilityInfo, type RoleInfo } from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Skeleton,
  Textarea,
} from '@nexora/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleX, Loader2, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { PageHeader } from '../../components/page-header';
import { apiSend } from '../../lib/api-client';
import { applyServerErrors, errorMessage } from '../../lib/forms';
import { useCapabilities, useSession } from '../auth/session';
import { rolesKey, useRoles } from '../users/api';

const roleFormSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,63}$/, {
      message: 'Use 2–64 lower-case letters, digits or underscores, starting with a letter.',
    }),
  name: z.string().trim().min(1, { message: 'Name is required.' }).max(100),
  description: z.string().trim().max(500),
  capabilities: z.array(z.string()),
});
type RoleForm = z.infer<typeof roleFormSchema>;

function groupByCategory(capabilities: readonly CapabilityInfo[]): [string, CapabilityInfo[]][] {
  const groups = new Map<string, CapabilityInfo[]>();
  for (const capability of capabilities) {
    groups.set(capability.category, [...(groups.get(capability.category) ?? []), capability]);
  }
  return [...groups.entries()];
}

/** The form lives in its own component: Radix unmounts closed dialog content, so each open starts clean. */
function RoleForm({
  role,
  capabilities,
  held,
  onDone,
}: {
  role: RoleInfo | null;
  capabilities: readonly CapabilityInfo[];
  held: ReadonlySet<string>;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RoleForm>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: role
      ? {
          key: role.key,
          name: role.name,
          description: role.description,
          capabilities: role.capabilities,
        }
      : { key: '', name: '', description: '', capabilities: ['dashboard.access'] },
  });
  const save = useMutation({
    mutationFn: (values: RoleForm) =>
      role
        ? apiSend(
            'PATCH',
            `/roles/${role.id}`,
            {
              ...(role.isSystem ? {} : { name: values.name }),
              description: values.description,
              capabilities: values.capabilities,
            },
            roleSchema,
          )
        : apiSend('POST', '/roles', values, roleSchema),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: rolesKey });
      toast.success(role ? `${saved.name} was updated.` : `${saved.name} was created.`);
      onDone();
    },
    onError: (error) => {
      setFormError(
        applyServerErrors(error, form.setError, ['key', 'name', 'description', 'capabilities']),
      );
    },
  });
  const selected = new Set(useWatch({ control: form.control, name: 'capabilities' }));

  return (
    <>
      <form
        noValidate
        onSubmit={(event) =>
          void form.handleSubmit((values) => {
            save.mutate(values);
          })(event)
        }
        className="flex flex-col gap-4"
      >
        {formError && (
          <Alert tone="danger">
            <CircleX aria-hidden="true" />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Name"
            error={form.formState.errors.name?.message}
            description={role?.isSystem ? 'Built-in roles cannot be renamed.' : undefined}
          >
            {(control) => (
              <Input
                {...control}
                disabled={role?.isSystem}
                autoFocus={!role}
                {...form.register('name')}
              />
            )}
          </Field>
          <Field
            label="Key"
            error={form.formState.errors.key?.message}
            description={
              role
                ? 'Keys cannot be changed.'
                : 'Used in exports and integrations, e.g. "reviewer".'
            }
          >
            {(control) => (
              <Input
                {...control}
                disabled={role !== null}
                className="font-mono"
                {...form.register('key')}
              />
            )}
          </Field>
        </div>
        <Field label="Description" error={form.formState.errors.description?.message}>
          {(control) => <Textarea {...control} rows={2} {...form.register('description')} />}
        </Field>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">Capabilities</legend>
          {groupByCategory(capabilities).map(([category, items]) => (
            <div key={category} className="rounded-lg border p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {category}
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {items.map((capability) => {
                  const disabled = !held.has(capability.key);
                  return (
                    <li key={capability.key}>
                      <label
                        className={`flex items-start gap-2 text-sm ${disabled ? 'opacity-60' : 'cursor-pointer'}`}
                        title={disabled ? 'You do not hold this capability' : undefined}
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={selected.has(capability.key)}
                          disabled={disabled}
                          onChange={(event) => {
                            const next = new Set(selected);
                            if (event.target.checked) next.add(capability.key);
                            else next.delete(capability.key);
                            form.setValue('capabilities', [...next].sort(), {
                              shouldDirty: true,
                            });
                          }}
                        />
                        <span>
                          <span className="block font-medium">{capability.description}</span>
                          <code className="text-xs text-muted-foreground">{capability.key}</code>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </fieldset>
        <DialogFooter>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {role ? 'Save changes' : 'Create role'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function RoleDialog({
  role,
  open,
  onOpenChange,
  capabilities,
  held,
}: {
  role: RoleInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  capabilities: readonly CapabilityInfo[];
  held: ReadonlySet<string>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{role ? `Edit ${role.name}` : 'Create role'}</DialogTitle>
          <DialogDescription>
            Capabilities take effect immediately for everyone with this role. You can only grant
            capabilities you hold yourself.
          </DialogDescription>
        </DialogHeader>
        <RoleForm
          role={role}
          capabilities={capabilities}
          held={held}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function RolesPage() {
  const held = useCapabilities();
  const session = useSession();
  const ownRoleId = session.data?.authenticated ? session.data.user.role?.id : undefined;
  const roles = useRoles();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RoleInfo | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<RoleInfo | null>(null);
  const remove = useMutation({
    mutationFn: (role: RoleInfo) => apiSend('DELETE', `/roles/${role.id}`, undefined, null),
    onSuccess: (_result, role) => {
      void queryClient.invalidateQueries({ queryKey: rolesKey });
      toast.success(`${role.name} was deleted.`);
      setDeleting(null);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setDeleting(null);
    },
  });
  const canManage = held.has('roles.manage');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Roles"
        description="Roles bundle capabilities. Access checks use capabilities, never role names."
        actions={
          canManage && (
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus aria-hidden="true" /> Create role
            </Button>
          )
        }
      />
      {roles.isPending ? (
        <div className="grid gap-4 md:grid-cols-2" role="status" aria-label="Loading roles">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : roles.isError ? (
        <Alert tone="danger">
          <CircleX aria-hidden="true" />
          <AlertDescription>{errorMessage(roles.error)}</AlertDescription>
        </Alert>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {roles.data.roles.map((role) => {
            const editable =
              canManage &&
              !role.grantsAll &&
              role.id !== ownRoleId &&
              role.capabilities.every((key) => held.has(key));
            return (
              <li key={role.id}>
                <Card className="flex h-full flex-col gap-3 p-5" data-testid={`role-${role.key}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="flex flex-wrap items-center gap-2 font-semibold">
                        {role.name}
                        {role.isSystem && <Badge>Built-in</Badge>}
                      </h2>
                      <code className="text-xs text-muted-foreground">{role.key}</code>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {editable ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${role.name}`}
                          onClick={() => {
                            setEditing(role);
                          }}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                      ) : (
                        <span
                          className="p-2 text-muted-foreground"
                          title={
                            role.grantsAll
                              ? 'Always holds every capability'
                              : 'You cannot edit this role'
                          }
                        >
                          <Lock className="size-4" aria-label="Locked" />
                        </span>
                      )}
                      {editable && !role.isSystem && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${role.name}`}
                          onClick={() => {
                            setDeleting(role);
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {role.description && (
                    <p className="text-sm text-muted-foreground">{role.description}</p>
                  )}
                  <p className="mt-auto text-xs text-muted-foreground">
                    {role.grantsAll
                      ? 'All capabilities'
                      : `${String(role.capabilities.length)} capabilities`}{' '}
                    · {role.userCount} {role.userCount === 1 ? 'user' : 'users'}
                  </p>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <RoleDialog
        role={null}
        open={creating}
        onOpenChange={setCreating}
        capabilities={roles.data?.capabilities ?? []}
        held={held}
      />
      <RoleDialog
        role={editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        capabilities={roles.data?.capabilities ?? []}
        held={held}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? 'role'}?`}
        description={
          deleting && deleting.userCount > 0
            ? 'This role is assigned to users. Reassign them first.'
            : 'This cannot be undone.'
        }
        confirmLabel="Delete role"
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
        }}
      />
    </div>
  );
}
