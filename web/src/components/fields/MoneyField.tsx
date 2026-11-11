import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { groupIndian, paiseToRupeesInput, parseRupeesToPaise } from '../../lib/format/money';
import { FieldShell } from './Field';

/**
 * Money box: ₹ fixed in front, numbers only, Indian commas added while
 * typing (4,12,600), up to two paise digits. The value is integer paise —
 * the component never hands a float to the screen (AGENTS.md §2 rule 1).
 * Pass `period` + `onPeriodChange` for the separate per month / per day
 * choice the guide asks for on salaries.
 */
export type PayPeriod = 'month' | 'day';

export interface MoneyFieldProps {
  label: ReactNode;
  /** Integer paise, or null when empty. */
  value: number | null;
  onChange: (paise: number | null) => void;
  period?: PayPeriod;
  onPeriodChange?: (period: PayPeriod) => void;
  /** Smallest/largest allowed amount in paise (checked on blur). */
  minPaise?: number;
  maxPaise?: number;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
}

/** Re-formats what was typed: keeps digits and one dot, groups the rupees. */
export function formatMoneyTyping(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  const rupees = whole.replace(/^0+(?=\d)/, '');
  const grouped = rupees ? groupIndian(rupees) : rest.length ? '0' : '';
  if (rest.length === 0) return grouped;
  return `${grouped}.${rest.join('').slice(0, 2)}`;
}

export function MoneyField({
  label,
  value,
  onChange,
  period,
  onPeriodChange,
  minPaise,
  maxPaise,
  hint,
  error,
  required,
  disabled,
}: MoneyFieldProps) {
  const t = useT();
  const [text, setText] = useState(() => (value === null ? '' : paiseToRupeesInput(value)));
  const [touched, setTouched] = useState(false);

  // Follow outside changes (e.g. a draft loaded later) without fighting typing.
  useEffect(() => {
    const current = parseRupeesToPaise(text);
    if (value !== current) setText(value === null ? '' : paiseToRupeesInput(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the value prop
  }, [value]);

  const parsed = text === '' ? null : parseRupeesToPaise(text);
  const outOfRange =
    parsed !== null && ((minPaise !== undefined && parsed < minPaise) || (maxPaise !== undefined && parsed > maxPaise));
  const showInvalid = touched && ((text !== '' && parsed === null) || outOfRange);

  return (
    <FieldShell label={label} hint={hint} error={error ?? (showInvalid ? t('form.money.invalid') : undefined)} required={required}>
      {({ inputId, describedBy, invalid }) => (
        <div className="inrow">
          <div className="lb-prefixed">
            <span className="lb-prefixed__prefix" aria-hidden="true">
              ₹
            </span>
            <input
              id={inputId}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={text}
              onChange={(e) => {
                const next = formatMoneyTyping(e.target.value);
                setText(next);
                onChange(next === '' ? null : parseRupeesToPaise(next));
              }}
              onBlur={() => setTouched(true)}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              required={required}
              disabled={disabled}
            />
          </div>
          {period && onPeriodChange && (
            <select
              className="lb-money-period"
              value={period}
              onChange={(e) => onPeriodChange(e.target.value as PayPeriod)}
              aria-label={t('form.money.period')}
              disabled={disabled}
            >
              <option value="month">{t('form.money.perMonth')}</option>
              <option value="day">{t('form.money.perDay')}</option>
            </select>
          )}
        </div>
      )}
    </FieldShell>
  );
}
