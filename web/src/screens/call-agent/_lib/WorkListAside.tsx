import { useState } from 'react';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { useHome, type WorkCategory } from './api';
import { PersonRow } from './PersonRow';

const FILTERS: Array<{ key: 'all' | Exclude<WorkCategory, 'priority'>; label: MessageKey }> = [
  { key: 'all', label: 'ca.filter.all' },
  { key: 'callbacks', label: 'ca.filter.callbacks' },
  { key: 'follow_ups', label: 'ca.filter.followUps' },
  { key: 'offers', label: 'ca.filter.offers' },
  { key: 'new_leads', label: 'ca.filter.newLeads' },
];

/** "My work today" beside a profile or call (CA04, CA05 designs). Hidden on phones. */
export function WorkListAside({ currentId }: { currentId?: string }) {
  const t = useT();
  const home = useHome();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const data = home.data;
  if (!data) return <aside className="lb-ca-aside" aria-hidden="true" />;
  const items = data.work.items.filter((i) => filter === 'all' || i.category === filter).slice(0, 12);
  return (
    <aside className="lb-ca-aside" aria-labelledby="ca-aside-work">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 className="h2" id="ca-aside-work">{t('ca.work.title')}</h2>
        <span className="tag lb-ca-todo">{t('ca.work.toDo', { count: data.work.counts.all })}</span>
      </div>
      <div role="group" aria-label={t('ca.work.filters')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`tag ${filter === f.key ? 'tb' : 'tn'} lb-ca-chip`}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {t(f.label, { count: data.work.counts[f.key] })}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <div key={item.key} className={item.subjectId === currentId ? 'lb-ca-current' : undefined}>
          <PersonRow item={item} callingHours={data.callingHours} />
        </div>
      ))}
      {items.length === 0 && <p className="sub">{t('ca.work.emptyFilter')}</p>}
    </aside>
  );
}
