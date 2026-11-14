import type { Prisma } from '@prisma/client';

/**
 * Owner accounts (owner decision 14 Nov, Master Guide).
 *
 * In the first days the two owners each have a CEO account and also a
 * separate agent account (one a call agent, one a field agent). The CEO marks
 * such an agent account as an owner account. Everything it registers or does
 * (job seekers, businesses, vacancies, visits, calls, placements) goes into
 * the normal lists and reports under its name, exactly like any agent. It is
 * LEFT OUT of:
 *   - targets (team and agent targets and progress),
 *   - the leaderboards,
 *   - attendance (no day, late, absent or leave tracking, no attendance bells,
 *     not in attendance reports),
 *   - salary / payroll runs and incentives.
 * It signs in like any agent (device approval, login code from a senior).
 *
 * Every place that picks staff for one of those uses the helpers below, so
 * the rule lives in one file.
 */

/** Only these roles can be owner accounts. */
export const OWNER_ACCOUNT_ROLES: readonly string[] = ['call_agent', 'field_agent'];

/** Shown next to the switch on the CEO's staff screens. */
export const OWNER_ACCOUNT_EXPLANATION =
  'Owner account: their work counts in the lists, but not in targets, leaderboard, attendance or salary';

/** Prisma where-fragment for Staff: leaves owner accounts out. Spread it into a Staff where. */
export const NOT_OWNER_ACCOUNT = { isOwnerAccount: false } as const satisfies Prisma.StaffWhereInput;

/** Adds the owner-account exclusion to a Staff where clause. */
export function withoutOwnerAccounts<T extends Prisma.StaffWhereInput>(where: T): T & typeof NOT_OWNER_ACCOUNT {
  return { ...where, ...NOT_OWNER_ACCOUNT };
}

/** For relation filters on other tables: `{ staff: staffNotOwnerAccount }`. */
export const staffNotOwnerAccount: Prisma.StaffWhereInput = NOT_OWNER_ACCOUNT;

/** True when the row is an owner account. Rows loaded without the column count as normal staff. */
export function isOwnerAccount(staff: { isOwnerAccount?: boolean | null } | null | undefined): boolean {
  return Boolean(staff?.isOwnerAccount);
}

/** Message used when an attendance, leave or target action is refused for an owner account. */
export const OWNER_ACCOUNT_NO_ATTENDANCE = 'Owner accounts have no attendance, leave or salary';
export const OWNER_ACCOUNT_NO_TARGETS = 'Owner accounts have no targets';
