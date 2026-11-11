import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n/I18nProvider';
import type { NotificationItem } from '../portals/notifications';
import { UiIcon } from './Icon';

/**
 * Bell with the red count and the popover list from the designs. `onOpen`
 * runs when the list opens (the portal hook marks the notifications as seen).
 */
export function NotificationBell({
  items,
  count,
  allPath,
  onOpen,
}: {
  items: NotificationItem[];
  count: number;
  allPath?: string;
  onOpen?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const openItems = items.filter((i) => i.state === 'open');
  const cleared = items.filter((i) => i.state === 'cleared');

  return (
    <div className="lb-bell" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="lb-bell__btn"
        aria-label={count > 0 ? t('common.notificationsCount', { count }) : t('common.notifications')}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen((o) => !o);
        }}
      >
        <UiIcon name="bell" />
        {count > 0 && <span className="lb-bell__count">{count}</span>}
      </button>
      {open && (
        <div id={panelId} role="dialog" aria-label={t('common.notifications')} className="lb-bell__panel">
          <div className="lb-bell__head">
            <strong>{count > 0 ? t('common.notificationsTitle', { count }) : t('common.notifications')}</strong>
            <button type="button" className="lb-icon-btn" onClick={() => setOpen(false)} aria-label={t('common.close')}>
              <UiIcon name="close" size={15} />
            </button>
          </div>
          {items.length === 0 && <p className="lb-bell__empty">{t('common.noNotifications')}</p>}
          {[...openItems, ...cleared].map((item) => {
            const body = (
              <>
                <span className={`lb-bell__dot lb-bell__dot--${item.state}`} aria-hidden="true" />
                <span className="lb-bell__text">
                  <span className="lb-bell__title">{item.title}</span>
                  {item.detail && <span className="lb-bell__detail">{item.detail}</span>}
                  {item.meta && <span className="lb-bell__meta">{item.meta}</span>}
                </span>
              </>
            );
            const cls = `lb-bell__item${item.state === 'cleared' ? ' is-cleared' : ''}`;
            return item.to ? (
              <Link key={item.id} to={item.to} className={cls} onClick={() => setOpen(false)}>
                {body}
              </Link>
            ) : (
              <div key={item.id} className={cls}>
                {body}
              </div>
            );
          })}
          {allPath && (
            <Link to={allPath} className="lb-bell__all" onClick={() => setOpen(false)}>
              {t('common.seeAllNotifications')}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
