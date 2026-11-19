import { Suspense } from 'react';
import { createBrowserRouter } from 'react-router';
import type { RouteObject } from 'react-router';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { CaseDetailsPage } from '@/features/cases/CaseDetailsPage';
import { CasesPage } from '@/features/cases/CasesPage';
import { NewCasePage } from '@/features/cases/NewCasePage';
import { DoctorInfoTab, DoctorPage, DoctorPricesTab } from '@/features/doctors/DoctorPage';
import { DoctorsPage } from '@/features/doctors/DoctorsPage';
import { HomePage } from '@/features/home/HomePage';
import { ChequesPage } from '@/features/payments/ChequesPage';
import { DebtsPage } from '@/features/payments/DebtsPage';
import { DoctorPaymentsTab, DoctorStatementTab } from '@/features/payments/DoctorTabs';
import { OutgoingPage } from '@/features/outgoing/OutgoingPage';
import { PaymentsPage } from '@/features/payments/PaymentsPage';
import { GeneralSettingsPage } from '@/features/settings/GeneralSettingsPage';
import { ExpenseCategoriesPage, TechniciansPage, WorkTypesPage } from '@/features/settings/ListPages';
import { SettingsLayout } from '@/features/settings/SettingsLayout';
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
                  { path: 'cases', element: <CasesPage />, errorElement: <RouteError /> },
                  { path: 'cases/new', element: <NewCasePage />, errorElement: <RouteError /> },
                  { path: 'cases/:id', element: <CaseDetailsPage />, errorElement: <RouteError /> },
                  { path: 'payments', element: <PaymentsPage />, errorElement: <RouteError /> },
                  { path: 'outgoing', element: <OutgoingPage />, errorElement: <RouteError /> },
                  { path: 'cheques', element: <ChequesPage />, errorElement: <RouteError /> },
                  { path: 'debts', element: <DebtsPage />, errorElement: <RouteError /> },
                  { path: 'doctors', element: <DoctorsPage />, errorElement: <RouteError /> },
                  {
                    path: 'doctors/:id',
                    element: <DoctorPage />,
                    errorElement: <RouteError />,
                    children: [
                      { index: true, element: <DoctorInfoTab />, errorElement: <RouteError /> },
                      { path: 'prices', element: <DoctorPricesTab />, errorElement: <RouteError /> },
                      { path: 'payments', element: <DoctorPaymentsTab />, errorElement: <RouteError /> },
                      { path: 'statement', element: <DoctorStatementTab />, errorElement: <RouteError /> },
                    ],
                  },
                  {
                    path: 'settings',
                    element: <SettingsLayout />,
                    errorElement: <RouteError />,
                    children: [
                      { index: true, element: <GeneralSettingsPage />, errorElement: <RouteError /> },
                      { path: 'work-types', element: <WorkTypesPage />, errorElement: <RouteError /> },
                      { path: 'technicians', element: <TechniciansPage />, errorElement: <RouteError /> },
                      {
                        path: 'expense-categories',
                        element: <ExpenseCategoriesPage />,
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
