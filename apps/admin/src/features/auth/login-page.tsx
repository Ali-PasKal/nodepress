import { zodResolver } from '@hookform/resolvers/zod';
import { loginRequestSchema, type LoginRequest } from '@nexora/shared';
import { Alert, AlertDescription, Button, Field, Input } from '@nexora/ui';
import { CircleX, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { usePageTitle } from '../../components/use-page-title';
import { AuthLayout } from '../../layouts/auth-layout';
import { errorMessage } from '../../lib/forms';
import { useSystemStatus } from '../system/api';
import { safeNextPath, useLogin, useSession } from './session';

export function LoginPage() {
  usePageTitle('Sign in');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const session = useSession();
  const status = useSystemStatus();
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });
  const next = safeNextPath(params.get('next'));

  useEffect(() => {
    if (session.data?.authenticated) {
      void navigate(next, { replace: true });
    }
  }, [session.data, navigate, next]);

  if (status.data && !status.data.installed) {
    return <Navigate to="/setup" replace />;
  }

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    login.mutate(values, {
      onSuccess: () => {
        void navigate(next, { replace: true });
      },
      onError: (error) => {
        setFormError(errorMessage(error));
        form.resetField('password');
      },
    });
  });

  return (
    <AuthLayout title="Sign in" description="Use your NEXORA account to manage this site.">
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
        {params.get('reason') === 'expired' && !formError && (
          <Alert tone="info">
            <AlertDescription>Your session has ended. Sign in again to continue.</AlertDescription>
          </Alert>
        )}
        {formError && (
          <Alert tone="danger">
            <CircleX aria-hidden="true" />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <Field label="Email" error={form.formState.errors.email?.message}>
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="username"
              autoFocus
              {...form.register('email')}
            />
          )}
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="current-password"
              {...form.register('password')}
            />
          )}
        </Field>
        <Button type="submit" disabled={login.isPending} className="mt-1">
          {login.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Sign in
        </Button>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="font-medium text-primary hover:underline">
            Forgot your password?
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
