import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { api } from '../../../lib/api/client';
import { formatDateTimeIST } from '../../../lib/format/date';
import { AadhaarCheckCard } from '../../ceo/_kit/AadhaarCheck';

interface WaitingRow {
  subjectType: 'job_seeker' | 'referral';
  person: { id: string; code: string; name: string; city: string };
  registeredBy: { name: string; role: string } | null;
  hasSelfie: boolean;
  method: string;
  idNumberLast4: string | null;
  sentAt: string;
  photoKept: boolean;
}

const METHOD: Record<string, string> = { pan: 'PAN', driving_licence: 'Driving licence', voter_id: 'Voter ID' };

/**
 * Rev 169, the fallback: ID card photos (PAN, driving licence, voter ID) that no other Team Lead of
 * the city can check, for a Manager of that city (and the CEO). Each opens the card next to the live
 * selfie (the view is audited) with "Looks right" / "Fake · flag it". Never a person this Manager
 * registered. Shows nothing when nothing waits.
 */
export function OtherIdWaiting() {
  const q = useQuery({ queryKey: ['identity', 'other-id', 'waiting'], queryFn: () => api.get<{ rows: WaitingRow[] }>('/identity/other-id/waiting') });
  const rows = q.data?.rows ?? [];
  if (!rows.length) return null;
  return (
    <Card title={`ID cards waiting for you · ${rows.length}`}>
      <p className="sub" style={{ marginTop: -6 }}>
        No other Team Lead in the city can check these, so a Manager or the CEO does. Open each one, compare the card with the selfie, then decide.
      </p>
      {rows.map((row) => (
        <div key={`${row.subjectType}:${row.person.id}`} data-testid="other-id-waiting-row" style={{ marginTop: 12 }}>
          <p style={{ margin: '0 0 6px' }}>
            <strong>
              {row.person.code} · {row.person.name}
            </strong>{' '}
            <span className="sub">
              {row.subjectType === 'referral' ? 'Referral partner · ' : ''}
              {METHOD[row.method] ?? row.method}
              {row.idNumberLast4 ? ` …${row.idNumberLast4}` : ''} · {row.person.city} · sent {formatDateTimeIST(row.sentAt)} · registered by {row.registeredBy?.name ?? 'nobody'}
            </span>
          </p>
          <AadhaarCheckCard jobSeekerId={row.person.id} subjects={row.subjectType === 'referral' ? 'referrals' : 'job-seekers'} title="ID card and selfie" />
        </div>
      ))}
    </Card>
  );
}
