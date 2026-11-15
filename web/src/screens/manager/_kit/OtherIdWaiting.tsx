import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { api } from '../../../lib/api/client';
import { formatDateTimeIST } from '../../../lib/format/date';
import { ActionButton } from '../../ceo/_kit/actions';
import { AadhaarCheckCard } from '../../ceo/_kit/AadhaarCheck';

interface WaitingRow {
  /** id_card: an ID card photo to approve; registration: the general registration check. */
  kind?: 'id_card' | 'registration';
  subjectType: 'job_seeker' | 'referral';
  person: { id: string; code: string; name: string; city: string };
  registeredBy: { name: string; role: string } | null;
  hasSelfie: boolean;
  method: string | null;
  idNumberLast4: string | null;
  sentAt: string;
  photoKept: boolean;
}

const METHOD: Record<string, string> = { pan: 'PAN', driving_licence: 'Driving licence', voter_id: 'Voter ID', aadhaar_qr: 'Aadhaar QR' };

/**
 * Rev 169, the fallback: what no other Team Lead of the city can check, for a Manager of that city
 * (and the CEO) — ID card photos (PAN, driving licence, voter ID) to approve, and registrations made
 * by a Team Lead or by nobody's team to check. Each opens the ID check next to the live selfie (the
 * view is audited). Never a person this Manager registered. Shows nothing when nothing waits.
 */
export function OtherIdWaiting() {
  const q = useQuery({ queryKey: ['identity', 'other-id', 'waiting'], queryFn: () => api.get<{ rows: WaitingRow[] }>('/identity/other-id/waiting') });
  const rows = q.data?.rows ?? [];
  if (!rows.length) return null;
  const cards = rows.filter((r) => (r.kind ?? 'id_card') === 'id_card').length;
  return (
    <Card title={`Waiting for your check · ${rows.length}`}>
      <p className="sub" style={{ marginTop: -6 }}>
        No other Team Lead in the city can check these, so a Manager or the CEO does{cards ? ` (${cards} ID card${cards === 1 ? '' : 's'})` : ''}. Open each one, compare it with the selfie, then decide.
      </p>
      {rows.map((row) => {
        const subjects = row.subjectType === 'referral' ? 'referrals' : 'job-seekers';
        const registration = row.kind === 'registration';
        return (
          <div key={`${row.kind ?? 'id_card'}:${row.subjectType}:${row.person.id}`} data-testid="other-id-waiting-row" style={{ marginTop: 12 }}>
            <p style={{ margin: '0 0 6px' }}>
              <strong>
                {row.person.code} · {row.person.name}
              </strong>{' '}
              <span className="sub">
                {registration ? 'Registration to check · ' : ''}
                {row.subjectType === 'referral' ? 'Referral partner · ' : ''}
                {!registration && row.method ? `${METHOD[row.method] ?? row.method}${row.idNumberLast4 ? ` …${row.idNumberLast4}` : ''} · ` : ''}
                {row.person.city} · {registration ? 'registered' : 'sent'} {formatDateTimeIST(row.sentAt)} · registered by {row.registeredBy?.name ?? 'nobody'}
              </span>
            </p>
            <AadhaarCheckCard jobSeekerId={row.person.id} subjects={subjects} title={registration ? 'ID check and selfie' : 'ID card and selfie'} />
            {registration ? (
              <div className="tl-actions" style={{ marginTop: 8 }}>
                <ActionButton
                  label="Looks right"
                  variant="success"
                  title={`${row.person.code} looks right`}
                  description="Marks the registration as checked."
                  run={async () => {
                    const res = await api.post(`/identity/${subjects}/${row.person.id}/registration-check`, { verdict: 'ok' });
                    await q.refetch();
                    return res;
                  }}
                  success="Marked as checked"
                />
                <ActionButton
                  label="Fake · flag it"
                  variant="danger"
                  title={`Flag ${row.person.code} as fake`}
                  description="Opens a flag for the Manager."
                  reason={{ label: 'What looks fake', required: true }}
                  run={async ({ reason }) => {
                    const res = await api.post(`/identity/${subjects}/${row.person.id}/registration-check`, { verdict: 'fake', note: reason });
                    await q.refetch();
                    return res;
                  }}
                  success="Flagged"
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </Card>
  );
}
