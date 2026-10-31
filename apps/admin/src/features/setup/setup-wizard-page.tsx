import { zodResolver } from '@hookform/resolvers/zod';
import { newPasswordSchema, setupInstallSchema, setupStatusResponseSchema } from '@nexora/shared';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Field, Input } from '@nexora/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, Loader2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch, type FieldPath } from 'react-hook-form';
import { Link, Navigate } from 'react-router';
import { z } from 'zod';
import { usePageTitle } from '../../components/use-page-title';
import { AuthLayout } from '../../layouts/auth-layout';
import { ApiError, apiGet, apiSend } from '../../lib/api-client';
import { errorMessage } from '../../lib/forms';
import { systemQueryKeys } from '../system/api';

const wizardSchema = z
  .object({
    siteName: z.string().trim().min(1, { message: 'Site name is required.' }).max(200),
    baseUrl: setupInstallSchema.shape.site.shape.baseUrl,
    displayName: setupInstallSchema.shape.admin.shape.displayName,
    email: setupInstallSchema.shape.admin.shape.email,
    password: newPasswordSchema,
    confirm: z.string(),
    setupToken: setupInstallSchema.shape.setupToken,
  })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match.',
  });
type WizardForm = z.input<typeof wizardSchema>;

const STEPS = [
  { id: 'checks', label: 'Environment' },
  { id: 'site', label: 'Site' },
  { id: 'admin', label: 'Administrator' },
  { id: 'install', label: 'Install' },
] as const;

const STEP_FIELDS: Record<(typeof STEPS)[number]['id'], FieldPath<WizardForm>[]> = {
  checks: [],
  site: ['siteName', 'baseUrl'],
  admin: ['displayName', 'email', 'password', 'confirm'],
  install: ['setupToken'],
};

const SERVER_FIELD: Record<string, FieldPath<WizardForm>> = {
  setupToken: 'setupToken',
  'site.name': 'siteName',
  'site.baseUrl': 'baseUrl',
  'admin.displayName': 'displayName',
  'admin.email': 'email',
  'admin.password': 'password',
};

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border p-3">
      {ok ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
      ) : (
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {label} <span className="sr-only">{ok ? '(passed)' : '(needs attention)'}</span>
        </p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </li>
  );
}

export function SetupWizardPage() {
  usePageTitle('Set up NEXORA');
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const status = useQuery({
    queryKey: ['setup', 'status'],
    queryFn: ({ signal }) => apiGet('/setup/status', setupStatusResponseSchema, { signal }),
  });
  const form = useForm<WizardForm>({
    resolver: zodResolver(wizardSchema),
    mode: 'onTouched',
    defaultValues: {
      siteName: '',
      baseUrl: window.location.origin,
      displayName: '',
      email: '',
      password: '',
      confirm: '',
      setupToken: '',
    },
  });
  const install = useMutation({
    mutationFn: (values: z.output<typeof wizardSchema>) =>
      apiSend(
        'POST',
        '/setup/install',
        {
          setupToken: values.setupToken,
          site: { name: values.siteName, baseUrl: values.baseUrl },
          admin: {
            displayName: values.displayName,
            email: values.email,
            password: values.password,
          },
        },
        z.object({ installed: z.literal(true) }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systemQueryKeys.status });
    },
  });
  const [installError, setInstallError] = useState<string | null>(null);
  const values = useWatch({ control: form.control });

  if (status.isPending) {
    return (
      <AuthLayout title="Set up NEXORA" wide>
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Checking the environment…
        </p>
      </AuthLayout>
    );
  }
  if (status.isError) {
    return (
      <AuthLayout title="Set up NEXORA" wide>
        <Alert tone="danger">
          <CircleX aria-hidden="true" />
          <div className="flex flex-col gap-2">
            <AlertTitle>Cannot reach the API</AlertTitle>
            <AlertDescription>Start the API server, then retry.</AlertDescription>
            <div>
              <Button variant="outline" size="sm" onClick={() => void status.refetch()}>
                Retry
              </Button>
            </div>
          </div>
        </Alert>
      </AuthLayout>
    );
  }
  if (install.isSuccess) {
    return (
      <AuthLayout title="NEXORA is installed" wide>
        <div className="flex flex-col gap-4">
          <Alert tone="success">
            <CircleCheck aria-hidden="true" />
            <div>
              <AlertTitle>Setup complete</AlertTitle>
              <AlertDescription>
                The site and your administrator account were created. The setup wizard is now
                permanently disabled.
              </AlertDescription>
            </div>
          </Alert>
          <Button asChild>
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }
  if (status.data.installed) {
    return <Navigate to="/login" replace />;
  }

  const { checks, security } = status.data;
  const environmentOk = checks.database === 'up' && checks.migrations === 'up';
  const current = STEPS[step] ?? STEPS[0];

  const next = async () => {
    if (await form.trigger(STEP_FIELDS[current.id])) {
      setStep((value) => Math.min(value + 1, STEPS.length - 1));
    }
  };

  const submit = form.handleSubmit((values) => {
    setInstallError(null);
    install.mutate(wizardSchema.parse(values), {
      onError: (error) => {
        const issues = error instanceof ApiError ? error.issues : [];
        for (const issue of issues) {
          const field = SERVER_FIELD[issue.path];
          if (field) form.setError(field, { type: 'server', message: issue.message });
        }
        setInstallError(issues.length > 0 ? 'Some details need attention.' : errorMessage(error));
        // Take the user back to the step that holds the first invalid field.
        if (issues.some((issue) => issue.path.startsWith('site.'))) setStep(1);
        else if (issues.some((issue) => issue.path.startsWith('admin.'))) setStep(2);
      },
    });
  });

  return (
    <AuthLayout
      title="Set up NEXORA"
      description="Create your site and the first administrator account."
      wide
    >
      <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Setup progress">
        {STEPS.map((item, index) => (
          <li
            key={item.id}
            className="flex flex-col gap-1.5"
            aria-current={index === step ? 'step' : undefined}
          >
            <span
              className={`h-1.5 rounded-full ${index <= step ? 'bg-primary' : 'bg-muted'}`}
              aria-hidden="true"
            />
            <span
              className={`text-xs ${index === step ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
            >
              {index + 1}. {item.label}
            </span>
          </li>
        ))}
      </ol>

      <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
        <h2 className="text-base font-semibold">{current.label}</h2>

        {current.id === 'checks' && (
          <ul className="flex flex-col gap-2">
            <Check
              ok={checks.database === 'up'}
              label="Database connection"
              detail={
                checks.database === 'up'
                  ? 'PostgreSQL is reachable.'
                  : 'The database is unreachable.'
              }
            />
            <Check
              ok={checks.migrations === 'up'}
              label="Database schema"
              detail={
                checks.migrations === 'up'
                  ? 'All migrations are applied.'
                  : 'Run "pnpm nexora migrate deploy", then reload.'
              }
            />
            <Check
              ok={security.secureCookies}
              label="Secure session cookies"
              detail={
                security.secureCookies
                  ? 'Session cookies require HTTPS.'
                  : security.environment === 'production'
                    ? 'Enable SESSION_COOKIE_SECURE and serve the site over HTTPS.'
                    : 'Off in development (plain HTTP). Production requires HTTPS and enforces this.'
              }
            />
            <Check
              ok={security.httpsRequest || security.environment !== 'production'}
              label="HTTPS"
              detail={
                security.httpsRequest
                  ? 'This connection uses HTTPS.'
                  : 'This connection is not using HTTPS. Use HTTPS for any non-local deployment.'
              }
            />
          </ul>
        )}

        {current.id === 'site' && (
          <div className="grid gap-4">
            <Field label="Site name" error={form.formState.errors.siteName?.message}>
              {(control) => <Input {...control} autoFocus {...form.register('siteName')} />}
            </Field>
            <Field
              label="Public base URL"
              description="Used to build links in emails, e.g. https://www.example.com"
              error={form.formState.errors.baseUrl?.message}
            >
              {(control) => (
                <Input {...control} type="url" inputMode="url" {...form.register('baseUrl')} />
              )}
            </Field>
          </div>
        )}

        {current.id === 'admin' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Your name"
              error={form.formState.errors.displayName?.message}
              className="sm:col-span-2"
            >
              {(control) => (
                <Input
                  {...control}
                  autoComplete="name"
                  autoFocus
                  {...form.register('displayName')}
                />
              )}
            </Field>
            <Field
              label="Email"
              error={form.formState.errors.email?.message}
              className="sm:col-span-2"
            >
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  autoComplete="username"
                  {...form.register('email')}
                />
              )}
            </Field>
            <Field
              label="Password"
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
          </div>
        )}

        {current.id === 'install' && (
          <div className="flex flex-col gap-4">
            <dl className="grid gap-x-4 gap-y-2 rounded-lg border p-4 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-muted-foreground">Site</dt>
              <dd className="font-medium break-words">{values.siteName}</dd>
              <dt className="text-muted-foreground">Base URL</dt>
              <dd className="font-medium break-all">{values.baseUrl}</dd>
              <dt className="text-muted-foreground">Administrator</dt>
              <dd className="font-medium break-words">
                {values.displayName} &lt;{values.email}&gt;{' '}
                <Badge tone="info">Super Administrator</Badge>
              </dd>
            </dl>
            <Field
              label="Setup token"
              description="Printed in the API server log when it started (look for “setup token”). It proves you operate this server."
              error={form.formState.errors.setupToken?.message}
            >
              {(control) => (
                <Input
                  {...control}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  autoFocus
                  {...form.register('setupToken')}
                />
              )}
            </Field>
            {installError && (
              <Alert tone="danger">
                <CircleX aria-hidden="true" />
                <AlertDescription>{installError}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            onClick={() => {
              setStep((value) => Math.max(value - 1, 0));
            }}
            disabled={step === 0 || install.isPending}
          >
            Back
          </Button>
          {current.id === 'install' ? (
            <Button type="submit" disabled={install.isPending}>
              {install.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Install NEXORA
            </Button>
          ) : (
            <Button
              onClick={() => void next()}
              disabled={current.id === 'checks' && !environmentOk}
            >
              Continue
            </Button>
          )}
        </div>
      </form>
    </AuthLayout>
  );
}
