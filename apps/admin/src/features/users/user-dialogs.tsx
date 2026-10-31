import { zodResolver } from '@hookform/resolvers/zod';
import {
  createUserSchema,
  displayNameSchema,
  newPasswordSchema,
  type RoleInfo,
  type UserSummary,
} from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  NativeSelect,
} from '@nexora/ui';
import { CircleX, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { applyServerErrors } from '../../lib/forms';
import { useCreateUser, useSetUserPassword, useUpdateUser } from './api';

/*
 * Each dialog renders its form as a separate component inside DialogContent. Radix unmounts the
 * content when the dialog closes, so every open starts with fresh form state (no reset effects).
 */

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert tone="danger">
      <CircleX aria-hidden="true" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function CreateUserForm({ roles, onDone }: { roles: RoleInfo[]; onDone: () => void }) {
  const create = useCreateUser();
  const [formError, setFormError] = useState<string | null>(null);
  const defaultRole = roles.find((role) => role.key === 'viewer')?.id ?? roles[0]?.id ?? '';
  const form = useForm<
    z.input<typeof createUserSchema>,
    unknown,
    z.output<typeof createUserSchema>
  >({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: '', displayName: '', password: '', roleId: defaultRole },
  });

  const submit = form.handleSubmit((values) => {
    setFormError(null);
    create.mutate(values, {
      onSuccess: (user) => {
        toast.success(`${user.displayName} was added.`);
        onDone();
      },
      onError: (error) => {
        setFormError(
          applyServerErrors(error, form.setError, ['email', 'displayName', 'password', 'roleId']),
        );
      },
    });
  });

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <FormError message={formError} />
      <Field label="Name" error={form.formState.errors.displayName?.message}>
        {(control) => <Input {...control} autoFocus {...form.register('displayName')} />}
      </Field>
      <Field label="Email" error={form.formState.errors.email?.message}>
        {(control) => (
          <Input {...control} type="email" autoComplete="off" {...form.register('email')} />
        )}
      </Field>
      <Field
        label="Initial password"
        description="At least 12 characters."
        error={form.formState.errors.password?.message}
      >
        {(control) => (
          <Input
            {...control}
            type="password"
            autoComplete="new-password"
            {...form.register('password')}
          />
        )}
      </Field>
      <Field label="Role" error={form.formState.errors.roleId?.message}>
        {(control) => (
          <NativeSelect {...control} {...form.register('roleId')}>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Add user
        </Button>
      </DialogFooter>
    </form>
  );
}

export function CreateUserDialog({
  open,
  onOpenChange,
  roles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: RoleInfo[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            Share the initial password with the user securely; they can change it from their
            profile.
          </DialogDescription>
        </DialogHeader>
        <CreateUserForm
          roles={roles}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

const editSchema = z.object({ displayName: displayNameSchema, roleId: z.string() });

function EditUserForm({
  user,
  roles,
  roleEditable,
  roleHint,
  onDone,
}: {
  user: UserSummary;
  roles: RoleInfo[];
  roleEditable: boolean;
  roleHint: string;
  onDone: () => void;
}) {
  const update = useUpdateUser();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof editSchema>, unknown, z.output<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    defaultValues: { displayName: user.displayName, roleId: user.role?.id ?? '' },
  });
  // The current role is always listed so the field shows the truth even if it is not assignable.
  const options =
    roles.some((role) => role.id === user.role?.id) || !user.role
      ? roles
      : [
          ...roles,
          {
            ...user.role,
            description: '',
            isSystem: true,
            grantsAll: false,
            capabilities: [],
            userCount: 0,
          },
        ];

  const submit = form.handleSubmit((values) => {
    setFormError(null);
    const input = {
      ...(values.displayName !== user.displayName ? { displayName: values.displayName } : {}),
      ...(roleEditable && values.roleId !== user.role?.id ? { roleId: values.roleId } : {}),
    };
    if (Object.keys(input).length === 0) {
      onDone();
      return;
    }
    update.mutate(
      { id: user.id, input },
      {
        onSuccess: () => {
          toast.success('Changes saved.');
          onDone();
        },
        onError: (error) => {
          setFormError(applyServerErrors(error, form.setError, ['displayName', 'roleId']));
        },
      },
    );
  });

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <FormError message={formError} />
      <Field label="Name" error={form.formState.errors.displayName?.message}>
        {(control) => <Input {...control} autoFocus {...form.register('displayName')} />}
      </Field>
      <Field label="Role" description={roleHint} error={form.formState.errors.roleId?.message}>
        {(control) => (
          <NativeSelect {...control} disabled={!roleEditable} {...form.register('roleId')}>
            {options.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Save changes
        </Button>
      </DialogFooter>
    </form>
  );
}

export function EditUserDialog({
  user,
  onOpenChange,
  roles,
  canAssignRoles,
  isSelf,
}: {
  user: UserSummary | null;
  onOpenChange: (open: boolean) => void;
  roles: RoleInfo[];
  canAssignRoles: boolean;
  isSelf: boolean;
}) {
  const roleEditable = canAssignRoles && !isSelf;
  const roleHint = isSelf
    ? 'You cannot change your own role.'
    : !canAssignRoles
      ? 'You do not have permission to change roles.'
      : 'Changing the role signs the user out everywhere.';
  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {user && (
          <>
            <DialogHeader>
              <DialogTitle>Edit {user.displayName}</DialogTitle>
              <DialogDescription>{user.email}</DialogDescription>
            </DialogHeader>
            <EditUserForm
              user={user}
              roles={roles}
              roleEditable={roleEditable}
              roleHint={roleHint}
              onDone={() => {
                onOpenChange(false);
              }}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const passwordSchema = z
  .object({ password: newPasswordSchema, confirm: z.string() })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match.',
  });

function SetPasswordForm({ user, onDone }: { user: UserSummary; onDone: () => void }) {
  const setPassword = useSetUserPassword();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const submit = form.handleSubmit((values) => {
    setPassword.mutate(
      { id: user.id, password: values.password },
      {
        onSuccess: () => {
          toast.success(`Password set for ${user.displayName}. They were signed out everywhere.`);
          onDone();
        },
        onError: (error) => {
          setFormError(applyServerErrors(error, form.setError, ['password']));
        },
      },
    );
  });

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <FormError message={formError} />
      <Field label="New password" error={form.formState.errors.password?.message}>
        {(control) => (
          <Input
            {...control}
            type="password"
            autoComplete="new-password"
            autoFocus
            {...form.register('password')}
          />
        )}
      </Field>
      <Field label="Confirm password" error={form.formState.errors.confirm?.message}>
        {(control) => (
          <Input
            {...control}
            type="password"
            autoComplete="new-password"
            {...form.register('confirm')}
          />
        )}
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={setPassword.isPending}>
          {setPassword.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Set password
        </Button>
      </DialogFooter>
    </form>
  );
}

export function SetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: UserSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {user && (
          <>
            <DialogHeader>
              <DialogTitle>Set password</DialogTitle>
              <DialogDescription>
                Set a new password for {user.displayName}. They will be signed out of every session.
              </DialogDescription>
            </DialogHeader>
            <SetPasswordForm
              user={user}
              onDone={() => {
                onOpenChange(false);
              }}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
