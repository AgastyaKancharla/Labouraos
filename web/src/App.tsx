import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { RequireRole } from './auth/RequireRole';
import { ROLE_HOME } from './auth/roles';
import { ToastProvider } from './components/Toast';
import { I18nProvider } from './i18n/I18nProvider';
import { isApiError } from './lib/api/errors';
import { PORTALS } from './portals';
import StaffSignIn from './screens/auth/StaffSignIn';
import { FieldAgentNotice } from './screens/shared/FieldAgentNotice';
import { NotFound } from './screens/shared/NotFound';
import { PortalLayout } from './screens/shared/PortalLayout';
import { ScreenRoute } from './screens/shared/ScreenRoute';

/**
 * Data defaults: a failed request is retried once unless it is a 4xx (the
 * answer will not change); data is fresh for 30 s; refetch on window focus
 * is off so a screen does not jump while someone reads it.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => !(isApiError(error) && error.status >= 400 && error.status < 500) && count < 1,
      },
      mutations: { retry: false },
    },
  });
}

/** All providers, shared by the app and by tests (tests pass their own router). */
export function AppProviders({ children, queryClient }: { children: ReactNode; queryClient?: QueryClient }) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

function HomeRedirect() {
  const { session } = useAuth();
  return <Navigate to={session && !session.totpSetupOnly ? ROLE_HOME[session.staff.role] : '/login'} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<StaffSignIn />} />
      <Route
        path="/field-agent"
        element={
          <RequireRole roles={['field_agent']}>
            <FieldAgentNotice />
          </RequireRole>
        }
      />
      {PORTALS.map((portal) => (
        <Route
          key={portal.key}
          path={portal.root}
          element={
            portal.roles.length > 0 ? (
              <RequireRole roles={portal.roles}>
                <PortalLayout portal={portal} />
              </RequireRole>
            ) : (
              <PortalLayout portal={portal} />
            )
          }
        >
          {portal.screens.map((screen) =>
            screen.path === '' ? (
              <Route key={screen.id} index element={<ScreenRoute portal={portal} screen={screen} />} />
            ) : (
              <Route key={`${screen.id}:${screen.path}`} path={screen.path} element={<ScreenRoute portal={portal} screen={screen} />} />
            ),
          )}
          <Route path="*" element={<NotFound />} />
        </Route>
      ))}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export function App() {
  return (
    <AppProviders>
      <BrowserRouter basename="/app">
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
