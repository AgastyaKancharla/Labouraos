import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { ErrorState, EmptyState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { humanize } from '../_kit/kit';
import { BusinessTabs } from '../_kit/tabs';

/** Businesses waiting — design C-Biz-Pending.dc.html: leads to visit, agreements to sign, Team Lead reviews. */
interface Row {
  id: string;
  code: string;
  name: string;
  area: string | null;
  cameFrom: string;
  cameBy: string | null;
  since: string;
  waitingDays: number;
  waitingFor: 'visit' | 'agreement' | 'tl_review';
  agreementSigned: boolean;
  candidatesShown: boolean;
  assignment: { id: string; status: string; suggested: { id: string; name: string | null } | null; assigned: { id: string; name: string | null } | null } | null;
}

const WAITING = {
  visit: 'Needs a verification visit',
  agreement: 'Agreement not signed by OTP yet',
  tl_review: 'Team Lead review (same day)',
};

export default function BusinessesWaiting() {
  const to = useScreenPath();
  const query = useQuery({ queryKey: ['ceo', 'businesses-waiting'], queryFn: () => api.get<{ rows: Row[]; fieldAgents: { id: string; name: string }[] }>('/ceo/businesses/waiting') });
  const rows = query.data?.rows ?? [];
  const agents = query.data?.fieldAgents ?? [];

  const action = (r: Row) => {
    if (r.waitingFor === 'tl_review') {
      return (
        <span className="ceo-actions">
          {r.candidatesShown && <StatusPill tone="info">Candidates already shown</StatusPill>}
          <ActionButton label="Approve" variant="success" title="Approve the verification" run={() => api.post(`/businesses/${r.id}/verification/approve`, {})} success={`${r.name} is verified`} />
          <ActionButton label="Reject" variant="danger" title="Reject the verification" reason run={({ reason }) => api.post(`/businesses/${r.id}/verification/reject`, { reason })} success={`${r.name} rejected`} />
        </span>
      );
    }
    if (r.waitingFor === 'agreement') {
      return <ActionButton label="Resend link" title="Resend the agreement link" description="The contact person gets a fresh link to sign the agreement by OTP." run={() => api.post(`/businesses/${r.id}/agreement-links`, {})} success="Agreement link sent" />;
    }
    return (
      <ActionButton
        label="Assign"
        variant="primary"
        title="Assign the verification visit"
        description={r.assignment?.suggested?.name ? `Suggested: ${r.assignment.suggested.name} (nearest available).` : 'Pick the field agent who visits.'}
        choice={{
          label: 'Field agent',
          options: agents.map((a) => ({ value: a.id, label: a.id === r.assignment?.suggested?.id ? `${a.name} (suggested)` : a.name })),
          initial: r.assignment?.suggested?.id ?? agents[0]?.id,
        }}
        run={async ({ choice }) => {
          const assignmentId = r.assignment?.id ?? (await api.post<{ id: string }>(`/businesses/${r.id}/visit-assignments`, { purpose: 'verification' })).id;
          return api.post(`/businesses/${r.id}/visit-assignments/${assignmentId}/assign`, { assignedStaffId: choice });
        }}
        success="Visit assigned"
      />
    );
  };

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('C-Businesses'), label: 'Businesses' }} title="Businesses waiting" subtitle="Leads to visit, agreements to sign and Team Lead reviews." />
      <BusinessTabs />
      <StatGrid>
        <StatTile label="Need a verification visit" value={rows.filter((r) => r.waitingFor === 'visit').length} tone="orange" loading={query.isPending} />
        <StatTile label="Agreement not signed yet" value={rows.filter((r) => r.waitingFor === 'agreement').length} tone="gold" loading={query.isPending} />
        <StatTile label="Team Lead review" value={rows.filter((r) => r.waitingFor === 'tl_review').length} tone="royal" loading={query.isPending} />
        <StatTile label="Waiting more than 2 days" value={rows.filter((r) => r.waitingDays > 2).length} tone="red" loading={query.isPending} />
      </StatGrid>
      {query.isPending ? (
        <SkeletonCard height={220} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <Card flush>
          {rows.length === 0 ? (
            <EmptyState title="Nothing is waiting — every business is visited and reviewed." />
          ) : (
            <div className="scrollx">
              <table>
                <caption className="sr-only">Businesses waiting</caption>
                <thead>
                  <tr>
                    <th scope="col">Business</th>
                    <th scope="col">Came from</th>
                    <th scope="col">Waiting for</th>
                    <th scope="col">Who</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link to={to('C-Business', { id: r.id })} style={{ fontWeight: 600 }}>
                          {r.name}
                        </Link>
                        <div className="ceo-cell-sub">
                          {r.code}
                          {r.area ? ` · ${r.area}` : ''}
                        </div>
                      </td>
                      <td>
                        {r.cameFrom === 'in_person' ? `Onboarded in person${r.cameBy ? ` by ${r.cameBy}` : ''}` : `${humanize(r.cameFrom)}${r.cameBy ? ` · ${r.cameBy}` : ''}`} · {formatDateIST(r.since)}
                      </td>
                      <td>
                        {WAITING[r.waitingFor]}
                        {r.waitingDays > 2 && (
                          <>
                            {' '}
                            <StatusPill tone="crit">{r.waitingDays} days</StatusPill>
                          </>
                        )}
                      </td>
                      <td>{r.assignment?.assigned?.name ?? (r.assignment?.suggested?.name ? `${r.assignment.suggested.name} (suggested)` : '—')}</td>
                      <td>{action(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="ceo-note" style={{ padding: '10px 16px' }}>
            No candidate is shown until the business is visited in person and the agreement is signed by OTP; the Team Lead reviews the same day.
          </div>
        </Card>
      )}
    </div>
  );
}
