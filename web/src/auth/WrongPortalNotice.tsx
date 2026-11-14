import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { useT } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/en';
import { isStaffRole, type StaffRole } from './roles';

/** The route state RequireRole leaves when it sends someone away from another role's page. */
export interface WrongPortalState {
  /** The role the page they opened is for, or null when it is for several. */
  wrongPortalFor: StaffRole | null;
}

const FOR_KEY: Record<StaffRole, MessageKey> = {
  ceo: 'auth.wrongPortal.for.ceo',
  manager: 'auth.wrongPortal.for.manager',
  team_lead: 'auth.wrongPortal.for.team_lead',
  finance: 'auth.wrongPortal.for.finance',
  call_agent: 'auth.wrongPortal.for.call_agent',
  field_agent: 'auth.wrongPortal.for.field_agent',
};

const IN_KEY: Record<StaffRole, MessageKey> = {
  ceo: 'auth.wrongPortal.in.ceo',
  manager: 'auth.wrongPortal.in.manager',
  team_lead: 'auth.wrongPortal.in.team_lead',
  finance: 'auth.wrongPortal.in.finance',
  call_agent: 'auth.wrongPortal.in.call_agent',
  field_agent: 'auth.wrongPortal.in.field_agent',
};

function wrongPortalFrom(state: unknown): { found: boolean; forRole: StaffRole | null } {
  if (!state || typeof state !== 'object' || !('wrongPortalFor' in state)) return { found: false, forRole: null };
  const value = (state as WrongPortalState).wrongPortalFor;
  return { found: true, forRole: isStaffRole(value) ? value : null };
}

/**
 * Owner rule (Master Guide, 14 Nov): each portal accepts only its own roles and
 * refuses others cleanly. Someone who opens another role's page lands on their
 * own home; this says why, once ("That page is for the CEO. You're in the
 * Manager portal."), then clears the note from the history entry so Back or a
 * reload does not show it again.
 */
export function WrongPortalNotice({ role }: { role: StaffRole }) {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const t = useT();
  const shown = useRef<string | null>(null);
  const { found, forRole } = wrongPortalFrom(location.state);

  useEffect(() => {
    if (!found || shown.current === location.key) return;
    shown.current = location.key;
    const first = forRole ? t(FOR_KEY[forRole]) : t('auth.wrongPortal.for.other');
    toast.show(`${first} ${t(IN_KEY[role])}`);
    const rest = { ...(location.state as Record<string, unknown>) };
    delete rest.wrongPortalFor;
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: Object.keys(rest).length ? rest : null,
    });
  }, [found, forRole, role, location, navigate, t, toast]);

  return null;
}
