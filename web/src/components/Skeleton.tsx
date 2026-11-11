import type { CSSProperties } from 'react';
import { useT } from '../i18n/I18nProvider';

/** A grey shimmering block while data loads. Purely visual (aria-hidden). */
export function Skeleton({ width = '100%', height = 14, radius = 6, style }: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return <span className="lb-skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius, ...style }} />;
}

/** Several text lines; the wrapper announces "Loading…" to screen readers once. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  const t = useT();
  return (
    <div className="lb-skeleton-text" role="status" aria-live="polite">
      <span className="sr-only">{t('common.loading')}</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}

/** A card-shaped placeholder of the given height. */
export function SkeletonCard({ height = 140 }: { height?: number }) {
  const t = useT();
  return (
    <div className="panel lb-skeleton-card" role="status" style={{ height }}>
      <span className="sr-only">{t('common.loading')}</span>
      <Skeleton width="40%" />
      <Skeleton width="55%" height={30} />
      <Skeleton width="80%" />
    </div>
  );
}
