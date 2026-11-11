import { Link } from 'react-router-dom';
import { useT } from '../../../i18n/I18nProvider';
import { useNow } from '../../../lib/useNow';
import { useScreenPath } from '../../../portals/PortalContext';
import type { WorkItem } from './api';
import { lockedLabel, personRef, reasonTag } from './format';

/** One row of "My work today" (CA03): name, trade · masked phone, the reason tag. */
export function PersonRow({ item, callingHours }: { item: WorkItem; callingHours?: { start: string; end: string } }) {
  const t = useT();
  const now = useNow(60_000);
  const to = useScreenPath();
  const tag = reasonTag(item, t, now);
  const locked = lockedLabel(item, t, now, callingHours);
  const target =
    item.kind === 'follow_up' || item.kind === 'refund_check'
      ? to('CA04-Profile', { id: personRef(item) }) + `?followUp=${encodeURIComponent(String(item.detail.followUpTaskId ?? ''))}`
      : to('CA04-Profile', { id: personRef(item) });
  return (
    <Link className="qc" to={target} data-testid="work-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="nm">{item.name}</div>
        <div className="sub">
          {[item.trade, item.maskedPhone].filter(Boolean).join(' · ')}
          {locked && <span className="lb-ca-locked"> · {locked}</span>}
        </div>
      </div>
      <span className={`tag ${tag.tone}`}>{tag.text}</span>
    </Link>
  );
}
