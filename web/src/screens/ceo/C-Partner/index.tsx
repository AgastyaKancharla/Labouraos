import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { formatMobile } from '../../../lib/format/phone';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { Kv, humanize } from '../_kit/kit';
import { PAYMENT_STATUS, SEEKER_STATUS } from '../_kit/labels';

/** Referral partner page — design C-Partner.dc.html. */
interface Detail {
  id: string;
  code: string;
  name: string;
  phone: string;
  type: string;
  role: string | null;
  businessName: string | null;
  area: string | null;
  createdAt: string;
  registeredBy: string | null;
  terms: { granted: boolean; at: string | null } | null;
  identity: { status: string; method: string; nameMatches: boolean | null } | null;
  payoutAccount: { method: string; masked: string; status: string; nameMatches: boolean | null; activeFrom: string; cooling: boolean } | null;
  counts: { referred: number; registered: number; joined: number; earnedPaise: number; duePaise: number; payoutPaise: number };
  payouts: { id: string; code: string; at: string; placement: { id: string; code: string; name: string } | null; amountPaise: number; status: string; paidAt: string | null }[];
  referred: { id: string; code: string; name: string; status: string; guaranteeDay: number | null; placement: { id: string; code: string; joinedDate: string | null } | null }[];
}

export default function PartnerDetail() {
  const { id = '' } = useParams();
  const to = useScreenPath();
  const query = useQuery({ queryKey: ['ceo', 'partner', id], queryFn: () => api.get<Detail>(`/ceo/referrals/${id}`) });
  const d = query.data;
  const back = { to: to('C-Referrals'), label: 'Referrals' };
  if (query.isPending)
    return (
      <div className="lb-page">
        <TopBar back={back} title="Referral partner" />
        <SkeletonCard height={260} />
      </div>
    );
  if (query.isError || !d)
    return (
      <div className="lb-page">
        <TopBar back={back} title="Referral partner" />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  const owed = d.payouts.filter((p) => p.status === 'pending');
  const c = d.counts;
  return (
    <div className="lb-page">
      <TopBar
        back={back}
        title={`${d.name} · ${d.code}`}
        subtitle={`${c.referred} referred · ${c.registered} registered · ${c.joined} joined · ${formatINR(c.earnedPaise)} earned · ${formatINR(c.duePaise)} due.`}
        actions={
          <ActionButton
            label="Release due payouts"
            variant="primary"
            title={`Approve ${owed.length} payout${owed.length === 1 ? '' : 's'}`}
            description={`${formatINR(owed.reduce((s, p) => s + p.amountPaise, 0))} to ${d.name}. Finance pays them today (after any 48-hour wait for changed UPI details) and records the UTR.`}
            disabled={owed.length === 0}
            run={async () => {
              for (const p of owed) await api.post(`/payments/${p.id}/approve`);
            }}
            success="Payouts approved — Finance pays them today"
          />
        }
      />
      <div className="two-col">
        <Card title="Partner">
          <Kv
            rows={[
              ['Phone', d.phone.includes('*') ? d.phone : formatMobile(d.phone.replace(/^\+91/, ''))],
              ['Type', `${humanize(d.type)}${d.role ? ` · ${humanize(d.role).toLowerCase()}` : ''}${d.businessName ? ` · ${d.businessName}` : ''}`],
              ['Area', d.area ?? '—'],
              ['Registered', `${formatDateIST(d.createdAt)}${d.registeredBy ? ` · by ${d.registeredBy}` : ''}`],
              ['Terms + call recording', d.terms?.granted ? <StatusPill tone="good">{`Agreed by OTP${d.terms.at ? ` ${formatDateIST(d.terms.at)}` : ''}`}</StatusPill> : <StatusPill tone="warn">Not agreed yet</StatusPill>],
              [
                'Selfie / ID',
                d.identity ? (
                  <StatusPill tone={d.identity.status === 'verified' ? (d.identity.nameMatches === false ? 'warn' : 'good') : 'warn'}>
                    {`${humanize(d.identity.method)} · ${d.identity.status === 'verified' ? (d.identity.nameMatches === false ? 'name does not match' : 'name matches') : humanize(d.identity.status).toLowerCase()}`}
                  </StatusPill>
                ) : (
                  <StatusPill tone="muted">Not done</StatusPill>
                ),
              ],
              [
                'UPI',
                d.payoutAccount ? (
                  <StatusPill tone={d.payoutAccount.status === 'verified' && d.payoutAccount.nameMatches !== false ? 'good' : 'warn'}>
                    {`${d.payoutAccount.masked} · ${humanize(d.payoutAccount.status).toLowerCase()}${d.payoutAccount.nameMatches === false ? ' · name mismatch' : d.payoutAccount.nameMatches ? ' · name matches' : ''}${d.payoutAccount.cooling ? ` · usable from ${formatDateIST(d.payoutAccount.activeFrom)}` : ''}`}
                  </StatusPill>
                ) : (
                  <StatusPill tone="muted">Not given yet</StatusPill>
                ),
              ],
            ]}
          />
        </Card>
        <Card title="Payouts" flush>
          <div className="scrollx">
            <table>
              <caption className="sr-only">Payouts</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">For</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {d.payouts.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDateIST(p.at)}</td>
                    <td>{p.placement ? <Link to={to('C-Placement', { id: p.placement.id })}>{`${p.placement.code} · ${p.placement.name} joined`}</Link> : '—'}</td>
                    <td>{formatINR(p.amountPaise)}</td>
                    <td>
                      <StatusPill tone={PAYMENT_STATUS[p.status]?.tone ?? 'muted'}>{PAYMENT_STATUS[p.status]?.label ?? p.status}</StatusPill>
                    </td>
                  </tr>
                ))}
                {d.payouts.length === 0 && (
                  <tr>
                    <td colSpan={4} className="ceo-sub">
                      No payouts yet — {formatINR(c.payoutPaise)} is queued when a referred person joins.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <Card title={`People ${d.name.split(' ')[0]} referred (${d.referred.length})`} flush>
        <div className="scrollx">
          <table>
            <caption className="sr-only">People referred</caption>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Name</th>
                <th scope="col">Status</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {d.referred.map((j) => (
                <tr key={j.id}>
                  <td className="code">{j.code}</td>
                  <td>{j.name}</td>
                  <td>
                    {j.placement?.joinedDate ? (
                      <StatusPill tone="good">{`Joined ${formatDateIST(j.placement.joinedDate)}`}</StatusPill>
                    ) : (
                      <StatusPill tone={SEEKER_STATUS[j.status]?.tone ?? 'muted'}>{`${SEEKER_STATUS[j.status]?.label ?? j.status}${j.guaranteeDay ? ` · day ${j.guaranteeDay}` : ''}`}</StatusPill>
                    )}
                  </td>
                  <td>{j.placement ? <Link to={to('C-Placement', { id: j.placement.id })}>Open →</Link> : <Link to={to('C-JobSeeker', { id: j.id })}>Open →</Link>}</td>
                </tr>
              ))}
              {d.referred.length === 0 && (
                <tr>
                  <td colSpan={4} className="ceo-sub">
                    Nobody referred yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
