export type Role =
  | 'ceo'
  | 'manager'
  | 'team_lead'
  | 'call_agent'
  | 'field_agent'
  | 'finance';

export type Resource =
  | 'job_seeker'
  | 'referral'
  | 'business'
  | 'vacancy'
  | 'placement'
  | 'payment'
  | 'pricing'
  | 'staff'
  | 'target';

export type Action = 'read' | 'write';

export type AccessScope = 'all' | 'own_account' | 'own_lead' | 'own_team' | 'own_only' | 'none';

export interface PermissionRule {
  allowed: boolean;
  scope: AccessScope;
}

export const RBAC_MATRIX: Record<Role, Record<Resource, Record<Action, PermissionRule>>> = {
  ceo: {
    job_seeker: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    referral: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    business: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    vacancy: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    placement: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    payment: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    pricing: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    staff: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    target: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
  },
  manager: {
    job_seeker: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    referral: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    business: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    vacancy: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    placement: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    payment: { read: { allowed: true, scope: 'all' }, write: { allowed: false, scope: 'none' } },
    pricing: { read: { allowed: true, scope: 'all' }, write: { allowed: false, scope: 'none' } }, // Manager is read-only for pricing
    staff: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    target: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
  },
  team_lead: {
    job_seeker: { read: { allowed: true, scope: 'own_team' }, write: { allowed: true, scope: 'own_team' } },
    referral: { read: { allowed: true, scope: 'own_team' }, write: { allowed: true, scope: 'own_team' } },
    business: { read: { allowed: true, scope: 'own_team' }, write: { allowed: true, scope: 'own_team' } },
    vacancy: { read: { allowed: true, scope: 'own_team' }, write: { allowed: true, scope: 'own_team' } },
    placement: { read: { allowed: true, scope: 'own_team' }, write: { allowed: true, scope: 'own_team' } },
    payment: { read: { allowed: false, scope: 'none' }, write: { allowed: false, scope: 'none' } },
    pricing: { read: { allowed: false, scope: 'none' }, write: { allowed: false, scope: 'none' } },
    staff: { read: { allowed: true, scope: 'own_team' }, write: { allowed: true, scope: 'own_team' } },
    target: { read: { allowed: true, scope: 'own_team' }, write: { allowed: false, scope: 'none' } },
  },
  call_agent: {
    job_seeker: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    referral: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    business: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'own_lead' } },
    // Call agents need city-wide access to vacancies and placements to match candidates across Bengaluru.
    // Setting scope to 'all' documents existing behaviour (the guard never enforced 'own_captured').
    vacancy: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    placement: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    payment: { read: { allowed: false, scope: 'none' }, write: { allowed: false, scope: 'none' } },
    pricing: { read: { allowed: false, scope: 'none' }, write: { allowed: false, scope: 'none' } },
    staff: { read: { allowed: true, scope: 'own_only' }, write: { allowed: false, scope: 'none' } },
    target: { read: { allowed: true, scope: 'own_only' }, write: { allowed: false, scope: 'none' } },
  },
  field_agent: {
    job_seeker: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    referral: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    business: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'own_account' } },
    vacancy: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'own_account' } },
    placement: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'own_account' } },
    payment: { read: { allowed: false, scope: 'none' }, write: { allowed: false, scope: 'none' } },
    pricing: { read: { allowed: false, scope: 'none' }, write: { allowed: false, scope: 'none' } },
    staff: { read: { allowed: true, scope: 'own_only' }, write: { allowed: false, scope: 'none' } },
    target: { read: { allowed: true, scope: 'own_only' }, write: { allowed: false, scope: 'none' } },
  },
  finance: {
    job_seeker: { read: { allowed: true, scope: 'all' }, write: { allowed: false, scope: 'none' } },
    referral: { read: { allowed: true, scope: 'all' }, write: { allowed: false, scope: 'none' } },
    business: { read: { allowed: true, scope: 'all' }, write: { allowed: false, scope: 'none' } },
    vacancy: { read: { allowed: true, scope: 'all' }, write: { allowed: false, scope: 'none' } },
    placement: { read: { allowed: true, scope: 'all' }, write: { allowed: false, scope: 'none' } },
    payment: { read: { allowed: true, scope: 'all' }, write: { allowed: true, scope: 'all' } },
    pricing: { read: { allowed: false, scope: 'none' }, write: { allowed: false, scope: 'none' } },
    staff: { read: { allowed: false, scope: 'none' }, write: { allowed: false, scope: 'none' } },
    target: { read: { allowed: false, scope: 'none' }, write: { allowed: false, scope: 'none' } },
  },
};
