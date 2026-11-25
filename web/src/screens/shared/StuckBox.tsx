import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/Button';
import { MobileField } from '../../components/fields/MobileField';
import { SelectField } from '../../components/fields';
import { useT } from '../../i18n/I18nProvider';
import type { MessageKey } from '../../i18n/en';
import { api } from '../../lib/api/client';
import { PAYER_RELATIONS } from '../call-agent/_registration/options';
import { SendLinkButtons, type SendChannel } from '../../components/SendLinkButtons';

/**
 * "Where they're stuck" (Master Guide rev 204, 21 Nov) on every job seeker,
 * business and referral partner profile in the call agent, Team Lead, Manager
 * and CEO views: the account owner, the step the person is on and the link
 * that matches it, with "Send on WhatsApp" and a small "Send by SMS" (rev 211).
 * Team Leads, Managers and the CEO keep the view but get no buttons (the server
 * lists no actions for them and refuses their sends). Every button calls the
 * existing route with its own permissions; a refusal (for example a
 * do-not-call or wrong-number block) shows the server's message. Waiting for
 * the Team Lead's ID check shows that, with no resend.
 */
export type StuckKind = 'job_seeker' | 'business' | 'referral';
type StuckAction = 'registration_link' | 'payment_link' | 'someone_else_pays' | 'agreement_link' | 'partner_terms_link';

export interface StuckView {
  kind: StuckKind;
  id: string;
  code: string;
  name: string;
  owner: { name: string; code: string } | null;
  step: string;
  state: string;
  reason: string | null;
  waitingForTeamLead: boolean;
  actions: StuckAction[];
}

export const STEP: Record<string, MessageKey> = {
  consent: 'stuck.step.consent',
  selfie: 'stuck.step.selfie',
  id_check: 'stuck.step.id_check',
  payment: 'stuck.step.payment',
  agreement: 'stuck.step.agreement',
  visit: 'stuck.step.visit',
  team_lead_check: 'stuck.step.team_lead_check',
  terms: 'stuck.step.terms',
  upi: 'stuck.step.upi',
  complete: 'stuck.step.complete',
  closed: 'stuck.step.closed',
};

const STATE: Record<string, MessageKey> = {
  not_started: 'stuck.state.not_started',
  in_progress: 'stuck.state.in_progress',
  stuck: 'stuck.state.stuck',
  done: 'stuck.state.done',
  confirming: 'stuck.state.in_progress',
};

/** The link each action sends; `channel` undefined or 'whatsapp' = WhatsApp first (SMS as backup), 'sms' = by SMS only (rev 211). */
export const ACTION: Record<Exclude<StuckAction, 'someone_else_pays'>, { label: MessageKey; run: (id: string, channel?: SendChannel) => Promise<unknown> }> = {
  registration_link: { label: 'stuck.action.registration_link', run: (id, channel) => api.post('/consent/links', { jobSeekerId: id, channel }) },
  payment_link: { label: 'stuck.action.payment_link', run: (id, channel) => api.post(`/job-seekers/${encodeURIComponent(id)}/resend-payment`, { channel }) },
  agreement_link: { label: 'stuck.action.agreement_link', run: (id, channel) => api.post(`/businesses/${encodeURIComponent(id)}/agreement-links`, { channel }) },
  partner_terms_link: { label: 'stuck.action.partner_terms_link', run: (id, channel) => api.post(`/referrals/${encodeURIComponent(id)}/terms-links`, { channel }) },
};

export function stuckQueryKey(kind: StuckKind, id: string) {
  return ['profile-stuck', kind, id] as const;
}

export function StuckBox({ kind, id }: { kind: StuckKind; id: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const stuck = useQuery({
    queryKey: stuckQueryKey(kind, id),
    queryFn: () => api.get<StuckView>('/profile-stuck', { query: { kind, id } }),
    enabled: Boolean(id),
    retry: false,
  });
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherPhone, setOtherPhone] = useState('');
  const [relation, setRelation] = useState('');
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: stuckQueryKey(kind, id) });
  };
  if (stuck.isLoading || stuck.error || !stuck.data) return null;
  const s = stuck.data;
  const stepLabel = t(STEP[s.step] ?? 'stuck.step.unknown');
  return (
    <section className="card lb-stuck" aria-label={t('stuck.title')} data-testid="stuck-box">
      <h2 className="h2">{t('stuck.title')}</h2>
      <div className="row">
        <span>{t('stuck.owner')}</span>
        <b data-testid="stuck-owner">{s.owner ? `${s.owner.name} · ${s.owner.code}` : t('stuck.noOwner')}</b>
      </div>
      <div className="row">
        <span>{t('stuck.step')}</span>
        <b data-testid="stuck-step">
          {stepLabel}
          {s.step !== 'complete' && STATE[s.state] ? ` · ${t(STATE[s.state])}` : ''}
        </b>
      </div>
      {s.waitingForTeamLead ? (
        <p className="lb-ca-why" role="status" data-testid="stuck-waiting">
          {t(s.kind === 'business' ? 'stuck.waitingApproval' : 'stuck.waitingIdCheck')}
        </p>
      ) : (
        s.reason && <p className="sub">{s.reason}</p>
      )}
      {s.actions.length > 0 && (
        <div className="lb-stuck__actions">
          {s.actions.map((action) =>
            action === 'someone_else_pays' ? (
              <Button key={action} onClick={() => setOtherOpen((o) => !o)} aria-expanded={otherOpen}>
                {t('stuck.action.someone_else_pays')}
              </Button>
            ) : (
              <span key={action} className="lb-stuck__pair">
                <SendLinkButtons label={t(ACTION[action].label)} run={(channel) => ACTION[action].run(s.id, channel)} onSent={refresh} testId={`stuck-send-${action}`} />
              </span>
            ),
          )}
        </div>
      )}
      {otherOpen && (
        <div className="lb-stuck__other">
          <MobileField label={t('stuck.otherPhone')} value={otherPhone} onChange={setOtherPhone} required />
          <SelectField
            label={t('stuck.otherRelation')}
            value={relation}
            onChange={setRelation}
            options={PAYER_RELATIONS.map((r) => ({ value: r.value, label: t(r.label as MessageKey) }))}
          />
          <SendLinkButtons
            label={t('stuck.otherSend')}
            disabled={otherPhone.length !== 10}
            run={(channel) =>
              api.post(`/job-seekers/${encodeURIComponent(s.id)}/payment-only-link`, { phone: `+91${otherPhone}`, channel, ...(relation ? { relation } : {}) })
            }
            onSent={refresh}
            testId="stuck-send-other-payer"
          />
        </div>
      )}
    </section>
  );
}
