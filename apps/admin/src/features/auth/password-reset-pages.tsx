import { zodResolver } from '@hookform/resolvers/zod';
import {
  messageResponseSchema,
  newPasswordSchema,
  passwordResetRequestSchema,
} from '@nexora/shared';
import { Alert, AlertDescription, AlertTitle, Button, Field, Input } from '@nexora/ui';
import { useMutation } from '@tanstack/react-query';
import { CircleCheck, CircleX, Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { usePageTitle } from '../../components/use-page-title';
import { AuthLayout } from '../../layouts/auth-layout';
import { apiSend } from '../../lib/api-client';
import { applyServerErrors } from '../../lib/forms';

export function ForgotPasswordPage() {
  usePageTitle('Reset password');
  const form = useForm<z.input<typeof passwordResetRequestSchema>>({
    resolver: zodResolver(passwordResetRequestSchema),
    defaultValues: { email: '' },
  });
  const request = useMutation({
    mutationFn: (values: z.output<typeof passwordResetRequestSchema>) =>
      apiSend('POST', '/auth/password-reset/request', values, messageResponseSchema),
  });

  return (
    <AuthLayout
      title="Reset your password"
      description="We'll email you a link to choose a new password."
    >
      {request.isSuccess ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success">
            <CircleCheck aria-hidden="true" />
            <div>
              <AlertTitle>Check your email</AlertTitle>
              <AlertDescription>
                {request.data.message} The link expires in 30 minutes.
              </AlertDescription>
            </div>
          </Alert>
          <Link
            to="/login"
            className="text-center text-sm font-medium text-primary hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) =>
            void form.handleSubmit((values) => {
              request.mutate(passwordResetRequestSchema.parse(values));
            })(event)
          }
        >
          {request.isError && (
            <Alert tone="danger">
              <CircleX aria-hidden="true" />
              <AlertDescription>{request.error.message}</AlertDescription>
            </Alert>
          )}
          <Field label="Email" error={form.formState.errors.email?.message}>
            {(control) => (
              <Input
                {...control}
                type="email"
                autoComplete="email"
                autoFocus
                {...form.register('email')}
              />
            )}
          </Field>
          <Button type="submit" disabled={request.isPending}>
            {request.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Send reset link
          </Button>
          <Link
            to="/login"
            className="text-center text-sm font-medium text-primary hover:underline"
          >
            Back to sign in
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}

const resetFormSchema = z
  .object({ password: newPasswordSchema, confirm: z.string() })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match.',
  });
type ResetForm = z.infer<typeof resetFormSchema>;

export function ResetPasswordPage() {
  usePageTitle('Choose a new password');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const form = useForm<ResetForm>({
    resolver: zodResolver(resetFormSchema),
    defaultValues: { password: '', confirm: '' },
  });
  const confirm = useMutation({
    mutationFn: (password: string) =>
      apiSend('POST', '/auth/password-reset/confirm', { token, password }, null),
    onError: (error) => {
      applyServerErrors(error, form.setError, ['password']);
    },
  });

  if (token.length < 20) {
    return (
      <AuthLayout title="Invalid link">
        <div className="flex flex-col gap-4">
          <Alert tone="danger">
            <CircleX aria-hidden="true" />
            <AlertDescription>
              This password reset link is incomplete. Request a new one.
            </AlertDescription>
          </Alert>
          <Link
            to="/forgot-password"
            className="text-center text-sm font-medium text-primary hover:underline"
          >
            Request a new link
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Choose a new password"
      description="Use at least 12 characters. A memorable phrase works well."
    >
      {confirm.isSuccess ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success">
            <CircleCheck aria-hidden="true" />
            <div>
              <AlertTitle>Password changed</AlertTitle>
              <AlertDescription>
                You have been signed out everywhere. Sign in with your new password.
              </AlertDescription>
            </div>
          </Alert>
          <Button asChild>
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) =>
            void form.handleSubmit((values) => {
              confirm.mutate(values.password);
            })(event)
          }
        >
          {confirm.isError && confirm.error.message && !form.formState.errors.password && (
            <Alert tone="danger">
              <CircleX aria-hidden="true" />
              <AlertDescription>
                {confirm.error.message}{' '}
                <Link to="/forgot-password" className="font-medium underline">
                  Request a new link
                </Link>
              </AlertDescription>
            </Alert>
          )}
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
          <Button type="submit" disabled={confirm.isPending}>
            {confirm.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Change password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
