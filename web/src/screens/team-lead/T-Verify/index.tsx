import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { EmptyState, ErrorState } from '../../../components/ErrorState';
import { StatusPill } from '../../../components/Badge';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../../ceo/_kit/actions';
import { Kv } from '../../ceo/_kit/kit';
import { firstName, useTeam, type Brief } from '../_kit/api';
import '../_kit/tl.css';

/** Check registrations — design T-Verify.dc.html. The ID photo is never stored (Aadhaar rule): the ID box shows the vendor's result. */
interface Registration {
  jobSeeker: { id: string; code: string; name: string };
  trade: string | null;
  registeredBy: Brief | null;
  paid: boolean;
  hasSelfie: boolean;
  idCheck: { method: string; status: string; nameMatches: boolean | null; isAdult: boolean | null } | null;
  duplicates: string[];
  signals: string[];
  verdict: string;
}
interface Board {
  summary: { toCheck: number; possibleDuplicates: number; checkedThisMonth: number; fakesThisMonth: number };
  rows: Registration[];
}

const METHOD: Record<string, string> = { digilocker: 'DigiLocker', aadhaar_qr: 'Aadhaar QR', pan: 'PAN', driving_licence: 'Driving licence', voter_id: 'Voter ID' };

export default function TeamLeadVerify() {
  const to = useScreenPath();
  const team = useTeam();
  const board = useQuery({ queryKey: ['team-lead', 'registrations'], queryFn: () => api.get<Board>('/team-lead/registrations') });
  const b = board.data;
  const mgr = team.data?.manager ? firstName(team.data.manager.name) : 'the Manager';
  return (
    <div className="lb-page">
      <TopBar showSearch={false} back={{ to: to('T-Home'), label: 'My team' }} title="Check registrations" subtitle="Catch fake or duplicate registrations before they cost money." />
      <StatGrid>
        <StatTile label="To check today" value={b?.summary.toCheck ?? '—'} tone="gold" loading={board.isPending} />
        <StatTile label="Possible duplicate" value={b?.summary.possibleDuplicates ?? '—'} tone="red" loading={board.isPending} />
        <StatTile label="Checked this month" value={b?.summary.checkedThisMonth ?? '—'} tone="good" loading={board.isPending} />
        <StatTile label="Fakes found this month" value={b?.summary.fakesThisMonth ?? '—'} tone="orange" loading={board.isPending} />
      </StatGrid>
      {board.error ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : !b ? (
        <SkeletonCard />
      ) : b.rows.length === 0 ? (
        <Card>
          <EmptyState title="Nothing to check right now." />
        </Card>
      ) : (
        b.rows.map((r) => <RegistrationCard key={r.jobSeeker.id} row={r} managerName={mgr} />)
      )}
      <div className="tl-note">
        The system checks every registration (ID check, same phone or name and date of birth, who paid) and sends you the ones to look at, plus the newest paid ones. "Fake" opens a flag that {mgr} sees.
      </div>
    </div>
  );
}

function RegistrationCard({ row, managerName }: { row: Registration; managerName: string }) {
  const toast = useToast();
  const [selfie, setSelfie] = useState<string | null | undefined>(undefined);
  const load = useMutation({
    mutationFn: () => api.get<{ url: string | null }>(`/team-lead/registrations/${row.jobSeeker.id}/selfie`),
    onSuccess: (res) => setSelfie(res.url),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not load the selfie'),
  });
  const ok = row.verdict === 'Looks normal';
  const id = row.idCheck;
  return (
    <Card
      title={`${row.jobSeeker.code} · ${row.jobSeeker.name}`}
      aside={<StatusPill tone={ok ? 'good' : row.duplicates.length ? 'danger' : 'warn'}>{row.verdict}</StatusPill>}
    >
      <p className="tl-sub" style={{ marginTop: -6 }}>
        Registered by {row.registeredBy?.name ?? '—'}
        {row.trade ? ` · ${row.trade}` : ''}
      </p>
      <div className="tl-reg">
        <div>
          <div className="tl-photo">
            {selfie ? <img src={selfie} alt={`Selfie of ${row.jobSeeker.name}`} /> : selfie === null ? 'No selfie stored' : row.hasSelfie ? <Button size="compact" onClick={() => load.mutate()} loading={load.isPending}>Show selfie</Button> : 'No selfie yet'}
          </div>
          <div className="tl-sub">Selfie</div>
        </div>
        <div>
          <div className="tl-photo">{id ? `${METHOD[id.method] ?? id.method} · ${id.status === 'verified' ? 'verified' : id.status}` : 'ID not checked yet'}</div>
          <div className="tl-sub">ID check (no ID photo is ever stored)</div>
        </div>
        <div>
          <Kv
            rows={[
              ['Name matches the ID', id?.nameMatches === null || id?.nameMatches === undefined ? '—' : id.nameMatches ? 'Yes' : 'No'],
              ['18 or over', id?.isAdult === null || id?.isAdult === undefined ? '—' : id.isAdult ? 'Yes' : 'No'],
              ['Same phone or name as someone else', row.duplicates.length ? `Yes · ${row.duplicates.join(', ')}` : 'No'],
              ['Paid the registration fee', row.paid ? 'Yes' : 'Not yet'],
            ]}
          />
          <div className="tl-actions" style={{ marginTop: 12 }}>
            <ActionButton label="Looks right" variant="success" title={`${row.jobSeeker.code} looks right`} run={() => api.post(`/team-lead/registrations/${row.jobSeeker.id}/check`, { verdict: 'ok' })} success="Marked as checked" />
            <ActionButton
              label="Fake · flag it"
              variant="danger"
              title={`Flag ${row.jobSeeker.code} as fake`}
              description={`This opens a flag that ${managerName} sees.`}
              reason={{ label: 'What looks fake', required: true }}
              run={({ reason }) => api.post(`/team-lead/registrations/${row.jobSeeker.id}/check`, { verdict: 'fake', note: reason })}
              success={`Flagged · ${managerName} will see it`}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
