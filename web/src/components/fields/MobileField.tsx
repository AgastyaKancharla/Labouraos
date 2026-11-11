import { useState, type ReactNode } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { cleanMobileInput, isValidMobile } from '../../lib/format/phone';
import { FieldShell } from './Field';

/**
 * Mobile number with +91 fixed in front and exactly 10 digits (guide, Forms).
 * Pasting "+91 98765 43210" or "098765…" is cleaned to the 10 digits.
 * `onChange` always receives digits only.
 */
export interface MobileFieldProps {
  label?: ReactNode;
  value: string;
  onChange: (digits: string) => void;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  /** Content to the right of the input, e.g. the Send OTP button. */
  action?: ReactNode;
  labelAside?: ReactNode;
  name?: string;
}

export function MobileField({ label, value, onChange, hint, error, required, disabled, action, labelAside, name }: MobileFieldProps) {
  const t = useT();
  const [touched, setTouched] = useState(false);
  const showInvalid = touched && value.length > 0 && !isValidMobile(value);
  return (
    <FieldShell
      label={label ?? t('form.mobile.label')}
      hint={hint}
      error={error ?? (showInvalid ? t('form.mobile.invalid') : undefined)}
      required={required}
      labelAside={labelAside}
    >
      {({ inputId, describedBy, invalid }) => (
        <div className="inrow">
          <div className="lb-prefixed">
            <span className="lb-prefixed__prefix" aria-hidden="true">
              +91
            </span>
            <input
              id={inputId}
              name={name}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              pattern="[6-9][0-9]{9}"
              maxLength={14}
              value={value}
              onChange={(e) => onChange(cleanMobileInput(e.target.value))}
              onBlur={() => setTouched(true)}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              required={required}
              disabled={disabled}
            />
          </div>
          {action}
        </div>
      )}
    </FieldShell>
  );
}
