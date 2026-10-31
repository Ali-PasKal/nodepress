import { Navigate, type RouteObject } from 'react-router';
import { SystemStatusPage } from '../features/system/system-status-page';
import { AdminLayout } from '../layouts/admin-layout';
import type { RouteHandle } from '../layouts/breadcrumbs';
import { NotFoundPage } from '../routes/not-found-page';
import { RouteErrorPage } from '../routes/route-error-page';

const handle = (breadcrumbs: string[]): RouteHandle => ({ breadcrumbs });

export const adminRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AdminLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <Navigate to="/system/status" replace /> },
      {
        path: 'system/status',
        element: <SystemStatusPage />,
        handle: handle(['System', 'Status']),
      },
      { path: '*', element: <NotFoundPage />, handle: handle(['Not found']) },
    ],
  },
];

/** Vite's BASE_URL is "/admin/"; the router basename must not have the trailing slash. */
export const ROUTER_BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '');
