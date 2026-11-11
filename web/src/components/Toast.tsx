import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n/I18nProvider';

/**
 * The navy message box at the bottom right from the designs
 * ("Approved. The person and their Team Lead got an SMS…").
 * `const toast = useToast(); toast.show('Saved')` — or toast.error(...) for
 * failures, which stays until closed and is announced assertively.
 */
type ToastKind = 'info' | 'success' | 'error';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: ReactNode;
}
interface ToastApi {
  show: (message: ReactNode) => void;
  success: (message: ReactNode) => void;
  error: (message: ReactNode) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const AUTO_DISMISS_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const t = useT();

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((i) => i.id !== id)), []);
  const push = useCallback(
    (kind: ToastKind, message: ReactNode) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-2), { id, kind, message }]);
      if (kind !== 'error') setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({
      show: (m) => push('info', m),
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="lb-toasts" role="status" aria-live="polite">
        {items
          .filter((i) => i.kind !== 'error')
          .map((item) => (
            <div key={item.id} className={`lb-toast lb-toast--${item.kind}`}>
              <span>{item.message}</span>
              <button type="button" onClick={() => dismiss(item.id)} aria-label={t('common.close')}>
                ×
              </button>
            </div>
          ))}
      </div>
      <div className="lb-toasts lb-toasts--errors" aria-live="assertive">
        {items
          .filter((i) => i.kind === 'error')
          .map((item) => (
            <div key={item.id} className="lb-toast lb-toast--error">
              <span>{item.message}</span>
              <button type="button" onClick={() => dismiss(item.id)} aria-label={t('common.close')}>
                ×
              </button>
            </div>
          ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>');
  return value;
}
