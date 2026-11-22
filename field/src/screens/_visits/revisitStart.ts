import { routes } from '@/navigation/routes';

/**
 * Opening a revisit (22 Nov): the visit still starts at step 1 (a fresh board
 * photo and GPS, the anti-fake rule), with the shop name filled in and the
 * last visit's note shown at the top so the agent knows the history.
 */
export function revisitStart(r: { businessId: string | null; visitId: string | null; name: string; note?: string | null; lastVisitAt?: string | null }) {
  return {
    pathname: routes.visitStart,
    params: {
      ...(r.businessId ? { businessId: r.businessId } : { revisitOf: r.visitId ?? '' }),
      name: r.name,
      ...(r.note ? { lastNote: r.note } : {}),
      ...(r.lastVisitAt ? { lastAt: r.lastVisitAt } : {}),
    },
  };
}
