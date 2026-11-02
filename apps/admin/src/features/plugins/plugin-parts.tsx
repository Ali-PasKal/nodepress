import { PLUGIN_PERMISSION_INFO, type PluginSummary } from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nexora/ui';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../lib/forms';
import { useActivatePlugin } from './api';

/** Status as administrators need it: active, inactive, failed, or waiting for a permission review. */
export function PluginStatusBadge({ plugin }: { plugin: PluginSummary }) {
  if (plugin.status === 'active') return <Badge tone="success">Active</Badge>;
  if (plugin.status === 'failed') return <Badge tone="danger">Failed</Badge>;
  if (plugin.needsApproval && plugin.grantedPermissions.length + plugin.grantedHosts.length > 0) {
    return <Badge tone="warning">Needs review</Badge>;
  }
  return <Badge>Inactive</Badge>;
}

/** Plain-language list of what a plugin asks for. */
export function PermissionList({
  plugin,
}: {
  plugin: Pick<PluginSummary, 'permissions' | 'hosts'>;
}) {
  if (plugin.permissions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No permissions: the plugin can only use its own settings and storage.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {plugin.permissions.map((permission) => (
        <li key={permission} className="text-sm">
          <p className="font-medium">{PLUGIN_PERMISSION_INFO[permission].label}</p>
          <p className="text-muted-foreground">{PLUGIN_PERMISSION_INFO[permission].description}</p>
          {permission === 'http:fetch' ? (
            <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Allowed hosts">
              {plugin.hosts.map((host) => (
                <li key={host}>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{host}</code>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Activation: the administrator sees exactly what the plugin asks for and grants all of it (or nothing).
 * The request repeats the permissions shown, so a plugin updated meanwhile cannot slip in more.
 */
export function ActivateDialog({
  plugin,
  open,
  onOpenChange,
}: {
  plugin: PluginSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const activate = useActivatePlugin();
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Activate {plugin.name}?</DialogTitle>
          <DialogDescription>
            Version {plugin.version}
            {plugin.author ? ` by ${plugin.author}` : ''}. Review what it asks for.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <PermissionList plugin={plugin} />
          <Alert tone="info">
            <ShieldCheck aria-hidden="true" />
            <AlertDescription>
              Plugins run in an isolated sandbox. They cannot read the database, files, users or
              settings, and cannot reach the network except through the permissions above.
            </AlertDescription>
          </Alert>
          {error ? (
            <Alert tone="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={activate.isPending}
            onClick={() => {
              setError(null);
              activate.mutate(
                {
                  key: plugin.id,
                  input: { permissions: [...plugin.permissions], hosts: [...plugin.hosts] },
                },
                {
                  onSuccess: () => {
                    toast.success(`${plugin.name} is active.`);
                    onOpenChange(false);
                  },
                  onError: (failure) => {
                    setError(errorMessage(failure));
                  },
                },
              );
            }}
          >
            {activate.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {plugin.permissions.length > 0 ? 'Grant and activate' : 'Activate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
