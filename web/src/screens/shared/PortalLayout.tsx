import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppShell } from '../../components/AppShell';
import { SkeletonCard } from '../../components/Skeleton';
import type { PortalDef } from '../../portals';
import { ErrorBoundary } from './ErrorBoundary';

/** Shell + lazy-loading fallback + crash boundary around every screen of a portal. */
export function PortalLayout({ portal }: { portal: PortalDef }) {
  const location = useLocation();
  return (
    <AppShell portal={portal}>
      <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<SkeletonCard height={220} />}>
          <Outlet />
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}
