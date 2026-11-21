import type { ComponentType } from 'react';
import { createBrowserRouter } from 'react-router';
import type { LazyRouteFunction, RouteObject } from 'react-router';
import { NotFoundPage, RouteError } from './errors';
import { Boot, RequireAuth, Root } from './guards';
import { FullPageStatus } from './status';

/**
 * Route-level code splitting (B5b item 15): each screen is its own chunk, fetched when its route is
 * first visited. A route's own `errorElement` also catches a chunk that fails to load.
 */
function page<M extends Record<string, unknown>>(
  load: () => Promise<M>,
  name: keyof M & string,
): LazyRouteFunction<RouteObject> {
  return async () => ({ Component: (await load())[name] as ComponentType });
}

/** Every route has its own error boundary (approved F0 plan). */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Root />,
    // Shown while the first screen's chunk loads (a route with `lazy` is not ready at once).
    HydrateFallback: FullPageStatus,
    errorElement: <RouteError />,
    children: [
      {
        element: <Boot />,
        errorElement: <RouteError />,
        children: [
          {
            path: 'setup',
            lazy: page(() => import('@/features/setup/SetupPage'), 'SetupPage'),
            errorElement: <RouteError />,
          },
          {
            path: 'login',
            lazy: page(() => import('@/features/auth/LoginPage'), 'LoginPage'),
            errorElement: <RouteError />,
          },
          {
            element: <RequireAuth />,
            errorElement: <RouteError />,
            children: [
              {
                path: 'change-password',
                lazy: page(() => import('@/features/auth/ChangePasswordPage'), 'ChangePasswordPage'),
                errorElement: <RouteError />,
              },
              {
                lazy: page(() => import('@/features/shell/ShellLayout'), 'ShellLayout'),
                errorElement: <RouteError />,
                children: [
                  {
                    index: true,
                    lazy: page(() => import('@/features/home/HomePage'), 'HomePage'),
                    errorElement: <RouteError />,
                  },
                  {
                    path: 'cases',
                    lazy: page(() => import('@/features/cases/CasesPage'), 'CasesPage'),
                    errorElement: <RouteError />,
                  },
                  {
                    path: 'cases/new',
                    lazy: page(() => import('@/features/cases/NewCasePage'), 'NewCasePage'),
                    errorElement: <RouteError />,
                  },
                  {
                    path: 'cases/:id',
                    lazy: page(() => import('@/features/cases/CaseDetailsPage'), 'CaseDetailsPage'),
                    errorElement: <RouteError />,
                  },
                  {
                    path: 'payments',
                    lazy: page(() => import('@/features/payments/PaymentsPage'), 'PaymentsPage'),
                    errorElement: <RouteError />,
                  },
                  {
                    path: 'outgoing',
                    lazy: page(() => import('@/features/outgoing/OutgoingPage'), 'OutgoingPage'),
                    errorElement: <RouteError />,
                  },
                  {
                    path: 'cheques',
                    lazy: page(() => import('@/features/payments/ChequesPage'), 'ChequesPage'),
                    errorElement: <RouteError />,
                  },
                  {
                    path: 'invoices',
                    lazy: page(() => import('@/features/invoices/InvoicesPage'), 'InvoicesPage'),
                    errorElement: <RouteError />,
                  },
                  {
                    path: 'invoices/new',
                    lazy: page(() => import('@/features/invoices/NewInvoicePage'), 'NewInvoicePage'),
                    errorElement: <RouteError />,
                  },
                  {
                    path: 'invoices/:id',
                    lazy: page(() => import('@/features/invoices/InvoicePage'), 'InvoicePage'),
                    errorElement: <RouteError />,
                  },
                  {
                    path: 'invoice-appearance',
                    lazy: page(() => import('@/features/invoices/InvoiceAppearancePage'), 'InvoiceAppearancePage'),
                    errorElement: <RouteError />,
                  },
                  {
                    path: 'debts',
                    lazy: page(() => import('@/features/payments/DebtsPage'), 'DebtsPage'),
                    errorElement: <RouteError />,
                  },
                  {
                    path: 'doctors',
                    lazy: page(() => import('@/features/doctors/DoctorsPage'), 'DoctorsPage'),
                    errorElement: <RouteError />,
                  },
                  {
                    path: 'doctors/:id',
                    lazy: page(() => import('@/features/doctors/DoctorPage'), 'DoctorPage'),
                    errorElement: <RouteError />,
                    children: [
                      {
                        index: true,
                        lazy: page(() => import('@/features/doctors/DoctorPage'), 'DoctorInfoTab'),
                        errorElement: <RouteError />,
                      },
                      {
                        path: 'prices',
                        lazy: page(() => import('@/features/doctors/DoctorPage'), 'DoctorPricesTab'),
                        errorElement: <RouteError />,
                      },
                      {
                        path: 'payments',
                        lazy: page(() => import('@/features/payments/DoctorTabs'), 'DoctorPaymentsTab'),
                        errorElement: <RouteError />,
                      },
                      {
                        path: 'statement',
                        lazy: page(() => import('@/features/payments/DoctorTabs'), 'DoctorStatementTab'),
                        errorElement: <RouteError />,
                      },
                    ],
                  },
                  {
                    path: 'settings',
                    lazy: page(() => import('@/features/settings/SettingsLayout'), 'SettingsLayout'),
                    errorElement: <RouteError />,
                    children: [
                      {
                        index: true,
                        lazy: page(
                          () => import('@/features/settings/GeneralSettingsPage'),
                          'GeneralSettingsPage',
                        ),
                        errorElement: <RouteError />,
                      },
                      {
                        path: 'work-types',
                        lazy: page(() => import('@/features/settings/ListPages'), 'WorkTypesPage'),
                        errorElement: <RouteError />,
                      },
                      {
                        path: 'technicians',
                        lazy: page(() => import('@/features/settings/ListPages'), 'TechniciansPage'),
                        errorElement: <RouteError />,
                      },
                      {
                        path: 'expense-categories',
                        lazy: page(() => import('@/features/settings/ListPages'), 'ExpenseCategoriesPage'),
                        errorElement: <RouteError />,
                      },
                    ],
                  },
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
