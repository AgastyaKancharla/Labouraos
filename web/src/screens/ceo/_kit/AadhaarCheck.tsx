import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { StatusPill } from '../../../components/Badge';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateTimeIST } from '../../../lib/format/date';
import { ActionButton } from './actions';
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
    /** Another ID: the last 4 of the number he typed. */
    idNumberLast4?: string | null;
    /** A signed Aadhaar QR showed under 18 and no Manager / CEO has lifted the stop (rev 154). */
    under18Stop?: boolean;
    photo: { kind?: 'aadhaar_qr' | 'id_card_photo' | null; kept: boolean; deletedReason: string | null; deletedAt: string | null; expiresAt: string | null };
  } | null;
  /** The ID photo while it is kept: from the QR, or the live photo of another ID card. */
  idPhotoUrl?: string | null;
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
const METHOD: Record<string, string> = { aadhaar_qr: 'Aadhaar QR', pan: 'PAN', driving_licence: 'Driving licence', voter_id: 'Voter ID', aadhaar_older_check: 'Aadhaar (older check)' };
const yesNo = (v: boolean | null | undefined) => (v === null || v === undefined ? '—' : v ? 'Yes' : 'No');

/**
 * The Aadhaar check of a job seeker for the CEO (and Managers / Team Leads
 * within their scope): the live selfie next to the photo from the Aadhaar QR
 * (while it is kept — until the Team Lead's check, 30 days at most), the
 * "verified by UIDAI" badge, the masked reference and the results; for
 * another ID the live photo of the card (until the Team Lead's check), its
 * type and the last 4 of the number. Loaded on request: every look is
 * audited. Agents never see this. A standing under-18 stop can be lifted here
 * with a written reason (CEO; the API also lets a Manager over that
 * registration do it).
 */
export function AadhaarCheckCard({ jobSeekerId }: { jobSeekerId: string }) {
  const [data, setData] = useState<AadhaarCheckResponse | null>(null);
  const load = useMutation({ mutationFn: () => api.get<AadhaarCheckResponse>(`/identity/job-seekers/${jobSeekerId}/aadhaar-check`), onSuccess: setData });
  const c = data?.check ?? null;
  const idPhotoUrl = data ? (data.idPhotoUrl ?? data.qrPhotoUrl) : null;
  const card = Boolean(c && c.method !== 'aadhaar_qr');
  return (
    <Card title="ID check">
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
                {idPhotoUrl ? (
                  <img src={idPhotoUrl} alt={card ? 'Live photo of the ID card' : 'Photo from the Aadhaar QR'} />
                ) : (
                  `${card ? 'Card photo' : 'QR photo'} ${DELETED[c.photo.deletedReason ?? ''] ?? 'not kept'}`
                )}
              </div>
              <figcaption className="sub">{card ? `Live photo of the ${METHOD[c.method] ?? 'ID'} card` : 'Photo from the Aadhaar QR'}</figcaption>
            </figure>
          </div>
          {c.under18Stop ? (
            <div className="lb-under18" data-testid="under18-stop" style={{ marginBottom: 12 }}>
              <p style={{ margin: '0 0 8px' }}>
                <StatusPill tone="danger">Under 18 · registration stopped</StatusPill>{' '}
                <span className="sub">A signed Aadhaar QR shows under 18. No other ID, payment or terms step gets past it until it is lifted.</span>
              </p>
              <ActionButton
                label="Lift the under-18 stop"
                variant="danger"
                title="Lift the under-18 stop"
                description="Only when you have seen proof that the person is 18 or older (for example, the date on the card was wrong). Your reason is kept in the audit log."
                reason={{ label: 'Why the stop is lifted (proof seen)', required: true }}
                run={async ({ reason }) => {
                  const res = await api.post(`/identity/job-seekers/${jobSeekerId}/under-18/lift`, { reason });
                  load.mutate();
                  return res;
                }}
                success="Under-18 stop lifted"
              />
            </div>
          ) : null}
          <Kv
            rows={[
              ['Result', c.verifiedByUidai ? <StatusPill tone="good">Aadhaar verified by UIDAI</StatusPill> : <StatusPill tone={c.status === 'verified' ? 'good' : 'warn'}>{`${c.method.replace(/_/g, ' ')} · ${c.status}`}</StatusPill>],
              ...(card
                ? ([
                  ['ID', METHOD[c.method] ?? c.method],
                  ['Number ends in', c.idNumberLast4 ? `…${c.idNumberLast4}` : '—'],
                ] as [string, string][])
                : ([['Aadhaar', c.maskedReference ?? '—']] as [string, string][])),
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
