import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { Modal } from '../../../components/Modal';
import { StatusPill } from '../../../components/Badge';
import { DateField, MoneyField, TextField } from '../../../components/fields';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateIST, istDateKey, istStartOfDay } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { PricingTabs } from '../_kit/tabs';

/**
 * Pricing & policy — design C-Pricing.dc.html. Every number the software runs
 * on. A change starts on the date picked and never alters old records. Also
 * the attendance and leave settings (shift, grace, tolerance, weekly day off)
 * and the public holiday list, which only the CEO changes.
 */
type Policy = Record<string, unknown> & { id: string; weeklyOffDays: number[] };
interface History {
  current: Policy;
  since: Record<string, string>;
  scheduled: { id: string; effectiveFrom: string; setBy: string | null; changes: { field: string; before: unknown; after: unknown }[] }[];
  history: { id: string; effectiveFrom: string; setBy: string | null; changes: { field: string; before: unknown; after: unknown }[] }[];
}
type Kind = 'paise' | 'int' | 'hours' | 'time';
interface Field {
  key: string;
  label: string;
  kind: Kind;
}
interface Rule {
  name: string;
  fields: Field[];
  show: (p: Policy) => string;
  /** Saved through its own endpoint instead of a new policy version. */
  save?: (values: Record<string, unknown>) => Promise<unknown>;
}

const n = (p: Policy, k: string) => Number(p[k]);
const t12 = (hhmm: unknown) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return m ? `${hh}:${String(m).padStart(2, '0')} ${suffix}` : `${hh} ${suffix}`;
};

export const RULES: Rule[] = [
  { name: 'Activation fee (job seeker)', fields: [{ key: 'activationFeePaise', label: 'Fee', kind: 'paise' }], show: (p) => `${formatINR(n(p, 'activationFeePaise'))} · no GST` },
  { name: 'Placement fee', fields: [{ key: 'placementFeePercent', label: "% of first month's salary", kind: 'int' }, { key: 'gstPercent', label: 'GST %', kind: 'int' }], show: (p) => `${n(p, 'placementFeePercent')}% of first month's salary + ${n(p, 'gstPercent')}% GST` },
  { name: 'Job seeker guarantee', fields: [{ key: 'jobSeekerGuaranteeDays', label: 'Days', kind: 'int' }], show: (p) => `${n(p, 'jobSeekerGuaranteeDays')} days` },
  { name: 'Hits before deactivation', fields: [{ key: 'maxHits', label: 'Hits', kind: 'int' }], show: (p) => String(n(p, 'maxHits')) },
  { name: 'Offer reply time', fields: [{ key: 'offerReplyHours', label: 'Hours', kind: 'int' }], show: (p) => `${n(p, 'offerReplyHours')} hours` },
  { name: 'Interview result due', fields: [{ key: 'interviewResultDeadline', label: 'By (same day)', kind: 'time' }], show: (p) => `${t12(p.interviewResultDeadline)} same day` },
  { name: 'Fee due after selection', fields: [{ key: 'placementPaymentDueHours', label: 'Hours', kind: 'int' }], show: (p) => `${n(p, 'placementPaymentDueHours')} hours` },
  { name: 'Replacement guarantee', fields: [{ key: 'replacementWindowDays', label: 'Days', kind: 'int' }, { key: 'maxFreeReplacements', label: 'Free replacements', kind: 'int' }], show: (p) => `${n(p, 'replacementWindowDays')} days · ${n(p, 'maxFreeReplacements')} free replacements` },
  { name: 'Replacement search before refund', fields: [{ key: 'replacementSearchDays', label: 'Days', kind: 'int' }], show: (p) => `${n(p, 'replacementSearchDays')} days, then 100% refund` },
  { name: 'No-bypass', fields: [{ key: 'noBypassMonths', label: 'Months', kind: 'int' }, { key: 'noBypassPenaltyPercent', label: 'Penalty % on top of the fee', kind: 'int' }], show: (p) => `${n(p, 'noBypassMonths')} months · full fee + ${n(p, 'noBypassPenaltyPercent')}% + GST` },
  { name: 'Referral payout', fields: [{ key: 'referralPayoutPaise', label: 'Payout', kind: 'paise' }], show: (p) => `${formatINR(n(p, 'referralPayoutPaise'))} when the referred person joins` },
  { name: 'Joining reward', fields: [{ key: 'joiningRewardPaise', label: 'Reward', kind: 'paise' }, { key: 'joiningRewardAfterDays', label: 'After days in the job', kind: 'int' }], show: (p) => `${formatINR(n(p, 'joiningRewardPaise'))} after ${n(p, 'joiningRewardAfterDays')} days in the job` },
  { name: 'Calling hours', fields: [{ key: 'callingHoursStart', label: 'From', kind: 'time' }, { key: 'callingHoursEnd', label: 'To', kind: 'time' }], show: (p) => `${t12(p.callingHoursStart)} – ${t12(p.callingHoursEnd)}` },
  {
    name: 'Shift and production',
    fields: [
      { key: 'shiftStart', label: 'Shift starts', kind: 'time' },
      { key: 'shiftEnd', label: 'Shift ends', kind: 'time' },
      { key: 'productionHoursFullDay', label: 'Production hours for a full day', kind: 'hours' },
      { key: 'halfDayBelowHours', label: 'Half day below (hours)', kind: 'hours' },
      { key: 'dayToleranceMinutes', label: 'Full/half-day tolerance (minutes)', kind: 'int' },
      { key: 'lateGraceMinutes', label: 'Late-login grace (minutes)', kind: 'int' },
    ],
    show: (p) => `${t12(p.shiftStart)} – ${t12(p.shiftEnd)} · ${n(p, 'productionHoursFullDay')} production hours · half day under ${n(p, 'halfDayBelowHours')} h · tolerance ${n(p, 'dayToleranceMinutes')} min · late after ${n(p, 'lateGraceMinutes')} min grace`,
  },
  {
    name: 'Breaks and idle',
    fields: [
      { key: 'shortBreakMinutes', label: 'Short break (minutes, ×2)', kind: 'int' },
      { key: 'lunchMinutes', label: 'Lunch (minutes)', kind: 'int' },
      { key: 'idleAfterMinutes', label: 'Idle after (minutes)', kind: 'int' },
    ],
    show: (p) => `2 × ${n(p, 'shortBreakMinutes')} min + ${n(p, 'lunchMinutes')} min lunch · idle after ${n(p, 'idleAfterMinutes')} min`,
  },
  { name: 'Paid leave', fields: [{ key: 'casualLeavePerMonth', label: 'Casual a month', kind: 'int' }, { key: 'emergencyLeavePerMonth', label: 'Emergency a month', kind: 'int' }], show: (p) => `${n(p, 'casualLeavePerMonth') + n(p, 'emergencyLeavePerMonth')} a month (${n(p, 'casualLeavePerMonth')} casual, ${n(p, 'emergencyLeavePerMonth')} emergency) · carries forward` },
  {
    name: 'Approval limits (Finance)',
    fields: [{ key: 'financeBusinessRefundLimitPaise', label: 'Business refund up to', kind: 'paise' }, { key: 'financeExpenseLimitPaise', label: 'Expense up to', kind: 'paise' }],
    show: (p) => `Finance approves refunds up to ${formatINR(n(p, 'financeBusinessRefundLimitPaise'))} and expenses up to ${formatINR(n(p, 'financeExpenseLimitPaise'))}; above that, the CEO`,
    save: (v) => api.put('/pricing/approval-limits', { businessRefundLimitPaise: v.financeBusinessRefundLimitPaise, expenseLimitPaise: v.financeExpenseLimitPaise }),
  },
];

const FIELD_LABEL: Record<string, string> = Object.fromEntries(RULES.flatMap((r) => r.fields.map((f) => [f.key, `${r.name} · ${f.label}`])));
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function show(v: unknown, key: string): string {
  if (key.endsWith('Paise') && typeof v === 'number') return formatINR(v);
  if (key === 'weeklyOffDays' && Array.isArray(v)) return v.map((d) => WEEKDAYS[d as number]?.slice(0, 3)).join(', ') || 'none';
  return String(v);
}

export default function Pricing() {
  const to = useScreenPath();
  const history = useQuery({ queryKey: ['ceo', 'pricing', 'history'], queryFn: () => api.get<History>('/ceo/pricing/history') });
  const [editing, setEditing] = useState<Rule | null>(null);
  const h = history.data;
  const p = h?.current;
  const since = (r: Rule) => {
    const dates = r.fields.map((f) => h?.since[f.key]).filter((x): x is string => Boolean(x)).sort();
    return dates.length ? formatDateIST(dates[dates.length - 1]) : '—';
  };
  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('Main'), label: 'Command Center' }}
        title="Pricing & policy"
        subtitle="Every number the software runs on, in one place. Nothing is hard-coded."
        actions={
          <Button variant="primary" onClick={() => setEditing(RULES[0])} disabled={!p}>
            + Schedule a change
          </Button>
        }
      />
      <PricingTabs />
      {history.error ? (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      ) : (
        <Card flush>
          <div className="scrollx">
            <table>
              <thead><tr><th>Rule</th><th>In force</th><th>Since</th><th /></tr></thead>
              <tbody>
                {p &&
                  RULES.map((r) => (
                    <tr key={r.name}>
                      <td>{r.name}</td>
                      <td><strong>{r.show(p)}</strong></td>
                      <td>{since(r)}</td>
                      <td><Button onClick={() => setEditing(r)}>Change →</Button></td>
                    </tr>
                  ))}
                {p && (
                  <tr>
                    <td>Weekly day off</td>
                    <td><strong>{show(p.weeklyOffDays, 'weeklyOffDays')}</strong></td>
                    <td>{h?.since.weeklyOffDays ? formatDateIST(h.since.weeklyOffDays) : '—'}</td>
                    <td><WeeklyOff current={p.weeklyOffDays} /></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="ceo-note" style={{ padding: '0 18px 14px' }}>Only the CEO can change these. A change starts on the date you pick and never alters old records — every payment and placement keeps the numbers it was made with.</p>
        </Card>
      )}
      <div className="two-col">
        <Card title="Recent changes">
          {h && !h.history.length && !h.scheduled.length ? (
            <p className="ceo-sub">No changes yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              {h?.scheduled.map((v) => (
                <div key={v.id} className="rule" style={{ borderLeftColor: 'var(--gold-raw)' }}>
                  <StatusPill tone="warn">{`Starts ${formatDateIST(v.effectiveFrom)}`}</StatusPill> {v.changes.map((c) => `${FIELD_LABEL[c.field] ?? c.field} ${show(c.before, c.field)} → ${show(c.after, c.field)}`).join('; ') || 'No change'} · by {v.setBy ?? '—'}
                </div>
              ))}
              {h?.history.map((v) => (
                <div key={v.id} className="rule" style={{ borderLeftColor: 'var(--royal)' }}>
                  <strong>{formatDateIST(v.effectiveFrom)}</strong> {v.changes.map((c) => `${FIELD_LABEL[c.field] ?? c.field} ${show(c.before, c.field)} → ${show(c.after, c.field)}`).join('; ')} · by {v.setBy ?? '—'}
                </div>
              ))}
            </div>
          )}
        </Card>
        <Holidays />
      </div>
      {editing && p && <ChangeRule key={editing.name} rule={editing} policy={p} onPick={setEditing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ChangeRule({ rule, policy, onPick, onClose }: { rule: Rule; policy: Policy; onPick: (r: Rule) => void; onClose: () => void }) {
  const today = istDateKey(useNow());
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(rule.fields.map((f) => [f.key, policy[f.key]])));
  const [from, setFrom] = useState(today);
  const toast = useToast();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => {
      if (rule.save) return rule.save(values);
      return api.post('/pricing', { ...values, effectiveFrom: from === today ? undefined : istStartOfDay(from).toISOString() });
    },
    onSuccess: () => {
      toast.success(rule.save || from === today ? `${rule.name} changed` : `${rule.name} changes on ${formatDateIST(istStartOfDay(from))}`);
      void qc.invalidateQueries({ queryKey: ['ceo'] });
      void qc.invalidateQueries({ queryKey: ['pricing'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save. Try again.'),
  });
  const set = (k: string, v: unknown) => setValues((x) => ({ ...x, [k]: v }));
  const invalid = rule.fields.some((f) => {
    const v = values[f.key];
    if (f.kind === 'time') return !/^\d{2}:\d{2}$/.test(String(v ?? ''));
    return typeof v !== 'number' || Number.isNaN(v) || v < 0;
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Change: ${rule.name}`}
      dismissible={!save.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={invalid}>
            {rule.save || from === today ? 'Change now' : 'Schedule change'}
          </Button>
        </>
      }
    >
      <label className="field">
        Rule
        <select value={rule.name} onChange={(e) => onPick(RULES.find((r) => r.name === e.target.value) ?? rule)}>
          {RULES.map((r) => (
            <option key={r.name}>{r.name}</option>
          ))}
        </select>
      </label>
      <p className="ceo-sub">Now: {rule.show(policy)}</p>
      {rule.fields.map((f) =>
        f.kind === 'paise' ? (
          <MoneyField key={f.key} label={f.label} value={(values[f.key] as number) ?? null} onChange={(v) => set(f.key, v)} required />
        ) : f.kind === 'time' ? (
          <label key={f.key} className="field">
            {f.label}
            <input type="time" value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} required />
          </label>
        ) : (
          <TextField key={f.key} label={f.label} inputMode="decimal" value={values[f.key] === undefined || values[f.key] === null ? '' : String(values[f.key])} onChange={(v) => set(f.key, v.trim() === '' ? NaN : f.kind === 'hours' ? Number(v) : Math.trunc(Number(v.replace(/\D/g, ''))))} required />
        ),
      )}
      {!rule.save && <DateField label="Starts on" value={from} onChange={(v) => v && setFrom(v)} min={today} hint="Today changes it straight away; a later date schedules it." />}
    </Modal>
  );
}

function WeeklyOff({ current }: { current: number[] }) {
  const [days, setDays] = useState<number[]>(current);
  return (
    <ActionButton
      label="Change →"
      title="Weekly day off"
      description={
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {WEEKDAYS.map((d, i) => (
            <label key={d} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={days.includes(i)} onChange={(e) => setDays((x) => (e.target.checked ? [...x, i].sort() : x.filter((y) => y !== i)))} />
              {d}
            </label>
          ))}
          <span className="ceo-sub">No absent day is marked on a day off; time worked on it is make-up time.</span>
        </span>
      }
      run={() => api.post('/pricing', { weeklyOffDays: days })}
      success="Weekly day off changed"
    />
  );
}

interface HolidayList {
  year: number;
  holidays: { id: string; date: string; name: string; weekday: number }[];
}

function Holidays() {
  const now = useNow();
  const [year, setYear] = useState(Number(istDateKey(now).slice(0, 4)));
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const toast = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['attendance', 'holidays', year], queryFn: () => api.get<HolidayList>('/attendance/holidays', { query: { year: String(year) } }) });
  const add = useMutation({
    mutationFn: () => api.post('/attendance/holidays', { date, name: name.trim() }),
    onSuccess: () => {
      toast.success('Holiday added');
      setDate('');
      setName('');
      void qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not add. Try again.'),
  });
  return (
    <Card
      title="Public holidays"
      aside={
        <span className="ceo-actions">
          <Button size="compact" onClick={() => setYear(year - 1)} aria-label="Previous year">←</Button>
          <strong>{year}</strong>
          <Button size="compact" onClick={() => setYear(year + 1)} aria-label="Next year">→</Button>
        </span>
      }
    >
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} compact />
      ) : list.data && !list.data.holidays.length ? (
        <p className="ceo-sub">No holidays set for {year}.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list.data?.holidays.map((hd) => (
            <div key={hd.id} className="ceo-rule-row">
              <span>
                <strong>{formatDateIST(`${hd.date}T06:00:00Z`)}</strong> · {WEEKDAYS[hd.weekday]?.slice(0, 3)} · {hd.name}
              </span>
              <span />
              <ActionButton label="Remove" variant="danger" title={`Remove ${hd.name}`} description="Anyone absent that day is worked out again." run={() => api.delete(`/attendance/holidays/${hd.id}`)} success="Holiday removed" />
            </div>
          ))}
        </div>
      )}
      <form
        className="ceo-inline-form"
        style={{ marginTop: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (date && name.trim()) add.mutate();
        }}
      >
        <DateField label="Date" value={date} onChange={setDate} />
        <TextField label="Holiday" value={name} onChange={setName} placeholder="Kannada Rajyotsava" />
        <Button type="submit" loading={add.isPending} disabled={!date || !name.trim()}>
          + Add holiday
        </Button>
      </form>
      <p className="ceo-note">A holiday is a paid day off for everyone — never absent and not a leave day.</p>
    </Card>
  );
}
