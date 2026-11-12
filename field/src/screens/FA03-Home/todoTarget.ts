import { routes, sellingRoutes } from '@/navigation/routes';
import type { HomeTodo } from '@/api/endpoints';

/**
 * Where a check-in or follow-up row opens: a day-7 / day-30 check-in opens the
 * placement (FA15q); a follow-up on a "not selected" interview opens that
 * interview (FA16); a business follow-up (repeat business) opens the business
 * (FA08); anything else about a job seeker opens their profile panel (FA10c).
 */
export function checkInTarget(todo: Extract<HomeTodo, { kind: 'check_in' }>): string | null {
  if (todo.relatedType === 'placement' && todo.relatedId) return sellingRoutes.paid(todo.relatedId);
  if (todo.relatedType === 'interview' && todo.relatedId) return sellingRoutes.interviewDay(todo.relatedId);
  if (todo.subjectType === 'business') return `${routes.business}/${todo.subjectId}`;
  if (todo.subjectType === 'job_seeker') return sellingRoutes.seekerProgress(todo.subjectId);
  return null;
}
