import { useState } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { DataTable, type Column } from '../components/DataTable';
import { useToast } from '../components/Toast';
import { useT } from '../i18n/I18nProvider';
import { isApiError } from '../lib/api/errors';
import { useReopenDay, useSetShift, useTeamShifts, type ShiftRow } from './api';
import { settingClock } from './format';

/**
 * Own shifts (Master Guide rev 202, decided 21 Nov): each person's shift — a
 * start time plus about 9 hours — set by their Team Lead, a Manager over them
 * or the CEO (T-Attendance, MG-Attendance, C-Team-Attendance). Lateness, the
 * late grace and the sign-in safety cap follow it; the person sees it on their
 * own attendance screens. The server decides who may change whose shift.
 */
export function ShiftsPanel() {
  const t = useT();
  const shifts = useTeamShifts();
  const [editing, setEditing] = useState<string | null>(null);
  const company = shifts.data?.companyShift;
  const columns: Column<ShiftRow>[] = [
    { key: 'person', header: t('att.shifts.person'), cell: (r) => `${r.name} (${r.code})`, sortValue: (r) => r.name },
    {
      key: 'shift',
      header: t('att.shifts.shift'),
      cell: (r) => (
        <span>
          {settingClock(r.shiftStart)} – {settingClock(r.shiftEnd)} <span className="tl-sub">· {t(r.own ? 'att.shifts.own' : 'att.shifts.company')}</span>
        </span>
      ),
      sortValue: (r) => r.shiftStart,
    },
    {
      key: 'edit',
      header: '',
      cell: (r) =>
        editing === r.staffId ? (
          <ShiftEditor row={r} onDone={() => setEditing(null)} />
        ) : (
          <Button size="compact" onClick={() => setEditing(r.staffId)}>
            {t('att.shifts.edit')}
          </Button>
        ),
    },
  ];
  return (
    <Card title={t('att.shifts.title')} flush aria-label={t('att.shifts.title')}>
      {company ? (
        <div className="tl-note" style={{ padding: '0 18px 8px' }}>
          {t('att.shifts.intro', { start: settingClock(company.start), end: settingClock(company.end) })}
        </div>
      ) : null}
      <DataTable
        columns={columns}
        rows={shifts.data?.people}
        rowKey={(r) => r.staffId}
        caption={t('att.shifts.title')}
        loading={shifts.isPending}
        error={shifts.error}
        onRetry={() => void shifts.refetch()}
        emptyTitle={t('att.shifts.empty')}
      />
    </Card>
  );
}

function ShiftEditor({ row, onDone }: { row: ShiftRow; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const save = useSetShift();
  const [start, setStart] = useState(row.shiftStart);
  const [end, setEnd] = useState(row.shiftEnd);
  const send = (shiftStart: string | null, shiftEnd: string | null) =>
    save.mutate(
      { staffId: row.staffId, shiftStart, shiftEnd },
      {
        onSuccess: () => {
          toast.success(t('att.shifts.saved', { name: row.name }));
          onDone();
        },
        onError: (error) => toast.error(isApiError(error) ? error.message : String(error)),
      },
    );
  return (
    <div className="tl-inline">
      <label className="field">
        {t('att.shifts.start')}
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label={`${t('att.shifts.start')} · ${row.name}`} />
      </label>
      <label className="field">
        {t('att.shifts.end')}
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label={`${t('att.shifts.end')} · ${row.name}`} />
      </label>
      <Button size="compact" variant="primary" loading={save.isPending} disabled={!start || !end} onClick={() => send(start, end)}>
        {t('att.shifts.save')}
      </Button>
      {row.own ? (
        <Button size="compact" disabled={save.isPending} onClick={() => send(null, null)}>
          {t('att.shifts.reset')}
        </Button>
      ) : null}
      <Button size="compact" onClick={onDone}>
        {t('att.shifts.cancel')}
      </Button>
    </div>
  );
}

/**
 * Reopen today (decided 21 Nov): a Team Lead, a Manager over the person or the
 * CEO opens today's ended day again, with a reason (audited). Only today's
 * day; the server refuses anything else.
 */
export function ReopenDayButton({ dayId, name }: { dayId: string; name: string }) {
  const t = useT();
  const toast = useToast();
  const reopen = useReopenDay();
  const [reason, setReason] = useState<string | null>(null);
  if (reason === null) {
    return (
      <Button size="compact" onClick={() => setReason('')}>
        {t('att.reopen.button')}
      </Button>
    );
  }
  return (
    <div className="tl-inline">
      <input aria-label={`${t('att.reopen.reason')} · ${name}`} placeholder={t('att.reopen.reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button
        size="compact"
        variant="primary"
        disabled={!reason.trim()}
        loading={reopen.isPending}
        onClick={() =>
          reopen.mutate(
            { dayId, reason: reason.trim() },
            {
              onSuccess: () => {
                toast.success(t('att.reopen.done'));
                setReason(null);
              },
              onError: (error) => toast.error(isApiError(error) ? error.message : String(error)),
            },
          )
        }
      >
        {t('att.shifts.save')}
      </Button>
      <Button size="compact" onClick={() => setReason(null)}>
        {t('att.shifts.cancel')}
      </Button>
    </div>
  );
}
