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

/**
 * Legal minimum wage — design C-Pricing-MinWage.dc.html. Every vacancy form
 * checks against these: the business's zone and the trade's skill level
 * (Karnataka notification of 22 May 2026; guide rev 193, docs/minimum-wage.md).
 */
interface ZoneFigures {
  unskilledPaise: number;
  semiSkilledPaise: number;
  skilledPaise: number;
  highlySkilledPaise: number;
  businesses?: number;
}
interface MinWage extends ZoneFigures {
  effectiveFrom: string;
  /** All three zones (rev 193); the top-level figures are Zone 1's. */
  zones?: Record<'1' | '2' | '3', ZoneFigures>;
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
type LevelKey = (typeof LEVELS)[number][0];
export const ZONES = [
  ['1', 'Zone 1', 'Greater Bengaluru Authority area'],
  ['2', 'Zone 2', 'Other municipal corporations and district headquarters'],
  ['3', 'Zone 3', 'Rest of Karnataka'],
] as const;
type ZoneKey = (typeof ZONES)[number][0];

function zoneFigures(d: MinWage, zone: ZoneKey): ZoneFigures | null {
  if (d.zones?.[zone]) return d.zones[zone];
  return zone === '1' ? d : null;
}

/** PUT body key for a zone and level: Zone 1 keeps the plain keys, the others are prefixed (zone2UnskilledPaise). */
function bodyKey(zone: ZoneKey, level: LevelKey): string {
  return zone === '1' ? level : `zone${zone}${level[0].toUpperCase()}${level.slice(1)}`;
}

export default function MinimumWage() {
  const to = useScreenPath();
  const q = useQuery({ queryKey: ['ceo', 'pricing', 'minimum-wage'], queryFn: () => api.get<MinWage>('/ceo/pricing/minimum-wage') });
  const [open, setOpen] = useState(false);
  const d = q.data;
  return (
    <div className="lb-page">
      <TopBar icon="salaries" iconTone="good" back={{ to: to('C-Pricing'), label: 'Pricing & policy' }} title="Legal minimum wage" subtitle="Update these when the government revises them; every vacancy form checks against the business's zone and the trade's skill level." actions={<Button variant="primary" onClick={() => setOpen(true)} disabled={!d}>Update figures</Button>} />
      <PricingTabs />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="two-col">
            {ZONES.map(([zone, label, area]) => {
              const z = d ? zoneFigures(d, zone) : null;
              return (
                <Card key={zone} icon="payments" tone="good" title={d ? `${label} · ${area} · in force from ${formatDateIST(d.effectiveFrom)}` : `${label} · ${area}`}>
                  <div className="kv" data-testid={`zone-${zone}`}>
                    {LEVELS.map(([k, levelLabel], i) => (
                      <Pair key={k} k={levelLabel} v={z ? `${formatINR(z[k])}${i === 0 ? ' a month basic' : ''}` : '—'} />
                    ))}
                    {z?.businesses !== undefined && <Pair k="Businesses in this zone" v={String(z.businesses)} />}
                  </div>
                </Card>
              );
            })}
            <Card icon="reports" tone="cyan" title="How it's used">
              <div className="kv">
                <span>Which figure</span>
                <span>The business's zone (from its pin code or city; office staff can change it on the business page) and the trade's skill level (Trades tab)</span>
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
  const [v, setV] = useState<Record<string, number | null>>(() => {
    const start: Record<string, number | null> = {};
    for (const [zone] of ZONES) {
      const z = zoneFigures(current, zone);
      for (const [level] of LEVELS) start[bodyKey(zone, level)] = z ? z[level] : null;
    }
    return start;
  });
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
      {ZONES.map(([zone, label, area]) => (
        <div key={zone} role="group" aria-label={`${label} — ${area}`}>
          <p>
            <strong>{`${label} — ${area}`}</strong>
          </p>
          {LEVELS.map(([level, levelLabel]) => {
            const key = bodyKey(zone, level);
            return <MoneyField key={key} label={`${label} · ${levelLabel} (a month)`} value={v[key]} onChange={(x) => setV((s) => ({ ...s, [key]: x }))} required />;
          })}
        </div>
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
