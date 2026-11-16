import type { NeedsItem } from '@/api/endpoints';
import { pageRoutes, routes, sellingRoutes, sellingRoutesFor } from '@/navigation/routes';

/** Steps of a visit, inside the Visits tab. */
const visitFlow = sellingRoutesFor('/visit');

type Href = string | { pathname: string; params: Record<string, string> };

/**
 * Where a Needs-you-now item opens: the exact step of its job, in the tab the
 * job lives in (redesign, 16 Nov). Visits, agreements and interviews to attend
 * open in Visits; vacancies, candidates and joinings in Businesses.
 */
export function needsTarget(item: NeedsItem): Href | null {
  const tg = item.target;
  switch (item.kind) {
    case 'interview_today':
      return visitFlow.interviewDay(tg.id);
    case 'visit_unfinished':
      switch (tg.step) {
        case 'continue_business_form':
          return { pathname: routes.visitBusiness, params: { visitId: tg.id } };
        case 'take_selfie':
          return { pathname: routes.visitProof, params: { id: tg.id } };
        case 'record_result':
          return { pathname: routes.visitTalk, params: { id: tg.id } };
        default:
          // mark_onboarded, verify: the visit details page offers the step.
          return pageRoutes.visitDetails(tg.id, '/visit');
      }
    case 'agreement_waiting':
      return { pathname: routes.visitAgreement, params: { businessId: tg.id } };
    case 'vacancy_awaiting_owner':
    case 'vacancy_draft':
      return sellingRoutes.confirmVacancy(tg.id);
    case 'ready_show_candidates':
      return sellingRoutes.matches(tg.id, tg.vacancyId ?? undefined);
    case 'joining_due':
      return sellingRoutes.joining(tg.id);
    case 'revisit_due':
      return {
        pathname: routes.visitStart,
        params: tg.businessId ? { businessId: tg.businessId, name: item.title } : { revisitOf: tg.id, name: item.title },
      };
    case 'followup_task':
      if (tg.relatedType === 'placement' && tg.relatedId) return sellingRoutes.paid(tg.relatedId);
      if (tg.relatedType === 'interview' && tg.relatedId) return sellingRoutes.interviewDay(tg.relatedId);
      if (tg.subjectType === 'business' && tg.subjectId) return pageRoutes.business(tg.subjectId);
      if (tg.subjectType === 'job_seeker' && tg.subjectId) return pageRoutes.seekerProgress(tg.subjectId);
      return null;
    default:
      return null;
  }
}
