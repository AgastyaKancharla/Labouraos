import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { Kv, Timeline, humanize } from '../_kit/kit';
import { VACANCY_STATUS } from '../_kit/labels';

/** CEO vacancy page — design C-Vacancy.dc.html. */
interface Detail {
  id: string;
  code: string;
  status: string;
  business: { id: string; code: string; name: string; locality: string | null };
  trade: string;
  role: string;
  description: string | null;
  headcount: number;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  salaryPeriod: string | null;
  belowLegalMinimum: boolean;
  ownerToldMinimumWage: boolean;
  shift: string | null;
  workingHours: string | null;
  weeklyOff: string | null;
  extras: string[];
  locality: string | null;
  confirmedAt: string | null;
  confirmationMethod: string | null;
  confirmedByName: string | null;
  capturedBy: { name: string; role: string } | null;
  replacementFor: string | null;
  openDays: number;
  tiles: { matching: number; shown: number; interviews: number; openDays: number };
  candidates: { id: string; code: string; name: string; locality: string | null; age: number | null; status: string; at: string }[];
  placements: { id: string; code: string; status: string; name: string }[];
  history: { at: string; status: string; by: string | null; reason: string | null }[];
}

const CANDIDATE: Record<string, { label: string; tone: 'good' | 'info' | 'muted' | 'warn' | 'danger' }> = {
  shown: { label: 'Shown', tone: 'info' },
  offered: { label: 'Offer sent', tone: 'info' },
  confirmed: { label: 'Interview booked', tone: 'info' },
  selected: { label: 'Selected', tone: 'good' },
  not_selected: { label: 'Not selected', tone: 'muted' },
  no_show: { label: "Didn't turn up", tone: 'warn' },
  declined: { label: 'Declined', tone: 'muted' },
};

export default function VacancyDetail() {
  const { id = '' } = useParams();
  const to = useScreenPath();
  const query = useQuery({ queryKey: ['ceo', 'vacancy', id], queryFn: () => api.get<Detail>(`/ceo/vacancies/${id}`) });
  const d = query.data;
  const back = { to: to('C-Vacancies'), label: 'Vacancies' };
  if (query.isPending)
    return (
      <div className="lb-page">
        <TopBar back={back} title="Vacancy" />
        <SkeletonCard height={260} />
      </div>
    );
  if (query.isError || !d)
    return (
      <div className="lb-page">
        <TopBar back={back} title="Vacancy" />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  const salary =
    d.salaryMinPaise !== null || d.salaryMaxPaise !== null
      ? `${d.salaryMinPaise !== null ? formatINR(d.salaryMinPaise) : ''}${d.salaryMaxPaise !== null ? `–${formatINR(d.salaryMaxPaise).replace('₹', '')}` : ''} ${d.salaryPeriod === 'daily' ? 'a day' : 'a month'}`
      : '—';
  return (
    <div className="lb-page">
      <TopBar
        back={back}
        title={`${d.role}${d.headcount > 1 ? ` × ${d.headcount}` : ''} · ${d.code}`}
        subtitle={`${d.business.name} · ${VACANCY_STATUS[d.status]?.label.toLowerCase() ?? d.status} · open ${d.openDays} days · ${d.tiles.matching} candidates in the trade.`}
        actions={
          d.status === 'open' ? (
            <ActionButton
              label="Close vacancy"
              variant="danger"
              title="Close this vacancy"
              description="No more matching or interviews for it. The reason is kept in the history."
              reason
              run={({ reason }) => api.patch(`/vacancies/${d.id}`, { status: 'cancelled', reason })}
              success="Vacancy closed"
            />
          ) : undefined
        }
      />
      <StatGrid>
        <StatTile label="Matching candidates (same trade)" value={d.tiles.matching} tone="cyan" />
        <StatTile label="Shown to owner" value={d.tiles.shown} tone="royal" />
        <StatTile label="Interviews" value={d.tiles.interviews} tone="navy" />
        <StatTile label="Open" value={`${d.tiles.openDays} days`} tone={d.tiles.openDays > 15 ? 'orange' : 'gold'} />
      </StatGrid>
      <div className="two-col">
        <Card title="Vacancy">
          <Kv
            rows={[
              ['Business', <Link to={to('C-Business', { id: d.business.id })}>{`${d.business.name} · ${d.business.code}`}</Link>],
              ['Role', `${d.role}${d.trade !== d.role ? ` · ${d.trade}` : ''} · ${d.headcount} position${d.headcount > 1 ? 's' : ''}`],
              ['Salary', `${salary}${d.belowLegalMinimum ? ` · below legal minimum${d.ownerToldMinimumWage ? ' (owner told)' : ''}` : ''}`],
              ['Shift', [humanize(d.shift), d.workingHours, d.weeklyOff ? `weekly off ${d.weeklyOff}` : null].filter((x) => x && x !== '—').join(' · ') || '—'],
              ['Extras', d.extras.length ? d.extras.map(humanize).join(', ') : '—'],
              ['Area', d.locality ?? '—'],
              ['Confirmed', d.confirmedAt ? <StatusPill tone="good">{`${humanize(d.confirmationMethod) ?? 'Owner OTP'} · ${formatDateIST(d.confirmedAt)}`}</StatusPill> : <StatusPill tone="warn">Waiting for owner OTP</StatusPill>],
              ['Captured by', d.capturedBy ? `${d.capturedBy.name} (${d.capturedBy.role === 'field_agent' ? 'field' : 'call'})` : '—'],
              ...(d.replacementFor ? ([['Replacement for', <Link to={to('C-Placement', { id: d.replacementFor })}>placement</Link>]] as [string, ReactNode][]) : []),
              ...(d.description ? ([['Description', d.description]] as [string, string][]) : []),
            ]}
          />
        </Card>
        <Card title="Candidates shown and interviewed" flush>
          <div className="scrollx">
            <table>
              <caption className="sr-only">Candidates</caption>
              <thead>
                <tr>
                  <th scope="col">Candidate</th>
                  <th scope="col">When</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {d.candidates.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={to('C-JobSeeker', { id: c.id })}>
                        {c.name}
                        {c.age ? `, ${c.age}` : ''}
                      </Link>
                      <div className="ceo-cell-sub">
                        {c.code}
                        {c.locality ? ` · ${c.locality}` : ''}
                      </div>
                    </td>
                    <td>{formatDateIST(c.at)}</td>
                    <td>
                      <StatusPill tone={CANDIDATE[c.status]?.tone ?? 'info'}>{CANDIDATE[c.status]?.label ?? humanize(c.status)}</StatusPill>
                    </td>
                  </tr>
                ))}
                {d.candidates.length === 0 && (
                  <tr>
                    <td colSpan={3} className="ceo-sub">
                      Nobody shown yet. Agents run matching from the field app and call console.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      {(d.placements.length > 0 || d.history.length > 0) && (
        <div className="two-col">
          <Card title="Placements">
            {d.placements.map((p) => (
              <div className="row" key={p.id} style={{ justifyContent: 'space-between' }}>
                <Link to={to('C-Placement', { id: p.id })}>
                  {p.code} · {p.name}
                </Link>
                <span>{humanize(p.status)}</span>
              </div>
            ))}
            {d.placements.length === 0 && <p className="ceo-sub">None yet.</p>}
          </Card>
          <Card title="History">
            <Timeline events={d.history.map((h) => ({ at: h.at, text: `${humanize(h.status)}${h.by ? ` · ${h.by}` : ''}`, aside: h.reason ? humanize(h.reason) : null }))} />
          </Card>
        </div>
      )}
    </div>
  );
}
