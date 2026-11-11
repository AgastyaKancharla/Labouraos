import type { ReactNode } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { addDaysToKey, ageOn, istDateKey } from '../../lib/format/date';
import { useNow } from '../../lib/useNow';
import { FieldShell } from './Field';

/**
 * A calendar picker — dates are never typed as free text (guide, Forms).
 * Value is an IST calendar day 'yyyy-mm-dd' (or '').
 *
 * mode="dob": the latest pickable day is exactly 18 years ago, so nobody
 * under 18 can be chosen, and an under-18 value shows an error.
 */
export interface DateFieldProps {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  mode?: 'date' | 'dob';
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  name?: string;
}

export function eighteenYearsAgo(todayKey: string): string {
  const [y, m, d] = todayKey.split('-').map(Number);
  // 29 Feb birthdays: the 18th birthday falls on 1 Mar in a non-leap year.
  const candidate = `${y - 18}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const valid = istDateKey(new Date(`${candidate}T12:00:00+05:30`)) === candidate;
  return valid ? candidate : addDaysToKey(`${y - 18}-${String(m).padStart(2, '0')}-28`, 1);
}

export function DateField({ label, value, onChange, min, max, mode = 'date', hint, error, required, disabled, name }: DateFieldProps) {
  const t = useT();
  const today = istDateKey(useNow());
  const dobMax = mode === 'dob' ? eighteenYearsAgo(today) : undefined;
  const underage = mode === 'dob' && value !== '' && ageOn(value, today) < 18;
  return (
    <FieldShell label={label} hint={hint} error={error ?? (underage ? t('form.date.underage') : undefined)} required={required}>
      {({ inputId, describedBy, invalid }) => (
        <input
          id={inputId}
          name={name}
          type="date"
          value={value}
          min={min ?? (mode === 'dob' ? '1940-01-01' : undefined)}
          max={dobMax ?? max}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          disabled={disabled}
        />
      )}
    </FieldShell>
  );
}
