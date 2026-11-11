import { useId } from 'react';
import { useT } from '../i18n/I18nProvider';
import { customPeriod, periodFor, periodRangeLabel, type Period, type PeriodPreset } from '../lib/period';
import { useNow } from '../lib/useNow';

/**
 * Today / This week / This month / Custom with a from–to range, as on every
 * portal screen (C-Payments, MG-Home…). Dates are IST calendar days; turn the
 * value into API parameters with periodToUtcRange().
 */
const PRESETS: Exclude<PeriodPreset, 'custom'>[] = ['today', 'week', 'month'];

export function PeriodPicker({ value, onChange, showLabel = true }: {
  value: Period;
  onChange: (period: Period) => void;
  showLabel?: boolean;
}) {
  const t = useT();
  const now = useNow();
  const id = useId();
  const labelKey = { today: 'period.today', week: 'period.week', month: 'period.month', custom: 'period.custom' } as const;

  return (
    <div className="lb-period" role="group" aria-label={t('period.label')}>
      <div className="tabs">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={value.preset === p ? 'tab on' : 'tab'}
            aria-pressed={value.preset === p}
            onClick={() => onChange(periodFor(p, now))}
          >
            {t(labelKey[p])}
          </button>
        ))}
        <button
          type="button"
          className={value.preset === 'custom' ? 'tab on' : 'tab'}
          aria-pressed={value.preset === 'custom'}
          onClick={() => onChange(customPeriod(value.from, value.to))}
        >
          {t('period.custom')}
        </button>
      </div>
      <div className="field lb-period__range">
        <label htmlFor={`${id}-from`}>{t('period.from')}</label>
        <input
          id={`${id}-from`}
          type="date"
          value={value.from}
          max={value.to}
          onChange={(e) => e.target.value && onChange(customPeriod(e.target.value, value.to))}
        />
        <label htmlFor={`${id}-to`}>{t('period.to')}</label>
        <input
          id={`${id}-to`}
          type="date"
          value={value.to}
          min={value.from}
          onChange={(e) => e.target.value && onChange(customPeriod(value.from, e.target.value))}
        />
      </div>
      {showLabel && (
        <span className="lb-period__label" aria-live="polite">
          {t('period.showing', { label: periodRangeLabel(value) })}
        </span>
      )}
    </div>
  );
}
