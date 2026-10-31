import { zodResolver } from '@hookform/resolvers/zod';
import { siteSettingsSchema, updateSiteSettingsSchema } from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Skeleton,
} from '@nexora/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleX, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { PageHeader } from '../../components/page-header';
import { apiGet, apiSend } from '../../lib/api-client';
import { applyServerErrors, errorMessage } from '../../lib/forms';

const settingsKey = ['settings', 'site'] as const;
const formSchema = z.object({
  name: z.string().trim().min(1, { message: 'Site name is required.' }).max(200),
  baseUrl: z.string(),
});

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: ({ signal }) => apiGet('/settings/site', siteSettingsSchema, { signal }),
  });
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', baseUrl: '' },
  });
  useEffect(() => {
    if (settings.data) form.reset(settings.data);
  }, [settings.data, form]);
  const save = useMutation({
    mutationFn: (values: z.infer<typeof formSchema>) =>
      apiSend(
        'PATCH',
        '/settings/site',
        updateSiteSettingsSchema.parse(values),
        siteSettingsSchema,
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData(settingsKey, saved);
      toast.success('Settings saved.');
    },
    onError: (error) => {
      const message = applyServerErrors(error, form.setError, ['name', 'baseUrl']);
      if (message) toast.error(message);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Site-wide configuration." />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Site</CardTitle>
          <CardDescription>
            The public base URL is used to build links in emails such as password resets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settings.isPending ? (
            <Skeleton className="h-32" />
          ) : settings.isError ? (
            <Alert tone="danger">
              <CircleX aria-hidden="true" />
              <AlertDescription>{errorMessage(settings.error)}</AlertDescription>
            </Alert>
          ) : (
            <form
              noValidate
              className="flex flex-col gap-4"
              onSubmit={(event) =>
                void form.handleSubmit((values) => {
                  const parsed = updateSiteSettingsSchema.safeParse(values);
                  if (!parsed.success) {
                    for (const issue of parsed.error.issues) {
                      const field = issue.path[0];
                      if (field === 'name' || field === 'baseUrl')
                        form.setError(field, { message: issue.message });
                    }
                    return;
                  }
                  save.mutate(values);
                })(event)
              }
            >
              <Field label="Site name" error={form.formState.errors.name?.message}>
                {(control) => <Input {...control} {...form.register('name')} />}
              </Field>
              <Field label="Public base URL" error={form.formState.errors.baseUrl?.message}>
                {(control) => (
                  <Input {...control} type="url" inputMode="url" {...form.register('baseUrl')} />
                )}
              </Field>
              <div>
                <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
                  {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
                  Save settings
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
