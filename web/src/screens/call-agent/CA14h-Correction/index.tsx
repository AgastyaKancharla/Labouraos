import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAttendance } from '../../../attendance/AttendanceProvider';
import { attendanceKeys, type CorrectionStatus, type MyRequest } from '../../../attendance/api';
import { dayLabel, hhmm } from '../../../attendance/format';
import { statusLabelKey } from '../../../attendance/statuses';
import { DateField, FieldShell, SelectField } from '../../../components/fields';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { api } from '../../../lib/api/client';
import { istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import '../../../attendance/attendance.css';

function routedKey(routeReason: string, office: boolean): MessageKey {
  if (routeReason === 'no_line') return 'att.corr.sent.noLine';
  if (routeReason === 'third_correction') return 'att.corr.sent.third';
  return office ? 'att.corr.sent.office' : 'att.corr.sent.teamLead';
}

/**
 * Request a correction — design CA14h-Correction. For when something went
 * wrong (system down, forgot to change status). The day comes from a
 * calendar and the times from a time picker — never typed — and the time
 * must already have passed. The Team Lead approves or rejects it with a
 * reason (a third correction in a month goes to the Manager); the change
 * and the reason are kept. Nobody ever edits their own times.
 *
 * The server accepts working time only (Available, team meeting, training,
 * one-to-one), so the design's "System problem" choice is not offered: a
 * system problem is picked from the status menu at the time and approved
 * there.
 */
export default function RequestCorrection() {
  const t = useT();
  const to = useScreenPath();
  const toast = useToast();
  const qc = useQueryClient();
  const attendance = useAttendance();
  const audience = attendance?.audience ?? 'agent';
  const office = audience === 'office';
  const today = istDateKey(useNow());
  const [date, setDate] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [status, setStatus] = useState<CorrectionStatus>('available');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);

  const send = useMutation<MyRequest, Error>({
    mutationFn: () => api.post<MyRequest>('/attendance/corrections', { date, from, to: until, status, reason: reason.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: attendanceKeys.mine });
      void qc.invalidateQueries({ queryKey: ['attendance', 'month'] });
    },
    onError: (e) => toast.error(e.message),
  });

  const order = Boolean(from && until && until <= from);
  const errors = {
    date: tried && !date ? t('common.required') : undefined,
    from: tried && !from ? t('common.required') : undefined,
    until: order ? t('att.corr.toAfterFrom') : tried && !until ? t('common.required') : undefined,
    reason: tried && !reason.trim() ? t('common.required') : undefined,
  };
  const ready = Boolean(date && from && until && !order && reason.trim());
  const choices: { value: CorrectionStatus; label: string }[] = [
    { value: 'available', label: t('att.corr.available') },
    { value: 'team_meeting', label: t(statusLabelKey('team_meeting', audience)) },
    { value: 'training', label: t(statusLabelKey('training', audience)) },
    { value: 'one_to_one', label: t(statusLabelKey('one_to_one', audience)) },
  ];

  if (send.data) {
    const r = send.data;
    return (
      <div className="lb-page lb-att-page lb-att-page--narrow">
        <TopBar title={t('att.corr.title')} titleHidden />
        <h2 className="h1">{t('att.corr.title')}</h2>
        <div className="lb-att-ok" role="status">
          {t('att.corr.sent', { date: dayLabel(r.date ?? date), from: r.startAt ? hhmm(r.startAt) : from, to: r.endAt ? hhmm(r.endAt) : until })}
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

  const timeField = (label: string, value: string, set: (v: string) => void, error: string | undefined) => (
    <FieldShell label={label} required error={error}>
      {({ inputId, describedBy, invalid }) => (
        <input id={inputId} type="time" step={60} value={value} onChange={(e) => set(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid || undefined} required />
      )}
    </FieldShell>
  );

  return (
    <div className="lb-page lb-att-page lb-att-page--narrow">
      <TopBar title={t('att.corr.title')} titleHidden />
        <h2 className="h1">{t('att.corr.title')}</h2>
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
          <DateField label={t('att.corr.day')} required value={date} max={today} error={errors.date} onChange={setDate} />
          {timeField(t('att.corr.from'), from, setFrom, errors.from)}
          {timeField(t('att.corr.to'), until, setUntil, errors.until)}
          <SelectField label={t('att.corr.should')} required value={status} placeholder={null} options={choices} onChange={(v) => v && setStatus(v)} />
          <FieldShell label={t('att.corr.reason')} required error={errors.reason} className="lb-att-wide">
            {({ inputId, describedBy, invalid }) => (
              <textarea id={inputId} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid || undefined} required maxLength={500} />
            )}
          </FieldShell>
        </div>
        <div className="lb-att-warn">{t(office ? 'att.corr.goesToOffice' : 'att.corr.goesTo')}</div>
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
