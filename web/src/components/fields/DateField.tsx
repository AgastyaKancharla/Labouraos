import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { addDaysToKey, ageOn, istDateKey } from '../../lib/format/date';
import { dobTextProblem, dobTextToKey, keyToDobText, maskDobDigits } from '../../lib/format/dobTyping';
import { useNow } from '../../lib/useNow';
import { FieldShell } from './Field';

/**
 * A calendar picker. Value is an IST calendar day 'yyyy-mm-dd' (or '').
 *
 * mode="dob" (Master Guide rev 204, 21 Nov): the date of birth is typed as
 * numbers with the dashes added automatically (DD-MM-YYYY, numeric keyboard),
 * checked to be a real day, with the calendar kept beside it as an option.
 * The latest pickable day is exactly 18 years ago, and an under-18 value
 * shows the same error as before. The value saved is unchanged (ISO day).
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

export function DateField(props: DateFieldProps) {
  if (props.mode === 'dob') return <DobField {...props} />;
  return <CalendarDateField {...props} />;
}

function CalendarDateField({ label, value, onChange, min, max, mode = 'date', hint, error, required, disabled, name }: DateFieldProps) {
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

/** The day a typed text stands for when it is usable ('' while incomplete, not a real day or in the future). */
function usableKey(text: string, todayKey: string): string {
  return dobTextProblem(text, todayKey) === null ? dobTextToKey(text) ?? '' : '';
}

/** Date of birth: typed DD-MM-YYYY with automatic dashes, plus the calendar as an option. */
function DobField({ label, value, onChange, min, hint, error, required, disabled, name }: DateFieldProps) {
  const t = useT();
  const today = istDateKey(useNow());
  const dobMax = eighteenYearsAgo(today);
  const [text, setText] = useState(() => keyToDobText(value));
  const [touched, setTouched] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  // A value set from outside (the calendar, a restored draft, Discard) shows as typed text.
  useEffect(() => {
    const current = usableKey(text, today);
    if (value !== current) setText(keyToDobText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the value changes
  }, [value]);

  const problem = dobTextProblem(text, today);
  const showProblem = problem !== null && (problem !== 'incomplete' || touched);
  const underage = value !== '' && ageOn(value, today) < 18;
  const typedError = showProblem
    ? t(problem === 'future' ? 'form.dob.future' : problem === 'incomplete' ? 'form.dob.incomplete' : 'form.dob.notADate')
    : undefined;

  const typed = (raw: string) => {
    const next = maskDobDigits(raw);
    setText(next);
    const key = usableKey(next, today);
    if (key !== value) onChange(key);
  };

  return (
    <FieldShell label={label} hint={hint ?? t('form.dob.hint')} error={error ?? typedError ?? (underage ? t('form.date.underage') : undefined)} required={required}>
      {({ inputId, describedBy, invalid }) => (
        <>
          <div className="lb-dob">
            <input
              id={inputId}
              name={name}
              type="text"
              inputMode="numeric"
              autoComplete="bday"
              placeholder={t('form.dob.placeholder')}
              maxLength={10}
              value={text}
              onChange={(e) => typed(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              required={required}
              disabled={disabled}
            />
            <button
              type="button"
              className="btn bs lb-dob__calendar"
              aria-label={t('form.dob.calendar')}
              aria-expanded={calendarOpen}
              onClick={() => setCalendarOpen((open) => !open)}
              disabled={disabled}
            >
              <span aria-hidden="true">📅</span>
            </button>
          </div>
          {calendarOpen && (
            <input
              type="date"
              className="lb-dob__picker"
              aria-label={t('form.dob.calendarPick')}
              value={value}
              min={min ?? '1940-01-01'}
              max={dobMax}
              onChange={(e) => {
                const key = e.target.value;
                setText(keyToDobText(key));
                if (key !== value) onChange(key);
                if (key) setCalendarOpen(false);
              }}
              disabled={disabled}
            />
          )}
        </>
      )}
    </FieldShell>
  );
}
