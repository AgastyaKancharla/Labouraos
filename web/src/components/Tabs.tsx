import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

/**
 * Two kinds of tabs, both styled as the designs' `.tabs` / `.tab`:
 *
 * - <Tabs>: switches content on the same page (WAI-ARIA tabs: arrow keys,
 *   Home/End move between tabs; only the active tab is in the Tab order).
 * - <LinkTabs>: each tab is a separate route (Payments → Money in / Money
 *   out / GST & invoices). Plain links with aria-current.
 */
export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  /** Small count after the label. */
  count?: number;
}

export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  children,
}: {
  items: readonly TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Accessible name of the tab list. */
  label: string;
  /** Panel content for the active tab. */
  children?: ReactNode;
}) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, items.findIndex((i) => i.key === value));

  const focusAt = (i: number) => {
    const next = (i + items.length) % items.length;
    refs.current[next]?.focus();
    onChange(items[next].key);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') focusAt(index + 1);
    else if (e.key === 'ArrowLeft') focusAt(index - 1);
    else if (e.key === 'Home') focusAt(0);
    else if (e.key === 'End') focusAt(items.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <>
      <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {items.map((item, i) => {
          const selected = item.key === value;
          return (
            <button
              key={item.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${item.key}`}
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              className={selected ? 'tab on' : 'tab'}
              onClick={() => onChange(item.key)}
            >
              {item.label}
              {item.count !== undefined && <span className="lb-tab__count">{item.count}</span>}
            </button>
          );
        })}
      </div>
      {children !== undefined && (
        <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`} tabIndex={0} className="lb-tabpanel">
          {children}
        </div>
      )}
    </>
  );
}

export function LinkTabs({ items, label }: { items: readonly { to: string; label: ReactNode; end?: boolean }[]; label: string }) {
  return (
    <nav className="tabs" aria-label={label}>
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end ?? true} className={({ isActive }) => (isActive ? 'tab on' : 'tab')}>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
