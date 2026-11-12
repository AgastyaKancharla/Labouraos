import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill } from '../../../components/Badge';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateTimeIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { ActionButton } from '../_kit/actions';
import { humanize } from '../_kit/kit';

/** System health — design C-System.dc.html. CEO only. */
interface Status {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptimeFormatted: string;
  environment: string;
  version: string;
  idCheck: { status: 'up' | 'down'; lastChangedAt: string | null };
  components: { name: string; status: 'healthy' | 'degraded' | 'unhealthy'; latencyMs?: number; message?: string }[];
}
interface SystemExtras {
  messages: { sent: number; delivered: number; failed: number; byChannel: { channel: string; sent: number; delivered: number; failed: number }[]; byTemplate: { template: string; sent: number }[] };
  otps: { sent: number; verified: number };
  jobs: { key: string; label: string; runsAt: string; lastRunAt: string | null; result: string | null; runPath: string | null }[];
  intervals: { key: string; label: string; every: string; runPath?: string }[];
}
interface Schedules {
  allPresent: boolean;
  jobs: { key: string; label: string; present: boolean }[];
}
const TONE = { healthy: 'good', degraded: 'warn', unhealthy: 'danger' } as const;
const WORD = { healthy: 'Running', degraded: 'Slow', unhealthy: 'Down' } as const;

export default function SystemScreen() {
  const to = useScreenPath();
  const status = useQuery({ queryKey: ['system', 'status'], queryFn: () => api.get<Status>('/system/status/details'), refetchInterval: 60_000 });
  const extras = useQuery({ queryKey: ['ceo', 'system'], queryFn: () => api.get<SystemExtras>('/ceo/system'), refetchInterval: 60_000 });
  // A free Render Key Value forgets the job schedules when it restarts; the
  // server puts them back within 10 minutes, and the CEO can do it at once here.
  const schedules = useQuery({ queryKey: ['jobs', 'schedules'], queryFn: () => api.get<Schedules>('/jobs/schedules'), refetchInterval: 60_000 });
  const missingSchedules = (schedules.data?.jobs ?? []).filter((j) => !j.present);
  const st = status.data;
  const x = extras.data;
  const comps = st?.components ?? [];
  const runnable = (x?.jobs ?? []).filter((j) => j.runPath);
  const pct = (a: number, b: number) => (b ? `${Math.round((a * 1000) / b) / 10}%` : '—');
  return (
    <div className="lb-page">
      <TopBar
        back={{ to: to('Main'), label: 'Command Center' }}
        title="System health"
        subtitle="Every outside service Laboura depends on, message and OTP delivery, and the nightly jobs."
        actions={
          <ActionButton
            label="Run nightly jobs now"
            variant="primary"
            title="Run every nightly job now"
            description={`Runs ${runnable.length} jobs one after another: ${runnable.map((j) => j.label).join(', ')}. Each is safe to repeat.`}
            disabled={!runnable.length}
            run={async () => {
              for (const j of runnable) await api.post(j.runPath as string);
            }}
            success="Nightly jobs ran"
          />
        }
      />
      <StatGrid>
        <StatTile label="Services connected" value={st ? `${comps.filter((c) => c.status !== 'unhealthy').length} of ${comps.length}` : '—'} tone="good" loading={status.isPending} />
        <StatTile label="Running slow" value={st ? comps.filter((c) => c.status === 'degraded').length : '—'} tone="gold" loading={status.isPending} />
        <StatTile label="OTPs sent today" value={x?.otps.sent ?? '—'} tone="royal" loading={extras.isPending} />
        <StatTile label="Messages delivered" value={x ? pct(x.messages.delivered, x.messages.sent) : '—'} tone="cyan" loading={extras.isPending} />
        <StatTile label="Mode" value={st ? humanize(st.environment) : '—'} tone="navy" detail={st ? `Up ${st.uptimeFormatted} · v${st.version}` : undefined} loading={status.isPending} />
      </StatGrid>
      {missingSchedules.length > 0 && (
        <Card title="Job schedules missing">
          <div className="ceo-note">
            {missingSchedules.length} job schedule(s) are not in the job queue, usually because it restarted: {missingSchedules.map((j) => j.label).join(', ')}.
            They come back within 10 minutes by themselves. Use Run now below for any job that should have run meanwhile.
          </div>
          <ActionButton
            label="Put schedules back now"
            variant="primary"
            title="Register every job schedule again"
            run={async () => {
              await api.post('/jobs/schedules/repair');
              await schedules.refetch();
            }}
            success="Job schedules registered again"
          />
        </Card>
      )}
      {status.error ? (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      ) : (
        <Card title="Services">
          <div className="scrollx">
            <table>
              <thead><tr><th>Service</th><th>Status</th><th>Detail</th><th>Problems</th></tr></thead>
              <tbody>
                {comps.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td><StatusPill tone={TONE[c.status]}>{WORD[c.status]}</StatusPill></td>
                    <td>{c.latencyMs !== undefined ? `${c.latencyMs} ms` : '—'}</td>
                    <td>{c.status === 'healthy' ? '—' : (c.message ?? '—')}</td>
                  </tr>
                ))}
                {st && (
                  <tr>
                    <td>ID checks (Aadhaar vendor)</td>
                    <td><StatusPill tone={st.idCheck.status === 'up' ? 'good' : 'danger'}>{st.idCheck.status === 'up' ? 'Running' : 'Down'}</StatusPill></td>
                    <td>{st.idCheck.status === 'down' ? 'PAN fallback offered' : '—'}</td>
                    <td>{st.idCheck.lastChangedAt ? `Since ${formatDateTimeIST(st.idCheck.lastChangedAt)}` : '—'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <div className="two-col">
        <Card title="Nightly jobs">
          {extras.error ? (
            <ErrorState error={extras.error} onRetry={() => void extras.refetch()} compact />
          ) : (
            <div className="scrollx">
              <table>
                <thead><tr><th>Job</th><th>Runs at</th><th>Last run</th><th>Result</th><th /></tr></thead>
                <tbody>
                  {x?.jobs.map((j) => (
                    <tr key={j.key}>
                      <td>{j.label}</td>
                      <td>{j.runsAt}</td>
                      <td>{j.lastRunAt ? formatDateTimeIST(j.lastRunAt) : <span className="ceo-sub">Not recorded</span>}</td>
                      <td>{j.result ? humanize(j.result) : '—'}</td>
                      <td>{j.runPath && <ActionButton label="Run now" title={`Run "${j.label}" now`} run={() => api.post(j.runPath as string)} success={`${j.label} ran`} />}</td>
                    </tr>
                  ))}
                  {x?.intervals.map((j) => (
                    <tr key={j.key}>
                      <td>{j.label}</td>
                      <td>{j.every}</td>
                      <td colSpan={2}><span className="ceo-sub">Running</span></td>
                      <td>{j.runPath && <ActionButton label="Run now" title={`Run "${j.label}" now`} run={() => api.post(j.runPath as string)} success={`${j.label} ran`} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Messages today">
          <div className="kv">
            <span>OTPs (staff, job seekers, businesses)</span>
            <span>{x ? `${x.otps.sent} sent · ${x.otps.verified} verified` : '—'}</span>
            {x?.messages.byChannel.map((c) => (
              <Pair key={c.channel} k={c.channel === 'sms' ? 'SMS' : 'WhatsApp'} v={`${c.sent} sent · ${c.delivered} delivered${c.failed ? ` · ${c.failed} failed` : ''}`} />
            ))}
            {x?.messages.byTemplate.map((t) => <Pair key={t.template} k={humanize(t.template)} v={`${t.sent} sent`} />)}
            <span>Failed</span>
            <span>{x ? x.messages.failed : '—'}</span>
          </div>
        </Card>
      </div>
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
