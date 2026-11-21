import { useQuery } from '@tanstack/react-query';
import { AppSignupBadgeFor } from '../../shared/AppSignupBadge';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST } from '../../../lib/format/date';
import { formatINR } from '../../../lib/format/money';
import { formatMobile } from '../../../lib/format/phone';
import type { ReactNode } from 'react';
import { useRecordsPortal } from '../_kit/records';
import { AssignmentLine, type Assignment } from '../_kit/assign';
import { StuckBox } from '../../shared/StuckBox';
import { ProfileHero, VisitPhotos } from '../_kit/photos';
import { ActionButton } from '../_kit/actions';
import { Kv, Timeline, dateOrDash, humanize } from '../_kit/kit';
import { BUSINESS_STATUS, VACANCY_STATUS } from '../_kit/labels';
import { BypassChargesCard } from './BypassCharges';
import { useAuth } from '../../../auth/AuthProvider';
import { BanButton, LegalAcceptanceCard, SuspendButtons, SuspensionBanner } from '../_kit/legal';

/** CEO business page — design C-Business.dc.html. */
interface Detail {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  phone: string;
  gstNumber: string | null;
  gstVerified: boolean | null;
  type: string | null;
  employeeCount: number | null;
  employeeCountBand: string | null;
  address: string | null;
  hasPin: boolean;
  /** Rev 193: legal minimum wage zone (1 Greater Bengaluru, 2 other corporations / district HQs, 3 rest of Karnataka). */
  minimumWageZone?: 1 | 2 | 3;
  /** "auto" = from the address; "staff" = set by office staff. */
  minimumWageZoneSource?: 'auto' | 'staff';
  contact: { name: string | null; role: string | null; phone: string; verified: boolean };
  branches: { id: string; name: string; locality: string | null; contact: string }[];
  accountAgent: { id: string; name: string | null; since: string | null } | null;
  heardFrom: string | null;
  leadChannel: string | null;
  status: string;
  pauseReason: string | null;
  /** D6 (rev 176): CEO suspension. */
  suspension?: { since: string | null; until: string | null; permanent: boolean; reason: string | null } | null;
  noDocuments: boolean;
  createdAt: string;
  /** Money fields (fees, fee terms) are the CEO's only: a Manager's answer leaves them out. */
  tiles: { openVacancies: number; openPositions: number; candidatesShown: number; noBypassMonths: number; interviews: number; placements: number; feesPaidPaise?: number; replacementsUsed: number };
  agreement: { signedAt: string; signedName: string; signedRole: string | null; version: string; feePercent?: number; gstPercent?: number; noBypassMonths: number; noBypassPenaltyPercent?: number } | null;
  callRecordingConsent: boolean | null;
  vacancies: { id: string; code: string; role: string; headcount: number; salaryMinPaise: number | null; salaryMaxPaise: number | null; belowLegalMinimum: boolean; confirmed: boolean; confirmationMethod: string | null; openDays: number; status: string; interviews: number }[];
  introductions: { at: string; jobSeeker: { id: string; code: string; name: string }; shownBy: string; channel: string; outcome: string }[];
  visits: { id?: string; at: string; by: string | null; purpose: string | null; geofenceFlag: boolean; hasSelfie: boolean; hasBoardPhoto?: boolean; photoLive: boolean | null }[];
  /** Team Lead and Manager only: the record's section and who holds it (rev 194). */
  assignment?: Assignment;
  history: { at: string; status: string; by: string | null; reason: string | null }[];
}

const ZONE_NAMES: Record<string, string> = {
  '1': 'Zone 1 · Greater Bengaluru',
  '2': 'Zone 2 · other city corporation or district HQ',
  '3': 'Zone 3 · rest of Karnataka',
};

function money(min: number | null, max: number | null) {
  if (min === null && max === null) return '—';
  if (min !== null && max !== null) return `${formatINR(min)}–${formatINR(max).replace('₹', '')}`;
  return formatINR((min ?? max) as number);
}

function outcomeLabel(o: string): { label: string; tone: 'good' | 'info' | 'muted' | 'warn' | 'danger' } {
  if (o.startsWith('placed_')) return { label: 'Selected · placed', tone: 'good' };
  if (o === 'selected') return { label: 'Selected', tone: 'good' };
  if (o === 'not_selected') return { label: 'Not selected', tone: 'muted' };
  if (o === 'no_show') return { label: "Didn't turn up", tone: 'warn' };
  if (o === 'shown') return { label: 'Shown', tone: 'muted' };
  return { label: `Interview · ${humanize(o).toLowerCase()}`, tone: 'info' };
}

export default function BusinessDetail() {
  const { id = '' } = useParams();
  const { api: base, ceo, teamLead, to } = useRecordsPortal();
  const toast = useToast();
  const query = useQuery({ queryKey: [base, 'business', id], queryFn: () => api.get<Detail>(`${base}/businesses/${id}`) });
  const agents = useQuery({
    queryKey: ['staff', 'field-agents'],
    // The Team Lead moves a business with Assign (his own team only) instead.
    enabled: !teamLead,
    queryFn: async () => {
      const res = await api.get<{ id: string; name: string; role: string; status?: string }[] | { rows: { id: string; name: string; role: string; status?: string }[] }>('/staff', { query: { role: 'field_agent' } });
      const list = Array.isArray(res) ? res : res.rows;
      return list.filter((s) => s.role === 'field_agent' && (s.status ?? 'active') === 'active');
    },
  });
  const d = query.data;
  const role = useAuth().session?.staff.role;
  const back = { to: to('C-Businesses'), label: 'Businesses' };
  if (query.isPending)
    return (
      <div className="lb-page">
        <TopBar back={back} title="Business" />
        <SkeletonCard height={120} />
        <SkeletonCard height={260} />
      </div>
    );
  if (query.isError || !d)
    return (
      <div className="lb-page">
        <TopBar back={back} title="Business" />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );

  const statusLabel = BUSINESS_STATUS[d.status]?.label ?? humanize(d.status);
  const openAgreement = async () => {
    try {
      const html = await api.get<string>(`/businesses/${d.id}/agreement`);
      const w = window.open('', '_blank');
      if (!w) {
        toast.error('Allow pop-ups for this site to open the agreement.');
        return;
      }
      w.document.write(typeof html === 'string' ? html : JSON.stringify(html));
      w.document.close();
      w.focus();
      w.print();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open the agreement');
    }
  };

  return (
    <div className="lb-page">
      <TopBar
        back={back}
        title={`${d.name} · ${d.code}`}
        titleBadge={<AppSignupBadgeFor type="business" id={d.id} />}
        subtitle={
          ceo
            ? `${statusLabel}${d.accountAgent?.name ? ` · ${d.accountAgent.name}'s account` : ''} · ${d.tiles.placements} placements and ${formatINR(d.tiles.feesPaidPaise ?? 0)} paid since ${formatDateIST(d.createdAt)}.`
            : `${statusLabel}${d.accountAgent?.name ? ` · ${d.accountAgent.name}'s account` : ''} · ${d.tiles.placements} placements since ${formatDateIST(d.createdAt)}.`
        }
        actions={
          <div className="ceo-actions">
            <AssignmentLine assignment={d.assignment} kind="business" id={d.id} name={d.name} />
            {!teamLead && <ActionButton
              label="Move to another agent"
              title="Move to another account agent"
              description="Their open vacancies and follow-ups move with the business. The move is recorded in the history."
              choice={{ label: 'New account agent', options: (agents.data ?? []).filter((a) => a.id !== d.accountAgent?.id).map((a) => ({ value: a.id, label: a.name })) }}
              run={({ choice }) => api.post(`/businesses/${d.id}/account-agent`, { accountAgentId: choice })}
              success="Account agent changed"
            />}
            {teamLead ? null : d.status === 'paused' ? (
              <ActionButton label="Unpause business" title="Unpause the business" reason run={({ reason }) => api.post(`/businesses/${d.id}/unpause`, { reason })} success="Business unpaused" />
            ) : (
              <ActionButton
                label="Pause business"
                variant="danger"
                title="Pause the business"
                description="No matching and no new interviews until it is unpaused."
                reason
                run={({ reason }) => api.post(`/businesses/${d.id}/pause`, { reason })}
                success="Business paused"
              />
            )}
            {role === 'ceo' && <SuspendButtons businessId={d.id} suspended={Boolean(d.suspension)} />}
            {(role === 'ceo' || role === 'manager') && <BanButton subjectType="business" subjectId={d.id} name={d.name} />}
            <ActionButton
              label="Call contact"
              variant="primary"
              title={`Call ${d.contact.name ?? d.name}`}
              description="Your phone rings first, then the contact person. The call is recorded."
              confirmLabel="Call now"
              run={() => api.post('/calls', { subjectType: 'business', subjectId: d.id, purpose: 'general' })}
              success="Calling through the calling system"
            />
          </div>
        }
      />
      {/* Photo at the top of the profile, the name and the ID under it (rev 198). */}
      <ProfileHero kind="business" id={d.id} name={d.name} code={d.code} visits={d.visits} />
      {/* 21 Nov (rev 204): owner, step and the matching button, in every portal's scope. */}
      <StuckBox kind="business" id={d.id} />
      <SuspensionBanner suspension={d.suspension} />
      <StatGrid>
        <StatTile label={`Open vacancies · ${d.tiles.openPositions} positions`} value={d.tiles.openVacancies} tone="gold" />
        <StatTile label={`Candidates shown (${d.tiles.noBypassMonths}-month no-bypass)`} value={d.tiles.candidatesShown} tone="cyan" />
        <StatTile label="Interviews" value={d.tiles.interviews} tone="royal" />
        <StatTile label="Placements" value={d.tiles.placements} tone="navy" />
        {ceo && <StatTile label="Fees paid + GST" value={formatINR(d.tiles.feesPaidPaise ?? 0)} tone="good" />}
        <StatTile label="Replacements used" value={d.tiles.replacementsUsed} tone="orange" />
      </StatGrid>
      <div className="two-col">
        <Card title="Business">
          <Kv
            rows={[
              ['Legal name', `${d.legalName ?? d.name}${d.gstNumber ? ` · GSTIN ${d.gstNumber}${d.gstVerified ? ' (checked)' : ''}` : d.noDocuments ? ' · No documents' : ''}`],
              ['Type', [humanize(d.type), d.employeeCount ? `${d.employeeCount} staff` : d.employeeCountBand].filter((x) => x && x !== '—').join(' · ') || '—'],
              ['Address', `${d.address ?? '—'}${d.hasPin ? ' · map pin set' : ' · no map pin'}`],
              [
                'Minimum wage zone',
                d.minimumWageZone ? (
                  <span className="ceo-actions">
                    <span data-testid="minimum-wage-zone">{`${ZONE_NAMES[String(d.minimumWageZone)]}${d.minimumWageZoneSource === 'staff' ? ' (set by staff)' : ' (from the address)'}`}</span>
                    <ActionButton
                      label="Change zone"
                      title="Change the minimum wage zone"
                      description="Vacancies of this business are checked against this zone's legal minimum wage. The change is recorded in the history."
                      choice={{ label: 'Zone', options: Object.entries(ZONE_NAMES).map(([value, label]) => ({ value, label })), initial: String(d.minimumWageZone) }}
                      reason
                      run={({ choice, reason }) => api.patch(`/businesses/${d.id}/minimum-wage-zone`, { zone: Number(choice), reason })}
                      success="Minimum wage zone changed"
                    />
                  </span>
                ) : (
                  '—'
                ),
              ],
              ['Contact', `${d.contact.name ?? '—'}${d.contact.role ? ` · ${humanize(d.contact.role).toLowerCase()}` : ''} · ${d.contact.phone.includes('*') ? d.contact.phone : formatMobile(d.contact.phone.replace(/^\+91/, ''))}${d.contact.verified ? ' (OTP verified)' : ''}`],
              ['Branches', d.branches.length ? `${d.branches.length} · ${d.branches.map((b) => `${b.locality ?? b.name} (contact: ${b.contact})`).join(', ')}` : 'None'],
              ['Account agent', d.accountAgent ? `${d.accountAgent.name ?? '—'}${d.accountAgent.since ? ` · since ${formatDateIST(d.accountAgent.since)}` : ''}` : 'Not assigned'],
              ['How they heard', humanize(d.heardFrom ?? d.leadChannel)],
              ...(d.status === 'paused' ? ([['Paused', d.pauseReason ?? '—']] as [string, string][]) : []),
            ]}
          />
        </Card>
        <LegalAcceptanceCard subjectType="business" subjectId={d.id} />
        <Card title="Agreement">
          {d.agreement ? (
            <Kv
              rows={[
                ['Signed', <StatusPill tone="good">{`${formatDateIST(d.agreement.signedAt)} · by ${d.agreement.signedName}, OTP`}</StatusPill>],
                [
                  'Version',
                  ceo
                    ? `${d.agreement.version} · fee ${d.agreement.feePercent}% + GST · no-bypass ${d.agreement.noBypassMonths} months + ${d.agreement.noBypassPenaltyPercent}%`
                    : `${d.agreement.version} · no-bypass ${d.agreement.noBypassMonths} months`,
                ],
                ['Call-recording consent', d.callRecordingConsent ? <StatusPill tone="good">Given</StatusPill> : <StatusPill tone="warn">Not recorded</StatusPill>],
                ['Employer clause', 'Pays at least legal minimum wage, PF/ESI'],
                // The signed copy carries the fee terms: the CEO only.
                ...(ceo
                  ? ([
                      [
                        'Copy',
                        <Button size="compact" onClick={() => void openAgreement()}>
                          Download PDF
                        </Button>,
                      ],
                    ] as [string, ReactNode][])
                  : []),
              ]}
            />
          ) : (
            <p className="ceo-sub">Not signed yet — no candidate is shown until the contact person signs by OTP.</p>
          )}
        </Card>
      </div>
      <Card title="Vacancies" flush>
        <div className="scrollx">
          <table>
            <caption className="sr-only">Vacancies</caption>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Role</th>
                <th scope="col">Positions</th>
                <th scope="col">Salary</th>
                <th scope="col">Confirmed</th>
                <th scope="col">Open for</th>
                <th scope="col">Status</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {d.vacancies.map((v) => (
                <tr key={v.id}>
                  <td className="code">{v.code}</td>
                  <td>{v.role}</td>
                  <td>{v.headcount}</td>
                  <td>
                    {money(v.salaryMinPaise, v.salaryMaxPaise)} {v.belowLegalMinimum && <StatusPill tone="warn">below legal min</StatusPill>}
                  </td>
                  <td>{v.confirmed ? <StatusPill tone="good">{v.confirmationMethod ? humanize(v.confirmationMethod) : 'Owner OTP'}</StatusPill> : <StatusPill tone="warn">Waiting</StatusPill>}</td>
                  <td>{v.openDays === 1 ? '1 day' : `${v.openDays} days`}</td>
                  <td>
                    <StatusPill tone={VACANCY_STATUS[v.status]?.tone ?? 'muted'}>{VACANCY_STATUS[v.status]?.label ?? humanize(v.status)}</StatusPill>
                  </td>
                  <td>
                    <Link to={to('C-Vacancy', { id: v.id })}>Open →</Link>
                  </td>
                </tr>
              ))}
              {d.vacancies.length === 0 && (
                <tr>
                  <td colSpan={8} className="ceo-sub">
                    No vacancies yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="two-col">
        <Card title="Introductions and results" flush>
          <div className="scrollx">
            <table>
              <caption className="sr-only">Introductions and results</caption>
              <thead>
                <tr>
                  <th scope="col">Shown</th>
                  <th scope="col">Candidate</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {d.introductions.map((i, n) => {
                  const o = outcomeLabel(i.outcome);
                  return (
                    <tr key={n}>
                      <td>{formatDateIST(i.at)}</td>
                      <td>
                        <Link to={to('C-JobSeeker', { id: i.jobSeeker.id })}>
                          {i.jobSeeker.name} · {i.jobSeeker.code}
                        </Link>
                      </td>
                      <td>
                        <StatusPill tone={o.tone}>{o.label}</StatusPill>
                      </td>
                    </tr>
                  );
                })}
                {d.introductions.length === 0 && (
                  <tr>
                    <td colSpan={3} className="ceo-sub">
                      No candidates shown yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Visits (proof)">
          <div className="grid4">
            {/* The shop's name board and the agent's selfie for the latest visits (private links, tap to enlarge). */}
            {d.visits.slice(0, 4).map((v, i) => (
              <VisitPhotos key={v.id ?? i} businessId={d.id} businessName={d.name} visit={v} />
            ))}
          </div>
          <Kv rows={d.visits.map((v) => [dateOrDash(v.at), `${v.by ?? '—'} · ${humanize(v.purpose)}${v.geofenceFlag ? ' · GPS outside the pin' : ' · GPS at the pin'}${v.photoLive === false ? ' · photo not live' : ''}`] as [string, string])} />
          {d.visits.length === 0 && <p className="ceo-sub">No visits recorded.</p>}
        </Card>
      </div>
      {ceo && <BypassChargesCard businessId={d.id} />}
      {d.history.length > 0 && (
        <Card title="History">
          <Timeline events={d.history.map((h) => ({ at: h.at, text: `${BUSINESS_STATUS[h.status]?.label ?? humanize(h.status)}${h.by ? ` · ${h.by}` : ''}`, aside: h.reason ? humanize(h.reason) : null }))} />
        </Card>
      )}
    </div>
  );
}
