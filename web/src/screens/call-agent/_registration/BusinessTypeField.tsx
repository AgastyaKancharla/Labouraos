import { useState } from 'react';
import { TextField } from '../../../components/fields';
import { useT } from '../../../i18n/I18nProvider';
import { BUSINESS_TYPE_GROUPS, businessTypeLabel, OTHER_BUSINESS_TYPE } from './businessTypes';

/**
 * Type of business (Master Guide rev 207–208, 22 Nov): the full list grouped
 * by sector (group headings), a search box over it, and — for "Other (type
 * it)" — a required box for the type in words. An older value on a draft
 * still shows by its name.
 */
export function BusinessTypeField({
  value,
  onChange,
  other,
  onOther,
  error,
  otherError,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  other: string;
  onOther: (value: string) => void;
  error?: string;
  otherError?: string;
  label: string;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const groups = BUSINESS_TYPE_GROUPS.map((g) => ({
    ...g,
    types: q ? g.types.filter((ty) => ty.label.toLowerCase().includes(q) || g.label.toLowerCase().includes(q) || ty.value === value) : g.types,
  })).filter((g) => g.types.length);
  const known = BUSINESS_TYPE_GROUPS.some((g) => g.types.some((ty) => ty.value === value));
  const id = 'business-type-select';
  return (
    <>
      <div className="fld">
        <label className="reg-label" htmlFor={id}>
          {label}
          <span className="req"> *</span>
        </label>
        <input
          type="search"
          className="reg-type-search"
          aria-label={t('reg.btype.search')}
          placeholder={t('reg.btype.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} required>
          <option value="">{t('form.select.placeholder')}</option>
          {value && !known ? <option value={value}>{businessTypeLabel(value)}</option> : null}
          {groups.map((g) => (
            <optgroup key={g.key} label={g.label}>
              {g.types.map((ty) => (
                <option key={ty.value} value={ty.value}>
                  {ty.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {error ? (
          <span className="vno" role="alert">
            {error}
          </span>
        ) : null}
      </div>
      {value === OTHER_BUSINESS_TYPE ? (
        <TextField label={t('reg.btype.otherLabel')} required value={other} onChange={onOther} maxLength={80} error={otherError} />
      ) : null}
    </>
  );
}
