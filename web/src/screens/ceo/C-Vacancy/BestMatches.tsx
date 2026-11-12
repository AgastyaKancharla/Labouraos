import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { StatusPill } from '../../../components/Badge';
import { api } from '../../../lib/api/client';
import { useScreenPath } from '../../../portals/PortalContext';

interface Match {
  jobSeekerId: string;
  priority?: boolean;
  daysLeft?: number | null;
  card: { firstName: string; age: number; trade: string; yearsExperience: number; distanceKm: number; matchReasons: string[] };
}
interface Shortlist {
  total: number;
  matches: Match[];
}

/**
 * C-Vacancy "Best matches now": the matching engine's current top candidates
 * for this vacancy (GET /vacancies/:id/shortlist — the same rules agents use),
 * with why they match and whether they were already shown.
 */
export function BestMatchesCard({ vacancyId, shownIds }: { vacancyId: string; shownIds: string[] }) {
  const to = useScreenPath();
  const q = useQuery({ queryKey: ['vacancies', vacancyId, 'shortlist'], queryFn: () => api.get<Shortlist>(`/vacancies/${vacancyId}/shortlist`) });
  const shown = new Set(shownIds);
  const rows = q.data?.matches ?? [];
  return (
    <Card title="Best matches now" aside={q.data ? `${q.data.total} match${q.data.total === 1 ? '' : 'es'}` : undefined} flush>
      {/* position: relative keeps the screen-reader-only header inside the scroller on a phone. */}
      <div className="scrollx" style={{ position: 'relative' }}>
        <table>
          <caption className="sr-only">Best matches now</caption>
          <thead>
            <tr>
              <th scope="col">Candidate</th>
              <th scope="col">Why</th>
              <th scope="col">
                <span className="sr-only">Shown</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.jobSeekerId}>
                <td>
                  <Link to={to('C-JobSeeker', { id: m.jobSeekerId })}>
                    {m.card.firstName}, {m.card.age}
                  </Link>
                </td>
                <td>
                  {m.card.trade} {m.card.yearsExperience} yrs · {Math.round(m.card.distanceKm * 10) / 10} km
                  {m.priority && m.daysLeft !== null && m.daysLeft !== undefined ? ` · close to a refund (${m.daysLeft} days left)` : ''}
                </td>
                <td>{shown.has(m.jobSeekerId) ? <StatusPill tone="info">Shown</StatusPill> : <StatusPill tone="muted">Not shown yet</StatusPill>}</td>
              </tr>
            ))}
            {q.isPending && (
              <tr>
                <td colSpan={3} className="ceo-sub">
                  Finding matches…
                </td>
              </tr>
            )}
            {q.isError && (
              <tr>
                <td colSpan={3} className="ceo-sub">
                  Matches can't be worked out for this vacancy now (not confirmed, business not verified, or the trade is not on the list).
                </td>
              </tr>
            )}
            {q.data && rows.length === 0 && (
              <tr>
                <td colSpan={3} className="ceo-sub">
                  No job seeker matches right now. The field agent is told when a new match registers.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
