import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { EmptyState, ErrorState } from '../../../components/ErrorState';
import { StatusPill } from '../../../components/Badge';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { ActionButton } from '../../ceo/_kit/actions';
import { Kv, humanize } from '../../ceo/_kit/kit';
import { OwnerPhotos } from '../../ceo/_kit/photos';
import { homeBack, useRecordsPortal } from '../../ceo/_kit/records';

/**
 * Businesses and vacancies to check — Master Guide rev 211–212 (25 Nov). Every business the
 * automatic check sent here (no sampling, no limit), oldest first, with every failed reason,
 * the proofs, the distance to the Maps pin and the owner's photos; a small business also shows
 * the owner's ID, business proof, address proof and the "Video call done" step, all needed
 * before Approve. Every vacancy held for an unusual salary or many openings, with why.
 * Approve and Reject are the existing routes; "Ask for a visit" sends a field agent.
 */
interface Reason { code: string; ok: boolean; detail: string }
interface SmallBusiness {
  ownerId: { method: string | null; type: string | null; result: string | null; last4: string | null; failureReason: string | null };
  ownerIdName: string | null;
  businessProof: { given: boolean; kind: string | null; fromProofs: boolean };
  businessProofValue: string | null;
  addressProof: { submitted: boolean; docType: string | null; result: string | null };
  addressMatched: string | null;
  videoCall: { done: boolean; at: string | null };
  videoCallNote: string | null;
  photos: { selfie: boolean; workspace: boolean };
  idPhotoWaiting: boolean;
  addressPhotoWaiting: boolean;
  missing: string[];
}
interface BusinessRow {
  id: string;
  code: string;
  name: string;
  area: string | null;
  type: string | null;
  since: string;
  candidatesShownMeanwhile: boolean;
  owner: string | null;
  canDecide: boolean;
  visit: { id: string; purpose: string; status: string } | null;
  verification: {
    household: boolean;
    runsFromHome: boolean;
    autoCheck: { status: string; checkedAt: string | null; distanceMeters: number | null; reasons: Reason[]; failed: string[] } | null;
    proofs: { key: string; label: string; given: boolean; valid: boolean; detail: string | null }[];
    mapsPlaceName: string | null;
  };
  smallBusiness: SmallBusiness | null;
}
interface VacancyRow {
  id: string;
  code: string;
  trade: string;
  headcount: number;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  salaryPeriod: string | null;
  usualSalary: { minPaise: number; maxPaise: number } | null;
  reasons: { code: string; detail: string }[];
  business: { id: string; code: string; name: string; locality: string | null };
}

const ID_WORD: Record<string, string> = { aadhaar: 'Aadhaar (QR)', pan: 'PAN', driving_licence: 'Driving licence', voter_id: 'Voter ID' };

function SmallBusinessChecks({ row }: { row: BusinessRow }) {
  const s = row.smallBusiness!;
  const idText = s.ownerId.result
    ? `${ID_WORD[s.ownerId.type ?? ''] ?? humanize(s.ownerId.type)}${s.ownerId.last4 ? ` ending ${s.ownerId.last4}` : ''}${s.ownerIdName ? ` · ${s.ownerIdName}` : ''} · ${humanize(s.ownerId.result)}`
    : 'Not given yet';
  return (
    <div data-testid="small-business-checks">
      <h4 style={{ margin: '12px 0 4px' }}>Small business checks (fewer than 2 proofs)</h4>
      <Kv
        rows={[
          ["Owner's ID", idText],
          ['Business proof', s.businessProof.given ? (s.businessProof.fromProofs && !s.businessProof.kind ? 'From the proofs above' : `${humanize(s.businessProof.kind)} · ${s.businessProofValue ?? ''}`) : 'Not given yet'],
          ['Address proof', s.addressProof.submitted ? `${humanize(s.addressProof.docType)} · ${humanize(s.addressProof.result)}${s.addressMatched ? ` · ${s.addressMatched}` : ''}` : 'Not given yet'],
          ['Video call', s.videoCall.done ? `Done ${formatDateIST(s.videoCall.at!)}${s.videoCallNote ? ` · ${s.videoCallNote}` : ''}` : 'Not done yet'],
        ]}
      />
      {row.canDecide && (
        <span className="ceo-actions" style={{ marginTop: 8 }}>
          {s.idPhotoWaiting && s.ownerId.result === 'pending' && (
            <>
              <ActionButton label="ID looks right" variant="success" title="Approve the owner's ID" description="Compare the card photo with the owner's selfie. The card photo is deleted after your decision." run={() => api.post(`/businesses/${row.id}/small-business/owner-id`, { decision: 'approve' })} success="Owner's ID approved" />
              <ActionButton label="Reject ID" variant="danger" title="Reject the owner's ID" reason run={({ reason }) => api.post(`/businesses/${row.id}/small-business/owner-id`, { decision: 'reject', reason })} success="Owner's ID rejected" />
            </>
          )}
          {s.addressPhotoWaiting && s.addressProof.result === 'pending' && (
            <>
              <ActionButton label="Address checked" variant="success" title="Address proof checked" description="Type the address as it is on the document. Only that is kept; the image is deleted." reason={{ label: 'Address on the document', required: true }} run={({ reason }) => api.post(`/businesses/${row.id}/small-business/address-proof`, { decision: 'approve', addressMatched: reason })} success="Address proof checked" />
              <ActionButton label="Reject address proof" variant="danger" title="Reject the address proof" reason run={({ reason }) => api.post(`/businesses/${row.id}/small-business/address-proof`, { decision: 'reject', reason })} success="Address proof rejected" />
            </>
          )}
          {!s.videoCall.done && (
            <ActionButton label="Video call done" title="Video call done" description="You saw the workspace on a short video call through Laboura. Write what it showed." reason={{ label: 'What the video call showed', required: true }} run={({ reason }) => api.post(`/businesses/${row.id}/small-business/video-call`, { note: reason })} success="Video call recorded" />
          )}
        </span>
      )}
      {s.missing.length > 0 && <p className="ceo-sub" data-testid="small-business-missing">Before Approve: {s.missing.join(', ')}.</p>}
    </div>
  );
}

function BusinessCard({ row, link }: { row: BusinessRow; link: string | null }) {
  const v = row.verification;
  const failed = v.autoCheck?.failed ?? [];
  const blocked = Boolean(row.smallBusiness && row.smallBusiness.missing.length > 0);
  return (
    <Card title={<>{link ? <Link to={link}>{row.name}</Link> : row.name} <span className="ceo-cell-sub">{row.code}{row.area ? ` · ${row.area}` : ''}</span></>}>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
        <div>
          <p style={{ margin: '0 0 6px' }}>
            {v.household ? <StatusPill tone="info">Household · visit and Team Lead check</StatusPill> : row.smallBusiness ? <StatusPill tone="warn">Small business</StatusPill> : <StatusPill tone="warn">Automatic check did not pass</StatusPill>}{' '}
            {v.runsFromHome && <StatusPill tone="info">Workplace is the owner's home</StatusPill>}{' '}
            {row.candidatesShownMeanwhile && <StatusPill tone="info">Candidates already shown (onboarded in person)</StatusPill>}
          </p>
          {failed.length > 0 && (
            <ul data-testid="failed-reasons" style={{ margin: '0 0 8px', paddingLeft: 18 }}>
              {failed.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
          <Kv
            rows={[
              ['Proofs', v.proofs.map((p) => `${p.label}: ${p.valid ? 'valid' : p.given ? `not valid${p.detail ? ` (${p.detail})` : ''}` : 'not given'}`).join(' · ')],
              ['Shop photo to Maps pin', v.autoCheck?.distanceMeters != null ? `${v.autoCheck.distanceMeters} m${v.mapsPlaceName ? ` · ${v.mapsPlaceName}` : ''}` : '—'],
              ['Waiting since', `${formatDateIST(row.since)}${row.owner ? ` · ${row.owner}` : ''}`],
              ['Visit', row.visit ? `${humanize(row.visit.purpose)} · ${humanize(row.visit.status)}` : 'None'],
            ]}
          />
          {row.smallBusiness && <SmallBusinessChecks row={row} />}
        </div>
        <OwnerPhotos businessId={row.id} businessName={row.name} />
      </div>
      {row.canDecide ? (
        <span className="ceo-actions" style={{ marginTop: 10 }}>
          <ActionButton label="Approve" variant="success" title="Approve the business" description="The business is verified and candidates can be shown." disabled={blocked} run={() => api.post(`/businesses/${row.id}/verification/approve`, {})} success={`${row.name} is verified`} />
          <ActionButton label="Reject" variant="danger" title="Reject the business" reason run={({ reason }) => api.post(`/businesses/${row.id}/verification/reject`, { reason })} success={`${row.name} rejected`} />
          {!row.smallBusiness && !row.visit && (
            <ActionButton label="Ask for a visit" title="Ask a field agent to visit" description="The nearest available field agent is suggested on Visit proof; the business keeps waiting for your check." run={() => api.post(`/businesses/${row.id}/visit-assignments`, { purpose: 'verification' })} success="Visit requested" />
          )}
        </span>
      ) : (
        <p className="ceo-sub">Not assigned to your team: assign it to your team on the business page to decide.</p>
      )}
    </Card>
  );
}

export default function BusinessChecks() {
  const { api: base, link } = useRecordsPortal();
  const query = useQuery({ queryKey: [base, 'business-checks'], queryFn: () => api.get<{ businesses: BusinessRow[]; vacancies: VacancyRow[] }>(`${base}/business-checks`) });
  const d = query.data;
  const money = (v: VacancyRow) => `${v.salaryMinPaise !== null ? formatINR(v.salaryMinPaise) : '—'}${v.salaryMaxPaise && v.salaryMaxPaise !== v.salaryMinPaise ? `–${formatINR(v.salaryMaxPaise).replace('₹', '')}` : ''}${v.salaryPeriod === 'daily' ? ' a day' : ' a month'}`;
  return (
    <div className="lb-page">
      <TopBar back={homeBack(link)} title="Businesses and vacancies to check" subtitle="Everything the automatic check could not confirm — every one, oldest first." />
      <StatGrid>
        <StatTile label="Businesses to check" value={d?.businesses.length ?? '—'} tone="gold" loading={query.isPending} />
        <StatTile label="Small businesses" value={d?.businesses.filter((b) => b.smallBusiness).length ?? '—'} tone="orange" loading={query.isPending} />
        <StatTile label="Vacancies to check" value={d?.vacancies.length ?? '—'} tone="royal" loading={query.isPending} />
      </StatGrid>
      {query.isPending ? (
        <SkeletonCard height={220} />
      ) : query.isError || !d ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {d.businesses.length === 0 && <EmptyState title="No business waits for your check." />}
          {d.businesses.map((row) => <BusinessCard key={row.id} row={row} link={link('C-Business', { id: row.id })} />)}
          <Card title="Vacancies to check" flush>
            {d.vacancies.length === 0 ? (
              <EmptyState title="No vacancy waits for your check." />
            ) : (
              <div className="scrollx">
                <table>
                  <caption className="sr-only">Vacancies to check</caption>
                  <thead>
                    <tr>
                      <th scope="col">Vacancy</th>
                      <th scope="col">Business</th>
                      <th scope="col">Openings · salary</th>
                      <th scope="col">Why</th>
                      <th scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {d.vacancies.map((v) => (
                      <tr key={v.id}>
                        <td>{v.trade}<div className="ceo-cell-sub">{v.code}</div></td>
                        <td>{v.business.name}<div className="ceo-cell-sub">{v.business.code}</div></td>
                        <td>{v.headcount} · {money(v)}{v.usualSalary && <div className="ceo-cell-sub">Usual for the trade: {formatINR(v.usualSalary.minPaise)}–{formatINR(v.usualSalary.maxPaise).replace('₹', '')}</div>}</td>
                        <td>{v.reasons.map((r) => r.detail).join('; ')}</td>
                        <td>
                          <span className="ceo-actions">
                            <ActionButton label="Approve" variant="success" title="Approve the vacancy" description="It goes live and candidates can be shown." run={() => api.post(`/vacancies/${v.id}/tl-check`, { decision: 'approve' })} success="Vacancy approved" />
                            <ActionButton label="Reject" variant="danger" title="Reject the vacancy" reason run={({ reason }) => api.post(`/vacancies/${v.id}/tl-check`, { decision: 'reject', reason })} success="Vacancy rejected" />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
