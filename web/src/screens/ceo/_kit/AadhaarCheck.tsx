import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { StatusPill } from '../../../components/Badge';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateTimeIST } from '../../../lib/format/date';
import { Kv } from './kit';

/** GET /identity/job-seekers/:id/aadhaar-check (Team Lead of his team, Manager, CEO). */
export interface AadhaarCheckResponse {
  check: {
    method: string;
    status: string;
    verifiedByUidai: boolean;
    maskedReference: string | null;
    checkedAt: string;
    nameMatches: boolean | null;
    isAdult: boolean | null;
    phoneLinked: 'linked' | 'not_linked' | 'unknown' | null;
    nameOnId: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    area: string | null;
    pincode: string | null;
    photo: { kept: boolean; deletedReason: string | null; deletedAt: string | null; expiresAt: string | null };
  } | null;
  qrPhotoUrl: string | null;
  selfieUrl: string | null;
}

const PHONE_LINK: Record<string, string> = { linked: 'Yes', not_linked: 'No · flag for the Team Lead', unknown: 'Not known' };
const GENDER: Record<string, string> = { M: 'Male', F: 'Female', T: 'Transgender' };
const DELETED: Record<string, string> = {
  team_lead_approved: 'deleted after the Team Lead approved',
  team_lead_rejected: 'deleted after the Team Lead rejected',
  expired: 'deleted after 30 days',
  replaced: 'replaced by a newer scan',
  erased: 'erased',
};
const yesNo = (v: boolean | null | undefined) => (v === null || v === undefined ? '—' : v ? 'Yes' : 'No');

/**
 * The Aadhaar check of a job seeker for the CEO (and Managers / Team Leads
 * within their scope): the live selfie next to the photo from the Aadhaar QR
 * (while it is kept — until the Team Lead's check, 30 days at most), the
 * "verified by UIDAI" badge, the masked reference and the results. Loaded on
 * request: each look at the QR photo is audited. Agents never see this.
 */
export function AadhaarCheckCard({ jobSeekerId }: { jobSeekerId: string }) {
  const [data, setData] = useState<AadhaarCheckResponse | null>(null);
  const load = useMutation({ mutationFn: () => api.get<AadhaarCheckResponse>(`/identity/job-seekers/${jobSeekerId}/aadhaar-check`), onSuccess: setData });
  const c = data?.check ?? null;
  return (
    <Card title="ID check (Aadhaar)">
      {!data ? (
        <>
          <Button size="compact" onClick={() => load.mutate()} loading={load.isPending}>
            Show the ID check
          </Button>
          {load.error ? <p className="sub">{load.error instanceof ApiError ? load.error.message : 'Could not load the ID check'}</p> : null}
        </>
      ) : !c ? (
        <p className="sub">ID not checked yet.</p>
      ) : (
        <>
          <div className="tl-photos" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <figure style={{ margin: 0 }}>
              <div className="lb-idphoto">{data.selfieUrl ? <img src={data.selfieUrl} alt="Live selfie" /> : 'No selfie'}</div>
              <figcaption className="sub">Live selfie</figcaption>
            </figure>
            <figure style={{ margin: 0 }}>
              <div className="lb-idphoto">
                {data.qrPhotoUrl ? <img src={data.qrPhotoUrl} alt="Photo from the Aadhaar QR" /> : c.method === 'aadhaar_qr' ? `QR photo ${DELETED[c.photo.deletedReason ?? ''] ?? 'not kept'}` : 'No ID photo (another ID)'}
              </div>
              <figcaption className="sub">Photo from the Aadhaar QR</figcaption>
            </figure>
          </div>
          <Kv
            rows={[
              ['Result', c.verifiedByUidai ? <StatusPill tone="good">Aadhaar verified by UIDAI</StatusPill> : <StatusPill tone={c.status === 'verified' ? 'good' : 'warn'}>{`${c.method.replace(/_/g, ' ')} · ${c.status}`}</StatusPill>],
              ['Aadhaar', c.maskedReference ?? '—'],
              ['Checked', formatDateTimeIST(c.checkedAt)],
              ['Name on the ID', c.nameOnId ? `${c.nameOnId} · matches: ${yesNo(c.nameMatches)}` : `Matches: ${yesNo(c.nameMatches)}`],
              ['Date of birth · 18+', `${c.dateOfBirth ?? '—'} · ${yesNo(c.isAdult)}`],
              ['Gender', c.gender ? (GENDER[c.gender] ?? c.gender) : '—'],
              ['Area · pincode', `${c.area ?? '—'} · ${c.pincode ?? '—'}`],
              ...(c.method === 'aadhaar_qr' ? ([['Phone linked to this Aadhaar', PHONE_LINK[c.phoneLinked ?? 'unknown'] ?? '—']] as [string, string][]) : []),
            ]}
          />
        </>
      )}
    </Card>
  );
}
