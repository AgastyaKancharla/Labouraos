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
    case 'verification_visit':
      // 21 Nov: a verification visit (app sign-up or call-agent lead) opens its verification steps,
      // resuming a started visit; a revisit of it too (M2).
      return {
        pathname: routes.visitVerify,
        params: { businessId: tg.businessId ?? '', assignmentId: tg.assignmentId ?? tg.id, ...(tg.visitId ? { visitId: tg.visitId } : {}) },
      };
    case 'visit_unfinished':
      if (tg.step === 'verify' && tg.assignmentId && tg.businessId) {
        return { pathname: routes.visitVerify, params: { businessId: tg.businessId, assignmentId: tg.assignmentId, visitId: tg.id } };
      }
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
    case 'vacancies_to_fill':
      return pageRoutes.business(tg.id);
    case 'joining_due':
      return sellingRoutes.joining(tg.id);
    case 'revisit_due':
      return {
        pathname: routes.visitStart,
        params: tg.businessId ? { businessId: tg.businessId, name: item.title } : { revisitOf: tg.id, name: item.title },
      };
    case 'followup_task':
      // 21 Nov (M4): the follow-up screen: call, what they said, Done.
      return pageRoutes.followUp(tg.id);
    default:
      return null;
  }
}
