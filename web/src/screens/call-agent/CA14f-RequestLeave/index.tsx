import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAttendance } from '../../../attendance/AttendanceProvider';
import { attendanceKeys, useLeaveBalance, type LeaveBody, type LeaveHalf, type MyRequest } from '../../../attendance/api';
import { dateRange } from '../../../attendance/format';
import { DateField, FieldShell, SelectField } from '../../../components/fields';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { api } from '../../../lib/api/client';
import { isApiError } from '../../../lib/api/errors';
import { useScreenPath } from '../../../portals/PortalContext';
import '../../../attendance/attendance.css';

/** Where the server sent the request (routeReason), in the person's words. */
function routedKey(routeReason: string, office: boolean): MessageKey {
  if (routeReason === 'no_line') return 'att.leave.sent.noLine';
  if (routeReason === 'over_limit') return 'att.leave.sent.overLimit';
  return office ? 'att.leave.sent.office' : 'att.leave.sent.teamLead';
}

/**
 * Request leave — design CA14f-RequestLeave. Casual or emergency leave, dates
 * from a calendar (never typed) and a reason. It goes to the Team Lead (the
 * server decides where: more than 3 casual days in a month go to the Manager;
 * a Team Lead's, Manager's or Finance's own request goes up their line).
 * Days beyond the paid balance count as unpaid leave — nothing is blocked.
 * "Half day?" (owner decision 12 Nov): full day, or the first or second half
 * of one date — half a day of the balance; the other half is worked.
 */
export default function RequestLeave() {
  const t = useT();
  const to = useScreenPath();
  const toast = useToast();
  const qc = useQueryClient();
  const attendance = useAttendance();
  const office = attendance?.audience === 'office';
  const balance = useLeaveBalance();
  const [kind, setKind] = useState<LeaveBody['kind'] | ''>('');
  const [fromDate, setFrom] = useState('');
  const [toDate, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [half, setHalf] = useState<LeaveHalf | ''>('');
  const [tried, setTried] = useState(false);

  const send = useMutation<MyRequest, Error>({
    // A half day is one date: "To" is "From".
    mutationFn: () =>
      api.post<MyRequest>('/attendance/leave', {
        kind,
        fromDate,
        toDate: half ? fromDate : toDate || fromDate,
        reason: reason.trim(),
        ...(half ? { half } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: attendanceKeys.mine });
      void qc.invalidateQueries({ queryKey: attendanceKeys.balance });
      void qc.invalidateQueries({ queryKey: ['attendance', 'month'] });
    },
    onError: (e) => toast.error(isApiError(e) ? e.message : e.message),
  });

  const left = (k: 'casual' | 'emergency') => (balance.data ? String(balance.data[k].left) : '—');
  const toBefore = !half && Boolean(toDate && fromDate && toDate < fromDate);
  const errors = {
    kind: tried && !kind ? t('form.select.placeholder') : undefined,
    from: tried && !fromDate ? t('common.required') : undefined,
    to: toBefore ? t('att.leave.toBeforeFrom') : undefined,
    reason: tried && !reason.trim() ? t('common.required') : undefined,
  };
  const ready = Boolean(kind && fromDate && !toBefore && reason.trim());

  if (send.data) {
    const r = send.data;
    return (
      <div className="lb-page lb-att-page lb-att-page--narrow">
        <TopBar title={t('att.leave.title')} titleHidden />
        <h2 className="h1">{t('att.leave.title')}</h2>
        <div className="lb-att-ok" role="status">
          {r.half
            ? t('att.leave.sentHalf', { date: dateRange(r.fromDate ?? fromDate, r.fromDate ?? fromDate), half: t(r.half === 'first' ? 'att.leave.firstHalf' : 'att.leave.secondHalf') })
            : t('att.leave.sent', { dates: dateRange(r.fromDate ?? fromDate, r.toDate ?? (toDate || fromDate)), days: r.days ?? 0 })}
        </div>
        <p className="lb-att-muted" style={{ margin: 0 }}>
          {t(routedKey(r.routeReason, office))} {t('att.leave.smsNote')}
        </p>
        <div className="lb-att-actions">
          <Link className="btn bs lb-btn" to={to('CA14e-MyAttendance')}>
            {t('att.back')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="lb-page lb-att-page lb-att-page--narrow">
      <TopBar title={t('att.leave.title')} titleHidden />
        <h2 className="h1">{t('att.leave.title')}</h2>
      <form
        className="lb-att-page"
        style={{ gap: 18 }}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (ready && !send.isPending) send.mutate();
        }}
      >
        <div className="card lb-att-form">
          <SelectField
            label={t('att.leave.type')}
            required
            value={kind}
            onChange={(v) => setKind(v)}
            placeholder={t('att.leave.pick')}
            error={errors.kind}
            options={[
              { value: 'casual', label: t('att.leave.casual', { left: left('casual') }) },
              { value: 'emergency', label: t('att.leave.emergency', { left: left('emergency') }) },
            ]}
          />
          <DateField
            label={t('att.leave.from')}
            required
            value={fromDate}
            error={errors.from}
            onChange={(v) => {
              setFrom(v);
              if (toDate && toDate < v) setTo('');
            }}
          />
          <DateField label={t('att.leave.to')} required value={half ? fromDate : toDate || fromDate} min={fromDate || undefined} hint={half ? undefined : t('att.leave.toHint')} error={errors.to} onChange={setTo} disabled={Boolean(half)} />
          <fieldset className="lb-att-half lb-att-wide">
            <legend>{t('att.leave.halfDay')}</legend>
            <div className="lb-att-half__choices">
              {([['', 'att.leave.fullDay'], ['first', 'att.leave.firstHalf'], ['second', 'att.leave.secondHalf']] as const).map(([value, key]) => (
                <label key={value || 'full'} className={half === value ? 'is-on' : undefined}>
                  <input type="radio" name="leave-half" value={value || 'full'} checked={half === value} onChange={() => setHalf(value)} />
                  {t(key)}
                </label>
              ))}
            </div>
            {half && <p className="lb-att-muted lb-att-half__hint">{t('att.leave.halfHint')}</p>}
          </fieldset>
          <FieldShell label={t('att.leave.reason')} required error={errors.reason} className="lb-att-wide">
            {({ inputId, describedBy, invalid }) => (
              <textarea id={inputId} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid || undefined} required maxLength={500} />
            )}
          </FieldShell>
        </div>
        <div className="lb-att-warn">
          {t(office ? 'att.leave.goesToOffice' : 'att.leave.goesTo')} {t('att.leave.unpaid')}
        </div>
        <div className="lb-att-actions">
          <button type="submit" className="btn bp lb-btn" disabled={send.isPending} aria-busy={send.isPending || undefined}>
            {t('att.leave.send')}
          </button>
          <Link className="btn bs lb-btn" to={to('CA14e-MyAttendance')}>
            {t('common.cancel')}
          </Link>
        </div>
      </form>
    </div>
  );
}
