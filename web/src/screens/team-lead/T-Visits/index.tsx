import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { Modal } from '../../../components/Modal';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateIST, formatTimeIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../../ceo/_kit/actions';
import { humanize } from '../../ceo/_kit/kit';
import { firstName, useTeam, type Brief } from '../_kit/api';

/** Visit proof — design T-Visits.dc.html, on the merged field-visit proof and its review flags. Photos only through short-lived private links. */
interface Assignment {
  id: string;
  purpose: string;
  createdAt: string;
  business: { id: string; code: string; name: string; locality: string | null };
  suggestedStaff: { id: string; name: string } | null;
}
interface VisitRow {
  id: string;
  agent: Brief | null;
  shop: string;
  at: string;
  durationSeconds: number | null;
  proof: { boardPhoto: boolean; selfie: boolean; gpsOk: boolean; distanceMeters: number | null };
  outcome: string | null;
  flags: Array<{ id: string; code: string; kind: string }>;
  check: { verdict: string; at: string } | null;
}
interface VisitsBoard {
  summary: { visits: number; toCheck: number; signedUp: number };
  rows: VisitRow[];
}

const FLAG_TEXT: Record<string, string> = {
  visit_short: 'Very short visit',
  visits_too_far_apart: 'Two shops too far apart for the time',
  visit_photo_reused: 'Photo used before',
  visit_gps_suspect: 'GPS looks faked',
  visits_no_onboarding: 'Many visits, no onboarding',
  visit_flagged: 'Flagged',
};
const OUTCOME: Record<string, string> = { onboarded: 'Signed up', interested_later: 'Call back', not_interested: 'Not interested', owner_not_there: 'Owner not there' };
const PURPOSE: Record<string, string> = { verification: 'Owner asked for a visit (call)', follow_up: 'Follow-up · no vacancy yet' };

export default function TeamLeadVisits() {
  const to = useScreenPath();
  const team = useTeam();
  const board = useQuery({ queryKey: ['team-lead', 'visits'], queryFn: () => api.get<VisitsBoard>('/team-lead/visits') });
  const assignments = useQuery({ queryKey: ['businesses', 'visit-assignments'], queryFn: () => api.get<Assignment[]>('/businesses/visit-assignments') });
  const fieldAgents = team.data?.members.filter((m) => m.role === 'field_agent') ?? [];
  const mgr = team.data?.manager ? firstName(team.data.manager.name) : 'the Manager';
  const b = board.data;

  const assignColumns: Column<Assignment>[] = [
    { key: 'biz', header: 'Business', cell: (a) => `${a.business.name}${a.business.locality ? ` · ${a.business.locality}` : ''}` },
    { key: 'why', header: 'Why', cell: (a) => PURPOSE[a.purpose] ?? humanize(a.purpose) },
    { key: 'when', header: 'Asked', cell: (a) => formatDateIST(a.createdAt), sortValue: (a) => a.createdAt },
    { key: 'assign', header: '', cell: (a) => <Assign assignment={a} agents={fieldAgents} /> },
  ];
  const visitColumns: Column<VisitRow>[] = [
    { key: 'agent', header: 'Agent', cell: (v) => v.agent?.name ?? '—', filter: 'select', filterValue: (v) => v.agent?.name ?? '—' },
    { key: 'shop', header: 'Shop', cell: (v) => v.shop },
    { key: 'time', header: 'Time', cell: (v) => formatTimeIST(v.at), sortValue: (v) => v.at },
    { key: 'inside', header: 'Inside for', cell: (v) => (v.durationSeconds === null ? '—' : `${Math.max(1, Math.round(v.durationSeconds / 60))} min`), sortValue: (v) => v.durationSeconds ?? 0 },
    {
      key: 'proof',
      header: 'Proof',
      cell: (v) =>
        v.flags.length ? (
          <StatusPill tone="danger">{v.flags.map((f) => FLAG_TEXT[f.kind] ?? humanize(f.kind)).join(' · ')}</StatusPill>
        ) : !v.proof.gpsOk && v.proof.distanceMeters !== null ? (
          <StatusPill tone="warn">GPS {v.proof.distanceMeters} m away</StatusPill>
        ) : (
          <span>
            {[v.proof.boardPhoto ? 'Photo' : null, v.proof.selfie ? 'selfie' : null, v.proof.gpsOk ? 'GPS ✓' : null].filter(Boolean).join(' · ') || '—'}
          </span>
        ),
    },
    { key: 'result', header: 'Result', cell: (v) => (v.outcome ? (OUTCOME[v.outcome] ?? humanize(v.outcome)) : 'In progress') },
    { key: 'act', header: '', cell: (v) => <VisitActions visit={v} managerName={mgr} /> },
  ];

  return (
    <div className="lb-page">
      <TopBar showSearch={false} back={{ to: to('T-Home'), label: 'My team' }} title="Visit proof" subtitle="Assign visits to your field agents and check every visit really happened." />
      <StatGrid>
        <StatTile label="Shop visits today" value={b?.summary.visits ?? '—'} tone="royal" loading={board.isPending} />
        <StatTile label="Visit requests to assign" value={assignments.data?.length ?? '—'} tone="orange" loading={assignments.isPending} />
        <StatTile label="Visits to check" value={b?.summary.toCheck ?? '—'} tone="red" loading={board.isPending} />
        <StatTile label="Businesses signed up today" value={b?.summary.signedUp ?? '—'} tone="good" loading={board.isPending} />
      </StatGrid>
      <Card title="Visit requests to assign" flush>
        <DataTable columns={assignColumns} rows={assignments.data} rowKey={(a) => a.id} caption="Visit requests to assign" loading={assignments.isPending} error={assignments.error} onRetry={() => void assignments.refetch()} emptyTitle="No visit requests waiting." />
      </Card>
      <Card title="Today's visits and their proof" flush>
        <DataTable columns={visitColumns} rows={b?.rows} rowKey={(v) => v.id} caption="Today's visits" loading={board.isPending} error={board.error} onRetry={() => void board.refetch()} emptyTitle="No shop visits today yet." />
        <div className="tl-note" style={{ padding: '0 18px 14px' }}>
          Every visit needs a shop photo with the name board before going in, a selfie and GPS · a very short visit or GPS far from the shop is flagged for you
        </div>
      </Card>
    </div>
  );
}

function Assign({ assignment, agents }: { assignment: Assignment; agents: Brief[] }) {
  const [agent, setAgent] = useState(assignment.suggestedStaff?.id ?? '');
  const toast = useToast();
  const qc = useQueryClient();
  const assign = useMutation({
    mutationFn: () => api.post(`/businesses/${assignment.business.id}/visit-assignments/${assignment.id}/assign`, { assignedStaffId: agent }),
    onSuccess: () => {
      toast.success('Visit assigned');
      void qc.invalidateQueries({ queryKey: ['businesses', 'visit-assignments'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not assign the visit'),
  });
  return (
    <div className="tl-inline">
      <select aria-label={`Assign ${assignment.business.name} to`} value={agent} onChange={(e) => setAgent(e.target.value)}>
        <option value="">Assign to…</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <Button size="compact" variant="primary" onClick={() => assign.mutate()} disabled={!agent} loading={assign.isPending}>
        Assign
      </Button>
    </div>
  );
}

function VisitActions({ visit, managerName }: { visit: VisitRow; managerName: string }) {
  const [open, setOpen] = useState(false);
  const photos = useQuery({ queryKey: ['team-lead', 'visit-photos', visit.id], queryFn: () => api.get<{ boardPhoto: string | null; selfie: string | null }>(`/team-lead/visits/${visit.id}/photos`), enabled: open, staleTime: 240_000 });
  if (visit.check) return <StatusPill tone={visit.check.verdict === 'ok' ? 'good' : 'danger'}>{visit.check.verdict === 'ok' ? 'Checked' : 'Flagged'}</StatusPill>;
  return (
    <div className="tl-actions">
      <Button size="compact" onClick={() => setOpen(true)}>
        Photos
      </Button>
      <ActionButton label="Looks right" variant="success" title={`Visit at ${visit.shop} looks right`} description={visit.flags.length ? 'Its open visit flags are closed.' : undefined} reason={{ label: 'Note (optional)', required: false }} run={({ reason }) => api.post(`/team-lead/visits/${visit.id}/check`, { verdict: 'ok', note: reason || undefined })} success="Visit checked" />
      {(visit.flags.length > 0 || !visit.proof.gpsOk) && (
        <ActionButton label="Flag" variant="danger" title={`Flag the visit at ${visit.shop}`} description={`This opens a flag that ${managerName} sees.`} reason={{ label: 'What is wrong', required: true }} run={({ reason }) => api.post(`/team-lead/visits/${visit.id}/check`, { verdict: 'flag', note: reason })} success="Visit flagged" />
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={`Proof · ${visit.shop}`} width={620}>
        <div className="tl-photos">
          {(['boardPhoto', 'selfie'] as const).map((key) => (
            <div key={key}>
              <div className="tl-photo">{photos.isPending ? 'Loading…' : photos.data?.[key] ? <img src={photos.data[key] as string} alt={key === 'boardPhoto' ? 'Shop name board' : 'Selfie'} /> : 'Not taken'}</div>
              <div className="tl-sub">{key === 'boardPhoto' ? 'Shop photo with the name board' : 'Selfie inside'}</div>
            </div>
          ))}
        </div>
        <p className="tl-sub">Links work for 5 minutes and are never public.</p>
      </Modal>
    </div>
  );
}
