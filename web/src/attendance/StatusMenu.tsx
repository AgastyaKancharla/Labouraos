import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT, type Translate } from '../i18n/I18nProvider';
import { useNow } from '../lib/useNow';
import { screenPath } from '../portals';
import { usePortal } from '../portals/PortalContext';
import type { AttendanceToday } from './api';
import { useAttendance } from './AttendanceProvider';
import { countdown, shortClock } from './format';
import { NOT_STARTED_DOT, STATUS_DEFS, breakAllowanceSeconds, menuStatuses, statusLabelKey, type AttendanceAudience, type AttendanceStatus } from './statuses';

/** Seconds into the current status, and how far past its allowance a break is (negative = time left). */
export function breakClock(today: AttendanceToday, status: AttendanceStatus, nowMs: number): { left: number; over: number } | null {
  const allowance = breakAllowanceSeconds(status, today.policy);
  if (allowance === null || !today.statusSince) return null;
  const used = Math.max(0, (nowMs - Date.parse(today.statusSince)) / 1000);
  return { left: Math.max(0, allowance - used), over: Math.max(0, used - allowance) };
}

/** What the chip says: "Available · 11:20", "Short break · 08:40 left", "Not logged in". */
export function chipText(t: Translate, audience: AttendanceAudience, today: AttendanceToday | undefined, status: AttendanceStatus | null, nowMs: number): { text: string; dot: string; over: boolean } {
  if (!today) return { text: t('att.status.not_started'), dot: NOT_STARTED_DOT, over: false };
  if (today.loginAt && today.logoutAt) return { text: t('att.status.ended'), dot: NOT_STARTED_DOT, over: false };
  if (!today.loginAt) return { text: t(today.dayType === 'leave' ? 'att.status.leave' : 'att.status.not_started'), dot: NOT_STARTED_DOT, over: false };
  if (!status) return { text: t('att.status.not_started'), dot: NOT_STARTED_DOT, over: false };
  const label = t(statusLabelKey(status, audience));
  const clock = breakClock(today, status, nowMs);
  if (clock) {
    if (clock.over > 0) return { text: t('att.chip.over', { status: label, time: countdown(clock.over) }), dot: '#BB232B', over: true };
    return { text: t('att.chip.left', { status: label, time: countdown(clock.left) }), dot: STATUS_DEFS[status].dot, over: false };
  }
  return { text: t('att.chip.since', { status: label, time: today.statusSince ? shortClock(today.statusSince) : '' }), dot: STATUS_DEFS[status].dot, over: false };
}

/** The menu's label for a status (the CA14b select's wording). */
export function optionLabel(t: Translate, status: AttendanceStatus, audience: AttendanceAudience, today: AttendanceToday | undefined): string {
  if (status === 'system_problem') return t(audience === 'agent' ? 'att.menu.systemProblem' : 'att.menu.systemProblemOffice');
  if (status === 'short_break') return t('att.menu.shortBreak', { minutes: today?.policy.shortBreakMinutes ?? 15 });
  if (status === 'lunch') return t('att.menu.lunch', { minutes: today?.policy.lunchMinutes ?? 30 });
  return t(statusLabelKey(status, audience));
}

/**
 * The one status dropdown in the header ("Available · 11:20 ▾"), from the CA03
 * and CA14 designs; Team Leads, Managers and Finance get the same control in
 * their page header. Start my day before the day starts; then every status
 * the person may pick (On call and After-call notes are shown greyed — the
 * phone system sets them), My attendance and End my day.
 */
export function StatusMenu({ tone }: { tone: 'onDark' | 'onLight' }) {
  const t = useT();
  const attendance = useAttendance();
  const portal = usePortal();
  const navigate = useNavigate();
  const now = useNow(1000);
  const [open, setOpen] = useState(false);
  const [alignLeft, setAlignLeft] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const first = menu.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])');
    first?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!attendance || attendance.failed || attendance.loading) return null;
  const { audience, today, status, phase } = attendance;
  const chip = chipText(t, audience, today, status, now.getTime());

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };
  const openMine = () => navigate(screenPath(portal, 'CA14e-MyAttendance'));

  return (
    <div className="lb-att-menuwrap">
      <button
        ref={button}
        type="button"
        className={`lb-att-chip lb-att-chip--${tone}${chip.over ? ' is-over' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t('att.menu.label', { status: chip.text })}
        onClick={() => {
          // Open towards the side with room (the chip sits on the left of a phone-width header).
          const rect = button.current?.getBoundingClientRect();
          setAlignLeft(Boolean(rect && rect.right < 300));
          setOpen((o) => !o);
        }}
      >
        <span className="lb-att-dot" style={{ background: chip.dot }} aria-hidden="true" />
        <span className="lb-att-chip__text">{chip.text}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div ref={menu} id={menuId} className={alignLeft ? 'lb-att-menu lb-att-menu--left' : 'lb-att-menu'} role="menu" aria-label={t('att.menu.title')} onKeyDown={onKeyDown}>
          {phase === 'open' ? (
            menuStatuses(audience).map((s) => {
              const def = STATUS_DEFS[s];
              const current = s === status;
              return (
                <button
                  key={s}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  aria-disabled={def.automatic || undefined}
                  tabIndex={-1}
                  className="lb-att-menu__item"
                  onClick={() => {
                    if (def.automatic || current) return void close();
                    run(() => void attendance.pick(s));
                  }}
                >
                  <span className="lb-att-dot" style={{ background: def.dot }} aria-hidden="true" />
                  <span className="lb-att-menu__label">
                    {optionLabel(t, s, audience, today)}
                    {def.automatic && <span className="lb-att-menu__sub">{t('att.menu.phoneSets')}</span>}
                  </span>
                  {current && <span aria-hidden="true">✓</span>}
                </button>
              );
            })
          ) : phase === 'ended' ? null : (
            <button type="button" role="menuitem" tabIndex={-1} className="lb-att-menu__item lb-att-menu__start" onClick={() => run(() => void attendance.start())}>
              {t('att.menu.start')}
            </button>
          )}
          <div className="lb-att-menu__sep" role="separator" />
          <button type="button" role="menuitem" tabIndex={-1} className="lb-att-menu__item" onClick={() => run(openMine)}>
            {t('att.menu.open')}
          </button>
          {phase === 'open' && (
            <button type="button" role="menuitem" tabIndex={-1} className="lb-att-menu__item lb-att-menu__end" onClick={() => run(attendance.requestEnd)}>
              {t('att.menu.end')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
