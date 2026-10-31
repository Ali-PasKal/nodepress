import { Navigate, type RouteObject } from 'react-router';
import { RequireAuth, RequireCapability } from '../features/auth/guards';
import { LoginPage } from '../features/auth/login-page';
import { SystemStatusPage } from '../features/system/system-status-page';
import { AdminLayout } from '../layouts/admin-layout';
import type { RouteHandle } from '../layouts/breadcrumbs';
import { NotFoundPage } from '../routes/not-found-page';
import { RouteErrorPage } from '../routes/route-error-page';

const handle = (breadcrumbs: string[]): RouteHandle => ({ breadcrumbs });

/*
 * Sign-in and system status ship in the initial bundle; every other page is code-split and loaded on
 * first navigation (route-level `lazy`), keeping the initial download within the performance budget.
 */
export const adminRoutes: RouteObject[] = [
  {
    path: '/setup',
    lazy: async () => ({
      Component: (await import('../features/setup/setup-wizard-page')).SetupWizardPage,
    }),
    errorElement: <RouteErrorPage />,
  },
  { path: '/login', element: <LoginPage />, errorElement: <RouteErrorPage /> },
  {
    path: '/forgot-password',
    lazy: async () => ({
      Component: (await import('../features/auth/password-reset-pages')).ForgotPasswordPage,
    }),
    errorElement: <RouteErrorPage />,
  },
  {
    path: '/reset-password',
    lazy: async () => ({
      Component: (await import('../features/auth/password-reset-pages')).ResetPasswordPage,
    }),
    errorElement: <RouteErrorPage />,
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AdminLayout />
      </RequireAuth>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <Navigate to="/system/status" replace /> },
      {
        path: 'system/status',
        element: <SystemStatusPage />,
        handle: handle(['System', 'Status']),
      },
      {
        path: 'users',
        handle: handle(['People', 'Users']),
        lazy: async () => {
          const { UsersPage } = await import('../features/users/users-page');
          return {
            element: (
              <RequireCapability capability="users.read">
                <UsersPage />
              </RequireCapability>
            ),
          };
        },
      },
      {
        path: 'roles',
        handle: handle(['People', 'Roles']),
        lazy: async () => {
          const { RolesPage } = await import('../features/roles/roles-page');
          return {
            element: (
              <RequireCapability capability="roles.read">
                <RolesPage />
              </RequireCapability>
            ),
          };
        },
      },
      {
        path: 'audit',
        handle: handle(['System', 'Audit log']),
        lazy: async () => {
          const { AuditPage } = await import('../features/audit/audit-page');
          return {
            element: (
              <RequireCapability capability="audit.read">
                <AuditPage />
              </RequireCapability>
            ),
          };
        },
      },
      {
        path: 'settings',
        handle: handle(['System', 'Settings']),
        lazy: async () => {
          const { SettingsPage } = await import('../features/settings/settings-page');
          return {
            element: (
              <RequireCapability capability="system.manage">
                <SettingsPage />
              </RequireCapability>
            ),
          };
        },
      },
      {
        path: 'profile',
        handle: handle(['Your profile']),
        lazy: async () => ({
          Component: (await import('../features/account/profile-page')).ProfilePage,
        }),
      },
      { path: '*', element: <NotFoundPage />, handle: handle(['Not found']) },
    ],
  },
];

/** Vite's BASE_URL is "/admin/"; the router basename must not have the trailing slash. */
export const ROUTER_BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '');
