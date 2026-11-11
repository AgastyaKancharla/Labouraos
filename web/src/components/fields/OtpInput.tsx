import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useT } from '../../i18n/I18nProvider';

/**
 * Six separate digit boxes (the designs' `.otp`). Typing moves forward,
 * Backspace moves back, arrows move between boxes, and pasting a whole code
 * fills every box. `value` is the digits typed so far.
 */
export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  /** Accessible name of the group ("Login code", "OTP code"). */
  label: string;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onComplete?: (code: string) => void;
}

export function OtpInput({ value, onChange, length = 6, label, autoFocus, disabled, invalid, describedBy, onComplete }: OtpInputProps) {
  const t = useT();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const setAt = (index: number, digit: string) => {
    const next = (value.slice(0, index) + digit + value.slice(index + 1)).replace(/\D/g, '').slice(0, length);
    onChange(next);
    if (next.length === length) onComplete?.(next);
  };
  const focus = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();

  const onKeyDown = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[i]) {
        onChange(value.slice(0, i) + value.slice(i + 1));
      } else if (i > 0) {
        onChange(value.slice(0, i - 1) + value.slice(i));
        focus(i - 1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focus(i + 1);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    e.preventDefault();
    onChange(pasted);
    focus(pasted.length);
    if (pasted.length === length) onComplete?.(pasted);
  };

  return (
    <div className="otp lb-otp" role="group" aria-label={label} aria-describedby={describedBy}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          pattern="[0-9]"
          maxLength={1}
          value={d}
          // Only the first empty box (or the last) autofocuses.
          autoFocus={autoFocus && i === Math.min(value.length, length - 1)}
          disabled={disabled}
          aria-label={t('form.otp.digit', { n: i + 1, total: length })}
          aria-invalid={invalid || undefined}
          onKeyDown={onKeyDown(i)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, '');
            if (!typed) return;
            if (typed.length > 1) {
              // Some keyboards insert the whole SMS code into one box.
              const merged = (value.slice(0, i) + typed).slice(0, length);
              onChange(merged);
              focus(merged.length);
              if (merged.length === length) onComplete?.(merged);
              return;
            }
            setAt(i, typed);
            focus(i + 1);
          }}
        />
      ))}
    </div>
  );
}
