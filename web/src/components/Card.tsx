import type { ReactNode } from 'react';
import { useFamily } from './family';

export interface CardProps {
  title?: ReactNode;
  /** Small text or link on the right of the title row ("Most urgent first", "See all →"). */
  aside?: ReactNode;
  children: ReactNode;
  /** No inner padding — for tables that run edge to edge. */
  flush?: boolean;
  className?: string;
  as?: 'section' | 'div' | 'article';
  'aria-label'?: string;
}

/** `.panel` (portal) or `.card` (console) with an optional title row. */
export function Card({ title, aside, children, flush, className, as: Tag = 'section', ...rest }: CardProps) {
  const family = useFamily();
  const base = family === 'portal' ? 'panel lb-card' : 'card lb-card';
  const classes = [base, flush ? 'lb-card--flush' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <Tag className={classes} aria-label={rest['aria-label']}>
      {(title || aside) && (
        <div className="lb-card__head">
          {title && <h2 className="h2">{title}</h2>}
          {aside && <div className="lb-card__aside">{aside}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}
