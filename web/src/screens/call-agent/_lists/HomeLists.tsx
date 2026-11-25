import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { formatTimeIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { ACTION } from '../../shared/StuckBox';
import type { StuckListRow } from '../../shared/StuckList';
import './lists.css';
import { DoneMark, ListRow, RowAction, WaitingMark } from './parts';

/**
 * Home's "Stuck registrations" and "Done today" in the console lists' row style (rev 210,
 * 23 Nov): the name in bold, one plain status line, and on the right ONE button (the first of
 * the profile box's buttons), "Waiting" (the Team Lead) or Done. Tapping a row opens the
 * person's profile (CA04: job seekers, businesses and partners).
 */
const KIND_KEY: Record<StuckListRow['kind'], MessageKey> = {
  job_seeker: 'stuck.kind.job_seeker',
  business: 'stuck.kind.business',
  referral: 'stuck.kind.referral',
};

const STEP_KEY: Record<string, MessageKey> = {
  consent: 'cl.stuck.step.consent',
  selfie: 'cl.stuck.step.selfie',
  id_check: 'cl.stuck.step.id_check',
  payment: 'cl.stuck.step.payment',
  agreement: 'cl.stuck.step.agreement',
  visit: 'cl.stuck.step.visit',
  team_lead_check: 'cl.stuck.step.team_lead_check',
  terms: 'cl.stuck.step.terms',
  upi: 'cl.stuck.step.upi',
};

export function stuckStatusText(r: StuckListRow, t: ReturnType<typeof useT>): string {
  if (r.waitingForTeamLead) return t(r.kind === 'business' ? 'stuck.list.waitingApproval' : 'stuck.list.waiting');
  return t(STEP_KEY[r.step] ?? 'cl.stuck.step.other');
}

export function HomeStuckRows({ rows }: { rows: StuckListRow[] | undefined }) {
  const t = useT();
  const to = useScreenPath();
  if (!rows) return null;
  if (rows.length === 0) return <p className="sub">{t('stuck.list.none')}</p>;
  return (
    <div className="lb-cl-home">
      {rows.map((r) => {
        const action = r.actions.find((a): a is keyof typeof ACTION => a in ACTION);
        return (
          <ListRow
            key={`${r.kind}-${r.id}`}
            testId="stuck-row"
            to={to('CA04-Profile', { id: r.code })}
            name={r.name}
            status={stuckStatusText(r, t)}
            tone={r.waitingForTeamLead ? 'amber' : r.step === 'payment' ? 'red' : 'ink'}
            small={`${t(KIND_KEY[r.kind])} · ${r.code}`}
            trailing={
              r.waitingForTeamLead ? (
                <WaitingMark />
              ) : action ? (
                <RowAction name={r.name} label={t(ACTION[action].label)} send={(channel) => ACTION[action].run(r.id, channel)} />
              ) : null
            }
          />
        );
      })}
    </div>
  );
}

export interface DoneRow {
  kind: string;
  at: string;
  name: string;
  code: string | null;
  ref?: string | null;
  status: string;
  extra: string | null;
}

const DONE_KEY: Record<string, MessageKey> = {
  registered: 'cl.done.registered',
  interview_booked: 'cl.done.interview_booked',
  vacancy_added: 'cl.done.vacancy_added',
  business_registered: 'cl.done.business_registered',
  partner_registered: 'cl.done.partner_registered',
};

export function HomeDoneRows({ rows, tagOf }: { rows: DoneRow[] | undefined; tagOf: (d: DoneRow) => string }) {
  const t = useT();
  const to = useScreenPath();
  if (!rows) return null;
  if (rows.length === 0) return <p className="sub">{t('ca.done.none')}</p>;
  return (
    <div className="lb-cl-home">
      {rows.map((d, i) => {
        const what = t(DONE_KEY[d.kind] ?? 'cl.done.call_outcome', { trade: d.extra ?? '' });
        const ref = d.ref ?? (d.code && /^(JS|BZ|RF)-/i.test(d.code) ? d.code : null);
        return (
          <ListRow
            key={`${d.kind}-${d.at}-${i}`}
            testId="done-row"
            to={ref ? to('CA04-Profile', { id: ref }) : undefined}
            name={d.name || '—'}
            status={t('cl.done.at', { what, time: formatTimeIST(d.at) })}
            tone="green"
            trailing={<DoneMark label={tagOf(d)} />}
          />
        );
      })}
    </div>
  );
}
