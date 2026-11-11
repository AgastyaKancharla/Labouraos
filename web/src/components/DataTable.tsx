import { useId, useMemo, useState, type ReactNode } from 'react';
import { useT } from '../i18n/I18nProvider';
import { useAuth } from '../auth/AuthProvider';
import { canExportLists, downloadTextFile, toCsv, type CsvColumn } from '../lib/csv';
import { Button } from './Button';
import { EmptyState, ErrorState } from './ErrorState';
import { UiIcon } from './Icon';
import { Skeleton } from './Skeleton';

/**
 * The list table every portal screen uses: sortable headers, per-column
 * filters, pagination, loading/empty/error states and the "Download (Excel)"
 * button (shown only to roles allowed to export lists).
 *
 * Sorting, filtering and paging happen in the browser on the rows you pass.
 * For lists that can grow past a few thousand rows, page on the server and
 * pass `rows` for the current page only (set `pageSize={rows.length}`).
 */
export interface Column<Row> {
  /** Stable id; also the default CSV header source. */
  key: string;
  header: string;
  /** Cell content. Defaults to String(row[key]). */
  cell?: (row: Row) => ReactNode;
  /** Value used for sorting; enables the sort button when present. */
  sortValue?: (row: Row) => string | number | null | undefined;
  /** 'select' builds a dropdown from the column's distinct filterValue()s; 'text' is a contains-search. */
  filter?: 'select' | 'text';
  filterValue?: (row: Row) => string;
  /** Value written to the downloaded file. Omit to leave the column out of the file. */
  csv?: (row: Row) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  /** Hide on phones (below 760 px) to keep the important columns readable. */
  hideOnPhone?: boolean;
}

export interface DataTableProps<Row> {
  columns: readonly Column<Row>[];
  rows: readonly Row[] | undefined;
  rowKey: (row: Row) => string;
  /** Accessible name for the table (also its <caption>, visually hidden). */
  caption: string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyTitle?: ReactNode;
  emptyBody?: ReactNode;
  pageSize?: number;
  initialSort?: { key: string; direction: 'asc' | 'desc' };
  /** File name (without extension) for the download button. */
  download?: string;
  onRowClick?: (row: Row) => void;
  /** Extra controls placed left of the download button. */
  toolbar?: ReactNode;
}

type SortState = { key: string; direction: 'asc' | 'desc' } | null;

function compare(a: string | number | null | undefined, b: string | number | null | undefined): number {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en-IN', { numeric: true, sensitivity: 'base' });
}

export function useTableDownload<Row>(columns: readonly Column<Row>[], filename: string | undefined) {
  const { session } = useAuth();
  const allowed = !!filename && canExportLists(session?.staff.role);
  const download = (rows: readonly Row[]) => {
    if (!allowed || !filename) return;
    const csvColumns: CsvColumn<Row>[] = columns
      .filter((c) => c.csv)
      .map((c) => ({ header: c.header, value: c.csv as (row: Row) => string | number | null | undefined }));
    downloadTextFile(`${filename}.csv`, toCsv(rows, csvColumns));
  };
  return { allowed, download };
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  loading,
  error,
  onRetry,
  emptyTitle,
  emptyBody,
  pageSize = 25,
  initialSort,
  download,
  onRowClick,
  toolbar,
}: DataTableProps<Row>) {
  const t = useT();
  const id = useId();
  const [sort, setSort] = useState<SortState>(initialSort ?? null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const { allowed: canDownload, download: doDownload } = useTableDownload(columns, download);

  const filterable = useMemo(() => columns.filter((c) => c.filter), [columns]);

  const selectOptions = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of filterable) {
      if (c.filter !== 'select') continue;
      const get = c.filterValue ?? ((r: Row) => String((r as Record<string, unknown>)[c.key] ?? ''));
      out[c.key] = Array.from(new Set((rows ?? []).map(get).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    }
    return out;
  }, [filterable, rows]);

  const processed = useMemo(() => {
    let list = [...(rows ?? [])];
    for (const c of filterable) {
      const needle = filters[c.key];
      if (!needle) continue;
      const get = c.filterValue ?? ((r: Row) => String((r as Record<string, unknown>)[c.key] ?? ''));
      list =
        c.filter === 'text'
          ? list.filter((r) => get(r).toLowerCase().includes(needle.toLowerCase()))
          : list.filter((r) => get(r) === needle);
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.sortValue) {
        const sv = col.sortValue;
        list.sort((a, b) => (sort.direction === 'asc' ? 1 : -1) * compare(sv(a), sv(b)));
      }
    }
    return list;
  }, [rows, filters, sort, columns, filterable]);

  const pages = Math.max(1, Math.ceil(processed.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = processed.slice(current * pageSize, current * pageSize + pageSize);

  const toggleSort = (key: string) => {
    setPage(0);
    setSort((s) => (s?.key === key ? { key, direction: s.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }));
  };

  const showToolbar = filterable.length > 0 || canDownload || toolbar;

  return (
    <div className="lb-table">
      {showToolbar && (
        <div className="lb-table__toolbar">
          {filterable.map((c) => (
            <label key={c.key} className="field lb-table__filter" htmlFor={`${id}-f-${c.key}`}>
              {c.header}
              {c.filter === 'select' ? (
                <select
                  id={`${id}-f-${c.key}`}
                  value={filters[c.key] ?? ''}
                  aria-label={t('table.filterBy', { column: c.header })}
                  onChange={(e) => {
                    setPage(0);
                    setFilters((f) => ({ ...f, [c.key]: e.target.value }));
                  }}
                >
                  <option value="">{t('table.all')}</option>
                  {(selectOptions[c.key] ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`${id}-f-${c.key}`}
                  type="search"
                  value={filters[c.key] ?? ''}
                  aria-label={t('table.filterBy', { column: c.header })}
                  onChange={(e) => {
                    setPage(0);
                    setFilters((f) => ({ ...f, [c.key]: e.target.value }));
                  }}
                />
              )}
            </label>
          ))}
          <div className="lb-table__actions">
            {toolbar}
            {canDownload && (
              <Button onClick={() => doDownload(processed)} icon={<UiIcon name="download" size={15} />} disabled={!rows?.length}>
                {t('common.download')}
              </Button>
            )}
          </div>
        </div>
      )}

      {error ? (
        <ErrorState error={error} onRetry={onRetry} compact />
      ) : (
        <div className="scrollx lb-table__scroll" tabIndex={0} role="region" aria-labelledby={`${id}-caption`}>
          <table aria-busy={loading || undefined}>
            <caption id={`${id}-caption`} className="sr-only">
              {caption}
            </caption>
            <thead>
              <tr>
                {columns.map((c) => {
                  const active = sort?.key === c.key;
                  const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={c.sortValue ? (ariaSort ?? 'none') : undefined}
                      className={[c.align ? `lb-align-${c.align}` : '', c.hideOnPhone ? 'lb-hide-phone' : ''].join(' ')}
                    >
                      {c.sortValue ? (
                        <button type="button" className="lb-sort" onClick={() => toggleSort(c.key)} title={t('table.sortBy', { column: c.header })}>
                          {c.header}
                          <UiIcon name={active ? (sort.direction === 'asc' ? 'arrowUp' : 'arrowDown') : 'sort'} size={12} />
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 4 }, (_, i) => (
                  <tr key={`sk-${i}`} aria-hidden="true">
                    {columns.map((c) => (
                      <td key={c.key} className={c.hideOnPhone ? 'lb-hide-phone' : undefined}>
                        <Skeleton width="70%" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!loading &&
                visible.map((row) => (
                  <tr
                    key={rowKey(row)}
                    className={onRowClick ? 'lb-row-click' : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.key === 'Enter') onRowClick(row);
                          }
                        : undefined
                    }
                    tabIndex={onRowClick ? 0 : undefined}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={[c.align ? `lb-align-${c.align}` : '', c.hideOnPhone ? 'lb-hide-phone' : ''].join(' ')}
                      >
                        {c.cell ? c.cell(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
          {!loading && processed.length === 0 && <EmptyState title={emptyTitle}>{emptyBody}</EmptyState>}
        </div>
      )}

      {!loading && !error && processed.length > pageSize && (
        <nav className="lb-table__pager" aria-label={caption}>
          <span>
            {t('table.range', {
              from: current * pageSize + 1,
              to: Math.min(processed.length, (current + 1) * pageSize),
              total: processed.length,
            })}
          </span>
          <Button onClick={() => setPage(current - 1)} disabled={current === 0} icon={<UiIcon name="chevronLeft" size={14} />}>
            {t('table.prev')}
          </Button>
          <span aria-live="polite">{t('table.page', { page: current + 1, pages })}</span>
          <Button onClick={() => setPage(current + 1)} disabled={current >= pages - 1}>
            {t('table.next')}
            <UiIcon name="chevronRight" size={14} />
          </Button>
        </nav>
      )}
    </div>
  );
}
