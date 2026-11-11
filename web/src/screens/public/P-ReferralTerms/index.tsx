import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { api } from '../../../lib/api/client';
import { formatINR } from '../../../lib/format/money';
import { LinkProblem, Loading, Muted, PageTitle, usePersonLanguage } from '../shared/ui';
import './referral-terms.css';

/**
 * Referral partner terms (public, /app/p/referral-terms). No design file; it
 * uses the public phone pages' look. Linked from the partner's registration
 * link (the terms they sign by OTP) and from the call agent's CA15 screen.
 * `?lang=kn|hi|en` opens it in the partner's language.
 *
 * Written from the Master Guide's referral rules (what earns, when it is
 * paid, payout details) and the pause rule already in the software; amounts
 * come from Settings through GET /referral-terms.
 */
interface Terms {
  version: string;
  referralPayoutPaise: number;
  activationFeePaise: number;
  payoutDetailsCoolingHours: number;
}

const SECTIONS: { title: MessageKey; lines: MessageKey[] }[] = [
  { title: 'rterms.earn.title', lines: ['rterms.earn.join', 'rterms.earn.notPay', 'rterms.earn.business', 'rterms.earn.self'] },
  { title: 'rterms.paid.title', lines: ['rterms.paid.queued', 'rterms.paid.how', 'rterms.paid.linked'] },
  { title: 'rterms.details.title', lines: ['rterms.details.add', 'rterms.details.change'] },
  { title: 'rterms.pause.title', lines: ['rterms.pause.who', 'rterms.pause.effect'] },
  { title: 'rterms.calls.title', lines: ['rterms.calls.recorded', 'rterms.calls.id'] },
];

export default function ReferralTerms() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  // Once per language link, so the switcher still works afterwards.
  usePersonLanguage(params.get('lang'), `referral-terms:${params.get('lang') ?? ''}`);
  const terms = useQuery({
    queryKey: ['referral-terms'],
    queryFn: () => api.get<Terms>('/referral-terms', { auth: false }),
    retry: false,
  });

  useEffect(() => {
    document.title = `${t('screen.P-ReferralTerms')} · ${t('app.name')}`;
  }, [t]);

  if (terms.isLoading) return <Loading />;
  if (terms.error || !terms.data) return <LinkProblem error={terms.error} onRetry={() => void terms.refetch()} />;
  const d = terms.data;
  const vars = {
    reward: formatINR(d.referralPayoutPaise),
    fee: formatINR(d.activationFeePaise),
    hours: d.payoutDetailsCoolingHours,
    version: d.version,
  };

  return (
    <>
      <PageTitle>{t('screen.P-ReferralTerms')}</PageTitle>
      <Muted>{t('rterms.intro')}</Muted>
      {SECTIONS.map((section) => (
        <section key={section.title} className="card lb-rterms">
          <h2 className="lb-rterms__h">{t(section.title)}</h2>
          <ul className="lb-rterms__list">
            {section.lines.map((line) => (
              <li key={line}>{t(line, vars)}</li>
            ))}
          </ul>
        </section>
      ))}
      <Muted>{t('rterms.version', vars)}</Muted>
    </>
  );
}
