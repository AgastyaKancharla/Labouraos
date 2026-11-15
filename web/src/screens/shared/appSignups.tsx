import type { ReactNode } from 'react';
import { StatusPill } from '../../components/Badge';
import { formatDateTimeIST } from '../../lib/format/date';

/**
 * Shapes and labels for the App sign-ups screens (Team Lead, Manager, CEO).
 * Data: GET /signup-tracker/team-lead | manager | ceo (src/modules/signup-tracker).
 * The office portals are in English; phones arrive as the last 4 digits.
 */
export type SignupKind = 'job_seeker' | 'business' | 'referral';
export const SIGNUP_KINDS: SignupKind[] = ['job_seeker', 'business', 'referral'];
export const STAGES = ['A', 'B', 'C', 'D', 'E', 'done'] as const;

export const KIND_LABEL: Record<string, string> = { job_seeker: 'Job seeker', business: 'Business', referral: 'Referral partner' };

/** What each stage means for each kind (proposal 4.1). */
export const STAGE_LABEL: Record<SignupKind, Record<string, string>> = {
  job_seeker: { A: 'Phone verified', B: 'Profile filled', C: 'Consent given', D: 'Selfie and ID done', E: 'Payment pending', done: '₹499 received' },
  business: { A: 'Phone verified', B: 'Business form filled', C: 'Agreement signed', D: 'Visit booked', E: 'Visit done, approval', done: 'Verified' },
  referral: { A: 'Phone verified', B: 'Details filled', C: 'Terms accepted', D: 'Selfie and ID done', E: 'UPI added', done: 'Active' },
};

export const STEP_LABEL: Record<string, string> = {
  profile: 'Profile form',
  business_form: 'Business form',
  details: 'Partner details',
  consent: 'Consent',
  selfie: 'Selfie',
  id_check: 'ID check',
  terms: 'Terms',
  payment: 'Payment',
  payment_failed: 'Payment (UPI failed)',
  agreement: 'Agreement',
  visit_booked: 'Visit to book',
  visit_done: 'Verification visit',
  approval: 'Team Lead approval',
  upi: 'UPI details',
  complete: 'Finished',
};

export const OUTCOME_LABEL: Record<string, string> = {
  open: 'In progress',
  self: 'Finished alone',
  assisted: 'Finished with help',
  no_response: 'No response',
  gave_up: 'Gave up',
};

export const REASON_LABEL: Record<string, string> = {
  existing_agent: 'Already knew them',
  language: 'Speaks their language',
  fair_share: 'Fewest open tasks',
  handover: 'Covering for a teammate',
  manual: 'Moved by hand',
};

export const SOURCE_LABEL: Record<string, string> = {
  store: 'App store',
  referral_link: 'Referral link',
  ad: 'Ad',
  organic: 'Found it',
  agent_link: 'Agent link',
  unknown: 'Not known',
};

export interface Brief {
  id: string;
  code: string;
  name: string;
}

export interface SignupRow {
  id: string;
  kind: SignupKind;
  code: string | null;
  name: string;
  maskedPhone: string | null;
  area: string | null;
  stage: string;
  stageReachedAt: string;
  step: string;
  missing: string[];
  stuckReason: string | null;
  scriptHint: string;
  source: string | null;
  contactConsent: boolean;
  assignedTo: Brief | null;
  assignmentReason: string | null;
  callTries: number;
  remindersSent: number;
  nextActionAt: string | null;
  openTask: { id: string; dueAt: string; overdue: boolean } | null;
  outcome: string;
  startedAt: string;
  finishedAt: string | null;
}

export type Funnel = Record<SignupKind, Record<string, number>>;

export interface SignupCounts {
  now: string;
  started: number;
  finished: number;
  finishedWithoutHelpPercent: number | null;
  medianMinutesToFinish: number | null;
  openByStage: Funnel;
  reachedStage: Funnel;
  outcomes: Record<SignupKind, Record<string, number>>;
  bySource: Record<string, number>;
}

export interface AreaTask {
  area: string;
  count: number;
  stages: Record<string, number>;
}

export function stageText(row: Pick<SignupRow, 'kind' | 'stage'>): string {
  return STAGE_LABEL[row.kind]?.[row.stage] ?? row.stage;
}

export function missingText(row: Pick<SignupRow, 'missing'>): string {
  return row.missing.length ? row.missing.map((m) => STEP_LABEL[m] ?? m).join(' · ') : '—';
}

export function minutesText(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} days`;
}

export function PersonCell({ row }: { row: SignupRow }) {
  return (
    <span>
      <strong>{row.name}</strong>
      <span className="sub" style={{ display: 'block' }}>
        {[row.code, row.maskedPhone, row.area].filter(Boolean).join(' · ') || 'No record yet'}
      </span>
    </span>
  );
}

export function StageCell({ row }: { row: SignupRow }) {
  const tone = row.outcome === 'open' ? (row.stage === 'E' ? 'warn' : 'info') : row.outcome === 'self' || row.outcome === 'assisted' ? 'good' : 'muted';
  return (
    <span>
      <StatusPill tone={tone}>{row.outcome === 'open' ? stageText(row) : OUTCOME_LABEL[row.outcome] ?? row.outcome}</StatusPill>
      {row.outcome === 'open' && row.missing.length > 0 && (
        <span className="sub" style={{ display: 'block' }}>Still to do: {missingText(row)}</span>
      )}
    </span>
  );
}

export function NextCell({ row }: { row: SignupRow }): ReactNode {
  if (row.openTask) {
    return row.openTask.overdue ? (
      <StatusPill tone="crit">Call overdue since {formatDateTimeIST(row.openTask.dueAt)}</StatusPill>
    ) : (
      <span>Call due {formatDateTimeIST(row.openTask.dueAt)}</span>
    );
  }
  if (!row.contactConsent) return <span className="sub">App reminders only (no call consent)</span>;
  return row.nextActionAt ? <span className="sub">Next {formatDateTimeIST(row.nextActionAt)}</span> : <span className="sub">—</span>;
}

/** The stage funnel: one row per kind, one column per stage. */
export function FunnelTable({ funnel, caption, note }: { funnel: Funnel | undefined; caption: string; note?: string }) {
  return (
    <div className="lb-table">
      <div className="lb-table__scroll">
      <table aria-label={caption}>
        <thead>
          <tr>
            <th scope="col">Kind</th>
            {STAGES.map((s) => (
              <th key={s} scope="col" style={{ textAlign: 'right' }}>
                {s === 'done' ? 'Done' : s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SIGNUP_KINDS.map((k) => (
            <tr key={k}>
              <th scope="row">{KIND_LABEL[k]}</th>
              {STAGES.map((s) => (
                <td key={s} style={{ textAlign: 'right' }} title={STAGE_LABEL[k][s]}>
                  {funnel?.[k]?.[s] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {note && <p className="sub" style={{ padding: '6px 18px 12px' }}>{note}</p>}
    </div>
  );
}
