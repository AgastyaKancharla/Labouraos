import { ErrorState } from '../../../components/ErrorState';
import { SkeletonCard } from '../../../components/Skeleton';
import { TopBar } from '../../../components/TopBar';
import { useT } from '../../../i18n/I18nProvider';
import { formatMonthIST } from '../../../lib/format/date';
import { useTargets, type MetricView } from '../_lib/api';

/**
 * My targets — design CA11-Targets. Worked out from real records; nothing is
 * typed here. Falling behind pace is flagged to the Team Lead. The
 * leaderboard ranks placements closed and never shows anyone's target.
 */
export default function MyTargets() {
  const t = useT();
  const q = useTargets();
  const d = q.data;
  const month = d ? formatMonthIST(new Date(Date.UTC(d.year, d.month - 1, 15))) : '';
  return (
    <div className="lb-page lb-ca">
      <TopBar title={d ? t('ca.tg.title', { month }) : t('screen.CA11-Targets')} />
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {!d && !q.error && <SkeletonCard height={260} />}
      {d && (
        <>
          <div className="grid3">
            <MetricCard label={t('ca.tg.activated')} note={t('ca.tg.activatedNote')} m={d.candidatesActivated} />
            <MetricCard label={t('ca.tg.vacancies')} note={t('ca.tg.vacanciesNote')} m={d.vacanciesCaptured} />
            <MetricCard label={t('ca.tg.refundRate')} note={t('ca.tg.refundNote')} m={d.refundRate} rate />
          </div>
          <div className="card">
            <h2 className="h2" style={{ marginBottom: 6 }}>{t('ca.tg.board')}</h2>
            {d.leaderboard.length === 0 && <p className="sub">{t('ca.tg.boardEmpty')}</p>}
            {d.leaderboard.map((row) => (
              <div className="row" key={row.staffCode}>
                <span>
                  {row.position}. {row.name} {row.isMe && <span className="sub">{t('ca.tg.you')}</span>}
                </span>
                <b>{row.placementsClosed}</b>
              </div>
            ))}
            <p className="sub" style={{ marginTop: 8 }}>{t('ca.tg.boardNote')}</p>
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, note, m, rate }: { label: string; note: string; m: MetricView; rate?: boolean }) {
  const t = useT();
  const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
  const value = rate ? pct(m.achieved) : m.achieved ?? '—';
  const target = m.target === null ? null : rate ? t('ca.tg.targetUnder', { value: Math.round(m.target * 100) }) : `/ ${m.target}`;
  let tag: { text: string; tone: string };
  if (m.target === null) tag = { text: t('ca.tg.noTarget'), tone: 'tn' };
  else if (rate) tag = m.breached ? { text: t('ca.tg.over'), tone: 'tr' } : { text: t('ca.tg.good'), tone: 'tg' };
  else tag = m.behindPace ? { text: t('ca.tg.behind'), tone: 'tr' } : { text: t('ca.tg.onPace'), tone: 'tg' };
  const fill = !rate && m.target ? Math.min(100, Math.round(((m.achieved ?? 0) / m.target) * 100)) : null;
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="lbl">{label}</span>
      <b style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--ink)' }}>
        {value} {target && <span className="sub" style={{ fontSize: 14 }}>{target}</span>}
      </b>
      {fill !== null && (
        <div className="bar" aria-hidden="true">
          <i style={{ width: `${fill}%`, background: m.behindPace ? 'var(--tomato)' : 'var(--green)' }} />
        </div>
      )}
      <div>
        <span className={`tag ${tag.tone}`}>{tag.text}</span>{' '}
        <span className="sub">
          {!rate && m.behindPace && m.expectedPace !== null ? t('ca.tg.behindNote', { value: Math.round(m.expectedPace) }) : note}
        </span>
      </div>
    </div>
  );
}
