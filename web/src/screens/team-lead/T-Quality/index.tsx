import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { StatusPill } from '../../../components/Badge';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { TopBar } from '../../../components/TopBar';
import { useToast } from '../../../components/Toast';
import { api } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { formatDateIST, formatTimeIST, istDateKey } from '../../../lib/format/date';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import { ms } from '../../ceo/_kit/format';
import { humanize } from '../../ceo/_kit/kit';
import { firstName, type Brief } from '../_kit/api';

/**
 * Listen to calls — design T-Quality.dc.html. Minimal on purpose: a six-item
 * checklist score per call (POST /team-lead/quality/:callId/score); the
 * recording plays through the existing short-lived link (GET /calls/:id/recording).
 */
interface CallRow {
  id: string;
  code: string;
  agent: Brief | null;
  with: string | null;
  at: string;
  durationSec: number | null;
  result: string | null;
  picked: boolean;
  score: { score: number; checks: boolean[]; note: string | null; flagged: boolean } | null;
}
interface Board {
  checklist: string[];
  summary: { toListen: number; listenedThisMonth: number; teamAverage: number | null; lowest: { staff: Brief; average: number | null } | null };
  picked: CallRow[];
  calls: CallRow[];
}

export default function TeamLeadQuality() {
  const to = useScreenPath();
  const now = useNow();
  const board = useQuery({ queryKey: ['team-lead', 'quality'], queryFn: () => api.get<Board>('/team-lead/quality') });
  const [selected, setSelected] = useState<string | null>(null);
  const b = board.data;
  const list = b ? [...b.picked, ...b.calls.filter((c) => !c.picked)] : undefined;
  // The first picked call opens straight away, as in the design; Close hides the panel ('').
  const currentId = selected ?? b?.picked[0]?.id ?? null;
  const current = list?.find((c) => c.id === currentId) ?? null;
  const when = (iso: string) => (istDateKey(iso) === istDateKey(now) ? `Today ${formatTimeIST(iso)}` : `${formatDateIST(iso)} ${formatTimeIST(iso)}`);
  const columns: Column<CallRow>[] = [
    { key: 'agent', header: 'Agent', cell: (c) => c.agent?.name ?? '—', filter: 'select', filterValue: (c) => c.agent?.name ?? '—' },
    { key: 'with', header: 'Call with', cell: (c) => c.with ?? '—' },
    { key: 'when', header: 'When', cell: (c) => when(c.at), sortValue: (c) => c.at },
    { key: 'length', header: 'Length', cell: (c) => ms(c.durationSec), hideOnPhone: true },
    { key: 'result', header: 'Result', cell: (c) => (c.result ? humanize(c.result) : '—'), hideOnPhone: true },
    {
      key: 'act',
      header: '',
      cell: (c) =>
        c.score ? (
          <Button size="compact" onClick={() => setSelected(c.id)}>
            {c.score.score} / 100
          </Button>
        ) : (
          <Button size="compact" variant={c.picked ? 'primary' : 'secondary'} onClick={() => setSelected(c.id)}>
            Listen and score
          </Button>
        ),
    },
  ];
  return (
    <div className="lb-page">
      <TopBar showSearch={false} back={{ to: to('T-Home'), label: 'My team' }} title="Listen to calls" subtitle="Hear what your agents say, score it against a short checklist, and coach from it." />
      <StatGrid>
        <StatTile label="Calls to listen to" value={b?.summary.toListen ?? '—'} tone="gold" loading={board.isPending} />
        <StatTile label="Listened to this month" value={b?.summary.listenedThisMonth ?? '—'} tone="royal" loading={board.isPending} />
        <StatTile label="Team call quality" value={b?.summary.teamAverage === null || !b ? '—' : `${b.summary.teamAverage} / 100`} tone="good" loading={board.isPending} />
        <StatTile label={b?.summary.lowest ? `${b.summary.lowest.staff.name} · lowest` : 'Lowest'} value={b?.summary.lowest?.average ?? '—'} tone="red" loading={board.isPending} />
      </StatGrid>
      <Card flush>
        <DataTable columns={columns} rows={list} rowKey={(c) => c.id} caption="Recorded calls" loading={board.isPending} error={board.error} onRetry={() => void board.refetch()} emptyTitle="No recorded calls from your team in the last 7 days." />
        <div className="tl-note" style={{ padding: '0 18px 14px' }}>
          The system picks 3 calls a day for you · listen to at least 2 calls per agent each week
        </div>
      </Card>
      {current && b && <ScorePanel key={current.id} call={current} checklist={b.checklist} scroll={Boolean(selected)} onDone={() => setSelected('')} />}
    </div>
  );
}

function ScorePanel({ call, checklist, scroll, onDone }: { call: CallRow; checklist: string[]; scroll: boolean; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [checks, setChecks] = useState<boolean[]>(() => call.score?.checks ?? checklist.map(() => false));
  const [note, setNote] = useState(call.score?.note ?? '');
  const recording = useQuery({ queryKey: ['calls', 'recording', call.id], queryFn: () => api.get<{ url: string }>(`/calls/${call.id}/recording`), staleTime: 240_000, retry: false });
  const score = Math.round((checks.filter(Boolean).length / Math.max(1, checks.length)) * 100);
  useEffect(() => {
    if (scroll) document.getElementById('tl-score-panel')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [scroll]);
  const save = useMutation({
    mutationFn: (flag: boolean) => api.post(`/team-lead/quality/${call.id}/score`, { checks, note: note.trim() || undefined, flag }),
    onSuccess: (_r, flag) => {
      toast.success(flag ? 'Score saved and the call flagged' : `Score saved · ${score} / 100`);
      void qc.invalidateQueries({ queryKey: ['team-lead'] });
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not save the score'),
  });
  const he = firstName(call.agent?.name);
  return (
    <div id="tl-score-panel">
      <Card title={`Score this call · ${call.agent?.name ?? ''} with ${call.with ?? 'the caller'}`} aside={call.score?.flagged ? <StatusPill tone="danger">Flagged</StatusPill> : undefined}>
        {recording.error ? (
          <p className="tl-sub">{recording.error instanceof ApiError ? recording.error.message : 'The recording is not available.'}</p>
        ) : recording.data ? (
          <audio controls src={recording.data.url} style={{ width: '100%' }} aria-label="Call recording" />
        ) : (
          <p className="tl-sub">Loading the recording…</p>
        )}
        <div className="tl-checklist" role="group" aria-label="Checklist">
          {checklist.map((item, i) => (
            <label key={item}>
              <input type="checkbox" checked={checks[i] ?? false} onChange={(e) => setChecks((prev) => prev.map((v, j) => (j === i ? e.target.checked : v)))} />
              {item}
            </label>
          ))}
        </div>
        <label className="field">
          What {he} should do differently
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </label>
        <div className="tl-actions" style={{ marginTop: 12 }}>
          <span className="tl-score">Score: {score} / 100</span>
          <Button variant="primary" onClick={() => save.mutate(false)} loading={save.isPending && save.variables === false}>
            Save score
          </Button>
          <Button variant="danger" onClick={() => save.mutate(true)} disabled={!note.trim()} loading={save.isPending && save.variables === true}>
            Flag this call
          </Button>
          <Button onClick={onDone}>Close</Button>
        </div>
      </Card>
    </div>
  );
}
