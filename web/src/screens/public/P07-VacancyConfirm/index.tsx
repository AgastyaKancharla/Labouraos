import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useI18n } from '../../../i18n/I18nProvider';
import { vacancyConfirmApi } from '../shared/api';
import { dateTimeLabel, dayLabel, rupeeRange, shiftText } from '../shared/format';
import { ActionError, LinkProblem, Loading, Muted, Ok, OtpBlock, PageTitle, Row, Warn } from '../shared/ui';

/**
 * P07-VacancyConfirm (rev 192 fix S3; no design file, built like P04-Agreement).
 * The owner (or the branch's contact person) opens the SMS link on their own
 * phone — no login, the token is the link — checks the vacancy the agent wrote
 * down (job, how many people, salary, shift, start date, business) and confirms
 * it with the code sent to the number the link went to. Only then can Laboura
 * show candidates for it. A used, expired or replaced link explains itself; a
 * vacancy already confirmed (by code on the visit or call) says so.
 */
export default function VacancyConfirm() {
  const { t, language } = useI18n();
  const token = useParams<{ token: string }>().token ?? '';
  const details = useQuery({ queryKey: ['vacancy-confirm', token], queryFn: () => vacancyConfirmApi.details(token), enabled: Boolean(token), retry: false });
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmed, setConfirmed] = useState(false);

  if (confirmed && details.data) {
    const d = details.data;
    return (
      <>
        <Ok emoji="✅">{t('pub.vac.confirmed')}</Ok>
        <Muted>{t('pub.vac.confirmedText', { count: d.headcountCount, job: d.roleTitle || d.trade })}</Muted>
      </>
    );
  }
  if (details.isLoading) return <Loading />;
  if (details.error || !details.data) return <LinkProblem error={details.error} onRetry={() => void details.refetch()} />;
  const d = details.data;
  const job = d.roleTitle ? `${d.roleTitle} · ${d.trade}` : d.trade;

  if (d.status !== 'awaiting_confirmation') {
    return (
      <>
        <PageTitle emoji="📋">{t('pub.vac.title', { business: d.business })}</PageTitle>
        {d.status === 'open' ? <Ok>{t('pub.vac.already')}</Ok> : <Warn>{t('pub.vac.closed')}</Warn>}
      </>
    );
  }

  // Rev 193: one button. "Send code to confirm" sends the code; typing it confirms in the same step.
  const confirm = async (typed: string) => {
    if (!requestId || typed.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await vacancyConfirmApi.confirm(token, requestId, typed);
      setConfirmed(true);
    } catch (e) {
      setError(e);
      setCode('');
      // Confirmed meanwhile (code on the visit) or changed: the page shows where it stands now.
      void details.refetch();
    } finally {
      setBusy(false);
    }
  };

  const salary = rupeeRange(d.salaryMinPaise, d.salaryMaxPaise);
  const per = d.salaryPeriod === 'daily' ? t('pub.offer.perDay') : t('pub.offer.perMonth');

  return (
    <>
      <PageTitle emoji="📋">{t('pub.vac.title', { business: d.business })}</PageTitle>
      <Muted>{t('pub.vac.intro')}</Muted>
      <div className="card">
        <Row label={t('pub.offer.business')}>{d.business}</Row>
        <Row label={t('pub.vac.role')}>{job}</Row>
        <Row label={t('pub.vac.people')}>{d.headcountCount}</Row>
        {salary && (
          <Row label={t('pub.vac.salary')}>
            {salary} {per}
          </Row>
        )}
        {d.shift && <Row label={t('pub.offer.shift')}>{shiftText(d.shift, t)}</Row>}
        {d.startDate && <Row label={t('pub.vac.start')}>{dayLabel(d.startDate, language)}</Row>}
      </div>
      <Muted>{t('pub.vac.wrong')}</Muted>
      <OtpBlock
        maskedPhone={d.maskedPhone}
        send={() => vacancyConfirmApi.sendOtp(token)}
        requestId={requestId}
        onRequestId={setRequestId}
        code={code}
        onCode={setCode}
        invalid={Boolean(error)}
        sendLabel={t('pub.vac.sendToConfirm')}
        hint={t('pub.vac.codeConfirms')}
        onComplete={(typed) => void confirm(typed)}
        submitting={busy}
        submittingLabel={t('pub.vac.confirming')}
      />
      <ActionError error={error} />
      <Muted>{t('pub.vac.expires', { when: dateTimeLabel(d.expiresAt, language) })}</Muted>
    </>
  );
}
