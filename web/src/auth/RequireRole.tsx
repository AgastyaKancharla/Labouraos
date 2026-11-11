import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { ROLE_HOME, ROLE_LANDING, type StaffRole } from './roles';

/**
 * Route guard. Not signed in → sign-in screen (and back here afterwards).
 * Signed in with another role → that role's own home. The API checks every
 * request anyway; this only keeps people on screens they can use.
 */
export function RequireRole({ roles, children }: { roles: readonly StaffRole[]; children: ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();
  if (!session || session.totpSetupOnly) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (!roles.includes(session.staff.role)) {
    return <Navigate to={ROLE_HOME[session.staff.role]} replace />;
  }
  return <>{children}</>;
}

/** Where to go after sign-in: the page they asked for if their role may open it, else their home. */
export function landingPath(role: StaffRole, from: string | undefined): string {
  const home = ROLE_HOME[role];
  if (from && (from === home || from.startsWith(`${home}/`))) return from;
  return ROLE_LANDING[role];
}
