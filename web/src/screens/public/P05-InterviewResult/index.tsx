import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DateField } from '../../../components/fields/DateField';
import { MoneyField } from '../../../components/fields/MoneyField';
import { SelectField } from '../../../components/fields/TextField';
import { useI18n } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { interviewApi, type OwnerResult } from '../shared/api';
import { dayLabel, timeLabel } from '../shared/format';
import { ActionError, Choice, LinkProblem, Loading, Muted, Ok, OtpBlock, PageTitle, usePersonLanguage, Warn } from '../shared/ui';

/**
 * P05-InterviewResult: the owner records the result on their own phone,
 * confirmed by OTP — a signed record if they later hire someone they said no
 * to. Salary is typed in rupees (sent as paise); there is no internal ID box.
 * "Selected" goes straight on to paying the fee (P05b).
 */
const REASON: Record<string, MessageKey> = {
  skills: 'pub.result.reason.skills',
  experience: 'pub.result.reason.experience',
  communication: 'pub.result.reason.communication',
  salary_expectation: 'pub.result.reason.salary',
  not_suitable: 'pub.result.reason.notSuitable',
  other: 'pub.result.reason.other',
};

export default function InterviewResult() {
  const { t, language } = useI18n();
  const token = useParams<{ token: string }>().token ?? '';
  const navigate = useNavigate();
  const to = useScreenPath();
  const today = istDateKey(useNow(60_000));
  const details = useQuery({ queryKey: ['owner-result', token], queryFn: () => interviewApi.ownerResult(token), enabled: Boolean(token), retry: false });
  usePersonLanguage(details.data?.language, token);
  const [result, setResult] = useState<OwnerResult | null>(null);
  const [salary, setSalary] = useState<number | null>(null);
  const [joining, setJoining] = useState('');
  const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [recorded, setRecorded] = useState<OwnerResult | null>(null);

  if (details.isLoading) return <Loading />;
  if (details.error || !details.data) return <LinkProblem error={details.error} onRetry={() => void details.refetch()} />;
  const d = details.data;
  const name = d.candidateFirstName;

  if (recorded) {
    return (
      <>
        <Ok>{t('pub.result.thanks')}</Ok>
        <Muted>
          {recorded === 'selected'
            ? t('pub.result.selectedDone', { name })
            : recorded === 'not_selected'
              ? t('pub.result.notSelectedDone', { name })
              : t('pub.result.noShowDone', { name })}
        </Muted>
      </>
    );
  }
  if (!d.awaitingResult) {
    return (
      <>
        <PageTitle>{t('pub.result.title', { name })}</PageTitle>
        <Warn>{t('pub.result.alreadyRecorded')}</Warn>
      </>
    );
  }

  const formOk =
    result === 'selected' ? Boolean(salary && salary > 0 && joining) : result === 'not_selected' ? Boolean(reason) : result === 'candidate_no_show';
  const canSubmit = formOk && Boolean(requestId) && code.length === 6;

  const submit = async () => {
    if (!canSubmit || !result || !requestId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await interviewApi.submitOwnerResult(token, {
        otpRequestId: requestId,
        otpCode: code,
        result,
        ...(result === 'not_selected' ? { resultReason: reason } : {}),
        ...(result === 'selected' ? { selectedSalaryPaise: salary!, selectedJoiningDate: joining } : {}),
      });
      const reference = response.placement?.payment?.upiReference;
      if (result === 'selected' && reference) navigate(to('P05b-PayFee', { token: reference }));
      else setRecorded(result);
    } catch (e) {
      setError(e);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle>{t('pub.result.title', { name })}</PageTitle>
      <span className="sub">
        {t('pub.result.sub', { day: dayLabel(d.slotStartsAt, language), business: d.businessName, time: timeLabel(d.resultDueAt, language) })}
      </span>
      <Choice type="radio" name="result" checked={result === 'selected'} onChange={() => setResult('selected')} title={t('pub.result.selected')} />
      {result === 'selected' && (
        <div className="card lb-pub-card">
          <MoneyField label={t('pub.result.salary')} value={salary} onChange={setSalary} required hint={t('pub.result.salaryHint')} />
          <DateField label={t('pub.result.joining')} value={joining} onChange={setJoining} min={today} required />
        </div>
      )}
      <Choice type="radio" name="result" checked={result === 'not_selected'} onChange={() => setResult('not_selected')} title={t('pub.result.notSelected')} />
      {result === 'not_selected' && (
        <SelectField
          label={t('pub.result.reason')}
          value={reason}
          onChange={setReason}
          options={d.reasons.map((r) => ({ value: r, label: t(REASON[r] ?? 'pub.result.reason.other') }))}
          required
        />
      )}
      <Choice type="radio" name="result" checked={result === 'candidate_no_show'} onChange={() => setResult('candidate_no_show')} title={t('pub.result.noShow', { name })} />
      <OtpBlock
        maskedPhone={d.maskedPhone}
        send={() => interviewApi.sendOwnerOtp(token)}
        requestId={requestId}
        onRequestId={setRequestId}
        code={code}
        onCode={setCode}
        invalid={Boolean(error)}
      />
      <ActionError error={error} />
      <button type="button" className="btn bp full" disabled={!canSubmit || busy} aria-busy={busy || undefined} onClick={() => void submit()}>
        {t('pub.result.submit')}
      </button>
    </>
  );
}
