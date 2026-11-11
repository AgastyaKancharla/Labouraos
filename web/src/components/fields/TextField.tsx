import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { FieldShell } from './Field';

type NativeInput = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'onChange' | 'value'>;

export interface TextFieldProps extends NativeInput {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: ReactNode;
}

/** A plain text input (names, notes, UPI ids…). Never use it for dates, money or phone numbers. */
export function TextField({ label, value, onChange, hint, error, required, ...rest }: TextFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      {({ inputId, describedBy, invalid }) => (
        <input
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface SelectFieldProps<V extends string> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'onChange' | 'value'> {
  label: ReactNode;
  value: V | '';
  onChange: (value: V | '') => void;
  options: readonly SelectOption<V>[];
  /** Text of the empty first option; pass null to have no empty option. */
  placeholder?: string | null;
  hint?: ReactNode;
  error?: ReactNode;
}

/** A dropdown. Use it for every fixed list (trades, areas, reasons) — no free text. */
export function SelectField<V extends string>({
  label,
  value,
  onChange,
  options,
  placeholder,
  hint,
  error,
  required,
  ...rest
}: SelectFieldProps<V>) {
  const t = useT();
  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      {({ inputId, describedBy, invalid }) => (
        <select
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value as V | '')}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          {...rest}
        >
          {placeholder !== null && <option value="">{placeholder ?? t('form.select.placeholder')}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}
