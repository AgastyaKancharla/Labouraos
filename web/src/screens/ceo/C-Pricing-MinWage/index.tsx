import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { Modal } from '../../../components/Modal';
import { DateField, MoneyField } from '../../../components/fields';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateIST, istDateKey, istStartOfDay } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { PricingTabs } from '../_kit/tabs';

/** Legal minimum wage — design C-Pricing-MinWage.dc.html. Every vacancy form checks against these. */
interface MinWage {
  effectiveFrom: string;
  unskilledPaise: number;
  semiSkilledPaise: number;
  skilledPaise: number;
  highlySkilledPaise: number;
  openVacancies: number;
  belowMinimum: number;
  belowMinimumOwnerTold: number;
}
const LEVELS = [
  ['unskilledPaise', 'Unskilled'],
  ['semiSkilledPaise', 'Semi-skilled'],
  ['skilledPaise', 'Skilled'],
  ['highlySkilledPaise', 'Highly skilled'],
] as const;

export default function MinimumWage() {
  const to = useScreenPath();
  const q = useQuery({ queryKey: ['ceo', 'pricing', 'minimum-wage'], queryFn: () => api.get<MinWage>('/ceo/pricing/minimum-wage') });
  const [open, setOpen] = useState(false);
  const d = q.data;
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('C-Pricing'), label: 'Pricing & policy' }} title="Legal minimum wage" subtitle="Update these when the government revises them; every vacancy form checks against them." actions={<Button variant="primary" onClick={() => setOpen(true)} disabled={!d}>Update figures</Button>} />
      <PricingTabs />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="two-col">
          <Card title={d ? `In force · Bengaluru (Zone 1) · from ${formatDateIST(d.effectiveFrom)}` : 'In force'}>
            <div className="kv">
              {LEVELS.map(([k, label], i) => (
                <Pair key={k} k={label} v={d ? `${formatINR(d[k])}${i === 0 ? ' a month basic' : ''}` : '—'} />
              ))}
            </div>
          </Card>
          <Card title="How it's used">
            <div className="kv">
              <span>Vacancy below the minimum</span>
              <span>Allowed with a warning · agent ticks "owner told" · marked for TL and Managers</span>
              <span>Vacancies below minimum now</span>
              <span>{d ? `${d.belowMinimum} of ${d.openVacancies} open (${d.belowMinimumOwnerTold} with owner told)` : '—'}</span>
              <span>Agreement</span>
              <span>The business is the employer and pays at least the legal minimum, PF and ESI</span>
            </div>
          </Card>
        </div>
      )}
      {open && d && <UpdateFigures current={d} onClose={() => setOpen(false)} />}
    </div>
  );
}

function UpdateFigures({ current, onClose }: { current: MinWage; onClose: () => void }) {
  const today = istDateKey(useNow());
  const [v, setV] = useState<Record<string, number | null>>({ unskilledPaise: current.unskilledPaise, semiSkilledPaise: current.semiSkilledPaise, skilledPaise: current.skilledPaise, highlySkilledPaise: current.highlySkilledPaise });
  const [from, setFrom] = useState(today);
  const toast = useToast();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => api.put('/pricing/legal-minimum-wages', { ...v, effectiveFrom: istStartOfDay(from).toISOString() }),
    onSuccess: () => {
      toast.success('Minimum wage figures updated');
      void qc.invalidateQueries({ queryKey: ['ceo'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save. Try again.'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Update the legal minimum wage"
      dismissible={!save.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={Object.values(v).some((x) => !x)}>Save figures</Button>
        </>
      }
    >
      {LEVELS.map(([k, label]) => (
        <MoneyField key={k} label={`${label} (a month)`} value={v[k]} onChange={(x) => setV((s) => ({ ...s, [k]: x }))} required />
      ))}
      <DateField label="In force from (the government's date)" value={from} onChange={(x) => x && setFrom(x)} />
    </Modal>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <>
      <span>{k}</span>
      <span>{v}</span>
    </>
  );
}
