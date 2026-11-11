import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../i18n/I18nProvider';
import { usePortal } from '../portals/PortalContext';
import { UiIcon } from './Icon';

/**
 * The search bar on every staff screen (guide: find anyone by name, mobile —
 * full or last 4 — or ID JS-/BZ-/RF-/VC-/PL-). Submitting opens the portal's
 * search screen with ?q=.
 */
export function SearchBox({ initial = '' }: { initial?: string }) {
  const t = useT();
  const id = useId();
  const portal = usePortal();
  const navigate = useNavigate();
  const [q, setQ] = useState(initial);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    navigate(`${portal.root}/search?q=${encodeURIComponent(query)}`);
  };
  return (
    <form role="search" className="lb-search" onSubmit={onSubmit}>
      <label htmlFor={id} className="sr-only">
        {t('search.label')}
      </label>
      <UiIcon name="search" size={16} />
      <input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search.placeholder')} enterKeyHint="search" />
    </form>
  );
}
