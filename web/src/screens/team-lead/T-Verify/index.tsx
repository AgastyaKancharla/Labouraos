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

/**
 * Check registrations — design T-Verify.dc.html. Aadhaar (guide, 14 Nov): the
 * live selfie next to the photo from the Aadhaar QR, the green "verified by
 * UIDAI" badge, the masked reference, the name match and whether his phone is
 * linked to that Aadhaar (a flag, not a block). "Looks right" (approve) or
 * "Fake · flag it" (reject) completes the check and deletes the QR photo.
 * Both photos come through 5-minute signed links.
 */
interface Registration {
  jobSeeker: { id: string; code: string; name: string };
  trade: string | null;
  registeredBy: Brief | null;
  paid: boolean;
  hasSelfie: boolean;
  idCheck: {
    method: string;
    status: string;
    nameMatches: boolean | null;
    isAdult: boolean | null;
    /** Aadhaar QR: UIDAI's digital signature passed. */
    verifiedByUidai?: boolean;
    maskedReference?: string | null;
    phoneLinked?: 'linked' | 'not_linked' | 'unknown' | null;
    qrPhotoKept?: boolean;
  } | null;
  duplicates: string[];
  signals: string[];
  verdict: string;
}
interface Board {
  summary: { toCheck: number; possibleDuplicates: number; checkedThisMonth: number; fakesThisMonth: number };
  rows: Registration[];
}

const METHOD: Record<string, string> = { aadhaar_qr: 'Aadhaar QR', aadhaar_older_check: 'Aadhaar (older check)', pan: 'PAN', driving_licence: 'Driving licence', voter_id: 'Voter ID' };
const PHONE_LINK: Record<string, string> = { linked: 'Yes', not_linked: 'No · flag', unknown: 'Not known' };

interface AadhaarCheckView {
  qrPhotoUrl: string | null;
  selfieUrl: string | null;
}

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
  const [photos, setPhotos] = useState<AadhaarCheckView | null>(null);
  const load = useMutation({
    mutationFn: () => api.get<AadhaarCheckView>(`/identity/job-seekers/${row.jobSeeker.id}/aadhaar-check`),
    onSuccess: (res) => setPhotos(res),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not load the photos'),
  });
  const ok = row.verdict === 'Looks normal';
  const id = row.idCheck;
  const qr = id?.method === 'aadhaar_qr';
  const canShow = row.hasSelfie || Boolean(id?.qrPhotoKept);
  return (
    <Card
      title={`${row.jobSeeker.code} · ${row.jobSeeker.name}`}
      aside={<StatusPill tone={ok ? 'good' : row.duplicates.length ? 'danger' : 'warn'}>{row.verdict}</StatusPill>}
    >
      <p className="tl-sub" style={{ marginTop: -6 }}>
        Registered by {row.registeredBy?.name ?? '—'}
        {row.trade ? ` · ${row.trade}` : ''}
      </p>
      <div className="tl-reg tl-reg--pair">
        <div className="tl-photos">
        <div>
          <div className="tl-photo">
            {photos?.selfieUrl ? <img src={photos.selfieUrl} alt={`Selfie of ${row.jobSeeker.name}`} /> : !row.hasSelfie ? 'No selfie yet' : photos ? 'No selfie stored' : 'Selfie'}
          </div>
          <div className="tl-sub">Live selfie</div>
        </div>
        <div>
          <div className="tl-photo">
            {photos?.qrPhotoUrl ? (
              <img src={photos.qrPhotoUrl} alt={`Photo from the Aadhaar QR of ${row.jobSeeker.name}`} />
            ) : !id ? (
              'ID not checked yet'
            ) : !qr ? (
              `${METHOD[id.method] ?? id.method} · ${id.status === 'verified' ? 'verified' : id.status}`
            ) : id.qrPhotoKept && !photos ? (
              'Photo from the QR'
            ) : (
              'QR photo deleted after the check'
            )}
          </div>
          <div className="tl-sub">{qr ? 'Photo from the Aadhaar QR' : 'ID check (no ID photo is stored)'}</div>
        </div>
        </div>
        <div>
          {qr && id?.verifiedByUidai ? (
            <p style={{ margin: '0 0 8px' }}>
              <StatusPill tone="good">Aadhaar verified by UIDAI</StatusPill> <span className="tl-sub">{id.maskedReference ?? ''}</span>
            </p>
          ) : null}
          <Kv
            rows={[
              ['Name matches the ID', id?.nameMatches === null || id?.nameMatches === undefined ? '—' : id.nameMatches ? 'Yes' : 'No'],
              ['18 or over', id?.isAdult === null || id?.isAdult === undefined ? '—' : id.isAdult ? 'Yes' : 'No'],
              ...(qr ? ([['Phone linked to this Aadhaar', PHONE_LINK[id?.phoneLinked ?? 'unknown'] ?? '—']] as [string, string][]) : []),
              ['Same phone or name as someone else', row.duplicates.length ? `Yes · ${row.duplicates.join(', ')}` : 'No'],
              ['Paid the registration fee', row.paid ? 'Yes' : 'Not yet'],
            ]}
          />
          {canShow && !photos ? (
            <div style={{ marginTop: 10 }}>
              <Button size="compact" onClick={() => load.mutate()} loading={load.isPending}>
                Show photos
              </Button>
            </div>
          ) : null}
          <div className="tl-actions" style={{ marginTop: 12 }}>
            <ActionButton label="Looks right" variant="success" title={`${row.jobSeeker.code} looks right`} description={qr ? 'Approves the check and deletes the photo from the Aadhaar QR.' : undefined} run={() => api.post(`/team-lead/registrations/${row.jobSeeker.id}/check`, { verdict: 'ok' })} success="Marked as checked" />
            <ActionButton
              label="Fake · flag it"
              variant="danger"
              title={`Flag ${row.jobSeeker.code} as fake`}
              description={`This opens a flag that ${managerName} sees.${qr ? ' The photo from the Aadhaar QR is deleted.' : ''}`}
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
