import { useQuery } from '@tanstack/react-query';
import { AppSignupBadgeFor } from '../../shared/AppSignupBadge';
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
import type { ReactNode } from 'react';
import { useRecordsPortal } from '../_kit/records';
import { AssignmentLine, type Assignment } from '../_kit/assign';
import { StuckBox } from '../../shared/StuckBox';
import { ProfileHero } from '../_kit/photos';
import { ActionButton } from '../_kit/actions';
import { useAuth } from '../../../auth/AuthProvider';
import { BanButton, LegalAcceptanceCard } from '../_kit/legal';
import { Kv, humanize } from '../_kit/kit';
import { PAYMENT_STATUS, SEEKER_STATUS } from '../_kit/labels';

/** Referral partner page — design C-Partner.dc.html. */
interface Detail {
  /** Team Lead and Manager only: the record's section and who holds it (rev 194). */
  assignment?: Assignment;
  paused?: { at: string; reason: string | null } | null;
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
  /** Money (payout account, earnings, payouts) is the CEO's only: a Manager's answer leaves it out. */
  payoutAccount?: { method: string; masked: string; status: string; nameMatches: boolean | null; activeFrom: string; cooling: boolean } | null;
  counts: { referred: number; registered: number; joined: number; earnedPaise?: number; duePaise?: number; payoutPaise?: number };
  payouts?: { id: string; code: string; at: string; placement: { id: string; code: string; name: string } | null; amountPaise: number; status: string; paidAt: string | null }[];
  referred: { id: string; code: string; name: string; status: string; guaranteeDay: number | null; placement: { id: string; code: string; joinedDate: string | null } | null }[];
}

export default function PartnerDetail() {
  const { id = '' } = useParams();
  const { api: base, ceo, teamLead, to } = useRecordsPortal();
  const query = useQuery({ queryKey: [base, 'partner', id], queryFn: () => api.get<Detail>(`${base}/referrals/${id}`) });
  const d = query.data;
  const role = useAuth().session?.staff.role;
  const back = { to: to('C-Referrals'), label: 'Referrals' };
  if (query.isPending)
    return (
      <div className="lb-page">
        <TopBar icon="referrals" iconTone="orange" back={back} title="Referral partner" />
        <SkeletonCard height={260} />
      </div>
    );
  if (query.isError || !d)
    return (
      <div className="lb-page">
        <TopBar icon="referrals" iconTone="orange" back={back} title="Referral partner" />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  // A Manager's answer has no payouts or payout account (no money for Managers).
  const payouts = d.payouts ?? [];
  const owed = payouts.filter((p) => p.status === 'pending');
  const c = d.counts;
  return (
    <div className="lb-page">
      <TopBar icon="referrals" iconTone="orange"
        back={back}
        title={`${d.name} · ${d.code}`}
        subtitle={
          ceo
            ? `${c.referred} referred · ${c.registered} registered · ${c.joined} joined · ${formatINR(c.earnedPaise ?? 0)} earned · ${formatINR(c.duePaise ?? 0)} due.`
            : `${c.referred} referred · ${c.registered} registered · ${c.joined} joined.`
        }
        titleBadge={
          <>
            {d.paused ? <StatusPill tone="danger">Paused</StatusPill> : null}
            <AppSignupBadgeFor type="referral" id={d.id} />
          </>
        }
        actions={
          <>
          <AssignmentLine assignment={d.assignment} kind="referral" id={d.id} name={d.name} />
          {(role === 'ceo' || role === 'manager') && <BanButton subjectType="referral" subjectId={d.id} name={d.name} />}
          {teamLead ? null : d.paused ? (
            <ActionButton
              label="Unpause partner"
              title={`Unpause ${d.name}`}
              description="Agents can register new referrals from this partner again."
              reason={{ label: 'Note (optional)', required: false }}
              run={({ reason }) => api.post(`/referrals/${d.id}/unpause`, { reason: reason || undefined })}
              success={`${d.name} is unpaused`}
            />
          ) : (
            <ActionButton
              label="Pause partner"
              variant="danger"
              title={`Pause ${d.name}`}
              description="New referrals naming this partner are refused until you unpause. Money already earned is still paid."
              reason
              run={({ reason }) => api.post(`/referrals/${d.id}/pause`, { reason })}
              success={`${d.name} is paused`}
            />
          )}
          {ceo && (
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
          )}
          </>
        }
      />
      {/* Photo at the top of the profile, the name and the ID under it (rev 198). */}
      <ProfileHero kind="referral" id={d.id} name={d.name} code={d.code} />
      {/* 21 Nov (rev 204): owner, step and the matching button, in every portal's scope. */}
      <StuckBox kind="referral" id={d.id} />
      {d.paused && (
        <div className="panel" role="status" style={{ padding: '12px 18px', borderLeft: '4px solid var(--red-raw)' }}>
          <strong>Paused {formatDateIST(d.paused.at)}</strong> — {d.paused.reason ?? 'no reason recorded'}. New referrals from this partner are refused; money already earned is still paid.
        </div>
      )}
      <LegalAcceptanceCard subjectType="referral" subjectId={d.id} />
      <div className="two-col">
        <Card icon="referrals" tone="gold" title="Partner">
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
              ...(ceo ? ([[
                'UPI',
                d.payoutAccount ? (
                  <StatusPill tone={d.payoutAccount.status === 'verified' && d.payoutAccount.nameMatches !== false ? 'good' : 'warn'}>
                    {`${d.payoutAccount.masked} · ${humanize(d.payoutAccount.status).toLowerCase()}${d.payoutAccount.nameMatches === false ? ' · name mismatch' : d.payoutAccount.nameMatches ? ' · name matches' : ''}${d.payoutAccount.cooling ? ` · usable from ${formatDateIST(d.payoutAccount.activeFrom)}` : ''}`}
                  </StatusPill>
                ) : (
                  <StatusPill tone="muted">Not given yet</StatusPill>
                ),
              ]] as [string, ReactNode][]) : []),
            ]}
          />
        </Card>
        {ceo && <Card icon="payouts" tone="good" title="Payouts" flush>
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
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDateIST(p.at)}</td>
                    <td>{p.placement ? <Link to={to('C-Placement', { id: p.placement.id })}>{`${p.placement.code} · ${p.placement.name} joined`}</Link> : '—'}</td>
                    <td>{formatINR(p.amountPaise)}</td>
                    <td>
                      <StatusPill tone={PAYMENT_STATUS[p.status]?.tone ?? 'muted'}>{PAYMENT_STATUS[p.status]?.label ?? p.status}</StatusPill>
                    </td>
                  </tr>
                ))}
                {payouts.length === 0 && (
                  <tr>
                    <td colSpan={4} className="ceo-sub">
                      No payouts yet — {formatINR(c.payoutPaise ?? 0)} is queued when a referred person joins.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>}
      </div>
      <Card icon="jobSeekers" tone="cyan" title={`People ${d.name.split(' ')[0]} referred (${d.referred.length})`} flush>
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
                  <td>
                    <Link to={to('C-JobSeeker', { id: j.id })}>{j.name}</Link>
                  </td>
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
