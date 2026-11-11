import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/Button';
import type { Column } from '../../../components/DataTable';
import { StatGrid, StatTile } from '../../../components/StatTile';
import { StatusPill, type StatusTone } from '../../../components/Badge';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { api } from '../../../lib/api/client';
import { formatDateIST, formatDateTimeIST } from '../../../lib/format/date';
import { useScreenPath } from '../../../portals/PortalContext';
import { DateFilter, FilterPanel, PagedTable, SearchField, SelectFilter, htmlTable, printDocument, rangeQuery, useCeoList, useDebounced, type ListPeriod } from '../_kit/kit';
import { BusinessTabs } from '../_kit/tabs';

/** Introductions register — design C-Introductions.dc.html. Proof against bypass; never edited. */
interface Row {
  id: string;
  at: string;
  business: { id: string; code: string; name: string };
  jobSeeker: { id: string; code: string; name: string };
  trade: string;
  channel: string;
  shownBy: string;
  noBypassUntil: string;
  outcome: string;
}
interface Summary {
  shown: number;
  selected: number;
  notSelected: number;
  bypassSuspected: number;
  noBypassMonths: number;
}

const OUTCOME: Record<string, { label: string; tone: StatusTone }> = {
  shown: { label: 'Shown', tone: 'muted' },
  interview_booked: { label: 'Interview booked', tone: 'info' },
  selected: { label: 'Selected', tone: 'good' },
  not_selected: { label: 'Not selected', tone: 'muted' },
  no_show: { label: "Didn't turn up", tone: 'warn' },
  bypass_suspected: { label: 'Bypass suspected', tone: 'danger' },
};

function how(r: Row) {
  return `${r.channel === 'in_person' ? 'Shown in person' : 'Profiles sent by link'} · ${r.shownBy}`;
}

export default function Introductions() {
  const to = useScreenPath();
  const navigate = useNavigate();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [outcome, setOutcome] = useState('');
  const [period, setPeriod] = useState<ListPeriod>(null);
  const [printing, setPrinting] = useState(false);
  const q = useDebounced(search);
  const filters = { search: q, outcome, ...rangeQuery(period) };
  const list = useCeoList<Row, object, Summary>('/ceo/introductions', filters);
  const s = list.query.data?.summary;

  const columns: Column<Row>[] = [
    { key: 'at', header: 'When', cell: (r) => formatDateTimeIST(r.at), csv: (r) => r.at },
    { key: 'business', header: 'Business', cell: (r) => r.business.name, csv: (r) => `${r.business.code} ${r.business.name}` },
    { key: 'candidate', header: 'Candidate', cell: (r) => `${r.jobSeeker.name} · ${r.jobSeeker.code}`, csv: (r) => `${r.jobSeeker.code} ${r.jobSeeker.name}` },
    { key: 'how', header: 'How', cell: how, csv: how, hideOnPhone: true },
    { key: 'until', header: 'No-bypass until', cell: (r) => formatDateIST(r.noBypassUntil), csv: (r) => r.noBypassUntil },
    { key: 'outcome', header: 'Outcome', cell: (r) => <StatusPill tone={OUTCOME[r.outcome]?.tone ?? 'muted'}>{OUTCOME[r.outcome]?.label ?? r.outcome}</StatusPill>, csv: (r) => OUTCOME[r.outcome]?.label },
  ];

  const evidencePack = async () => {
    setPrinting(true);
    try {
      const all = await api.get<{ rows: Row[] }>('/ceo/introductions', { query: { ...filters, page: 1, pageSize: 5000 } });
      const ok = printDocument(
        'Laboura introductions register',
        `<h1>Introductions register — evidence pack</h1><p>Every time a candidate was shown to a business. Recorded by the software and never edited. No-bypass period: ${s?.noBypassMonths ?? 12} months.</p>` +
          htmlTable(
            ['When', 'Business', 'Candidate', 'How', 'No-bypass until', 'Outcome'],
            all.rows.map((r) => [formatDateTimeIST(r.at), `${r.business.code} ${r.business.name}`, `${r.jobSeeker.code} ${r.jobSeeker.name}`, how(r), formatDateIST(r.noBypassUntil), OUTCOME[r.outcome]?.label ?? r.outcome]),
          ),
      );
      if (ok) toast.success(`Evidence pack ready — ${all.rows.length} introductions. Choose "Save as PDF".`);
      else toast.error('Allow pop-ups for this site to save the PDF.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not build the evidence pack');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="lb-page">
      <TopBar back={{ to: to('C-Businesses'), label: 'Businesses' }} title="Introductions register" subtitle="Who was shown to which business, and when — Laboura's proof against bypass." />
      <BusinessTabs />
      <StatGrid>
        <StatTile label="Introductions" value={s?.shown ?? '—'} tone="royal" loading={list.query.isPending} />
        <StatTile label="Selected" value={s?.selected ?? '—'} tone="good" loading={list.query.isPending} />
        <StatTile label="Not selected" value={s?.notSelected ?? '—'} tone="cyan" loading={list.query.isPending} />
        <StatTile label="Bypass suspected" value={s?.bypassSuspected ?? '—'} tone="red" loading={list.query.isPending} />
      </StatGrid>
      <FilterPanel>
        <SearchField value={search} onChange={setSearch} placeholder="Business or candidate" />
        <SelectFilter
          label="Outcome"
          value={outcome}
          onChange={setOutcome}
          options={[{ value: '', label: 'All' }, ...Object.entries(OUTCOME).map(([value, o]) => ({ value, label: o.label }))]}
        />
        <DateFilter label="Shown" value={period} onChange={setPeriod} />
      </FilterPanel>
      <PagedTable
        list={list}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Introductions register"
        download="introductions-register"
        onOpen={(r) => navigate(to('C-Business', { id: r.business.id }))}
        note="Every time a candidate is shown to a business it's recorded here and can never be edited — the proof for the 12-month no-bypass clause and any legal notice."
      />
      <div className="ceo-actions">
        <Button variant="primary" onClick={() => void evidencePack()} loading={printing}>
          Export evidence pack (PDF)
        </Button>
      </div>
    </div>
  );
}
