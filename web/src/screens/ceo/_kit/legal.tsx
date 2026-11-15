import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { StatusPill } from '../../../components/Badge';
import { api } from '../../../lib/api/client';
import { formatDateTimeIST } from '../../../lib/format/date';
import { ApiError } from '../../../lib/api/errors';
import { useToast } from '../../../components/Toast';
import { openWithToken } from '../../finance/_kit/upload';
import { ActionButton } from './actions';

/**
 * Legal documents v1.1 and conduct (Master Guide rev 176), for the staff
 * screens: which terms version a person accepted (with language, OTP and the
 * exact text), D11 permanent ban (Manager / CEO) and D6 business suspension (CEO).
 */
export type LegalSubject = 'job_seeker' | 'business' | 'referral';

interface Acceptance {
  id: string;
  documentKey: string;
  version: string;
  language: string;
  context: string;
  method: string;
  otpRequestId: string | null;
  noticeVersion: string | null;
  purposes: string[];
  acceptedAt: string;
}
interface AcceptanceList {
  status: { documentKey: string; currentVersion: string; acceptedVersion: string | null; needsReconsent: boolean; noticeVersion: string | null; currentNoticeVersion: string | null };
  acceptances: Acceptance[];
}

const DOC: Record<string, string> = {
  job_seeker_terms: 'Job seeker terms',
  business_agreement: 'Business agreement',
  referral_terms: 'Referral partner terms',
};
const CONTEXT: Record<string, string> = {
  registration: 'Consent step',
  payment_terms: 'Guarantee terms at payment',
  agreement: 'Agreement signed',
  partner_terms: 'Partner terms',
  reconsent: 'Re-consent',
};
const LANG: Record<string, string> = { kn: 'Kannada', hi: 'Hindi', en: 'English' };

/** "Accepted version 1.1 (English) · needs re-consent", with each acceptance listed. */
export function LegalAcceptanceCard({ subjectType, subjectId }: { subjectType: LegalSubject; subjectId: string }) {
  const toast = useToast();
  const q = useQuery({
    queryKey: ['legal-acceptances', subjectType, subjectId],
    queryFn: () => api.get<AcceptanceList>(`/legal/acceptances/${subjectType}/${subjectId}`),
    enabled: Boolean(subjectId),
    retry: false,
  });
  if (!q.data) return null;
  const { status, acceptances } = q.data;
  return (
    <Card title="Terms accepted" aria-label="Terms accepted">
      <div className="ceo-note">
        {DOC[status.documentKey] ?? status.documentKey}: current version {status.currentVersion}
        {status.currentNoticeVersion ? ` · consent notice ${status.currentNoticeVersion}` : ''} · accepted{' '}
        <strong>{status.acceptedVersion ? `version ${status.acceptedVersion}` : 'not yet in the new record'}</strong>{' '}
        {status.needsReconsent ? <StatusPill tone="warn">Asked to accept the new version on next open</StatusPill> : status.acceptedVersion ? <StatusPill tone="good">Up to date</StatusPill> : null}
      </div>
      {acceptances.length > 0 && (
        <ul className="ceo-list">
          {acceptances.map((a) => (
            <li key={a.id}>
              {formatDateTimeIST(a.acceptedAt)} · {CONTEXT[a.context] ?? a.context} · v{a.version}
              {a.noticeVersion ? ` (notice ${a.noticeVersion})` : ''} · {LANG[a.language] ?? a.language} · {a.method === 'in_app' ? 'in the app' : 'on the link'} by OTP ·{' '}
              <button
                type="button"
                className="lb-link"
                data-testid={`signed-copy-${a.id}`}
                onClick={() =>
                  openWithToken(`/legal/acceptance-text/${a.id}`).catch((e) => toast.error(e instanceof ApiError ? e.message : 'Could not open the signed copy'))
                }
              >
                View signed copy
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const BAN_CATEGORIES = [
  { value: 'forged_id', label: 'Forged or altered ID' },
  { value: 'fraud', label: 'Fraud' },
  { value: 'theft', label: 'Theft' },
  { value: 'violence', label: 'Violence' },
];

/** D11: Manager / CEO only. The same phone or ID can never register again. */
export function BanButton({ subjectType, subjectId, name }: { subjectType: LegalSubject; subjectId: string; name: string }) {
  const ban = useQuery({
    queryKey: ['permanent-ban', subjectType, subjectId],
    queryFn: () => api.get<{ banned: boolean; category?: string; reason?: string; bannedAt?: string }>(`/permanent-bans/${subjectType}/${subjectId}`),
    enabled: Boolean(subjectId),
    retry: false,
  });
  if (ban.data?.banned) return <StatusPill tone="danger">Permanently banned</StatusPill>;
  return (
    <ActionButton
      label="Ban permanently"
      variant="danger"
      title={`Ban ${name} permanently?`}
      description="Only for a forged ID, fraud, theft or violence (Master Guide). No refund; the same phone number or ID can never register again. The police get records only on a lawful request."
      choice={{ label: 'Why', options: BAN_CATEGORIES }}
      reason={{ label: 'What happened (kept in the audit log)', required: true }}
      confirmLabel="Ban permanently"
      run={({ reason, choice }) => api.post('/permanent-bans', { subjectType, subjectId, category: choice, reason })}
      success="Banned permanently"
    />
  );
}

/** D6: the CEO suspends a business for 30–90 days or permanently, with a reason. */
export function SuspendButtons({ businessId, suspended }: { businessId: string; suspended: boolean }) {
  if (suspended) {
    return (
      <ActionButton
        label="Lift suspension"
        title="Lift this business's suspension?"
        reason={{ label: 'Reason', required: true }}
        run={({ reason }) => api.post(`/businesses/${businessId}/suspension/lift`, { reason })}
        success="Suspension lifted"
      />
    );
  }
  return (
    <ActionButton
      label="Suspend"
      variant="danger"
      title="Suspend this business?"
      description="For repeated cancellations, no-shows at its own interviews, or misuse of candidates' data (agreement 6.4). While suspended it adds no vacancies, is shown no candidates and books no interviews. Placements, guarantees and payments already made carry on. Fees owed stay payable."
      choice={{
        label: 'How long',
        options: [
          { value: '30', label: '30 days' },
          { value: '60', label: '60 days' },
          { value: '90', label: '90 days' },
          { value: 'permanent', label: 'Permanently (serious cases)' },
        ],
      }}
      reason={{ label: 'Reason (told to the business)', required: true }}
      confirmLabel="Suspend"
      run={({ reason, choice }) =>
        api.post(`/businesses/${businessId}/suspension`, choice === 'permanent' ? { permanent: true, reason } : { days: Number(choice), reason })
      }
      success="Business suspended"
    />
  );
}

/** The banner on a suspended business's screens. */
export function SuspensionBanner({ suspension }: { suspension: { until: string | null; permanent: boolean; reason: string | null } | null | undefined }) {
  if (!suspension) return null;
  return (
    <div className="ceo-note ceo-note--danger" role="status" data-testid="suspension-banner">
      <strong>Suspended {suspension.permanent ? 'permanently' : `until ${formatDateTimeIST(suspension.until!)}`}.</strong> No new vacancies, no candidates shown, no
      bookings. Placements, guarantees and payments already made carry on.{suspension.reason ? ` Reason: ${suspension.reason}` : ''}
    </div>
  );
}
