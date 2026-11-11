import '../_lib/console.css';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import type { MessageKey } from '../../../i18n/en';
import { isSearchable, resultPath, useSearch, type SearchRow, type SearchType } from '../../../lib/search/searchApi';
import { usePortal } from '../../../portals/PortalContext';
import { screenPath } from '../../../portals';

/**
 * Search — design CA16-Search, used by every staff portal. Finds anyone by
 * name, mobile (full or last 4 digits) or ID (JS-, BZ-, RF-, VC-, PL-),
 * scoped by the server to what the role may see. Phone numbers stay masked.
 * No result offers to register the person (in the call agent console).
 */
const TABS: Array<'all' | SearchType> = ['all', 'job_seeker', 'business', 'referral', 'vacancy', 'placement'];

export default function Search() {
  const t = useT();
  const portal = usePortal();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const tab = (params.get('type') as SearchType | null) ?? null;
  const search = useSearch(q, tab);
  const counts = search.data?.counts;
  const can = (id: string) => portal.screens.some((s) => s.id === id);
  const register = [
    can('CA08-Register') && { id: 'CA08-Register', label: 'ca.search.registerSeeker' as MessageKey },
    can('CA13-BusinessLead') && { id: 'CA13-BusinessLead', label: 'ca.search.registerBusiness' as MessageKey },
    can('CA15-RegisterReferral') && { id: 'CA15-RegisterReferral', label: 'ca.search.registerReferral' as MessageKey },
  ].filter(Boolean) as Array<{ id: string; label: MessageKey }>;

  const setTab = (next: 'all' | SearchType) => {
    const p = new URLSearchParams(params);
    if (next === 'all') p.delete('type');
    else p.set('type', next);
    setParams(p, { replace: true });
  };

  return (
    <div className="lb-page lb-ca">
      <TopBar title={q ? t('ca.search.titleFor', { q }) : t('screen.CA16-Search')} />
      {!isSearchable(q) && <EmptyState title={t('ca.search.typeMore')}>{t('ca.search.help')}</EmptyState>}
      {search.error && <ErrorState error={search.error} onRetry={() => void search.refetch()} />}
      {isSearchable(q) && search.isLoading && <SkeletonCard height={220} />}
      {search.data && counts && (
        <>
          <div role="tablist" aria-label={t('ca.search.tabs')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TABS.filter((k) => k === 'all' || k === 'job_seeker' || k === 'business' || k === 'referral' || counts[k] > 0).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={(tab ?? 'all') === k}
                className={`tag ${(tab ?? 'all') === k ? 'tb' : 'tn'} lb-ca-chip`}
                onClick={() => setTab(k)}
              >
                {t(`ca.search.tab.${k}` as MessageKey, { count: counts[k] })}
              </button>
            ))}
          </div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {search.data.results.length === 0 && <p className="sub">{t('ca.search.none', { q })}</p>}
            {search.data.results.map((row) => (
              <ResultRow key={`${row.type}-${row.id}`} row={row} to={resultPath(portal, row)} />
            ))}
          </div>
          {register.length > 0 && (
            <div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="sub">{search.data.results.length ? t('ca.search.notRight') : t('ca.search.register')}</span>
              {register.map((r) => (
                <Link key={r.id} className="btn bs lb-btn" style={{ minHeight: 36, padding: '6px 12px' }} to={screenPath(portal, r.id)}>
                  {t(r.label)}
                </Link>
              ))}
            </div>
          )}
          <p className="sub">{t('ca.search.help')}</p>
        </>
      )}
    </div>
  );
}

function ResultRow({ row, to }: { row: SearchRow; to: string | null }) {
  const t = useT();
  const sub = [t(`ca.search.type.${row.type}` as MessageKey), row.code, row.maskedPhone, row.trade, row.locality].filter(Boolean).join(' · ');
  let tag = row.status ?? '';
  if (row.type === 'business') tag = [row.status, t('ca.search.openVacancies', { count: Number(row.extra.openVacancies ?? 0) })].filter(Boolean).join(' · ');
  if (row.type === 'referral') tag = t('ca.ref.referred', { referred: Number(row.extra.referred ?? 0), joined: Number(row.extra.joined ?? 0) });
  const body = (
    <>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="nm">{row.name}</div>
        <div className="sub">{sub}</div>
      </div>
      {tag && <span className="tag tn">{tag.replace(/_/g, ' ')}</span>}
    </>
  );
  return to ? (
    <Link className="qc" to={to}>
      {body}
    </Link>
  ) : (
    <div className="qc">{body}</div>
  );
}
