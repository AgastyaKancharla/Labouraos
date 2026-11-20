/**
 * What the staff screens list as "Terms accepted" for a job seeker (17 Nov, rev 198): each acceptance
 * once — the same document, version, step and exact text accepted again (a second link, a retried
 * payment step) shows as one line, the latest, with how many times and since when. Every row stays in
 * the database (LegalAcceptance history is never deleted); only the answer is shorter.
 */
export interface AcceptanceRow {
  id: string;
  documentKey: string;
  version: string;
  context: string;
  textHash: string;
  acceptedAt: Date;
}

export function latestAcceptances<T extends AcceptanceRow>(rows: T[]): (T & { times: number; firstAcceptedAt: Date })[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = [row.documentKey, row.version, row.context, row.textHash].join('|');
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()]
    .map((list) => {
      const sorted = [...list].sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime());
      return { ...sorted[0]!, times: sorted.length, firstAcceptedAt: sorted[sorted.length - 1]!.acceptedAt };
    })
    .sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime());
}
