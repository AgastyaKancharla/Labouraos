import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import type { Column } from '../../../components/DataTable';
import { ErrorState } from '../../../components/ErrorState';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST, formatDateTimeIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { DateFilter, FilterPanel, PagedTable, SearchField, SelectFilter, humanize, rangeQuery, useCeoList, useDebounced, type ListPeriod } from '../_kit/kit';
import { DataRequestsCard, dataRequestsKey, type DataRequestList } from './DataRequests';

/** Consent & privacy — design C-Privacy.dc.html. Proof of every consent and withdrawal (India's data law). */
interface Privacy {
  summary: { fullConsent: number; withdrawalsThisMonth: number; erasuresThisMonth: number; noticeVersion: string | null };
  purposes: { purpose: string; required: boolean; given: number; withdrawn: number }[];
  withdrawals: { id: string; at: string; subjectType: string; subjectCode: string | null; purpose: string; method: string | null; effect: string }[];
  erasures: { id: string; at: string; entityType: string; entityCode: string; by: string | null; reason: string | null }[];
  noticeVersions: { version: string; count: number; firstAt: string | null; lastAt: string | null }[];
  businesses: { total: number; signedAndRecording: number };
  partners: { total: number; termsAndRecording: number };
}
interface ConsentRow {
  id: string;
  subjectType: string;
  subjectCode: string | null;
  purpose: string;
  granted: boolean;
  noticeVersion: string;
  language: string;
  method: string;
  grantedAt: string | null;
  withdrawnAt: string | null;
  withdrawnMethod: string | null;
}

export const PURPOSE: Record<string, string> = {
  job_matching: 'Match me to jobs',
  profile_sharing: 'Share my profile with businesses',
  call_recording: 'Record calls',
  aadhaar_verification: 'Check my ID',
  job_updates: 'Job updates (SMS, WhatsApp)',
  promotions: 'Offers and news (optional)',
  agreement_terms: 'Agreement / terms',
};

export default function PrivacyScreen() {
  const to = useScreenPath();
  const p = useQuery({ queryKey: ['ceo', 'privacy'], queryFn: () => api.get<Privacy>('/ceo/privacy') });
  const d = p.data;
  const requests = useQuery({ queryKey: dataRequestsKey, queryFn: () => api.get<DataRequestList>('/data-requests') });
  const open = requests.data?.summary;
  const [search, setSearch] = useState('');
  const [subjectType, setSubjectType] = useState('');
  const [purpose, setPurpose] = useState('');
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState<ListPeriod>(null);
  const q = useDebounced(search);
  const records = useCeoList<ConsentRow>('/ceo/privacy/consents', { search: q, subjectType, purpose, status, ...rangeQuery(period) });
  const columns: Column<ConsentRow>[] = [
    { key: 'who', header: 'Who', cell: (r) => <span className="code">{r.subjectCode ?? '—'}</span>, csv: (r) => r.subjectCode },
    { key: 'type', header: 'Kind', cell: (r) => humanize(r.subjectType), csv: (r) => r.subjectType },
    { key: 'purpose', header: 'Purpose', cell: (r) => PURPOSE[r.purpose] ?? humanize(r.purpose), csv: (r) => r.purpose },
    { key: 'status', header: 'Status', cell: (r) => (r.withdrawnAt ? <StatusPill tone="warn">{`Withdrawn ${formatDateIST(r.withdrawnAt)}`}</StatusPill> : r.granted ? <StatusPill tone="good">Given</StatusPill> : <StatusPill tone="muted">Not given</StatusPill>), csv: (r) => (r.withdrawnAt ? 'withdrawn' : r.granted ? 'given' : 'not given') },
    { key: 'at', header: 'Given', cell: (r) => (r.grantedAt ? formatDateTimeIST(r.grantedAt) : '—'), csv: (r) => r.grantedAt },
    { key: 'notice', header: 'Notice', cell: (r) => `v${r.noticeVersion} · ${r.language.toUpperCase()}`, csv: (r) => `${r.noticeVersion} ${r.language}`, hideOnPhone: true },
    { key: 'method', header: 'How', cell: (r) => humanize(r.method), csv: (r) => r.method, hideOnPhone: true },
  ];
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('Main'), label: 'Command Center' }} title="Consent & privacy" subtitle="Proof of every consent, every withdrawal and every data request — what India's data law asks Laboura to keep." />
      {p.error ? (
        <ErrorState error={p.error} onRetry={() => void p.refetch()} />
      ) : (
        <>
          <StatGrid>
            <StatTile label="People with full consent" value={d?.summary.fullConsent ?? '—'} tone="good" loading={p.isPending} />
            <StatTile label="Withdrawals this month" value={d?.summary.withdrawalsThisMonth ?? '—'} tone="orange" loading={p.isPending} />
            <StatTile
              label="Data requests open"
              value={open?.open ?? '—'}
              tone="red"
              detail={open ? (open.overdue ? `${open.overdue} overdue` : 'none overdue') : undefined}
              loading={requests.isPending}
            />
            <StatTile label="Notice version in use" value={d?.summary.noticeVersion ? `v${d.summary.noticeVersion}` : '—'} tone="royal" loading={p.isPending} />
          </StatGrid>
          <div className="two-col">
            <Card title="Consent by purpose (job seekers)">
              <div className="scrollx">
                <table>
                  <thead><tr><th>Purpose</th><th>Given</th><th>Withdrawn</th></tr></thead>
                  <tbody>
                    {d?.purposes.map((x) => (
                      <tr key={x.purpose}><td>{PURPOSE[x.purpose] ?? humanize(x.purpose)}</td><td>{x.given}</td><td>{x.withdrawn}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Withdrawals (only on a recorded call with the person)">
              {d && !d.withdrawals.length ? (
                <p className="ceo-sub">No withdrawals.</p>
              ) : (
                <div className="scrollx">
                  <table>
                    <thead><tr><th>When</th><th>Who</th><th>Withdrew</th><th>Effect</th></tr></thead>
                    <tbody>
                      {d?.withdrawals.map((w) => (
                        <tr key={w.id}><td>{formatDateIST(w.at)}</td><td className="code">{w.subjectCode ?? '—'}</td><td>{PURPOSE[w.purpose] ?? humanize(w.purpose)}</td><td>{w.effect}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
          <DataRequestsCard />
          <div className="two-col">
            <Card title="Erasures done">
              {d && !d.erasures.length ? (
                <p className="ceo-sub">No erasures yet. Erasure is done from the person's page (Erase data) and recorded here; log the request above first.</p>
              ) : (
                <div className="scrollx">
                  <table>
                    <thead><tr><th>Done</th><th>Who</th><th>Request</th><th>Done by</th></tr></thead>
                    <tbody>
                      {d?.erasures.map((e) => (
                        <tr key={e.id}><td>{formatDateIST(e.at)}</td><td className="code">{e.entityCode}</td><td>Delete my data{e.reason ? ` · ${e.reason}` : ''}</td><td>{e.by ?? '—'}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card title="Notice versions">
              <div className="kv">
                {d?.noticeVersions.map((v, i) => (
                  <Pair key={v.version} k={`v${v.version}${v.firstAt ? ` · ${formatDateIST(v.firstAt)}` : ''}`} v={`${i === 0 ? 'In use' : 'Replaced · people re-agree on their next link'} · ${v.count} records`} />
                ))}
              </div>
              <h3 className="h2" style={{ marginTop: 16 }}>Business and partner consents</h3>
              <div className="kv">
                <span>Businesses: agreement + call recording</span>
                <span>{d ? `${d.businesses.signedAndRecording} of ${d.businesses.total}` : '—'}</span>
                <span>Referral partners: terms + call recording</span>
                <span>{d ? `${d.partners.termsAndRecording} of ${d.partners.total}${d.partners.total - d.partners.termsAndRecording ? ` · ${d.partners.total - d.partners.termsAndRecording} pending` : ''}` : '—'}</span>
              </div>
            </Card>
          </div>
        </>
      )}
      <Card title="Consent records">
        <FilterPanel>
          <SearchField value={search} onChange={setSearch} placeholder="JS-, BZ-, RF- code or name" />
          <SelectFilter label="Kind" value={subjectType} onChange={setSubjectType} options={[{ value: '', label: 'All' }, { value: 'job_seeker', label: 'Job seekers' }, { value: 'business', label: 'Businesses' }, { value: 'referral', label: 'Referral partners' }, { value: 'staff', label: 'Staff' }]} />
          <SelectFilter label="Purpose" value={purpose} onChange={setPurpose} options={[{ value: '', label: 'All' }, ...Object.entries(PURPOSE).map(([value, label]) => ({ value, label }))]} />
          <SelectFilter label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All' }, { value: 'given', label: 'Given' }, { value: 'withdrawn', label: 'Withdrawn' }]} />
          <DateFilter value={period} onChange={setPeriod} />
        </FilterPanel>
        <PagedTable list={records} columns={columns} rowKey={(r) => r.id} caption="Consent records" download="consent-records" />
      </Card>
    </div>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <>
      <span>{k}</span>
      <span>{v}</span>
    </>
  );
}
