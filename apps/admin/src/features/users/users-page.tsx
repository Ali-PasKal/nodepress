import type { UserSummary } from '@nexora/shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  NativeSelect,
  Pagination,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@nexora/ui';
import {
  CircleX,
  KeyRound,
  LogOut,
  MoreHorizontal,
  Pencil,
  Search,
  UserCheck,
  UserPlus,
  UserX,
} from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '../../components/page-header';
import { errorMessage } from '../../lib/forms';
import { formatDateTime } from '../../lib/format';
import { useCapabilities, useSession } from '../auth/session';
import { useRevokeUserSessions, useRoles, useUpdateUser, useUsers, type UserFilters } from './api';
import { assignableRoles } from './assignable-roles';
import { CreateUserDialog, EditUserDialog, SetPasswordDialog } from './user-dialogs';

function RoleBadge({ user }: { user: UserSummary }) {
  return user.role ? <Badge tone="info">{user.role.name}</Badge> : <Badge>No role</Badge>;
}

function StatusBadge({ user }: { user: UserSummary }) {
  return (
    <Badge tone={user.status === 'active' ? 'success' : 'warning'}>
      {user.status === 'active' ? 'Active' : 'Suspended'}
    </Badge>
  );
}

type PendingAction = { kind: 'suspend' | 'reactivate' | 'revoke'; user: UserSummary } | null;

export function UsersPage() {
  const capabilities = useCapabilities();
  const session = useSession();
  const selfId = session.data?.authenticated ? session.data.user.id : null;
  const [filters, setFilters] = useState<UserFilters>({
    page: 1,
    search: '',
    status: '',
    roleId: '',
  });
  const deferredSearch = useDeferredValue(filters.search);
  const users = useUsers({ ...filters, search: deferredSearch.trim() });
  const roles = useRoles(capabilities.has('roles.read'));
  const updateUser = useUpdateUser();
  const revokeSessions = useRevokeUserSessions();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [settingPassword, setSettingPassword] = useState<UserSummary | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);

  const allRoles = roles.data?.roles ?? [];
  const assignable = assignableRoles(allRoles, capabilities);
  const canCreate = capabilities.has('users.create') && assignable.length > 0;
  const canUpdate = capabilities.has('users.update');

  const runPending = () => {
    if (!pending) return;
    const { kind, user } = pending;
    const done = {
      onSettled: () => {
        setPending(null);
      },
      onError: (error: unknown) => toast.error(errorMessage(error)),
    };
    if (kind === 'revoke') {
      revokeSessions.mutate(user.id, {
        ...done,
        onSuccess: (result) =>
          toast.success(`Signed ${user.displayName} out of ${String(result.revoked)} session(s).`),
      });
    } else {
      const status = kind === 'suspend' ? 'suspended' : 'active';
      updateUser.mutate(
        { id: user.id, input: { status } },
        {
          ...done,
          onSuccess: () =>
            toast.success(
              kind === 'suspend'
                ? `${user.displayName} was suspended.`
                : `${user.displayName} was reactivated.`,
            ),
        },
      );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users"
        description="People who can sign in to this site, and what they are allowed to do."
        actions={
          canCreate && (
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <UserPlus aria-hidden="true" />
              Add user
            </Button>
          )
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Search users"
              placeholder="Search by name or email"
              className="pl-9"
              value={filters.search}
              onChange={(event) => {
                setFilters({ ...filters, search: event.target.value, page: 1 });
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex">
            <NativeSelect
              aria-label="Filter by status"
              className="sm:w-40"
              value={filters.status}
              onChange={(event) => {
                setFilters({
                  ...filters,
                  status: event.target.value as UserFilters['status'],
                  page: 1,
                });
              }}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </NativeSelect>
            <NativeSelect
              aria-label="Filter by role"
              className="sm:w-48"
              value={filters.roleId}
              onChange={(event) => {
                setFilters({ ...filters, roleId: event.target.value, page: 1 });
              }}
            >
              <option value="">All roles</option>
              {allRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        {users.isPending ? (
          <div className="flex flex-col gap-2 p-4" role="status" aria-label="Loading users">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : users.isError ? (
          <div className="p-4">
            <Alert tone="danger">
              <CircleX aria-hidden="true" />
              <AlertDescription>{errorMessage(users.error)}</AlertDescription>
            </Alert>
          </div>
        ) : users.data.items.length === 0 ? (
          <EmptyState title="No users found" description="Try a different search or filter." />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>User</TableHead>
                  <TableHead className="hidden sm:table-cell">Role</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="hidden md:table-cell">Last sign-in</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data.items.map((user) => {
                  const isSelf = user.id === selfId;
                  return (
                    <TableRow key={user.id} data-testid={`user-row-${user.email}`}>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {user.displayName}{' '}
                            {isSelf && (
                              <span className="text-xs font-normal text-muted-foreground">
                                (you)
                              </span>
                            )}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                          {/* Narrow screens: role and status move under the name so row actions stay visible. */}
                          <div className="mt-1.5 flex flex-wrap gap-1.5 sm:hidden">
                            <RoleBadge user={user} />
                            <StatusBadge user={user} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <RoleBadge user={user} />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <StatusBadge user={user} />
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                        {formatDateTime(user.lastLoginAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {canUpdate && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Actions for ${user.displayName}`}
                              >
                                <MoreHorizontal aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() => {
                                  setEditing(user);
                                }}
                              >
                                <Pencil aria-hidden="true" /> Edit
                              </DropdownMenuItem>
                              {!isSelf && (
                                <>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      setSettingPassword(user);
                                    }}
                                  >
                                    <KeyRound aria-hidden="true" /> Set password
                                  </DropdownMenuItem>
                                  {capabilities.has('sessions.manage') && (
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        setPending({ kind: 'revoke', user });
                                      }}
                                    >
                                      <LogOut aria-hidden="true" /> Sign out everywhere
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator />
                                  {user.status === 'active' ? (
                                    <DropdownMenuItem
                                      destructive
                                      onSelect={() => {
                                        setPending({ kind: 'suspend', user });
                                      }}
                                    >
                                      <UserX aria-hidden="true" /> Suspend
                                    </DropdownMenuItem>
                                  ) : (
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        setPending({ kind: 'reactivate', user });
                                      }}
                                    >
                                      <UserCheck aria-hidden="true" /> Reactivate
                                    </DropdownMenuItem>
                                  )}
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Pagination
              className="border-t p-4"
              page={users.data.page}
              pageSize={users.data.pageSize}
              total={users.data.total}
              onPageChange={(page) => {
                setFilters({ ...filters, page });
              }}
            />
          </>
        )}
      </Card>

      <CreateUserDialog open={creating} onOpenChange={setCreating} roles={assignable} />
      <EditUserDialog
        user={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        roles={assignable}
        canAssignRoles={capabilities.has('users.assign_roles')}
        isSelf={editing?.id === selfId}
      />
      <SetPasswordDialog
        user={settingPassword}
        onOpenChange={(open) => {
          if (!open) setSettingPassword(null);
        }}
      />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={
          pending?.kind === 'suspend'
            ? `Suspend ${pending.user.displayName}?`
            : pending?.kind === 'reactivate'
              ? `Reactivate ${pending.user.displayName}?`
              : `Sign ${pending?.user.displayName ?? ''} out everywhere?`
        }
        description={
          pending?.kind === 'suspend'
            ? 'They will be signed out immediately and cannot sign in until reactivated.'
            : pending?.kind === 'reactivate'
              ? 'They will be able to sign in again with their existing password.'
              : 'Every active session of this user ends immediately.'
        }
        confirmLabel={
          pending?.kind === 'suspend'
            ? 'Suspend'
            : pending?.kind === 'reactivate'
              ? 'Reactivate'
              : 'Sign out'
        }
        destructive={pending?.kind !== 'reactivate'}
        pending={updateUser.isPending || revokeSessions.isPending}
        onConfirm={runPending}
      />
    </div>
  );
}
