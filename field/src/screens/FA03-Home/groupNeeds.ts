import type { NeedsItem } from '@/api/endpoints';

/** One business (or shop, or person) on Today with everything waiting on it (22 Nov). */
export interface NeedsGroup {
  key: string;
  title: string;
  /** The registered business the group is about, when there is one: tapping the row opens it. */
  businessId: string | null;
  items: NeedsItem[];
  /** The most urgent due of its items. */
  due: NeedsItem['due'];
}

const DUE_RANK: Record<string, number> = { overdue: 0, today: 1, tomorrow: 2 };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The business an item is about: its own id for business items, else the business it belongs to. */
export function needsBusinessId(item: NeedsItem): string | null {
  const tg = item.target as NeedsItem['target'] & { subjectType?: string; subjectId?: string };
  if (item.kind === 'followup_task') return tg.subjectType === 'business' && tg.subjectId ? tg.subjectId : null;
  if (tg.type === 'business') return tg.id;
  return tg.businessId ?? null;
}

/**
 * Today (Master Guide rev 207, owner's field test 22 Nov): one row per
 * business with its open items under it — never "Andhra ruchilu" three times.
 * Items keep the server's order (most urgent first); a group sits where its
 * first item was. A shop not registered yet groups by its name. A
 * verification visit is its own job card and is never grouped.
 */
export function groupNeeds(items: NeedsItem[]): NeedsGroup[] {
  const groups: NeedsGroup[] = [];
  const byKey = new Map<string, NeedsGroup>();
  for (const item of items) {
    const businessId = needsBusinessId(item);
    const tg = item.target as NeedsItem['target'] & { subjectType?: string; subjectId?: string };
    const key =
      item.kind === 'verification_visit'
        ? `job:${item.id}`
        : businessId
          ? `b:${businessId}`
          : item.kind === 'followup_task' && tg.subjectId
            ? `${tg.subjectType ?? 'x'}:${tg.subjectId}`
            : `name:${norm(item.title)}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, title: item.title, businessId, items: [], due: null };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
    if (!group.businessId && businessId) group.businessId = businessId;
    if (item.due && (group.due === null || (DUE_RANK[item.due] ?? 9) < (DUE_RANK[group.due] ?? 9))) group.due = item.due;
  }
  return groups;
}
