import { Injectable } from '@nestjs/common';
import { PricingPolicy, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { tradeNameKey } from '../trade/trade.service';
import { DAILY_JOB_PATTERNS } from '../../jobs/job-schedules';
import { JOB_SEEKER_CONSENT_PURPOSES, JOB_SEEKER_REQUIRED_CONSENT_PURPOSES } from '../consent/consent.constants';
import { DateRange, PageRequest, Paged, contains, dateFilter, istDayKey, istStartOfDay, istStartOfMonth } from './ceo-common';
import { JOB_CATALOG } from '../../jobs/job-catalog';

export type AuditType = 'money' | 'corrections' | 'policy' | 'logins' | 'records';

const MONEY = /payment|refund|payout|bank_credit|placement_fee|joining_reward|invoice|tds/;
const CORRECTIONS = /hit_reversed|hit_refused|day_changed|correction|overturn|overruled|claim_decided|reporting_line|leave_/;
const POLICY = /pricing|holiday|^trade\.|^area\.|^target\.|team_named/;
const LOGINS = /^login_code|^staff_device|^auth\.|session_revoked|staff\.(locked|unlocked)|^otp\./;

/** Which filter group an audit action belongs to (C-Audit "Action" filter). */
export function auditType(action: string): AuditType {
  if (MONEY.test(action)) return 'money';
  if (CORRECTIONS.test(action)) return 'corrections';
  if (POLICY.test(action)) return 'policy';
  if (LOGINS.test(action)) return 'logins';
  return 'records';
}

const TYPE_PATTERNS: Record<Exclude<AuditType, 'records'>, string[]> = {
  money: ['payment', 'refund', 'payout', 'bank_credit', 'placement_fee', 'joining_reward', 'invoice', 'tds'],
  corrections: ['hit_reversed', 'hit_refused', 'day_changed', 'correction', 'overturn', 'overruled', 'claim_decided', 'reporting_line', 'leave_'],
  policy: ['pricing', 'holiday', 'trade.', 'area.', 'target.', 'team_named'],
  logins: ['login_code', 'staff_device', 'auth.', 'session_revoked', 'staff.locked', 'staff.unlocked', 'otp.'],
};

const WHO_ROLES: Record<string, string[]> = {
  ceo: ['ceo'],
  managers: ['manager'],
  team_leads: ['team_lead'],
  agents: ['call_agent', 'field_agent'],
  finance: ['finance'],
};

/** "field: before → after" for the first changed fields, never more than three. */
export function changeSummary(before: unknown, after: unknown, changed: readonly string[]): string | null {
  const b = before && typeof before === 'object' ? (before as Record<string, unknown>) : {};
  const a = after && typeof after === 'object' ? (after as Record<string, unknown>) : {};
  const keys = (changed.length ? changed : Object.keys(a)).filter((k) => !['updatedAt', 'createdAt', 'id'].includes(k)).slice(0, 3);
  if (!keys.length) return null;
  const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 40));
  return keys.map((k) => (k in b ? `${k}: ${show(b[k])} → ${show(a[k])}` : `${k}: ${show(a[k])}`)).join(' · ');
}

/** Severity on the Flags list: bypass and payout fraud first. */
export function flagSeverity(kind: string): 'high' | 'medium' | 'low' {
  if (['bypass_suspected', 'payout_matches_staff', 'payout_shared_account', 'business_stopped_after_interviews', 'screenshot_taken'].includes(kind)) return 'high';
  if (['gps_mismatch', 'payment_mismatch', 'payment_overdue', 'duplicate_business', 'interview_result_mismatch', 'agent_rejection_pattern', 'business_many_rejections', 'break_overrun', 'claim_decision_overdue', 'hit_reversal_needs_manager'].includes(kind)) return 'medium';
  return 'low';
}

const FINANCE_KINDS = ['payment_overdue', 'payment_mismatch', 'payout_name_mismatch', 'payout_shared_account', 'payout_matches_staff'];

/** The policy fields that differ between two versions. */
export function policyChanges(before: PricingPolicy | null, after: PricingPolicy): { field: string; before: unknown; after: unknown }[] {
  if (!before) return [];
  const skip = new Set(['id', 'effectiveFrom', 'setByStaffId', 'createdAt']);
  const out: { field: string; before: unknown; after: unknown }[] = [];
  for (const key of Object.keys(after) as (keyof PricingPolicy)[]) {
    if (skip.has(key)) continue;
    const x = before[key] instanceof Date ? (before[key] as Date).toISOString() : before[key];
    const y = after[key] instanceof Date ? (after[key] as Date).toISOString() : after[key];
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ field: key, before: x, after: y });
  }
  return out;
}

/** Endpoints that start each nightly job by hand (jobs.controller.ts), by schedule name. */
/** C-System "Run now": every scheduled job really runs, in the API process (POST /jobs/:job/run-now, CEO only). */
const RUNNABLE: Record<string, string> = Object.fromEntries(
  JOB_CATALOG.map((job) => [job.key, `/jobs/${job.key}/run-now`]),
);

const JOB_LABELS: Record<string, string> = Object.fromEntries(JOB_CATALOG.map((job) => [job.key, job.label]));

/** Names JobRun rows use for each job (the older spellings are kept for rows written before). */
const JOB_RUN_NAMES: Record<string, string[]> = Object.fromEntries(
  JOB_CATALOG.map((job) => [
    job.key,
    job.key === 'noPickupEvaluation'
      ? [job.runName, 'no_pickup_evaluation', 'no-pickup-evaluation', 'noPickupEvaluation']
      : job.key === 'retentionCleanup'
        ? [job.runName, 'retention_cleanup', 'retentionCleanup']
        : [job.runName],
  ]),
);

/** Audit rows written when the CEO starts a job by hand (entityCode is the queue name). */
const JOB_AUDIT_CODES: Record<string, string[]> = Object.fromEntries(
  JOB_CATALOG.map((job) => [job.key, [job.queue, job.queue.replace(/-/g, '_')]]),
);

function cronTime(pattern: string): string {
  const [m, h] = pattern.split(' ');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

/**
 * Admin reads for the CEO portal: Audit log (C-Audit), Flags (C-Audit-Flags),
 * Consent & privacy (C-Privacy), System health extras (C-System) and the
 * pricing history and minimum-wage use (C-Pricing, C-Pricing-MinWage).
 */
@Injectable()
export class CeoAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async audit(range: Partial<DateRange>, page: PageRequest, filters: { search?: string; who?: string; type?: string }): Promise<Paged<unknown>> {
    const and: Prisma.AuditLogWhereInput[] = [];
    const created = dateFilter(range);
    if (created) and.push({ createdAt: created });
    if (filters.who && WHO_ROLES[filters.who]) and.push({ actor: { role: { in: WHO_ROLES[filters.who] } } });
    if (filters.type && filters.type in TYPE_PATTERNS) {
      and.push({ OR: TYPE_PATTERNS[filters.type as keyof typeof TYPE_PATTERNS].map((p) => ({ action: { contains: p } })) });
    } else if (filters.type === 'records') {
      for (const list of Object.values(TYPE_PATTERNS)) and.push({ NOT: { OR: list.map((p) => ({ action: { contains: p } })) } });
    }
    if (filters.search) {
      and.push({
        OR: [{ action: contains(filters.search) }, { entityCode: contains(filters.search) }, { entityType: contains(filters.search) }, { code: contains(filters.search) }, { actor: { name: contains(filters.search) } }],
      });
    }
    const where: Prisma.AuditLogWhereInput = and.length ? { AND: and } : {};
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, code: true, name: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        code: r.code,
        at: r.createdAt.toISOString(),
        actor: r.actor ? { id: r.actor.id, code: r.actor.code, name: r.actor.name, role: r.actor.role } : { id: r.actorId, code: null, name: r.actorId === 'system' || r.actorId === 'bootstrap' ? 'System' : 'Removed account', role: null },
        type: auditType(r.action),
        action: r.action,
        entityType: r.entityType,
        entityCode: r.entityCode,
        reason: r.reason,
        change: changeSummary(r.before, r.after, r.changedFields),
        device: { id: r.deviceId, name: r.deviceName, network: r.network },
      })),
      total,
      page: page.page,
      pageSize: page.pageSize,
      summary: null,
    };
  }

  /** C-Audit-Flags: every flag, most serious first, with the subject named and the owner who should act. */
  async flags(page: PageRequest, filters: { search?: string; status?: string; severity?: string; kind?: string }, now: Date) {
    const where: Prisma.ReviewFlagWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
    };
    const all = await this.prisma.reviewFlag.findMany({
      where,
      include: { raisedForStaff: { select: { id: true, code: true, name: true, role: true, teamLeadId: true, reportsToId: true } }, resolvedByStaff: { select: { id: true, name: true } } },
      orderBy: { raisedAt: 'desc' },
      take: 5000,
    });
    const leadIds = [...new Set(all.map((f) => f.raisedForStaff?.teamLeadId ?? f.raisedForStaff?.reportsToId).filter((x): x is string => Boolean(x)))];
    const leads = leadIds.length ? await this.prisma.staff.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true, role: true } }) : [];
    const ids = (type: string) => all.filter((f) => f.subjectType === type).map((f) => f.subjectId);
    const [businesses, seekers, placements, payments, staff] = await Promise.all([
      this.prisma.business.findMany({ where: { id: { in: ids('business') } }, select: { id: true, code: true, name: true } }),
      this.prisma.jobSeeker.findMany({ where: { id: { in: ids('job_seeker') } }, select: { id: true, code: true, name: true } }),
      this.prisma.placement.findMany({ where: { id: { in: ids('placement') } }, select: { id: true, code: true } }),
      this.prisma.payment.findMany({ where: { id: { in: ids('payment') } }, select: { id: true, code: true } }),
      this.prisma.staff.findMany({ where: { id: { in: ids('staff') } }, select: { id: true, code: true, name: true } }),
    ]);
    const subjectName = (type: string, id: string): { code: string | null; name: string | null } => {
      const find = <T extends { id: string; code: string }>(list: T[]) => list.find((x) => x.id === id);
      const hit = type === 'business' ? find(businesses) : type === 'job_seeker' ? find(seekers) : type === 'placement' ? find(placements) : type === 'payment' ? find(payments) : type === 'staff' ? find(staff) : undefined;
      return { code: hit?.code ?? null, name: hit && 'name' in hit ? (hit as { name: string }).name : null };
    };
    const order = { high: 0, medium: 1, low: 2 } as const;
    let rows = all.map((f) => {
      const severity = flagSeverity(f.kind);
      const lead = leads.find((l) => l.id === (f.raisedForStaff?.teamLeadId ?? f.raisedForStaff?.reportsToId));
      const subject = subjectName(f.subjectType, f.subjectId);
      return {
        id: f.id,
        code: f.code,
        kind: f.kind,
        subjectType: f.subjectType,
        subjectId: f.subjectId,
        subject,
        raisedFor: f.raisedForStaff ? { id: f.raisedForStaff.id, name: f.raisedForStaff.name, role: f.raisedForStaff.role } : null,
        details: f.details,
        severity,
        owner: FINANCE_KINDS.includes(f.kind) ? 'Finance' : (lead?.name ?? 'CEO'),
        status: f.status,
        raisedAt: f.raisedAt.toISOString(),
        resolvedAt: f.resolvedAt?.toISOString() ?? null,
        resolvedBy: f.resolvedByStaff?.name ?? null,
        resolution: f.resolution,
      };
    });
    if (filters.severity) rows = rows.filter((r) => r.severity === filters.severity);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter((r) => [r.code, r.kind, r.subject.code, r.subject.name, r.raisedFor?.name, r.owner].some((v) => v && v.toLowerCase().includes(q)));
    }
    rows.sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || order[a.severity] - order[b.severity] || b.raisedAt.localeCompare(a.raisedAt));
    const monthStart = istStartOfMonth(now);
    const [open, closedThisMonth] = await Promise.all([
      this.prisma.reviewFlag.findMany({ where: { status: 'open' }, select: { kind: true } }),
      this.prisma.reviewFlag.count({ where: { status: { in: ['resolved', 'dismissed'] }, resolvedAt: { gte: monthStart } } }),
    ]);
    return {
      rows: rows.slice(page.skip, page.skip + page.pageSize),
      total: rows.length,
      page: page.page,
      pageSize: page.pageSize,
      summary: {
        open: open.length,
        high: open.filter((f) => flagSeverity(f.kind) === 'high').length,
        medium: open.filter((f) => flagSeverity(f.kind) === 'medium').length,
        low: open.filter((f) => flagSeverity(f.kind) === 'low').length,
        closedThisMonth,
      },
      kinds: [...new Set(all.map((f) => f.kind))].sort(),
    };
  }

  /** C-Privacy: consent proof by purpose, withdrawals, notice versions and business / partner consents. */
  async privacy(now: Date) {
    const monthStart = istStartOfMonth(now);
    const consents = await this.prisma.consent.findMany({
      where: { subjectType: 'job_seeker' },
      select: { subjectId: true, purpose: true, granted: true, withdrawnAt: true, noticeVersion: true, grantedAt: true },
    });
    const purposes = JOB_SEEKER_CONSENT_PURPOSES.map((purpose) => {
      const list = consents.filter((c) => c.purpose === purpose);
      return {
        purpose,
        required: (JOB_SEEKER_REQUIRED_CONSENT_PURPOSES as readonly string[]).includes(purpose),
        given: list.filter((c) => c.granted && !c.withdrawnAt).length,
        withdrawn: list.filter((c) => c.withdrawnAt).length,
      };
    });
    const bySeeker = new Map<string, Set<string>>();
    for (const c of consents) {
      if (!c.granted || c.withdrawnAt) continue;
      const set = bySeeker.get(c.subjectId) ?? new Set<string>();
      set.add(c.purpose);
      bySeeker.set(c.subjectId, set);
    }
    const fullConsent = [...bySeeker.values()].filter((set) => JOB_SEEKER_REQUIRED_CONSENT_PURPOSES.every((p) => set.has(p))).length;
    const withdrawals = await this.prisma.consent.findMany({
      where: { withdrawnAt: { not: null } },
      orderBy: { withdrawnAt: 'desc' },
      take: 50,
    });
    const codes = await this.subjectCodes(withdrawals.map((w) => ({ type: w.subjectType, id: w.subjectId })));
    const versions = new Map<string, { version: string; count: number; firstAt: string | null; lastAt: string | null }>();
    for (const c of await this.prisma.consent.findMany({ select: { noticeVersion: true, grantedAt: true } })) {
      const v = versions.get(c.noticeVersion) ?? { version: c.noticeVersion, count: 0, firstAt: null, lastAt: null };
      v.count += 1;
      const at = c.grantedAt?.toISOString() ?? null;
      if (at && (!v.firstAt || at < v.firstAt)) v.firstAt = at;
      if (at && (!v.lastAt || at > v.lastAt)) v.lastAt = at;
      versions.set(c.noticeVersion, v);
    }
    const noticeVersions = [...versions.values()].sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
    const [businessTotal, businessesSigned, businessRecording, partnerTotal, partnerConsents] = await Promise.all([
      this.prisma.business.count({ where: { anonymisedAt: null } }),
      this.prisma.businessAgreement.groupBy({ by: ['businessId'] }),
      this.prisma.consent.findMany({ where: { subjectType: 'business', purpose: 'call_recording', granted: true, withdrawnAt: null }, select: { subjectId: true } }),
      this.prisma.referral.count(),
      this.prisma.consent.findMany({ where: { subjectType: 'referral', granted: true, withdrawnAt: null, purpose: { in: ['agreement_terms', 'call_recording'] } }, select: { subjectId: true, purpose: true } }),
    ]);
    const recording = new Set(businessRecording.map((c) => c.subjectId));
    const businessesBoth = businessesSigned.filter((b) => recording.has(b.businessId)).length;
    const partnerSets = new Map<string, Set<string>>();
    for (const c of partnerConsents) {
      const s = partnerSets.get(c.subjectId) ?? new Set<string>();
      s.add(c.purpose);
      partnerSets.set(c.subjectId, s);
    }
    const partnersBoth = [...partnerSets.values()].filter((s) => s.has('agreement_terms') && s.has('call_recording')).length;
    const erasures = await this.prisma.auditLog.findMany({
      where: { action: 'dpdp.erasure_requested' },
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      summary: {
        fullConsent,
        withdrawalsThisMonth: await this.prisma.consent.count({ where: { withdrawnAt: { gte: monthStart } } }),
        erasuresThisMonth: erasures.filter((e) => e.createdAt.getTime() >= monthStart.getTime()).length,
        noticeVersion: noticeVersions[0]?.version ?? null,
      },
      purposes,
      withdrawals: withdrawals.map((w) => ({
        id: w.id,
        at: (w.withdrawnAt as Date).toISOString(),
        subjectType: w.subjectType,
        subjectId: w.subjectId,
        subjectCode: codes.get(w.subjectId) ?? null,
        purpose: w.purpose,
        method: w.withdrawnMethod,
        effect: (() => {
          const required = w.subjectType === 'job_seeker' ? (JOB_SEEKER_REQUIRED_CONSENT_PURPOSES as readonly string[]) : ['agreement_terms', 'call_recording'];
          if (!required.includes(w.purpose)) return 'No effect';
          return w.subjectType === 'business' ? 'Business paused' : w.subjectType === 'referral' ? 'Partner paused' : 'Profile paused';
        })(),
      })),
      erasures: erasures.map((e) => ({ id: e.id, at: e.createdAt.toISOString(), entityType: e.entityType, entityCode: e.entityCode, by: e.actor?.name ?? null, reason: e.reason })),
      noticeVersions,
      businesses: { total: businessTotal, signedAndRecording: businessesBoth },
      partners: { total: partnerTotal, termsAndRecording: partnersBoth },
    };
  }

  private async subjectCodes(subjects: { type: string; id: string }[]): Promise<Map<string, string>> {
    const of = (t: string) => subjects.filter((s) => s.type === t).map((s) => s.id);
    const [a, b, c] = await Promise.all([
      this.prisma.jobSeeker.findMany({ where: { id: { in: of('job_seeker') } }, select: { id: true, code: true } }),
      this.prisma.business.findMany({ where: { id: { in: of('business') } }, select: { id: true, code: true } }),
      this.prisma.referral.findMany({ where: { id: { in: of('referral') } }, select: { id: true, code: true } }),
    ]);
    return new Map([...a, ...b, ...c].map((x) => [x.id, x.code]));
  }

  /** "Export consent records": every consent row, filtered and paged, for the download. */
  async consentRecords(range: Partial<DateRange>, page: PageRequest, filters: { subjectType?: string; purpose?: string; status?: string; search?: string }) {
    const where: Prisma.ConsentWhereInput = {
      ...(filters.subjectType ? { subjectType: filters.subjectType } : {}),
      ...(filters.purpose ? { purpose: filters.purpose } : {}),
      ...(filters.status === 'withdrawn' ? { withdrawnAt: { not: null } } : filters.status === 'given' ? { granted: true, withdrawnAt: null } : {}),
      ...(dateFilter(range) ? { createdAt: dateFilter(range) } : {}),
    };
    if (filters.search) {
      const q = filters.search;
      const [s, b, r] = await Promise.all([
        this.prisma.jobSeeker.findMany({ where: { OR: [{ code: contains(q) }, { name: contains(q) }] }, select: { id: true }, take: 200 }),
        this.prisma.business.findMany({ where: { OR: [{ code: contains(q) }, { name: contains(q) }] }, select: { id: true }, take: 200 }),
        this.prisma.referral.findMany({ where: { OR: [{ code: contains(q) }, { name: contains(q) }] }, select: { id: true }, take: 200 }),
      ]);
      where.subjectId = { in: [...s, ...b, ...r].map((x) => x.id) };
    }
    const [rows, total] = await Promise.all([
      this.prisma.consent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.pageSize }),
      this.prisma.consent.count({ where }),
    ]);
    const codes = await this.subjectCodes(rows.map((r) => ({ type: r.subjectType, id: r.subjectId })));
    return {
      rows: rows.map((r) => ({
        id: r.id,
        subjectType: r.subjectType,
        subjectCode: codes.get(r.subjectId) ?? null,
        purpose: r.purpose,
        granted: r.granted,
        noticeVersion: r.noticeVersion,
        language: r.language,
        method: r.method,
        grantedAt: r.grantedAt?.toISOString() ?? null,
        withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
        withdrawnMethod: r.withdrawnMethod,
      })),
      total,
      page: page.page,
      pageSize: page.pageSize,
      summary: null,
    };
  }

  /** C-System extras: messages and OTPs today, and the nightly jobs with their last recorded run. */
  async system(now: Date) {
    const dayStart = istStartOfDay(istDayKey(now));
    const [messages, otps, otpVerified, runs, manual] = await Promise.all([
      this.prisma.messageLog.groupBy({ by: ['channel', 'status'], where: { createdAt: { gte: dayStart, lte: now } }, _count: { _all: true } }),
      this.prisma.otpSession.count({ where: { lastSentAt: { gte: dayStart, lte: now } } }),
      this.prisma.otpSession.count({ where: { lastSentAt: { gte: dayStart, lte: now }, verified: true } }),
      this.prisma.jobRun.findMany({ orderBy: { startedAt: 'desc' }, take: 200 }),
      this.prisma.auditLog.findMany({ where: { action: 'job.manual_trigger' }, orderBy: { createdAt: 'desc' }, take: 100, select: { entityCode: true, createdAt: true } }),
    ]);
    const templates = await this.prisma.messageLog.groupBy({ by: ['template'], where: { createdAt: { gte: dayStart, lte: now } }, _count: { _all: true } });
    const sum = (pred: (m: (typeof messages)[number]) => boolean) => messages.filter(pred).reduce((s, m) => s + m._count._all, 0);
    const sent = sum(() => true);
    const delivered = sum((m) => m.status === 'delivered' || m.status === 'read');
    const failed = sum((m) => m.status === 'failed');
    const jobs = (Object.keys(DAILY_JOB_PATTERNS) as (keyof typeof DAILY_JOB_PATTERNS)[]).map((key) => {
      const run = runs.find((r) => (JOB_RUN_NAMES[key] ?? []).includes(r.jobName));
      const byHand = manual.find((m) => (JOB_AUDIT_CODES[key] ?? []).some((c) => m.entityCode.includes(c)));
      const last = [run ? { at: (run.finishedAt ?? run.startedAt).toISOString(), outcome: run.outcome, source: 'schedule' } : null, byHand ? { at: byHand.createdAt.toISOString(), outcome: 'started by hand', source: 'manual' } : null]
        .filter((x): x is { at: string; outcome: string; source: string } => Boolean(x))
        .sort((a, b) => b.at.localeCompare(a.at))[0];
      return {
        key,
        label: JOB_LABELS[key] ?? key,
        runsAt: cronTime(DAILY_JOB_PATTERNS[key]),
        lastRunAt: last?.at ?? null,
        result: last?.outcome ?? null,
        runPath: RUNNABLE[key] ?? null,
      };
    });
    return {
      messages: {
        sent,
        delivered,
        failed,
        byChannel: ['sms', 'whatsapp'].map((channel) => ({
          channel,
          sent: sum((m) => m.channel === channel),
          delivered: sum((m) => m.channel === channel && (m.status === 'delivered' || m.status === 'read')),
          failed: sum((m) => m.channel === channel && m.status === 'failed'),
        })),
        byTemplate: templates.map((t) => ({ template: t.template, sent: t._count._all })).sort((a, b) => b.sent - a.sent).slice(0, 10),
      },
      otps: { sent: otps, verified: otpVerified },
      jobs,
      intervals: [
        { key: 'interviewReply', label: 'Offer reply deadlines', every: 'Every minute', runPath: RUNNABLE.interviewReply },
        { key: 'notificationSweep', label: JOB_LABELS.notificationSweep, every: 'Every 5 minutes', runPath: RUNNABLE.notificationSweep },
        { key: 'weeklyReport', label: JOB_LABELS.weeklyReport, every: 'Mondays at 09:00', runPath: RUNNABLE.weeklyReport },
      ],
    };
  }

  /** C-Pricing: in-force policy, scheduled versions and the change history (who, when, what). */
  async pricingHistory(now: Date) {
    const versions = await this.prisma.pricingPolicy.findMany({
      include: { setByStaff: { select: { id: true, name: true } } },
      orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    });
    const current = await this.pricing.current();
    const out = versions.map((v, i) => ({
      id: v.id,
      effectiveFrom: v.effectiveFrom.toISOString(),
      createdAt: v.createdAt.toISOString(),
      setBy: v.setByStaff?.name ?? null,
      scheduled: v.effectiveFrom.getTime() > now.getTime(),
      inForce: v.id === current.id,
      changes: policyChanges(i > 0 ? versions[i - 1] : null, v),
    }));
    // When each rule last changed: the newest in-force-or-past version that touched it.
    const since: Record<string, string> = {};
    const past = out.filter((v) => !v.scheduled);
    if (past.length) for (const key of Object.keys(current)) since[key] = past[0].effectiveFrom;
    for (const v of past) for (const c of v.changes) since[c.field] = v.effectiveFrom;
    return {
      current,
      since,
      scheduled: out.filter((v) => v.scheduled),
      history: out.filter((v) => !v.scheduled && v.changes.length).reverse().slice(0, 30),
    };
  }

  /** C-Pricing-MinWage: the figures in force and how many open vacancies sit below them. */
  async minimumWage() {
    const policy = await this.pricing.current();
    const [open, below, belowOwnerTold] = await Promise.all([
      this.prisma.vacancy.count({ where: { status: 'open' } }),
      this.prisma.vacancy.count({ where: { status: 'open', belowLegalMinimum: true } }),
      this.prisma.vacancy.count({ where: { status: 'open', belowLegalMinimum: true, ownerToldMinimumWage: true } }),
    ]);
    return {
      effectiveFrom: policy.legalMinimumWageEffectiveFrom.toISOString(),
      unskilledPaise: policy.legalMinimumWageUnskilledPaise,
      semiSkilledPaise: policy.legalMinimumWageSemiSkilledPaise,
      skilledPaise: policy.legalMinimumWageSkilledPaise,
      highlySkilledPaise: policy.legalMinimumWageHighlySkilledPaise,
      openVacancies: open,
      belowMinimum: below,
      belowMinimumOwnerTold: belowOwnerTold,
    };
  }

  /**
   * C-Pricing-Trades: per trade (by normalised name), job seekers in the pool
   * (active, any of their trades) and open vacancies.
   */
  async tradeCounts() {
    const [seekerTrades, vacancies] = await Promise.all([
      this.prisma.jobSeekerTrade.findMany({ where: { jobSeeker: { status: 'active' } }, select: { trade: true, jobSeekerId: true } }),
      this.prisma.vacancy.groupBy({ by: ['tradeSkill'], where: { status: 'open' }, _sum: { headcount: true } }),
    ]);
    const key = (s: string) => tradeNameKey(s);
    const pool = new Map<string, Set<string>>();
    for (const t of seekerTrades) {
      const set = pool.get(key(t.trade)) ?? new Set<string>();
      set.add(t.jobSeekerId);
      pool.set(key(t.trade), set);
    }
    const open = new Map<string, number>();
    for (const v of vacancies) open.set(key(v.tradeSkill), (open.get(key(v.tradeSkill)) ?? 0) + (v._sum.headcount ?? 0));
    const keys = [...new Set([...pool.keys(), ...open.keys()])];
    return { rows: keys.map((k) => ({ nameKey: k, candidates: pool.get(k)?.size ?? 0, openVacancies: open.get(k) ?? 0 })) };
  }
}
