import type { PluginDetail, PluginSettingDefinition, PluginSettingValue } from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmDialog,
  Field,
  Input,
  Label,
  NativeSelect,
  Skeleton,
  Textarea,
} from '@nexora/ui';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '../../components/page-header';
import { ApiError } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import { errorMessage } from '../../lib/forms';
import { NotFoundPage } from '../../routes/not-found-page';
import {
  useDeactivatePlugin,
  usePlugin,
  usePluginLogs,
  useUninstallPlugin,
  useUpdatePluginSettings,
} from './api';
import { ActivateDialog, PermissionList, PluginStatusBadge } from './plugin-parts';

type Draft = Record<string, string | boolean>;

function initialDraft(plugin: PluginDetail): Draft {
  const draft: Draft = {};
  for (const setting of plugin.settingDefinitions) {
    const value = plugin.settings[setting.key];
    if (setting.type === 'boolean') draft[setting.key] = value === true;
    else if (setting.type === 'secret') draft[setting.key] = '';
    else draft[setting.key] = value === null || value === undefined ? '' : String(value);
  }
  return draft;
}

function SettingInput({
  setting,
  value,
  isSet,
  cleared,
  error,
  onChange,
  onClear,
}: {
  setting: PluginSettingDefinition;
  value: string | boolean;
  isSet: boolean;
  cleared: boolean;
  error: string | undefined;
  onChange: (value: string | boolean) => void;
  onClear: (clear: boolean) => void;
}) {
  if (setting.type === 'boolean') {
    return (
      <div className="flex flex-col gap-1">
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox
            checked={value === true}
            onChange={(event) => {
              onChange(event.target.checked);
            }}
          />
          {setting.label}
        </Label>
        {setting.description ? (
          <p className="text-xs text-muted-foreground">{setting.description}</p>
        ) : null}
      </div>
    );
  }
  const description =
    setting.type === 'secret'
      ? `${setting.description ? `${setting.description} ` : ''}${
          isSet && !cleared ? 'A value is saved; type a new one to replace it.' : 'Not set.'
        }`
      : setting.description || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Field label={setting.label} description={description} error={error}>
        {(control) => {
          switch (setting.type) {
            case 'text':
              return setting.multiline ? (
                <Textarea
                  {...control}
                  value={String(value)}
                  maxLength={setting.maxLength}
                  rows={4}
                  onChange={(event) => {
                    onChange(event.target.value);
                  }}
                />
              ) : (
                <Input
                  {...control}
                  value={String(value)}
                  maxLength={setting.maxLength}
                  onChange={(event) => {
                    onChange(event.target.value);
                  }}
                />
              );
            case 'number':
              return (
                <Input
                  {...control}
                  type="number"
                  value={String(value)}
                  min={setting.min}
                  max={setting.max}
                  step={setting.integer ? 1 : 'any'}
                  onChange={(event) => {
                    onChange(event.target.value);
                  }}
                />
              );
            case 'select':
              return (
                <NativeSelect
                  {...control}
                  value={String(value)}
                  onChange={(event) => {
                    onChange(event.target.value);
                  }}
                >
                  {setting.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              );
            case 'secret':
              return (
                <Input
                  {...control}
                  type="password"
                  autoComplete="off"
                  value={String(value)}
                  maxLength={setting.maxLength}
                  placeholder={isSet && !cleared ? '••••••••' : ''}
                  onChange={(event) => {
                    onChange(event.target.value);
                  }}
                />
              );
          }
        }}
      </Field>
      {setting.type === 'secret' && isSet ? (
        <Label className="flex items-center gap-2 text-xs font-normal">
          <Checkbox
            checked={cleared}
            onChange={(event) => {
              onClear(event.target.checked);
            }}
          />
          Remove the saved value
        </Label>
      ) : null}
    </div>
  );
}

function SettingsForm({ plugin }: { plugin: PluginDetail }) {
  const save = useUpdatePluginSettings();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(plugin));
  const [cleared, setCleared] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const values: Record<string, PluginSettingValue> = {};
    for (const setting of plugin.settingDefinitions) {
      const value = draft[setting.key];
      if (setting.type === 'secret') {
        // Secrets are only sent when replaced or removed.
        if (cleared[setting.key]) values[setting.key] = null;
        else if (typeof value === 'string' && value !== '') values[setting.key] = value;
      } else if (setting.type === 'number') {
        values[setting.key] = Number(value);
      } else {
        values[setting.key] = value ?? '';
      }
    }
    setErrors({});
    save.mutate(
      { key: plugin.id, values },
      {
        onSuccess: (saved) => {
          setDraft(initialDraft(saved));
          setCleared({});
          toast.success('Plugin settings saved.');
        },
        onError: (error) => {
          if (error instanceof ApiError && error.issues.length > 0) {
            setErrors(Object.fromEntries(error.issues.map((issue) => [issue.path, issue.message])));
          }
          toast.error(errorMessage(error));
        },
      },
    );
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Plugin settings">
      {plugin.settingDefinitions.map((setting) => (
        <SettingInput
          key={setting.key}
          setting={setting}
          value={draft[setting.key] ?? ''}
          isSet={plugin.settings[setting.key] === true}
          cleared={cleared[setting.key] === true}
          error={errors[setting.key]}
          onChange={(value) => {
            setDraft((current) => ({ ...current, [setting.key]: value }));
          }}
          onClear={(clear) => {
            setCleared((current) => ({ ...current, [setting.key]: clear }));
          }}
        />
      ))}
      <div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Save settings
        </Button>
      </div>
    </form>
  );
}

function Logs({ pluginKey }: { pluginKey: string }) {
  const logs = usePluginLogs(pluginKey);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Recent log</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void logs.refetch();
          }}
          disabled={logs.isFetching}
        >
          <RefreshCw aria-hidden="true" className={logs.isFetching ? 'animate-spin' : undefined} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {logs.isPending ? (
          <Skeleton className="h-20" />
        ) : logs.isError ? (
          <p className="text-sm text-danger">{errorMessage(logs.error)}</p>
        ) : logs.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing logged yet.</p>
        ) : (
          <ol
            className="flex max-h-80 flex-col gap-1 overflow-y-auto font-mono text-xs"
            aria-label="Log lines"
          >
            {logs.data.items.map((line) => (
              <li key={line.id} className="flex gap-2">
                <time className="shrink-0 text-muted-foreground" dateTime={line.createdAt}>
                  {formatDateTime(line.createdAt)}
                </time>
                <span
                  className={
                    line.level === 'error'
                      ? 'text-danger'
                      : line.level === 'warn'
                        ? 'text-warning'
                        : undefined
                  }
                >
                  {line.message}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function Detail({ plugin }: { plugin: PluginDetail }) {
  const deactivate = useDeactivatePlugin();
  const uninstall = useUninstallPlugin();
  const navigate = useNavigate();
  const [activating, setActivating] = useState(false);
  const [removing, setRemoving] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" className="self-start" asChild>
        <Link to="/plugins">
          <ArrowLeft aria-hidden="true" /> All plugins
        </Link>
      </Button>
      <PageHeader
        title={plugin.name}
        description={plugin.description || undefined}
        actions={
          <>
            {plugin.status === 'active' ? (
              <Button
                variant="outline"
                disabled={deactivate.isPending}
                onClick={() => {
                  deactivate.mutate(plugin.id, {
                    onSuccess: () => toast.success(`${plugin.name} is inactive.`),
                    onError: (error) => toast.error(errorMessage(error)),
                  });
                }}
              >
                Deactivate
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRemoving(true);
                  }}
                >
                  Uninstall
                </Button>
                <Button
                  onClick={() => {
                    setActivating(true);
                  }}
                >
                  {plugin.needsApproval ? 'Review and activate' : 'Activate'}
                </Button>
              </>
            )}
          </>
        }
      />
      {plugin.error ? (
        <Alert tone="danger">
          <AlertDescription>{plugin.error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">About</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <PluginStatusBadge plugin={plugin} />
              </dd>
              <dt className="text-muted-foreground">Version</dt>
              <dd>{plugin.version}</dd>
              <dt className="text-muted-foreground">Id</dt>
              <dd>
                <code className="text-xs">{plugin.id}</code>
              </dd>
              {plugin.author ? (
                <>
                  <dt className="text-muted-foreground">Author</dt>
                  <dd>{plugin.author}</dd>
                </>
              ) : null}
              {plugin.homepage ? (
                <>
                  <dt className="text-muted-foreground">Website</dt>
                  <dd className="break-all">
                    <a
                      href={plugin.homepage}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="underline"
                    >
                      {plugin.homepage}
                    </a>
                  </dd>
                </>
              ) : null}
              {plugin.license ? (
                <>
                  <dt className="text-muted-foreground">Licence</dt>
                  <dd>{plugin.license}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Source</dt>
              <dd>{plugin.source === 'bundled' ? 'Shipped with NEXORA' : 'Uploaded'}</dd>
              <dt className="text-muted-foreground">Installed</dt>
              <dd>{formatDateTime(plugin.installedAt)}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Permissions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <PermissionList plugin={plugin} />
            {plugin.needsApproval && plugin.status !== 'active' ? (
              <p className="text-sm text-warning">Activating grants these permissions.</p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Always available: its own settings, a private storage of up to 1 MB, and logging.
            </p>
          </CardContent>
        </Card>
      </div>
      {plugin.shortcodeDefinitions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shortcodes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {plugin.shortcodeDefinitions.map((shortcode) => (
                <li key={shortcode.name} className="text-sm">
                  <p>
                    <code className="rounded bg-muted px-1.5 py-0.5">
                      {shortcode.example || `[${shortcode.name}]`}
                    </code>{' '}
                    <span className="font-medium">{shortcode.label}</span>
                  </p>
                  {shortcode.description ? (
                    <p className="text-muted-foreground">{shortcode.description}</p>
                  ) : null}
                  {Object.keys(shortcode.attributes).length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Attributes:{' '}
                      {Object.entries(shortcode.attributes)
                        .map(([name, attribute]) => `${name} (${attribute.type})`)
                        .join(', ')}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      {plugin.hooks.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Reacts to:{' '}
          {plugin.hooks.map((hook) => (
            <Badge key={hook} className="me-1">
              {hook === 'entry.published' ? 'Entry published' : 'Entry unpublished'}
            </Badge>
          ))}
        </p>
      ) : null}
      {plugin.settingDefinitions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <SettingsForm key={plugin.id} plugin={plugin} />
          </CardContent>
        </Card>
      ) : null}
      <Logs pluginKey={plugin.id} />
      {plugin.readme ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Read me</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Shown as plain text: the README comes from the package and is not trusted markup. */}
            <pre className="font-sans text-sm whitespace-pre-wrap">{plugin.readme}</pre>
          </CardContent>
        </Card>
      ) : null}
      <ActivateDialog plugin={plugin} open={activating} onOpenChange={setActivating} />
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Uninstall ${plugin.name}?`}
        description="Its code, settings, stored data and log are deleted. Shortcodes it provided show as plain text."
        confirmLabel="Uninstall"
        destructive
        pending={uninstall.isPending}
        onConfirm={() => {
          uninstall.mutate(plugin.id, {
            onSuccess: () => {
              toast.success(`${plugin.name} is uninstalled.`);
              void navigate('/plugins');
            },
            onError: (error) => toast.error(errorMessage(error)),
          });
        }}
      />
    </div>
  );
}

/** One plugin: permissions, shortcodes, settings, log and README. */
export function PluginDetailPage() {
  const { key = '' } = useParams();
  const plugin = usePlugin(key);
  if (plugin.isPending) return <Skeleton className="h-96" role="status" aria-label="Loading" />;
  if (plugin.isError) {
    if (plugin.error instanceof ApiError && plugin.error.status === 404) return <NotFoundPage />;
    return (
      <Alert tone="danger">
        <AlertDescription>{errorMessage(plugin.error)}</AlertDescription>
      </Alert>
    );
  }
  return <Detail plugin={plugin.data} />;
}
