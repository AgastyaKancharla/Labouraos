import { useQuery } from '@tanstack/react-query';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { StatusPill } from '../../../components/Badge';
import { api } from '../../../lib/api/client';
import { formatDateTimeIST } from '../../../lib/format/date';
import { FormAction } from '../../finance/_kit/kit';

/** One breach (GET /ceo/privacy/breaches). */
export interface BreachRow {
  id: string;
  code: string;
  discoveredAt: string;
  reportDueAt: string;
  summary: string;
  dataAffected: string;
  peopleAffected: number | null;
  status: 'open' | 'closed';
  steps: { at: string; text: string }[];
  told: { who: string; label: string; at: string; note: string | null }[];
  boardToldAt: string | null;
  overdue: boolean;
  hoursLeft: number | null;
  closedAt: string | null;
}
export interface BreachList {
  summary: { total: number; open: number; overdue: number; boardToldInTime: number; reportHours: number };
  rows: BreachRow[];
}
export const breachesKey = ['ceo', 'privacy', 'breaches'] as const;

export function useBreaches() {
  return useQuery({ queryKey: breachesKey, queryFn: () => api.get<BreachList>('/ceo/privacy/breaches') });
}

const TOLD_OPTIONS = [
  { value: 'data_protection_board', label: 'Data Protection Board' },
  { value: 'affected_people', label: 'The people affected' },
  { value: 'cert_in', label: 'CERT-In' },
  { value: 'police', label: 'Police' },
  { value: 'other', label: 'Someone else' },
];

function deadline(b: BreachRow): { tone: 'good' | 'warn' | 'crit' | 'muted'; text: string } {
  if (b.status === 'closed') return { tone: 'muted', text: 'Closed' };
  if (b.boardToldAt) return { tone: 'good', text: `Board told ${formatDateTimeIST(b.boardToldAt)}` };
  if (b.overdue) return { tone: 'crit', text: `Over 72 hours · Board not told` };
  return { tone: 'warn', text: `${b.hoursLeft ?? 0} h left to tell the Board` };
}

/**
 * The 72-hour data-breach register (guide: a data breach must be reported
 * within 72 hours). Log a breach, record the steps taken and who was told,
 * close it once the Data Protection Board has been told. CEO only.
 */
export function BreachesCard() {
  const q = useBreaches();
  const d = q.data;
  return (
    <Card
      title={`Data breaches · report within ${d?.summary.reportHours ?? 72} hours`}
      aside={
        <FormAction
          label="Log a breach"
          variant="danger"
          size="compact"
          title="Log a data breach"
          description="The 72 hours to tell the Data Protection Board start when it was found. Write no names or phone numbers here."
          confirmLabel="Log the breach"
          fields={[
            { name: 'summary', kind: 'text', label: 'What happened', required: true },
            { name: 'dataAffected', kind: 'text', label: 'What data (for example names and masked phones)', required: true },
            { name: 'peopleAffected', kind: 'text', label: 'How many people (if known)', inputMode: 'numeric' },
            { name: 'discoveredAt', kind: 'date', label: 'Found on (empty = now)', hint: 'A past day counts from the start of that day, to be safe.' },
          ]}
          run={(v) =>
            api.post('/ceo/privacy/breaches', {
              summary: v.summary,
              dataAffected: v.dataAffected,
              peopleAffected: v.peopleAffected ? Number(v.peopleAffected) : undefined,
              discoveredAt: v.discoveredAt || undefined,
            })
          }
          success="Breach logged · the 72-hour clock is running"
        />
      }
    >
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : d && !d.rows.length ? (
        <p className="ceo-sub">No data breaches. If one happens, log it here at once: the Data Protection Board must be told within 72 hours.</p>
      ) : (
        <div className="lb-stack">
          {d?.rows.map((b) => {
            const dl = deadline(b);
            return (
              <article key={b.id} className="panel" style={{ padding: '14px 16px' }} aria-label={`Breach ${b.code}`}>
                <div className="lb-row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <strong>
                    <span className="code">{b.code}</span> · {b.summary}
                  </strong>
                  <StatusPill tone={dl.tone}>{dl.text}</StatusPill>
                </div>
                <div className="kv" style={{ marginTop: 8 }}>
                  <span>Found</span>
                  <span>{formatDateTimeIST(b.discoveredAt)}</span>
                  <span>Tell the Board by</span>
                  <span>{formatDateTimeIST(b.reportDueAt)}</span>
                  <span>Data</span>
                  <span>
                    {b.dataAffected}
                    {b.peopleAffected !== null ? ` · ${b.peopleAffected} people` : ''}
                  </span>
                  <span>Who was told</span>
                  <span>{b.told.length ? b.told.map((t) => `${t.label} (${formatDateTimeIST(t.at)})`).join(' · ') : 'Nobody yet'}</span>
                </div>
                <h3 className="h2" style={{ marginTop: 10, fontSize: 14 }}>
                  Steps
                </h3>
                <ol style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>
                  {b.steps.map((s, i) => (
                    <li key={`${s.at}-${i}`}>
                      {formatDateTimeIST(s.at)} · {s.text}
                    </li>
                  ))}
                </ol>
                {b.status === 'open' && (
                  <div className="tl-actions" style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <FormAction
                      label="Add a step"
                      size="compact"
                      title={`Add a step · ${b.code}`}
                      confirmLabel="Save the step"
                      fields={[{ name: 'text', kind: 'text', label: 'What was done', required: true }]}
                      run={(v) => api.post(`/ceo/privacy/breaches/${b.id}/steps`, { text: v.text })}
                      success="Step saved"
                    />
                    <FormAction
                      label="Record who was told"
                      size="compact"
                      title={`Who was told · ${b.code}`}
                      confirmLabel="Save"
                      fields={[
                        { name: 'who', kind: 'select', label: 'Told', options: TOLD_OPTIONS },
                        { name: 'note', kind: 'text', label: 'How (form, email, SMS…)' },
                      ]}
                      run={(v) => api.post(`/ceo/privacy/breaches/${b.id}/told`, { who: v.who, note: v.note || undefined })}
                      success="Saved"
                    />
                    <FormAction
                      label="Close"
                      size="compact"
                      title={`Close ${b.code}`}
                      description="Only once the Data Protection Board has been told."
                      confirmLabel="Close the breach"
                      disabled={!b.boardToldAt}
                      fields={[{ name: 'note', kind: 'text', label: 'What closed it', required: true }]}
                      run={(v) => api.post(`/ceo/privacy/breaches/${b.id}/close`, { note: v.note })}
                      success="Breach closed"
                    />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </Card>
  );
}
