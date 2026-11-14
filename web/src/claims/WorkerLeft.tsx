import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, type ButtonVariant } from '../components/Button';
import { EmptyState, ErrorState } from '../components/ErrorState';
import { Modal } from '../components/Modal';
import { SkeletonCard } from '../components/Skeleton';
import { DateField, SelectField, TextField } from '../components/fields';
import { useToast } from '../components/Toast';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/I18nProvider';
import { api } from '../lib/api/client';
import { ApiError } from '../lib/api/errors';
import { formatDateIST, formatDateTimeIST, istDateKey } from '../lib/format/date';
import { useNow } from '../lib/useNow';
import './workerLeft.css';

/**
 * "Report worker left" — the replacement claim, for the Team Lead, Manager,
 * CEO and call agent screens (Laboura Field has its own on FA11). Reads GET
 * /placements/:id/worker-left and sends POST /placements/:id/claims, whose
 * rules decide everything (guarantee window, answered owner call, reason
 * list, auto-rejection when late, unpaid or not covered). The claim is then
 * decided on C-Claims / T-Requests / MG-Requests.
 */
export interface WorkerLeftForm {
  placement: { id: string; code: string; status: string; workerName: string | null; businessId: string; businessName: string | null; joinedDate: string | null };
  guarantee: { windowDays: number; endsAt: string | null; reportWithinDays: number; decisionHours: number };
  leftOnLatest: string;
  canReport: boolean;
  blocked: 'not_active' | 'not_joined' | 'open_claim' | null;
  openClaim: { code: string; reportedAt: string; decisionDueAt: string } | null;
  ownerCalls: { id: string; code: string; at: string; durationSec: number | null; by: string | null }[];
  reasons: { covered: string[]; notCovered: string[] };
}

interface FoundPlacement {
  id: string;
  code: string;
  workerName: string | null;
  businessName: string | null;
  joinedDate: string | null;
}

interface ClaimResult {
  code: string;
  decision: string | null;
  decisionReason: string | null;
}

export const workerLeftKey = (id: string) => ['placements', 'worker-left', id] as const;

function duration(sec: number | null): string {
  if (!sec) return '—';
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** The form itself, for one placement. */
function ClaimForm({ placementId, onDone, onBack }: { placementId: string; onDone: () => void; onBack?: () => void }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const now = useNow(60_000);
  const form = useQuery({ queryKey: workerLeftKey(placementId), queryFn: () => api.get<WorkerLeftForm>(`/placements/${encodeURIComponent(placementId)}/worker-left`) });
  const [leftOn, setLeftOn] = useState('');
  const [reason, setReason] = useState('');
  const [callId, setCallId] = useState('');
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = form.data;
  const chosenCall = callId || d?.ownerCalls[0]?.id || '';

  const callOwner = useMutation({
    mutationFn: () =>
      api.post('/calls', { subjectType: 'business', subjectId: d!.placement.businessId, purpose: 'general', relatedType: 'placement', relatedId: d!.placement.id }),
    onSuccess: () => setCalling(true),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : String(e)),
  });

  const submit = useMutation({
    mutationFn: () => api.post<ClaimResult>(`/placements/${encodeURIComponent(placementId)}/claims`, { workerLeftOn: leftOn, reason, callRecordId: chosenCall }),
    onSuccess: (claim) => {
      if (claim.decision === 'rejected') toast.error(t('wl.sentRejected', { code: claim.code, reason: claim.decisionReason ?? '' }));
      else toast.success(t('wl.sent', { code: claim.code, hours: d?.guarantee.decisionHours ?? 48 }));
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : String(e)),
  });

  if (form.isPending) return <SkeletonCard height={220} />;
  if (form.isError || !d) return <ErrorState error={form.error} onRetry={() => void form.refetch()} />;

  const p = d.placement;
  const header = (
    <p className="wl-sub">
      {t('wl.placement', { code: p.code, worker: p.workerName ?? '—', business: p.businessName ?? '—' })}
    </p>
  );
  const back = onBack && (
    <Button variant="secondary" onClick={onBack}>
      {t('wl.back')}
    </Button>
  );
  if (!d.canReport) {
    const text =
      d.blocked === 'open_claim' && d.openClaim
        ? t('wl.blocked.open_claim', { code: d.openClaim.code, due: formatDateTimeIST(d.openClaim.decisionDueAt) })
        : t(`wl.blocked.${d.blocked ?? 'not_active'}` as MessageKey);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {header}
        <p className="wl-note" role="status">
          {text}
        </p>
        {back}
      </div>
    );
  }

  const minDay = p.joinedDate ? istDateKey(p.joinedDate) : undefined;
  const maxDay = istDateKey(new Date(Math.min(new Date(d.leftOnLatest).getTime(), now.getTime())));
  const notCovered = d.reasons.notCovered.includes(reason);
  const options = [
    ...d.reasons.covered.map((r) => ({ value: r, label: `${t(`wl.reason.${r}` as MessageKey)}` })),
    ...d.reasons.notCovered.map((r) => ({ value: r, label: `${t(`wl.reason.${r}` as MessageKey)} — ${t('wl.notCovered')}` })),
  ];
  const ready = Boolean(leftOn && reason && chosenCall) && (!minDay || leftOn >= minDay) && leftOn <= maxDay;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (ready) submit.mutate();
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      noValidate
    >
      {header}
      <p style={{ margin: 0, fontSize: 13.5 }}>{t('wl.intro', { days: d.guarantee.windowDays, hours: d.guarantee.decisionHours })}</p>
      <DateField
        label={t('wl.leftOn')}
        value={leftOn}
        onChange={setLeftOn}
        min={minDay}
        max={maxDay}
        required
        hint={t('wl.leftOnHint', { joined: p.joinedDate ? formatDateIST(p.joinedDate) : '—', days: d.guarantee.reportWithinDays })}
      />
      <SelectField label={t('wl.reason')} value={reason} onChange={(v) => setReason(v)} options={options} placeholder={t('wl.reasonPick')} required />
      {notCovered && (
        <p className="wl-note" role="status">
          {t('wl.notCoveredNote')}
        </p>
      )}
      {d.ownerCalls.length ? (
        <SelectField
          label={t('wl.call')}
          value={chosenCall}
          onChange={(v) => setCallId(v)}
          options={d.ownerCalls.map((c) => ({ value: c.id, label: t('wl.callOption', { date: formatDateTimeIST(c.at), duration: duration(c.durationSec), by: c.by ?? '—' }) }))}
          required
        />
      ) : (
        <div className="wl-note" role="status" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span>{calling ? t('wl.calling') : t('wl.noCall')}</span>
          <span className="wl-row">
            <Button variant="secondary" onClick={() => callOwner.mutate()} loading={callOwner.isPending}>
              ☎ {t('wl.callOwner')}
            </Button>
            <Button variant="secondary" onClick={() => void form.refetch()} loading={form.isRefetching}>
              {t('wl.refresh')}
            </Button>
          </span>
        </div>
      )}
      {error && (
        <p className="vno" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <div className="wl-row">
        <Button type="submit" variant="danger" loading={submit.isPending} disabled={!ready}>
          {t('wl.submit')}
        </Button>
        {back}
      </div>
    </form>
  );
}

/** "Report worker left" on a placement the screen already shows (CEO placement page, call agent search results). */
export function ReportWorkerLeft({ placementId, workerName, variant = 'danger' }: { placementId: string; workerName?: string | null; variant?: ButtonVariant }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {t('wl.button')}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={workerName ? t('wl.title', { name: workerName }) : t('wl.titleNoName')} width={560}>
        {open && <ClaimForm placementId={placementId} onDone={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

/** "Report worker left" where no placement is open yet (Manager and Team Lead requests): find it first. */
export function ReportWorkerLeftFinder({ variant = 'secondary' }: { variant?: ButtonVariant }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<FoundPlacement | null>(null);
  const text = q.trim();
  const found = useQuery({
    queryKey: ['placements', 'worker-left', 'search', text],
    queryFn: () => api.get<FoundPlacement[]>('/placements/worker-left/search', { query: { q: text } }),
    enabled: open && !picked && text.length >= 2,
  });
  const close = () => {
    setOpen(false);
    setPicked(null);
    setQ('');
  };
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {t('wl.button')}
      </Button>
      <Modal open={open} onClose={close} title={picked?.workerName ? t('wl.title', { name: picked.workerName }) : t('wl.titleNoName')} width={560}>
        {picked ? (
          <ClaimForm placementId={picked.id} onDone={close} onBack={() => setPicked(null)} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <TextField label={t('wl.finder.label')} value={q} onChange={setQ} placeholder="PL-…" autoFocus />
            {text.length < 2 ? (
              <p className="wl-sub">{t('wl.finder.typeMore')}</p>
            ) : found.isPending ? (
              <SkeletonCard height={80} />
            ) : found.isError ? (
              <ErrorState error={found.error} onRetry={() => void found.refetch()} />
            ) : !found.data?.length ? (
              <EmptyState title={t('wl.finder.none', { q: text })} />
            ) : (
              <ul aria-label={t('wl.finder.title')} className="wl-list">
                {found.data.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="wl-pick" onClick={() => setPicked(p)}>
                      <strong>{t('wl.finder.row', { worker: p.workerName ?? '—', business: p.businessName ?? '—' })}</strong>
                      <span className="wl-sub">{t('wl.finder.joined', { code: p.code, date: p.joinedDate ? formatDateIST(p.joinedDate) : '—' })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
