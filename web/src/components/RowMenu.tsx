import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

/**
 * True inside an open-able row menu: a Button there renders as a menu item
 * (role="menuitem", reached with the arrow keys). Modal sets it back to false
 * for its own buttons, so a dialog opened from a menu item is unaffected.
 */
export const MenuItemContext = createContext(false);
export const useInMenu = () => useContext(MenuItemContext);

const ITEMS = '[role="menuitem"]:not([disabled])';

/**
 * A per-row drop-down of actions ("Edit ▾", "Access ▾") — the WAI-ARIA menu
 * button pattern: Enter, Space or ↓ opens it on the first item, ↑ on the
 * last; ↑ ↓ Home End move; Escape closes it and returns to the button; Tab
 * or a click elsewhere closes it. Every item keeps its own dialog: the menu
 * stays mounted while closed (only hidden), so a dialog an item opened stays
 * open, and focus goes back to the menu button when that dialog closes.
 * Placed with fixed positioning so a scrolling table never clips it; items
 * and the button are at least 44 px tall (comfortable to tap).
 */
export function RowMenu({ label, name, children, testId }: { label: string; /** Whose menu it is, for screen readers: "Edit · Deepa Nair". */ name: string; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<'first' | 'last' | null>(null);

  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }, []);
  const show = (focus: 'first' | 'last') => {
    focusOnOpen.current = focus;
    setOpen(true);
  };

  // Under the button, right-aligned, kept inside the screen (above the button when there is no room below).
  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;
    const place = () => {
      const r = button.current!.getBoundingClientRect();
      const height = menu.current!.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const below = r.bottom + 4;
      const top = below + height > vh - 8 && r.top - height - 4 >= 8 ? r.top - height - 4 : below;
      setStyle({ top: Math.max(8, top), right: Math.max(16, vw - r.right), maxHeight: vh - 16 });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const list = items();
    const target = focusOnOpen.current === 'last' ? list[list.length - 1] : list[0];
    focusOnOpen.current = null;
    target?.focus();
    const outside = (e: Event) => {
      const node = e.target as Node;
      if (!menu.current?.contains(node) && !button.current?.contains(node)) close(false);
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('touchstart', outside);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('touchstart', outside);
    };
  }, [open, close]);

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      show('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      show('last');
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // Keys typed in a dialog an item opened bubble here through React: only the menu's own keys count.
    if (!menu.current?.contains(e.target as Node)) return;
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => list[(index + list.length) % list.length]?.focus();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(at + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(at - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      move(list.length - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  // An item was chosen: the menu closes and focus goes to its button first, so the item's dialog
  // (opened by the same click) returns focus there when it closes.
  const onMenuClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!menu.current?.contains(target) || !target.closest(ITEMS)) return;
    close(true);
  };

  return (
    <div className="lb-menu" data-testid={testId}>
      <button
        ref={button}
        type="button"
        className="btn2 lb-btn lb-menu__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label} · ${name}`}
        onClick={() => (open ? close(false) : show('first'))}
        onKeyDown={onButtonKey}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      <div ref={menu} id={id} role="menu" aria-label={`${label} · ${name}`} className="lb-menu__list" hidden={!open} style={style} onKeyDown={onMenuKey} onClick={onMenuClick}>
        <MenuItemContext.Provider value={true}>{children}</MenuItemContext.Provider>
      </div>
    </div>
  );
}
