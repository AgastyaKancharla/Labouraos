import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateTimeIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { PricingTabs } from '../_kit/tabs';

/** Keeping data — design C-Pricing-Data.dc.html. The nightly clean-up India's data law requires. CEO only. */
export interface RetentionSummary {
  executedAt: string;
  dryRun: boolean;
  profilesAnonymised: { jobSeekers: number; businesses: number; referrals: number; total: number; refused: number };
  recordingsDeleted: number;
  recordingsProtected: number;
  accessLogsDeleted: { sessions: number; loginCodeRequests: number; total: number };
  moneyRecordsDeleted: { total: number };
  publicLinksDeleted: number;
  otpSessionsDeleted: number;
}

export default function KeepingData() {
  const to = useScreenPath();
  const last = useQuery({ queryKey: ['retention', 'summary'], queryFn: () => api.get<RetentionSummary | null>('/retention/summary') });
  const [dry, setDry] = useState<RetentionSummary | null>(null);
  const s = last.data;
  return (
    <div className="lb-page">
      <TopBar back={{ to: to('C-Pricing'), label: 'Pricing & policy' }} title="Keeping data" subtitle="The nightly clean-up India's data law requires. CEO only." />
      <PricingTabs />
      <StatGrid>
        <StatTile label="Profiles anonymised last run" value={s ? s.profilesAnonymised.total : last.isPending ? '—' : 0} tone="royal" loading={last.isPending} detail={s ? formatDateTimeIST(s.executedAt) : 'No run recorded yet'} />
        <StatTile label="Recordings deleted" value={s?.recordingsDeleted ?? (last.isPending ? '—' : 0)} tone="cyan" loading={last.isPending} />
        <StatTile label="Login logs deleted" value={s?.accessLogsDeleted.total ?? (last.isPending ? '—' : 0)} tone="navy" loading={last.isPending} />
        <StatTile label="Skipped · open claim or dispute" value={s ? s.profilesAnonymised.refused + s.recordingsProtected : last.isPending ? '—' : 0} tone="orange" loading={last.isPending} />
      </StatGrid>
      <div className="two-col">
        <Card title="Rules">
          <div className="kv">
            <span>Inactive profiles</span>
            <span>Anonymised after 23 months</span>
            <span>Call recordings and logs</span>
            <span>Deleted after 12 months unless disputed</span>
            <span>Payment records</span>
            <span>Kept 8 years</span>
            <span>Runs</span>
            <span>Every night · 2 AM</span>
          </div>
          <div style={{ marginTop: 14 }}>
            <ActionButton
              label="Dry run — show what would happen"
              title="Dry run of the clean-up"
              description="Counts what tonight's clean-up would anonymise and delete. Nothing is changed."
              run={async () => {
                const res = await api.post<RetentionSummary>('/retention/dry-run');
                setDry(res);
                return res;
              }}
              success="Dry run finished — nothing was changed"
            />
          </div>
        </Card>
        <Card title={dry ? 'Dry run — what would happen now' : 'Last run'}>
          {(dry ?? s) ? (
            <div className="kv">
              <span>Profiles anonymised</span>
              <span>{(dry ?? s)!.profilesAnonymised.total} ({(dry ?? s)!.profilesAnonymised.jobSeekers} job seekers, {(dry ?? s)!.profilesAnonymised.businesses} businesses, {(dry ?? s)!.profilesAnonymised.referrals} partners)</span>
              <span>Skipped (open claim)</span>
              <span>{(dry ?? s)!.profilesAnonymised.refused}</span>
              <span>Recordings deleted</span>
              <span>{(dry ?? s)!.recordingsDeleted} · {(dry ?? s)!.recordingsProtected} kept (disputed)</span>
              <span>Login logs deleted</span>
              <span>{(dry ?? s)!.accessLogsDeleted.total}</span>
              <span>Payment records deleted (over 8 years)</span>
              <span>{(dry ?? s)!.moneyRecordsDeleted.total}</span>
              <span>Old links and OTPs deleted</span>
              <span>{(dry ?? s)!.publicLinksDeleted + (dry ?? s)!.otpSessionsDeleted}</span>
            </div>
          ) : (
            <p className="ceo-sub">The clean-up has not run yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
