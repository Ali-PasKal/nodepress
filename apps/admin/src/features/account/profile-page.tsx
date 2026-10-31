import { zodResolver } from '@hookform/resolvers/zod';
import {
  authUserSchema,
  newPasswordSchema,
  sessionResponseSchema,
  sessionSummarySchema,
  updateProfileSchema,
} from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Field,
  Input,
  Skeleton,
} from '@nexora/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleX, Loader2, LogOut, Monitor } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { PageHeader } from '../../components/page-header';
import { apiGet, apiSend } from '../../lib/api-client';
import { applyServerErrors, errorMessage } from '../../lib/forms';
import { describeUserAgent, formatDateTime } from '../../lib/format';
import { sessionQueryKey, useSession, useStoreSession } from '../auth/session';

const sessionsKey = ['account', 'sessions'] as const;

function ProfileCard() {
  const session = useSession();
  const queryClient = useQueryClient();
  const user = session.data?.authenticated ? session.data.user : null;
  const form = useForm<z.input<typeof updateProfileSchema>>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { displayName: user?.displayName ?? '' },
  });
  useEffect(() => {
    if (user) form.reset({ displayName: user.displayName });
  }, [user, form]);
  const save = useMutation({
    mutationFn: (values: z.input<typeof updateProfileSchema>) =>
      apiSend('PATCH', '/account/profile', values, authUserSchema),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
      toast.success('Profile updated.');
    },
    onError: (error) => {
      const message = applyServerErrors(error, form.setError, ['displayName']);
      if (message) toast.error(message);
    },
  });
  if (!user) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your name as shown to other users.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) =>
            void form.handleSubmit((values) => {
              save.mutate(values);
            })(event)
          }
        >
          <Field label="Name" error={form.formState.errors.displayName?.message}>
            {(control) => (
              <Input {...control} autoComplete="name" {...form.register('displayName')} />
            )}
          </Field>
          <Field label="Email" description="Ask an administrator to change your email address.">
            {(control) => <Input {...control} value={user.email} readOnly disabled />}
          </Field>
          <div>
            <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
              {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Save profile
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

const passwordFormSchema = z
  .object({
    currentPassword: z.string().min(1, { message: 'Current password is required.' }),
    newPassword: newPasswordSchema,
    confirm: z.string(),
  })
  .refine((values) => values.newPassword === values.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match.',
  });
type PasswordForm = z.infer<typeof passwordFormSchema>;

function PasswordCard() {
  const store = useStoreSession();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<PasswordForm>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  const change = useMutation({
    mutationFn: (values: PasswordForm) =>
      apiSend(
        'POST',
        '/account/password',
        { currentPassword: values.currentPassword, newPassword: values.newPassword },
        sessionResponseSchema,
      ),
    onSuccess: (session) => {
      store(session);
      void queryClient.invalidateQueries({ queryKey: sessionsKey });
      form.reset();
      setFormError(null);
      toast.success('Password changed. Your other sessions were signed out.');
    },
    onError: (error) => {
      setFormError(applyServerErrors(error, form.setError, ['currentPassword', 'newPassword']));
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>
          Changing your password signs you out on every other device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) =>
            void form.handleSubmit((values) => {
              change.mutate(values);
            })(event)
          }
        >
          {formError && (
            <Alert tone="danger">
              <CircleX aria-hidden="true" />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <Field label="Current password" error={form.formState.errors.currentPassword?.message}>
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="current-password"
                {...form.register('currentPassword')}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="New password"
              description="At least 12 characters."
              error={form.formState.errors.newPassword?.message}
            >
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  autoComplete="new-password"
                  {...form.register('newPassword')}
                />
              )}
            </Field>
            <Field label="Confirm new password" error={form.formState.errors.confirm?.message}>
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  autoComplete="new-password"
                  {...form.register('confirm')}
                />
              )}
            </Field>
          </div>
          <div>
            <Button type="submit" disabled={change.isPending}>
              {change.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Change password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: sessionsKey,
    queryFn: ({ signal }) => apiGet('/account/sessions', z.array(sessionSummarySchema), { signal }),
  });
  const [confirmOthers, setConfirmOthers] = useState(false);
  const revoke = useMutation({
    mutationFn: (id: string) => apiSend('DELETE', `/account/sessions/${id}`, undefined, null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionsKey });
      toast.success('Session signed out.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const revokeOthers = useMutation({
    mutationFn: () =>
      apiSend(
        'POST',
        '/account/sessions/revoke-others',
        undefined,
        z.object({ revoked: z.number() }),
      ),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: sessionsKey });
      toast.success(`Signed out ${String(result.revoked)} other session(s).`);
      setConfirmOthers(false);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setConfirmOthers(false);
    },
  });
  const others = sessions.data?.filter((session) => !session.current).length ?? 0;

  return (
    <Card>
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>Devices where you are signed in.</CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={others === 0}
          onClick={() => {
            setConfirmOthers(true);
          }}
        >
          <LogOut aria-hidden="true" /> Sign out other sessions
        </Button>
      </CardHeader>
      <CardContent>
        {sessions.isPending ? (
          <Skeleton className="h-16" />
        ) : sessions.isError ? (
          <Alert tone="danger">
            <CircleX aria-hidden="true" />
            <AlertDescription>{errorMessage(sessions.error)}</AlertDescription>
          </Alert>
        ) : (
          <ul className="flex flex-col divide-y">
            {sessions.data.map((session) => (
              <li
                key={session.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                data-testid="session-item"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Monitor
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {describeUserAgent(session.userAgent)}{' '}
                      {session.current && <Badge tone="success">This device</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {session.ipAddress ?? 'Unknown address'} · last active{' '}
                      {formatDateTime(session.lastSeenAt)}
                    </p>
                  </div>
                </div>
                {!session.current && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => {
                      revoke.mutate(session.id);
                    }}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmOthers}
        onOpenChange={setConfirmOthers}
        title="Sign out other sessions?"
        description="Every session except this one ends immediately."
        confirmLabel="Sign out others"
        destructive
        pending={revokeOthers.isPending}
        onConfirm={() => {
          revokeOthers.mutate();
        }}
      />
    </Card>
  );
}

export function ProfilePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Your profile"
        description="Manage your account details, password and sessions."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileCard />
        <PasswordCard />
      </div>
      <SessionsCard />
    </div>
  );
}
