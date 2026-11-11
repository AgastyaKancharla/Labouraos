import { useState, type ReactNode } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { isValidPincode } from '../../lib/format/phone';
import { FieldShell } from './Field';

/**
 * 6-digit pincode. When it is complete, `onComplete` runs so the screen can
 * fill the city from it (guide: "the pincode fills the city"); show the
 * result with `resolvedLabel` (e.g. "Bengaluru").
 */
export interface PincodeFieldProps {
  label?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (pincode: string) => void;
  resolvedLabel?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
}

export function PincodeField({ label, value, onChange, onComplete, resolvedLabel, hint, error, required, disabled }: PincodeFieldProps) {
  const t = useT();
  const [touched, setTouched] = useState(false);
  const invalid = touched && value.length > 0 && !isValidPincode(value);
  return (
    <FieldShell
      label={label ?? t('form.pincode.label')}
      hint={hint}
      error={error ?? (invalid ? t('form.pincode.invalid') : undefined)}
      required={required}
      labelAside={resolvedLabel ? <span className="vok">{resolvedLabel}</span> : undefined}
    >
      {({ inputId, describedBy, invalid: isInvalid }) => (
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          value={value}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
            onChange(digits);
            if (digits.length === 6 && isValidPincode(digits)) onComplete?.(digits);
          }}
          onBlur={() => setTouched(true)}
          aria-describedby={describedBy}
          aria-invalid={isInvalid || undefined}
          required={required}
          disabled={disabled}
        />
      )}
    </FieldShell>
  );
}
