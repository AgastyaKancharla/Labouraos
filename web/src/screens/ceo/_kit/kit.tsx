import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/Button';
import { DataTable, type Column } from '../../../components/DataTable';
import { useAuth } from '../../../auth/AuthProvider';
import { useToast } from '../../../components/Toast';
import { api, type QueryValue } from '../../../lib/api/client';
import { canExportLists, downloadTextFile, toCsv } from '../../../lib/csv';
import { formatDateIST, formatDateTimeIST } from '../../../lib/format/date';
import { customPeriod, periodFor, periodToUtcRange, type Period } from '../../../lib/period';
import { useNow } from '../../../lib/useNow';
import './ceo.css';

/** Shared building blocks for the CEO portal screens (part 1). */

export interface PagedResponse<Row, Summary = unknown> {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  summary: Summary;
}

/** A list's date filter: null means "any date". */
export type ListPeriod = Period | null;

export function rangeQuery(period: ListPeriod): Record<string, string> {
  return period ? periodToUtcRange(period) : {};
}

/** "Any date / Today / This week / This month / Custom" with from–to for Custom. */
export function DateFilter({ value, onChange, label = 'Date' }: { value: ListPeriod; onChange: (p: ListPeriod) => void; label?: string }) {
  const now = useNow();
  const preset = value?.preset ?? 'any';
  return (
    <label className="field">
      {label}
      <span className="ceo-dates">
        <select
          aria-label={label}
          value={preset}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'any') onChange(null);
            else if (v === 'custom') onChange(customPeriod(value?.from ?? periodFor('month', now).from, value?.to ?? periodFor('today', now).to));
            else onChange(periodFor(v as 'today' | 'week' | 'month', now));
          }}
        >
          <option value="any">Any date</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="custom">Custom</option>
        </select>
        {value?.preset === 'custom' && (
          <>
            <input type="date" aria-label="From" value={value.from} onChange={(e) => e.target.value && onChange(customPeriod(e.target.value, value.to))} />
            <input type="date" aria-label="To" value={value.to} onChange={(e) => e.target.value && onChange(customPeriod(value.from, e.target.value))} />
          </>
        )}
      </span>
    </label>
  );
}

export function SearchField({ value, onChange, placeholder, label = 'Search' }: { value: string; onChange: (v: string) => void; placeholder: string; label?: string }) {
  return (
    <label className="field ceo-grow">
      {label}
      <input type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function SelectFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterPanel({ children }: { children: ReactNode }) {
  return <div className="panel ceo-filters">{children}</div>;
}

/** Waits until typing pauses before the search goes to the server. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** A server-paged CEO list: filters, page and the query, with the page reset when a filter changes. */
export function useCeoList<Row, Extra = object, Summary = unknown>(path: string, filters: Record<string, QueryValue>, pageSize = 25) {
  const [page, setPage] = useState(1);
  const key = JSON.stringify(filters);
  useEffect(() => setPage(1), [key]);
  const query = useQuery({
    queryKey: ['ceo', path, filters, page, pageSize],
    queryFn: () => api.get<PagedResponse<Row, Summary> & Extra>(path, { query: { ...filters, page, pageSize } }),
    placeholderData: keepPreviousData,
  });
  return { query, page, setPage, pageSize, filters, path };
}

/** The table, the "Showing x of y" line with Previous/Next, and the Excel download of every matching row. */
export function PagedTable<Row>({
  list,
  columns,
  rowKey,
  caption,
  download,
  onOpen,
  note,
  emptyTitle = 'No rows match these filters. Change a filter to see more.',
}: {
  list: { query: { data?: { rows: Row[]; total: number }; isPending: boolean; error: unknown; refetch: () => unknown }; page: number; setPage: (p: number) => void; pageSize: number; filters: Record<string, QueryValue>; path: string };
  columns: readonly Column<Row>[];
  rowKey: (row: Row) => string;
  caption: string;
  download: string;
  onOpen?: (row: Row) => void;
  note?: ReactNode;
  emptyTitle?: string;
}) {
  const { session } = useAuth();
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const data = list.query.data;
  const total = data?.total ?? 0;
  const from = total ? (list.page - 1) * list.pageSize + 1 : 0;
  const to = Math.min(total, list.page * list.pageSize);
  const pages = Math.max(1, Math.ceil(total / list.pageSize));
  const canDownload = canExportLists(session?.staff.role);

  const doDownload = async () => {
    setDownloading(true);
    try {
      const all = await api.get<{ rows: Row[] }>(list.path, { query: { ...list.filters, page: 1, pageSize: 5000 } });
      const csvColumns = columns.filter((c) => c.csv).map((c) => ({ header: c.header, value: c.csv as (r: Row) => string | number | null | undefined }));
      downloadTextFile(`${download}.csv`, toCsv(all.rows, csvColumns));
      toast.success(`Downloaded ${all.rows.length} rows`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="panel" style={{ padding: '6px 18px 14px' }}>
      <DataTable
        columns={columns}
        rows={data?.rows}
        rowKey={rowKey}
        caption={caption}
        loading={list.query.isPending}
        error={list.query.error}
        onRetry={() => void list.query.refetch()}
        emptyTitle={emptyTitle}
        pageSize={Math.max(1, data?.rows.length ?? list.pageSize)}
        onRowClick={onOpen}
        toolbar={
          canDownload ? (
            <Button onClick={() => void doDownload()} loading={downloading} disabled={!total}>
              Download (Excel)
            </Button>
          ) : undefined
        }
      />
      {!list.query.isPending && !list.query.error && (
        <div className="ceo-pager">
          <span aria-live="polite">{total ? `Showing ${from}–${to} of ${total}` : 'Showing 0'}</span>
          <div>
            <Button onClick={() => list.setPage(list.page - 1)} disabled={list.page <= 1}>
              ← Previous
            </Button>
            <span>
              Page {list.page} of {pages}
            </span>
            <Button onClick={() => list.setPage(list.page + 1)} disabled={list.page >= pages}>
              Next →
            </Button>
          </div>
        </div>
      )}
      {note && <div className="ceo-note">{note}</div>}
    </div>
  );
}

/** "Open →" in a table row; rows also open on click/Enter. */
export function OpenLink({ to, label = 'Open →' }: { to: string; label?: string }) {
  const navigate = useNavigate();
  return (
    <a
      href={`/app${to}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigate(to);
      }}
    >
      {label}
    </a>
  );
}

export function Kv({ rows }: { rows: readonly [ReactNode, ReactNode][] }) {
  return (
    <div className="kv">
      {rows.map(([k, v], i) => (
        <FragmentPair key={i} k={k} v={v} />
      ))}
    </div>
  );
}
function FragmentPair({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <>
      <span>{k}</span>
      <span>{v ?? '—'}</span>
    </>
  );
}

export interface TimelineEvent {
  at: string;
  text: ReactNode;
  tone?: string;
  aside?: ReactNode;
}

export function Timeline({ events, empty = 'Nothing recorded yet.' }: { events: readonly TimelineEvent[]; empty?: string }) {
  if (!events.length) return <p className="ceo-sub">{empty}</p>;
  return (
    <div className="tl">
      {events.map((e, i) => (
        <div key={i}>
          <span className="ceo-tl-time">{formatDateTimeIST(e.at)}</span>
          <i style={e.tone ? { background: e.tone } : undefined} />
          <span>{e.text}</span>
          <span className="ceo-sub">{e.aside}</span>
        </div>
      ))}
    </div>
  );
}

export function Hits({ count, max = 3 }: { count: number; max?: number }) {
  return (
    <span className="ceo-hits" role="img" aria-label={`${count} of ${max} hits`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < count ? 'ceo-hit on' : 'ceo-hit'} />
      ))}
    </span>
  );
}

export function Bars({ items, warm, format }: { items: readonly { label: string; value: number }[]; warm?: boolean; format: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className={`bars ceo-bars${warm ? ' warm' : ''}`} role="img" aria-label={items.map((i) => `${i.label}: ${format(i.value)}`).join(', ')}>
      {items.map((i, idx) => (
        <div className="bar-col" key={i.label}>
          <span className="bval">{format(i.value)}</span>
          <div className={idx === items.length - 1 ? 'bar last' : 'bar'} style={{ height: `${Math.max(4, Math.round((i.value / max) * 110))}px` }} />
          <span className="blabel">{i.label}</span>
        </div>
      ))}
    </div>
  );
}

export function HBar({ label, value, max, right, warm }: { label: ReactNode; value: number; max: number; right: ReactNode; warm?: boolean }) {
  return (
    <div className="hbar-row">
      <span>{label}</span>
      <div className="track">
        <div className={warm ? 'fill warm' : 'fill'} style={{ width: `${max > 0 ? Math.round((value / max) * 100) : 0}%` }} />
      </div>
      <b style={{ textAlign: 'right' }}>{right}</b>
    </div>
  );
}

export function dateOrDash(iso: string | null | undefined): string {
  return iso ? formatDateIST(iso) : '—';
}

export function humanize(code: string | null | undefined): string {
  if (!code) return '—';
  const s = code.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Opens a print window with a simple document — the browser's "Save as PDF" makes the PDF. */
export function printDocument(title: string, bodyHtml: string): boolean {
  const w = window.open('', '_blank', 'noopener=no,width=900,height=700');
  if (!w) return false;
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;font-size:12px;color:#0b1e4a;margin:24px}h1{font-size:18px}table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border:1px solid #c3ceea;padding:6px 8px;text-align:left}th{background:#eef3fb}</style></head><body>${bodyHtml}</body></html>`,
  );
  w.document.close();
  w.focus();
  w.print();
  return true;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export function htmlTable(headers: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c === null || c === undefined ? '—' : String(c))}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

/** Options for a filter dropdown from a facet list. */
export function facetOptions(allLabel: string, values: readonly string[] | undefined): { value: string; label: string }[] {
  return [{ value: '', label: allLabel }, ...(values ?? []).map((v) => ({ value: v, label: v }))];
}

export function useStableFilters<T extends Record<string, QueryValue>>(filters: T): T {
  const key = JSON.stringify(filters);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => filters, [key]);
}
