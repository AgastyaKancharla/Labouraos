import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n/I18nProvider';
import { UiIcon } from './Icon';

/**
 * Accessible dialog: focus moves into it, Tab stays inside, Escape and the
 * backdrop close it, and focus returns to what opened it. On phones it
 * becomes a bottom sheet.
 */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Buttons row at the bottom. */
  footer?: ReactNode;
  /** Prevent closing by Escape/backdrop while something is saving. */
  dismissible?: boolean;
  width?: number;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, children, footer, dismissible = true, width = 480 }: ModalProps) {
  const t = useT();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        onCloseRef.current();
      }
      if (e.key === 'Tab' && node) {
        const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, dismissible]);

  if (!open) return null;
  return createPortal(
    <div className="lb-modal" onMouseDown={(e) => e.target === e.currentTarget && dismissible && onClose()}>
      <div
        ref={panel}
        className="lb-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ maxWidth: width }}
      >
        <div className="lb-modal__head">
          <h2 id={titleId} className="h2">
            {title}
          </h2>
          {dismissible && (
            <button type="button" className="lb-icon-btn" onClick={onClose} aria-label={t('common.close')}>
              <UiIcon name="close" />
            </button>
          )}
        </div>
        <div className="lb-modal__body">{children}</div>
        {footer && <div className="lb-modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
