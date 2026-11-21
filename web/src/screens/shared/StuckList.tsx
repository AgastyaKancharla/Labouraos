import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n/I18nProvider';
import { api } from '../../lib/api/client';
import { isApiError } from '../../lib/api/errors';
import { ACTION, STEP, type StuckKind, type StuckView } from './StuckBox';

/**
 * "Stuck registrations" (22 Nov, owner testing): every stuck job seeker,
 * business and referral partner the viewer answers for (GET /profile-stuck/list:
 * a call agent his own, a Team Lead his team's) — stuck at payment, waiting for
 * the Team Lead's ID check (no resend), link not finished, agreement not
 * signed, partner terms / selfie / ID / UPI not done — each with the same
 * buttons as the profile's "Where they're stuck" box.
 */
export interface StuckListRow extends StuckView {
  since: string;
  ownerId?: string | null;
}

export const STUCK_LIST_KEY = ['profile-stuck', 'list'] as const;

export function useStuckList() {
  return useQuery({ queryKey: STUCK_LIST_KEY, queryFn: () => api.get<{ rows: StuckListRow[] }>('/profile-stuck/list') });
}

const KIND_KEY: Record<StuckKind, 'stuck.kind.job_seeker' | 'stuck.kind.business' | 'stuck.kind.referral'> = {
  job_seeker: 'stuck.kind.job_seeker',
  business: 'stuck.kind.business',
  referral: 'stuck.kind.referral',
};

export function StuckList({
  rows,
  showOwner = false,
  nameCell,
  extra,
}: {
  rows: StuckListRow[] | undefined;
  /** Team views: the agent each one belongs to. */
  showOwner?: boolean;
  /** How the name is drawn (for example a link to the person's page). */
  nameCell?: (row: StuckListRow) => ReactNode;
  /** More on a row (for example the Team Lead's "Remind"). */
  extra?: (row: StuckListRow) => ReactNode;
}) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const send = useMutation({
    mutationFn: ({ run }: { run: () => Promise<unknown>; name: string }) => run(),
    onSuccess: (_res, { name }) => {
      toast.success(`${name} · ${t('stuck.sent')}`);
      void queryClient.invalidateQueries({ queryKey: STUCK_LIST_KEY });
    },
    // The server's own words (a do-not-call block, a one-a-minute limit, a scope refusal).
    onError: (e) => toast.error(isApiError(e) ? e.message : t('error.server')),
  });
  if (!rows) return null;
  if (rows.length === 0) return <p className="sub">{t('stuck.list.none')}</p>;
  return (
    <>
      {rows.map((r) => {
        const where = r.waitingForTeamLead
          ? t(r.kind === 'business' ? 'stuck.list.waitingApproval' : 'stuck.list.waiting')
          : r.kind === 'business' && r.step === 'agreement'
            ? t('stuck.list.agreement')
            : t(STEP[r.step] ?? 'stuck.step.unknown');
        const buttons = r.actions.filter((a): a is keyof typeof ACTION => a in ACTION);
        return (
          <div className="row lb-stuck-row" key={`${r.kind}-${r.id}`} data-testid="stuck-row">
            <span>
              {nameCell ? nameCell(r) : <b>{r.name}</b>} <span className="sub">· {t(KIND_KEY[r.kind])} · {r.code}</span>
              <br />
              <span className="sub">
                {where}
                {showOwner ? ` · ${t('stuck.list.agent')}: ${r.owner?.name ?? t('stuck.noOwner')}` : ''}
              </span>
            </span>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {r.waitingForTeamLead ? <span className="sub">{t('ca.stuck.waitingNote')}</span> : null}
              {buttons.map((a) => (
                <button
                  key={a}
                  type="button"
                  className="tag ta lb-ca-chip"
                  disabled={send.isPending}
                  onClick={() => send.mutate({ run: () => ACTION[a].run(r.id), name: r.name })}
                >
                  {t(ACTION[a].label)}
                </button>
              ))}
              {extra ? extra(r) : null}
            </span>
          </div>
        );
      })}
    </>
  );
}
