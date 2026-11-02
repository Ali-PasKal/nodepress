import type { BundledPlugin, PluginSummary } from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Skeleton,
} from '@nexora/ui';
import { Loader2, Puzzle, ShieldCheck, Upload } from 'lucide-react';
import { useState, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '../../components/page-header';
import { ApiError } from '../../lib/api-client';
import { errorMessage } from '../../lib/forms';
import { useDeactivatePlugin, useInstallBundled, usePlugins, useUploadPlugin } from './api';
import { ActivateDialog, PluginStatusBadge } from './plugin-parts';

function UploadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const upload = useUploadPlugin();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!file) return;
    setProblems([]);
    upload.mutate(file, {
      onSuccess: (plugin) => {
        toast.success(
          `${plugin.name} ${plugin.version} is installed. Review it before activating.`,
        );
        onOpenChange(false);
        void navigate(`/plugins/${plugin.id}`);
      },
      onError: (error) => {
        setProblems([
          errorMessage(error),
          ...(error instanceof ApiError
            ? error.issues.map((issue) => `${issue.path || 'manifest'}: ${issue.message}`)
            : []),
        ]);
      },
    });
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setProblems([]);
        setFile(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Upload a plugin</DialogTitle>
            <DialogDescription>
              A .zip package with a nexora-plugin.json manifest (at most 2 MB). Uploading installs
              the plugin without running it; you review its permissions before activating it.
              Uploading a newer version updates an installed plugin.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Plugin package
            <input
              type="file"
              accept=".zip,application/zip"
              className="text-sm"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
              }}
            />
          </label>
          {problems.length > 0 ? (
            <Alert tone="danger">
              <AlertDescription>
                <ul>
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!file || upload.isPending}>
              {upload.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Upload
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InstalledPlugin({ plugin }: { plugin: PluginSummary }) {
  const deactivate = useDeactivatePlugin();
  const [activating, setActivating] = useState(false);
  return (
    <li>
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/plugins/${plugin.id}`} className="font-semibold hover:underline">
                {plugin.name}
              </Link>
              <span className="text-xs text-muted-foreground">{plugin.version}</span>
              <PluginStatusBadge plugin={plugin} />
              {plugin.source === 'bundled' ? <Badge tone="info">NEXORA</Badge> : null}
            </div>
            {plugin.description ? (
              <p className="mt-1 text-sm text-muted-foreground">{plugin.description}</p>
            ) : null}
            {plugin.error ? <p className="mt-1 text-sm text-danger">{plugin.error}</p> : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to={`/plugins/${plugin.id}`}>Details</Link>
            </Button>
            {plugin.status === 'active' ? (
              <Button
                variant="outline"
                size="sm"
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
              <Button
                size="sm"
                onClick={() => {
                  setActivating(true);
                }}
              >
                {plugin.needsApproval ? 'Review and activate' : 'Activate'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <ActivateDialog plugin={plugin} open={activating} onOpenChange={setActivating} />
    </li>
  );
}

function BundledRow({ plugin }: { plugin: BundledPlugin }) {
  const install = useInstallBundled();
  const upToDate = plugin.installedVersion === plugin.version;
  return (
    <li className="flex flex-col gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {plugin.name} <span className="text-xs text-muted-foreground">{plugin.version}</span>
        </p>
        <p className="text-sm text-muted-foreground">{plugin.description}</p>
      </div>
      {upToDate ? (
        <Badge>Installed</Badge>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={install.isPending}
          aria-label={`${plugin.installedVersion ? 'Update' : 'Install'} ${plugin.name}`}
          onClick={() => {
            install.mutate(plugin.id, {
              onSuccess: (installed) =>
                toast.success(
                  installed.status === 'active'
                    ? `${installed.name} is updated.`
                    : `${installed.name} is installed. Review it before activating.`,
                ),
              onError: (error) => toast.error(errorMessage(error)),
            });
          }}
        >
          {install.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {plugin.installedVersion ? `Update to ${plugin.version}` : 'Install'}
        </Button>
      )}
    </li>
  );
}

/** Installed plugins, first-party plugins that can be installed, and uploads. */
export function PluginsPage() {
  const plugins = usePlugins();
  const [uploading, setUploading] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Plugins"
        description="Add shortcodes and integrations. Plugins run in a sandbox and can only do what you allow."
        actions={
          <Button
            onClick={() => {
              setUploading(true);
            }}
          >
            <Upload aria-hidden="true" /> Upload plugin
          </Button>
        }
      />
      <Alert tone="info">
        <ShieldCheck aria-hidden="true" />
        <AlertDescription>
          Each plugin runs in its own isolated process with no access to the database, files or
          other plugins. Only install plugins from sources you trust: within the permissions you
          grant, a plugin can show content on your site and send requests to the listed hosts.
        </AlertDescription>
      </Alert>
      {plugins.isPending ? (
        <Skeleton className="h-40" />
      ) : plugins.isError ? (
        <Alert tone="danger">
          <AlertDescription>{errorMessage(plugins.error)}</AlertDescription>
        </Alert>
      ) : (
        <>
          <section aria-labelledby="installed-plugins" className="flex flex-col gap-3">
            <h2 id="installed-plugins" className="text-lg font-semibold">
              Installed
            </h2>
            {plugins.data.plugins.length === 0 ? (
              <EmptyState
                title="No plugins installed"
                description="Install one of NEXORA's plugins below or upload a package."
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {plugins.data.plugins.map((plugin) => (
                  <InstalledPlugin key={plugin.id} plugin={plugin} />
                ))}
              </ul>
            )}
          </section>
          {plugins.data.bundled.length > 0 ? (
            <section aria-labelledby="bundled-plugins" className="flex flex-col gap-2">
              <h2 id="bundled-plugins" className="flex items-center gap-2 text-lg font-semibold">
                <Puzzle aria-hidden="true" className="size-5" /> Plugins from NEXORA
              </h2>
              <Card>
                <CardContent className="px-4 py-1">
                  <ul>
                    {plugins.data.bundled.map((plugin) => (
                      <BundledRow key={plugin.id} plugin={plugin} />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </section>
          ) : null}
        </>
      )}
      <UploadDialog open={uploading} onOpenChange={setUploading} />
    </div>
  );
}
