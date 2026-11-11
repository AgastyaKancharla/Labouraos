import { useId, type ReactNode } from 'react';
import { useT } from '../../i18n/I18nProvider';

/**
 * Label + control + hint + error, wired for screen readers. Every form field
 * component in this folder renders through it, so they all look like the
 * designs' `.fld` (12 px bold label, 44 px control) and announce errors.
 */
export interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Rendered after the label on the same line (e.g. "Verified ✓"). */
  labelAside?: ReactNode;
  className?: string;
  children: (ids: { inputId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

export function FieldShell({ label, hint, error, required, labelAside, className, children }: FieldShellProps) {
  const t = useT();
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={['fld lb-field', error ? 'lb-field--invalid' : '', className ?? ''].join(' ')}>
      <div className="lb-field__labelrow">
        <label htmlFor={inputId}>
          {label}
          {required && (
            <span className="req" aria-hidden="true">
              {' '}
              *
            </span>
          )}
          {required && <span className="sr-only"> ({t('common.required')})</span>}
        </label>
        {labelAside}
      </div>
      {children({ inputId, describedBy, invalid: !!error })}
      {hint && (
        <span id={hintId} className="sub">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="vno" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
