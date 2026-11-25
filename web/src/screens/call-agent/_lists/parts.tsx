import { sentResultKey, type SendChannel } from '../../../components/SendLinkButtons';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { isApiError } from '../../../lib/api/errors';
import { LIST_CAP, LIST_FILTERS, useMyList, type ListFilter, type ListGroup, type ListKind } from './api';

/**
 * The pieces the console lists share (rev 210, 23 Nov), built after Laboura Field's
 * (field/src/screens/_lists): the filter chips (All · Needs action · Waiting for Team Lead ·
 * Active · Done), the row (name in bold first, one plain status line, a few small lines; tapping
 * it opens the profile) and its right side — a green Done, "Waiting" (the Team Lead), or ONE
 * next-step button that works right there.
 */

export type StatusTone = 'ink' | 'red' | 'green' | 'amber';

/** The filter chips; they wrap onto a second line rather than scroll sideways on a phone. */
export function FilterChips({ value, onChange, counts }: { value: ListFilter; onChange: (f: ListFilter) => void; counts?: Record<ListFilter, number> }) {
  const t = useT();
  return (
    <div role="group" aria-label={t('cl.filters')} className="lb-cl-chips">
      {LIST_FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          className={`tag ${value === f ? 'tb' : 'tn'} lb-ca-chip lb-cl-chip`}
          aria-pressed={value === f}
          onClick={() => onChange(f)}
        >
          {t(`cl.filter.${f}` as MessageKey)}
          {counts && f !== 'all' && counts[f] > 0 ? ` · ${counts[f]}` : ''}
        </button>
      ))}
    </div>
  );
}

export function DoneMark({ label }: { label?: string }) {
  const t = useT();
  return (
    <span className="lb-cl-mark lb-cl-mark--done" data-testid="row-done">
      ✓ {label ?? t('cl.done')}
    </span>
  );
}

export function WaitingMark() {
  const t = useT();
  return (
    <span className="lb-cl-mark lb-cl-mark--waiting" title={t('cl.waitingTitle')} data-testid="row-waiting">
      ⏳ {t('cl.waiting')}
    </span>
  );
}

/**
 * The ONE next-step button. `run` calls an existing route in place (Resend link, Send payment
 * link, Send agreement link…); `to` opens the screen that does it (Add vacancy, Book interview).
 * A refusal shows the server's own words (a do-not-call block, a one-a-minute limit).
 */
/**
 * A row's one button. `to` opens a screen; `send` sends a link (rev 211): the button sends on
 * WhatsApp first (SMS as backup) and the small "by SMS" under it sends by SMS only; the toast
 * says which channel carried it. `run` is a plain action.
 */
export function RowAction({ label, name, run, send, to, testId }: { label: string; name: string; run?: () => Promise<unknown>; send?: (channel: SendChannel) => Promise<unknown>; to?: string; testId?: string }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const action = useMutation({
    mutationFn: (channel: SendChannel | null) => (channel && send ? send(channel) : run!()),
    onSuccess: (res, channel) => {
      if (channel) {
        const key = sentResultKey(channel, res);
        if (key === 'send.result.none') toast.error(t(key));
        else toast.success(`${t('cl.sentToast', { name })} ${t(key)}`);
      } else {
        toast.success(t('cl.sentToast', { name }));
      }
      // The row's status line, the Home lists and the profile box follow the new state.
      void queryClient.invalidateQueries({ queryKey: ['call-work'] });
      void queryClient.invalidateQueries({ queryKey: ['profile-stuck'] });
    },
    onError: (e) => toast.error(isApiError(e) ? e.message : t('error.server')),
  });
  if (to) {
    return (
      <Link className="btn bp lb-btn lb-cl-btn" to={to} data-testid={testId}>
        {label}
      </Link>
    );
  }
  return (
    <span className="lb-cl-end">
      <button
        type="button"
        className="btn bp lb-btn lb-cl-btn"
        disabled={action.isPending || action.isSuccess}
        aria-busy={action.isPending}
        onClick={() => action.mutate(send ? 'whatsapp' : null)}
        data-testid={testId}
      >
        {action.isSuccess ? t('cl.sent') : action.isPending ? '…' : label}
      </button>
      {send && !action.isSuccess && (
        <button type="button" className="lb-send__sms" disabled={action.isPending} onClick={() => action.mutate('sms')}>
          {t('send.bySms')}
        </button>
      )}
      {action.isError && (
        <span className="lb-cl-error" role="alert">
          {isApiError(action.error) ? action.error.message : t('error.server')}
        </span>
      )}
    </span>
  );
}

/** The selfie in a small round frame, or the first letters of the name. */
export function Avatar({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  if (photoUrl && !failed) {
    return <img className="lb-cl-avatar" src={photoUrl} alt={t('cl.photo', { name })} onError={() => setFailed(true)} data-testid="row-photo" />;
  }
  return (
    <span className="lb-cl-avatar lb-cl-avatar--initials" aria-hidden="true" data-testid="row-initials">
      {initials(name)}
    </span>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}

/**
 * One row: the name in bold first, the plain status line under it, then small lines; on the
 * right Done / Waiting / the one button. The text part is a link to the profile; the button sits
 * beside it (never inside the link) and drops below the text on a narrow phone.
 */
export function ListRow({
  to,
  leading,
  name,
  status,
  tone = 'ink',
  lines,
  small,
  trailing,
  testId,
}: {
  to?: string;
  leading?: ReactNode;
  name: string;
  status: string;
  tone?: StatusTone;
  lines?: string[];
  small?: string | null;
  trailing?: ReactNode;
  testId?: string;
}) {
  const body = (
    <>
      {leading}
      <span className="lb-cl-text">
        <b className="lb-cl-name">{name}</b>
        <span className={`lb-cl-status lb-cl-status--${tone}`} data-testid="row-status">
          {status}
        </span>
        {(lines ?? []).filter(Boolean).map((line, i) => (
          <span key={i} className="lb-cl-line">
            {line}
          </span>
        ))}
        {small ? <span className="lb-cl-small">{small}</span> : null}
      </span>
    </>
  );
  return (
    <div className="lb-cl-row" data-testid={testId ?? 'list-row'}>
      {to ? (
        <Link className="lb-cl-main" to={to}>
          {body}
        </Link>
      ) : (
        <span className="lb-cl-main">{body}</span>
      )}
      {trailing ? <span className="lb-cl-trailing">{trailing}</span> : null}
    </div>
  );
}

/** Done, Waiting or the button, from a row state. */
export function RowEnd({ row, button }: { row: { waiting: boolean; done: boolean; action: string | null }; button: ReactNode }) {
  if (row.waiting) return <WaitingMark />;
  if (row.action && button) return <>{button}</>;
  return row.done ? <DoneMark /> : null;
}

export function toneOf(row: { waiting: boolean; done: boolean; group: ListGroup; status: string }, red: string[] = []): StatusTone {
  if (row.waiting) return 'amber';
  if (red.includes(row.status)) return 'red';
  if (row.done) return 'green';
  return 'ink';
}

export function maskedLast4(last4: string | null | undefined): string | null {
  return last4 ? `******${last4}` : null;
}

function useDebounced(value: string, ms = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * A list page: title, search, filter chips, the rows (needs action first, as the server sends
 * them) and "Load more" for long lists.
 */
export function ListScreen<T extends { id: string }>({
  kind,
  title,
  placeholder,
  emptyKey,
  renderRow,
}: {
  kind: ListKind;
  title: string;
  placeholder: string;
  emptyKey: MessageKey;
  renderRow: (row: T) => ReactNode;
}) {
  const t = useT();
  const searchId = useId();
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<ListFilter>('all');
  const q = useDebounced(text.trim().slice(0, 64));
  const list = useMyList<T>(kind, q, filter);
  const pages = list.data?.pages ?? [];
  const first = pages[0];
  const rows = pages.flatMap((p) => p.results);
  return (
    <div className="lb-page lb-ca lb-cl">
      <TopBar title={title} />
      <div className="lb-cl-search">
        <label className="lbl" htmlFor={searchId}>
          {t('cl.search')}
        </label>
        <input
          id={searchId}
          className="lb-cl-input"
          type="search"
          value={text}
          placeholder={placeholder}
          maxLength={64}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <FilterChips value={filter} onChange={setFilter} counts={first?.counts} />
      {list.error && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {!list.data && !list.error && <SkeletonCard height={260} />}
      {first && (
        <section className="card lb-cl-list" aria-label={title}>
          {rows.length === 0 ? (
            <p className="sub">{first.counts.all === 0 ? (q ? t('cl.noMatch', { q }) : t(emptyKey)) : t('cl.noneHere')}</p>
          ) : (
            <>
              {rows.map((row) => (
                <div key={row.id}>{renderRow(row)}</div>
              ))}
              <div className="lb-cl-foot">
                <span className="sub">{t('cl.count', { shown: rows.length, total: first.total })}</span>
                {list.hasNextPage && (
                  <button type="button" className="btn bs lb-btn lb-ca-small" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                    {list.isFetchingNextPage ? '…' : t('cl.loadMore')}
                  </button>
                )}
              </div>
              {!q && first.counts.all >= LIST_CAP && <p className="sub">{t('cl.capped', { count: LIST_CAP })}</p>}
            </>
          )}
        </section>
      )}
    </div>
  );
}
