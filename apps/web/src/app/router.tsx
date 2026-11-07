import { Suspense } from 'react';
import { createBrowserRouter } from 'react-router';
import type { RouteObject } from 'react-router';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { HomePage } from '@/features/home/HomePage';
import { SetupPage } from '@/features/setup/SetupPage';
import { ShellLayout } from '@/features/shell/ShellLayout';
import { NotFoundPage, RouteError } from './errors';
import { Boot, RequireAuth, Root } from './guards';
import { FullPageStatus } from './status';

/** Every route has its own error boundary (approved F0 plan). */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      {
        element: <Boot />,
        errorElement: <RouteError />,
        children: [
          { path: 'setup', element: <SetupPage />, errorElement: <RouteError /> },
          { path: 'login', element: <LoginPage />, errorElement: <RouteError /> },
          {
            element: <RequireAuth />,
            errorElement: <RouteError />,
            children: [
              { path: 'change-password', element: <ChangePasswordPage />, errorElement: <RouteError /> },
              {
                element: (
                  <Suspense fallback={<FullPageStatus />}>
                    <ShellLayout />
                  </Suspense>
                ),
                errorElement: <RouteError />,
                children: [
                  { index: true, element: <HomePage />, errorElement: <RouteError /> },
                  { path: '*', element: <NotFoundPage /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
