import type { RouteObject } from 'react-router';
import { RequireAuth, RequireCapability } from '../features/auth/guards';
import { LoginPage } from '../features/auth/login-page';
import { AdminLayout } from '../layouts/admin-layout';
import type { RouteHandle } from '../layouts/breadcrumbs';
import { NotFoundPage } from '../routes/not-found-page';
import { RouteErrorPage } from '../routes/route-error-page';

const handle = (breadcrumbs: string[]): RouteHandle => ({ breadcrumbs });
const CONTENT_READERS = ['content.read', 'content.create', 'content.edit_others'];

/*
 * Sign-in and the layout ship in the initial bundle; every page is code-split and loaded on first
 * navigation (route-level `lazy`), keeping the initial download within the performance budget.
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
      {
        index: true,
        handle: handle(['Dashboard']),
        lazy: async () => ({
          Component: (await import('../features/dashboard/dashboard-page')).DashboardPage,
        }),
      },
      {
        path: 'system/status',
        handle: handle(['System', 'Status']),
        lazy: async () => ({
          Component: (await import('../features/system/system-status-page')).SystemStatusPage,
        }),
      },
      {
        path: 'appearance',
        handle: handle(['Site', 'Appearance']),
        lazy: async () => {
          const { AppearancePage } = await import('../features/site/appearance-page');
          return {
            element: (
              <RequireCapability capability="appearance.manage">
                <AppearancePage />
              </RequireCapability>
            ),
          };
        },
      },
      {
        path: 'appearance/menus',
        handle: handle(['Site', 'Menus']),
        lazy: async () => {
          const { MenusPage } = await import('../features/site/menus-page');
          return {
            element: (
              <RequireCapability capability="appearance.manage">
                <MenusPage />
              </RequireCapability>
            ),
          };
        },
      },
      {
        path: 'seo',
        handle: handle(['Site', 'SEO']),
        lazy: async () => {
          const { SeoPage } = await import('../features/site/seo-page');
          return {
            element: (
              <RequireCapability capability="seo.manage">
                <SeoPage />
              </RequireCapability>
            ),
          };
        },
      },
      {
        path: 'seo/redirects',
        handle: handle(['Site', 'Redirects']),
        lazy: async () => {
          const { RedirectsPage } = await import('../features/site/redirects-page');
          return {
            element: (
              <RequireCapability capability="seo.manage">
                <RedirectsPage />
              </RequireCapability>
            ),
          };
        },
      },
      {
        path: 'content/:type',
        handle: handle(['Content']),
        lazy: async () => {
          const { EntriesPage } = await import('../features/content/entries-page');
          return {
            element: (
              <RequireCapability capability={CONTENT_READERS}>
                <EntriesPage />
              </RequireCapability>
            ),
          };
        },
      },
      {
        path: 'content/:type/:id',
        handle: handle(['Content', 'Editor']),
        lazy: async () => {
          const { EntryEditorPage } = await import('../features/content/entry-editor-page');
          return {
            element: (
              <RequireCapability capability={CONTENT_READERS}>
                <EntryEditorPage />
              </RequireCapability>
            ),
          };
        },
      },
      {
        path: 'taxonomies/:taxonomy',
        handle: handle(['Content', 'Terms']),
        lazy: async () => {
          const { TermsPage } = await import('../features/content/terms-page');
          return {
            element: (
              <RequireCapability capability="terms.manage">
                <TermsPage />
              </RequireCapability>
            ),
          };
        },
      },
      {
        path: 'media',
        handle: handle(['Content', 'Media']),
        lazy: async () => {
          const { MediaPage } = await import('../features/media/media-page');
          return {
            element: (
              <RequireCapability capability={['media.upload', 'media.manage', 'content.read']}>
                <MediaPage />
              </RequireCapability>
            ),
          };
        },
      },
      {
        path: 'settings/content-types',
        handle: handle(['System', 'Content types']),
        lazy: async () => {
          const { ContentTypesPage } = await import('../features/content/content-types-page');
          return {
            element: (
              <RequireCapability capability="content_types.manage">
                <ContentTypesPage />
              </RequireCapability>
            ),
          };
        },
      },
      {
        path: 'system/jobs',
        handle: handle(['System', 'Background jobs']),
        lazy: async () => {
          const { JobsPage } = await import('../features/jobs/jobs-page');
          return {
            element: (
              <RequireCapability capability="jobs.manage">
                <JobsPage />
              </RequireCapability>
            ),
          };
        },
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
