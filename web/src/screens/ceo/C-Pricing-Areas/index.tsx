import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { DataTable, type Column } from '../../../components/DataTable';
import { Modal } from '../../../components/Modal';
import { StatusPill } from '../../../components/Badge';
import { PincodeField, TextField } from '../../../components/fields';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { PricingTabs } from '../_kit/tabs';

/** Areas — design C-Pricing-Areas.dc.html. The CEO and Managers manage it; every form reads it. */
export interface AreaRow {
  id: string;
  name: string;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
  mergedInto: string | null;
  businesses: number;
  jobSeekers: number;
  openVacancies: number;
}

export default function Areas() {
  const to = useScreenPath();
  const areas = useQuery({ queryKey: ['areas', 'manage'], queryFn: () => api.get<{ rows: AreaRow[]; total: number }>('/areas/manage') });
  const [editing, setEditing] = useState<AreaRow | 'new' | null>(null);
  const rows = areas.data?.rows;
  const active = (rows ?? []).filter((a) => a.active);
  const columns: Column<AreaRow>[] = [
    { key: 'name', header: 'Area', cell: (r) => <strong>{r.name}</strong>, filter: 'text', filterValue: (r) => `${r.name} ${r.pincode ?? ''}`, sortValue: (r) => r.name, csv: (r) => r.name },
    { key: 'pin', header: 'Pincode', cell: (r) => r.pincode ?? '—', sortValue: (r) => r.pincode ?? '', csv: (r) => r.pincode },
    { key: 'biz', header: 'Businesses', cell: (r) => r.businesses, sortValue: (r) => r.businesses, csv: (r) => r.businesses, align: 'right' },
    { key: 'js', header: 'Job seekers', cell: (r) => r.jobSeekers, sortValue: (r) => r.jobSeekers, csv: (r) => r.jobSeekers, align: 'right' },
    { key: 'vac', header: 'Open vacancies', cell: (r) => r.openVacancies, sortValue: (r) => r.openVacancies, csv: (r) => r.openVacancies, align: 'right' },
    { key: 'centre', header: 'Centre point', cell: (r) => (r.latitude !== null && r.longitude !== null ? `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}` : '—'), csv: (r) => `${r.latitude ?? ''},${r.longitude ?? ''}`, hideOnPhone: true },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (r.active ? <StatusPill tone="good">On the forms</StatusPill> : <StatusPill tone="muted">{r.mergedInto ? `Merged into ${r.mergedInto}` : 'Switched off'}</StatusPill>),
      filter: 'select',
      filterValue: (r) => (r.active ? 'On' : r.mergedInto ? 'Merged' : 'Off'),
      csv: (r) => (r.active ? 'on' : r.mergedInto ? `merged into ${r.mergedInto}` : 'off'),
    },
    {
      key: 'act',
      header: '',
      cell: (r) =>
        r.mergedInto ? null : (
          <div className="ceo-actions" onClick={(e) => e.stopPropagation()}>
            <Button onClick={() => setEditing(r)}>Edit</Button>
            {r.active ? (
              <ActionButton label="Switch off" variant="danger" title={`Take ${r.name} off the forms`} description="Records that name it keep it; agents can no longer pick it. To fold it into another area, use Merge instead." run={() => api.patch(`/areas/${r.id}`, { active: false })} success={`${r.name} switched off`} />
            ) : (
              <ActionButton label="Switch on" title={`Put ${r.name} back on the forms`} run={() => api.patch(`/areas/${r.id}`, { active: true })} success={`${r.name} is back on the forms`} />
            )}
          </div>
        ),
    },
  ];
  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('C-Pricing'), label: 'Pricing & policy' }}
        title="Areas"
        subtitle="The list of Bengaluru areas agents choose from."
        actions={
          <>
            <Button variant="primary" onClick={() => setEditing('new')}>+ Add area</Button>
            <ActionButton
              label="Merge areas"
              title="Merge a duplicate into another area"
              description="Every job seeker, business, partner and vacancy naming the duplicate moves to the other area, and the duplicate comes off the list for good."
              choice={{
                label: 'Duplicate → keep',
                options: active.flatMap((a) => active.filter((b) => b.id !== a.id).map((b) => ({ value: `${a.id}|${b.id}`, label: `${a.name} → ${b.name}` }))),
              }}
              run={({ choice }) => {
                const [from, into] = choice.split('|');
                return api.post<{ moved: Record<string, number> }>(`/areas/${from}/merge`, { intoId: into });
              }}
              success={(res) => `Merged · ${Object.values((res as { moved: Record<string, number> }).moved).reduce((s, v) => s + v, 0)} records moved`}
              disabled={active.length < 2}
            />
          </>
        }
      />
      <PricingTabs />
      <div className="panel" style={{ padding: '6px 18px 14px' }}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="Areas" loading={areas.isPending} error={areas.error} onRetry={() => void areas.refetch()} download="areas" pageSize={50} emptyTitle="No areas yet." />
        <div className="ceo-note">Agents pick areas from this list; the pincode fills the city. Merge duplicates ("BTM 2nd Stage" / "BTM Layout") here. The CEO and Managers manage this list.</div>
      </div>
      {editing && <AreaForm area={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AreaForm({ area, onClose }: { area: AreaRow | null; onClose: () => void }) {
  const [name, setName] = useState(area?.name ?? '');
  const [pincode, setPincode] = useState(area?.pincode ?? '');
  const [lat, setLat] = useState(area?.latitude?.toString() ?? '');
  const [lng, setLng] = useState(area?.longitude?.toString() ?? '');
  const toast = useToast();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), pincode, latitude: Number(lat), longitude: Number(lng) };
      return area ? api.patch(`/areas/${area.id}`, body) : api.post('/areas', body);
    },
    onSuccess: () => {
      toast.success(area ? 'Area saved' : 'Area added');
      void qc.invalidateQueries({ queryKey: ['areas'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save. Try again.'),
  });
  const bad = !name.trim() || !/^\d{6}$/.test(pincode) || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || lat === '' || lng === '';
  return (
    <Modal
      open
      onClose={onClose}
      title={area ? `Edit ${area.name}` : 'Add an area'}
      dismissible={!save.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={bad}>Save</Button>
        </>
      }
    >
      <TextField label="Area name" value={name} onChange={setName} required maxLength={60} hint={area ? 'Renaming moves every record that names this area to the new name.' : undefined} />
      <PincodeField label="Pincode" value={pincode} onChange={setPincode} required />
      <div className="ceo-form-row">
        <TextField label="Centre point latitude" value={lat} onChange={(v) => setLat(v.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="12.9352" required />
        <TextField label="Centre point longitude" value={lng} onChange={(v) => setLng(v.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="77.6245" required />
      </div>
      <p className="ceo-sub">The map pin starts here on every form; the agent can move it.</p>
    </Modal>
  );
}
