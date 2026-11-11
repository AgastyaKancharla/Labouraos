import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../i18n/I18nProvider';
import { isSearchable, resultPath, useSearch } from '../lib/search/searchApi';
import { usePortal } from '../portals/PortalContext';
import { UiIcon } from './Icon';

/**
 * The search bar on every staff screen (guide: find anyone by name, mobile —
 * full or last 4 — or ID JS-/BZ-/RF-/VC-/PL-). Typing shows the first
 * matches straight away (GET /search, scoped and masked by the server);
 * ↑/↓ and Enter open one, Enter with none picked opens the portal's search
 * screen with ?q= for every result.
 */
const SUGGESTIONS = 6;
const DEBOUNCE_MS = 250;

export function SearchBox({ initial = '' }: { initial?: string }) {
  const t = useT();
  const id = useId();
  const listId = `${id}-list`;
  const portal = usePortal();
  const navigate = useNavigate();
  const [q, setQ] = useState(initial);
  const [debounced, setDebounced] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const search = useSearch(open ? debounced : '');
  const rows = (search.data?.results ?? []).slice(0, SUGGESTIONS);
  const showList = open && isSearchable(debounced) && (rows.length > 0 || Boolean(search.data));

  const goAll = () => {
    const query = q.trim();
    if (!query) return;
    setOpen(false);
    navigate(`${portal.root}/search?q=${encodeURIComponent(query)}`);
  };
  const goRow = (index: number) => {
    const row = rows[index];
    const path = row ? resultPath(portal, row) : null;
    setOpen(false);
    if (path) navigate(path);
    else goAll();
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (showList && active >= 0 && active < rows.length) goRow(active);
    else goAll();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(-1, a - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <form role="search" className="lb-search" onSubmit={onSubmit} ref={box}>
      <label htmlFor={id} className="sr-only">
        {t('search.label')}
      </label>
      <UiIcon name="search" size={16} />
      <input
        id={id}
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={t('search.placeholder')}
        enterKeyHint="search"
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
      />
      {showList && (
        <ul id={listId} role="listbox" className="lb-search__list" aria-label={t('search.suggestions')}>
          {rows.map((row, i) => (
            <li
              key={`${row.type}-${row.id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                goRow(i);
              }}
            >
              <span className="lb-search__name">{row.name}</span>
              <span className="lb-search__meta">{[row.code, row.maskedPhone, row.trade].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
          {rows.length === 0 && <li className="lb-search__empty">{t('search.noMatch')}</li>}
          <li
            role="option"
            aria-selected={false}
            className="lb-search__all"
            onMouseDown={(e) => {
              e.preventDefault();
              goAll();
            }}
          >
            {t('search.seeAll', { q: q.trim() })}
          </li>
        </ul>
      )}
    </form>
  );
}
