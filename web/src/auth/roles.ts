/** Staff roles as the API spells them (JwtPayload.role). */
export const STAFF_ROLES = ['ceo', 'manager', 'team_lead', 'finance', 'call_agent', 'field_agent'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

/** CEO, Managers and Finance sign in with an authenticator app (TOTP). */
export const MANAGEMENT_ROLES: readonly StaffRole[] = ['ceo', 'manager', 'finance'];

/** Where each role lands after signing in. */
export const ROLE_HOME: Record<StaffRole, string> = {
  ceo: '/ceo',
  manager: '/manager',
  team_lead: '/team-lead',
  finance: '/finance',
  call_agent: '/call-agent',
  // Field agents use the Laboura Field phone app; this page points them to it.
  field_agent: '/field-agent',
};

export const ROLE_LABEL: Record<StaffRole, string> = {
  ceo: 'CEO',
  manager: 'Manager',
  team_lead: 'Team Lead',
  finance: 'Finance',
  call_agent: 'Call agent',
  field_agent: 'Field agent',
};

/**
 * Where a fresh sign-in lands. Same as ROLE_HOME except call agents, who
 * start on Attendance to start their day (CA02 design: "Next she lands on
 * the Attendance tab"). Sign-in passes `{ landing: true }` in the route
 * state, and the Attendance screen moves straight on to Home when the day
 * has already started.
 */
export const ROLE_LANDING: Record<StaffRole, string> = {
  ...ROLE_HOME,
  call_agent: '/call-agent/attendance',
};
