import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { ROLE_HOME, ROLE_LANDING, type StaffRole } from './roles';
import { StaffPhotoGate } from './StaffPhotoGate';
import { WrongPortalNotice, type WrongPortalState } from './WrongPortalNotice';

/**
 * Route guard. Not signed in → sign-in screen (and back here afterwards).
 * Signed in with another role → their own home, with a one-time note saying
 * the page is for another role (WrongPortalNotice). No staff photo yet
 * (or the CEO asked for a new one) → the live camera selfie first. The API
 * checks every request anyway; this only keeps people on screens they can use.
 */
export function RequireRole({ roles, children }: { roles: readonly StaffRole[]; children: ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();
  if (!session || session.totpSetupOnly) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (!roles.includes(session.staff.role)) {
    const state: WrongPortalState = { wrongPortalFor: roles.length === 1 ? roles[0]! : null };
    return <Navigate to={ROLE_HOME[session.staff.role]} replace state={state} />;
  }
  // Guide (14 Nov): someone with no staff photo, or asked for a new one, takes it before going on.
  return (
    <>
      <WrongPortalNotice role={session.staff.role} />
      <StaffPhotoGate>{children}</StaffPhotoGate>
    </>
  );
}

/** Where to go after sign-in: the page they asked for if their role may open it, else their home. */
export function landingPath(role: StaffRole, from: string | undefined): string {
  const home = ROLE_HOME[role];
  if (from && (from === home || from.startsWith(`${home}/`))) return from;
  return ROLE_LANDING[role];
}
