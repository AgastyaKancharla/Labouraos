import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { DateField, SelectField } from '../../../components/fields';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { useAuth } from '../../../auth/AuthProvider';
import { api } from '../../../lib/api/client';
import { formatDateIST, formatTimeIST, istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../../ceo/_kit/actions';
import { roleTeam, teamShort } from '../_kit/kit';
import { RequestTabs, firstName, requestTeam, treeIndex, useTree, useWaiting, type RequestView } from '../_kit/requests';

/** Monday of this week (IST), as yyyy-mm-dd — what "Decided this week" starts from. */
export function mondayOf(now: Date): string {
  const key = istDateKey(now);
  const day = new Date(`${key}T00:00:00.000Z`);
  const back = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Decided this week — design MG-Decided.dc.html, on GET /requests/decided:
 * every request in the Manager's teams that was decided, by a Team Lead or
 * the Manager. A Team Lead's decision can be overturned with a reason
 * (POST /requests/:ref/overturn); the Team Lead, the person and the CEO see
 * it in the history.
 */
export default function ManagerDecided() {
  const to = useScreenPath();
  const now = useNow();
  const { session } = useAuth();
  const me = session?.staff.id;
  const waiting = useWaiting();
  const staff = useTree();
  const tree = useMemo(() => treeIndex(staff.data), [staff.data]);
  const [from, setFrom] = useState(() => mondayOf(now));
  const [by, setBy] = useState<'' | 'team_leads' | 'you'>('');
  const [team, setTeam] = useState('');
  const decided = useQuery({
    queryKey: ['requests', 'decided', from],
    queryFn: () => api.get<RequestView[]>('/requests/decided', { query: from ? { since: from } : undefined }),
  });

  const decider = (r: RequestView) => r.overturned?.by ?? r.decided?.by ?? null;
  const byText = (r: RequestView) => {
    const who = decider(r);
    if (!who) return '—';
    if (who.id === me) return 'You';
    return `${firstName(who.name)} (${who.role === 'team_lead' ? 'Team Lead' : who.role === 'manager' ? 'Manager' : who.role === 'ceo' ? 'CEO' : who.role})`;
  };
  const when = (r: RequestView) => {
    const at = r.overturned?.at ?? r.decided?.at ?? r.createdAt;
    return istDateKey(at) === istDateKey(now) ? `Today ${formatTimeIST(at)}` : formatDateIST(at);
  };

  const rows = (decided.data ?? []).filter((r) => {
    const who = decider(r);
    if (by === 'you' && who?.id !== me) return false;
    if (by === 'team_leads' && who?.role !== 'team_lead') return false;
    if (team && requestTeam(r, tree) !== team) return false;
    return true;
  });

  const columns: Column<RequestView>[] = [
    { key: 'when', header: 'When', cell: when, sortValue: (r) => r.overturned?.at ?? r.decided?.at ?? '' },
    { key: 'by', header: 'Decided by', cell: byText },
    {
      key: 'about',
      header: 'About',
      cell: (r) => {
        if (r.about && r.about.type !== 'staff') {
          return (
            <div className="mg-what">
              <b>
                {r.about.code} · {r.about.name}
              </b>
              <span>{r.title}</span>
            </div>
          );
        }
        const person = r.person ? tree.byId.get(r.person.id) : undefined;
        return (
          <div className="mg-what">
            <b>{r.person?.name ?? '—'}</b>
            <span>{r.person ? roleTeam(r.person.role, requestTeam(r, tree), person?.isIntern) : ''}</span>
          </div>
        );
      },
    },
    { key: 'request', header: 'Request', cell: (r) => <span className="mg-wrap">{r.kind === 'claim' ? 'Claim' : `${r.title} · ${r.summary}`}</span> },
    {
      key: 'decision',
      header: 'Decision',
      cell: (r) => (
        <StatusPill tone={r.status === 'approved' ? 'good' : 'danger'}>
          {r.status === 'approved' ? 'Approved' : 'Rejected'}
          {r.overturned ? ' · overturned' : ''}
        </StatusPill>
      ),
    },
    {
      key: 'reason',
      header: 'Their reason',
      cell: (r) => {
        const reason = r.overturned?.reason ?? r.decided?.reason;
        return reason && reason !== 'Approved' ? <span className="mg-wrap">"{reason}"</span> : '—';
      },
    },
    {
      key: 'act',
      header: '',
      cell: (r) =>
        r.canOverturn ? (
          <ActionButton
            label="Overturn"
            title={`Overturn: ${r.title.toLowerCase()} · ${r.about && r.about.type !== 'staff' ? r.about.code : (r.person?.name ?? '')}`}
            description={`${byText(r)} ${r.status === 'approved' ? 'approved' : 'rejected'} it. Overturning ${r.status === 'approved' ? 'rejects' : 'approves'} it — the Team Lead, the person and the CEO see your reason in the history.`}
            reason={{ label: 'Why you are overturning it', required: true }}
            confirmLabel="Overturn"
            run={({ reason }) => api.post(`/requests/${encodeURIComponent(r.ref)}/overturn`, { reason })}
            success="Decision overturned"
          />
        ) : (
          ''
        ),
    },
  ];

  const filtered = Boolean(by || team);

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('MG-Requests'), label: 'Requests' }} title="Decided this week" subtitle="Every request your Team Leads and you decided — overturn any of them, with a reason." />
      <RequestTabs waiting={waiting.data?.length} />
      <section className="panel mg-filters" aria-label="Filter decisions">
        <SelectField
          label="Decided by"
          value={by}
          onChange={(v) => setBy(v as typeof by)}
          placeholder="Anyone"
          options={[
            { value: 'team_leads', label: 'Team Leads' },
            { value: 'you', label: 'You' },
          ]}
        />
        <SelectField label="Team" value={team} onChange={setTeam} placeholder="All teams" options={tree.teams.map((t) => ({ value: t, label: teamShort(t) }))} />
        <DateField label="From" value={from} onChange={setFrom} max={istDateKey(now)} />
      </section>
      <Card flush>
        <DataTable
          columns={columns}
          rows={decided.data ? rows : undefined}
          rowKey={(r) => r.ref}
          caption="Decided this week"
          loading={decided.isPending}
          error={decided.error}
          onRetry={() => void decided.refetch()}
          emptyTitle={filtered ? 'No rows match these filters. Change a filter to see more.' : 'Nothing was decided in this period.'}
        />
        <div className="mg-note">You can overturn a Team Lead's decision with a reason · the Team Lead, the person and the CEO see it in the history</div>
      </Card>
    </div>
  );
}
