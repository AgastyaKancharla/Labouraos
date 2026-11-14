import { OwnTeam } from '../../common/rbac/own-team';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { PricingService } from '../pricing/pricing.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { CandidateIntroductionService } from '../vacancy/candidate-introduction.service';
import {
  ALLOWED_FOLLOW_UP_CALL_PURPOSES,
  FOLLOW_UP_ANSWERS,
  FollowUpAnswer,
  FollowUpKind,
  isRepeatBusinessKind,
  REPEAT_BUSINESS_ANSWERS,
  REPEAT_BUSINESS_CHECK_IN_DAYS,
  RepeatBusinessAnswer,
} from './follow-up.constants';
import { CompleteFollowUpTaskDto } from './dto/complete-follow-up-task.dto';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { ReportingScopeService } from '../staff/reporting-scope.service';

export interface ListFollowUpTasksQuery {
  status?: string;
  kind?: string;
  assignedStaffId?: string;
}

@Injectable()
export class FollowUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly pricingService: PricingService,
    private readonly reviewFlagService: ReviewFlagService,
    private readonly candidateIntroService: CandidateIntroductionService,
    @Optional() private readonly jobSeekerService?: JobSeekerService,
    @Optional() private readonly reportingScope?: ReportingScopeService,
  ) {}

  /** Everyone below a Team Lead or Manager in the reporting line. */
  private async peopleUnder(staffId: string): Promise<string[]> {
    if (this.reportingScope) return this.reportingScope.peopleUnder(staffId);
    const team = await this.prisma.staff.findMany({ where: { teamLeadId: staffId }, select: { id: true } });
    return team.map((m) => m.id);
  }

  /** A Team Lead's own team, the Team Lead included (the shared definition, OwnTeam). */
  private teamOf(teamLeadId: string): Promise<string[]> {
    return new OwnTeam(this.prisma, this.reportingScope ?? undefined).memberIds(teamLeadId);
  }

  async listTasks(
    actor: { id: string; role: string; teamLeadId?: string | null },
    query?: ListFollowUpTasksQuery,
  ) {
    const where: Prisma.FollowUpTaskWhereInput = {};

    if (query?.status) {
      where.status = query.status;
    }
    if (query?.kind) {
      where.kind = query.kind;
    }

    if (['ceo', 'manager', 'finance'].includes(actor.role)) {
      if (query?.assignedStaffId) {
        where.assignedStaffId = query.assignedStaffId;
      }
    } else if (actor.role === 'team_lead') {
      const memberIds = await this.teamOf(actor.id);
      where.assignedStaffId = query?.assignedStaffId && memberIds.includes(query.assignedStaffId)
        ? query.assignedStaffId
        : { in: memberIds };
    } else if (['call_agent', 'field_agent'].includes(actor.role)) {
      where.assignedStaffId = actor.id;
    } else {
      throw new ForbiddenException('Access denied');
    }

    return this.prisma.followUpTask.findMany({
      where,
      orderBy: { dueAt: 'asc' },
      include: {
        assignedStaff: {
          select: { id: true, code: true, name: true, role: true },
        },
        answerBusiness: {
          select: { id: true, code: true, name: true },
        },
        callRecord: true,
      },
    });
  }

  /**
   * The businesses this job seeker was introduced to, for the follow-up call
   * (CA04b, "Working at a business we introduced?").
   *
   * Ownership: the CEO and the agent the task is assigned to see every
   * introduction. Otherwise an agent sees only the businesses they introduced
   * themselves, and a Team Lead or Manager only those introduced by someone
   * in their reporting scope (or all of them when the task's agent is in
   * that scope). Nothing in scope → 403, so a task id is not a way in.
   */
  async getIntroducedBusinesses(taskId: string, actor: { id: string; role: string }) {
    const task = await this.prisma.followUpTask.findUnique({
      where: { id: taskId },
    });
    if (!task) {
      throw new NotFoundException(`FollowUpTask '${taskId}' not found`);
    }

    // null = every introduction; otherwise only those shown by these staff.
    let shownBy: string[] | null;
    if (actor.role === 'ceo' || task.assignedStaffId === actor.id) {
      shownBy = null;
    } else if (actor.role === 'team_lead' || actor.role === 'manager') {
      const scope = actor.role === 'team_lead'
        ? await this.teamOf(actor.id)
        : [actor.id, ...(await this.peopleUnder(actor.id))];
      shownBy = task.assignedStaffId && scope.includes(task.assignedStaffId) ? null : scope;
    } else if (actor.role === 'call_agent' || actor.role === 'field_agent') {
      shownBy = [actor.id];
    } else {
      throw new ForbiddenException('Access denied');
    }

    const introductions = await this.prisma.candidateIntroduction.findMany({
      where: {
        jobSeekerId: task.subjectId,
        ...(shownBy ? { shownByStaffId: { in: shownBy } } : {}),
      },
      select: {
        business: {
          select: { id: true, code: true, name: true, city: true, locality: true },
        },
      },
      distinct: ['businessId'],
    });
    if (shownBy && introductions.length === 0) {
      throw new ForbiddenException('This follow-up is not yours or your team’s');
    }

    return introductions.map((i) => i.business);
  }

  /**
   * Who may complete a follow-up (owner rule, Master Guide 14 Nov) — the
   * tasks each person's list shows them:
   * - a call or field agent: only follow-ups assigned to them;
   * - a Team Lead: follow-ups assigned to them or to someone in their
   *   reporting line;
   * - Managers and the CEO: any.
   * A missing task is left to completeTask (404).
   */
  async assertMayComplete(taskId: string, actor: { id: string; role: string }) {
    if (!['team_lead', 'call_agent', 'field_agent'].includes(actor.role)) return;
    const task = await this.prisma.followUpTask.findUnique({
      where: { id: taskId },
      select: { assignedStaffId: true },
    });
    if (!task) return;
    if (actor.role !== 'team_lead') {
      if (task.assignedStaffId !== actor.id) {
        throw new ForbiddenException('This follow-up is assigned to someone else');
      }
      return;
    }
    const scope = await this.teamOf(actor.id);
    if (!task.assignedStaffId || !scope.includes(task.assignedStaffId)) {
      throw new ForbiddenException('This follow-up is not yours or your team’s');
    }
  }

  async completeTask(
    taskId: string,
    dto: CompleteFollowUpTaskDto,
    actorId: string,
    now = new Date(),
  ) {
    const task = await this.prisma.followUpTask.findUnique({
      where: { id: taskId },
    });
    if (!task) {
      throw new NotFoundException(`FollowUpTask '${taskId}' not found`);
    }
    if (task.status !== 'pending') {
      throw new BadRequestException(
        `Task '${task.code}' is '${task.status}' and cannot be completed`,
      );
    }

    if (!dto.callRecordId) {
      throw new BadRequestException('callRecordId is required');
    }

    const call = await this.prisma.callRecord.findUnique({
      where: { id: dto.callRecordId },
    });
    if (!call) {
      throw new NotFoundException(`CallRecord '${dto.callRecordId}' not found`);
    }
    if (!call.answered) {
      throw new BadRequestException(
        'Follow-up task can only be completed with an answered call',
      );
    }
    if (call.subjectType !== task.subjectType || call.subjectId !== task.subjectId) {
      throw new BadRequestException('Call subject does not match task subject');
    }
    if (!ALLOWED_FOLLOW_UP_CALL_PURPOSES.includes(call.purpose as (typeof ALLOWED_FOLLOW_UP_CALL_PURPOSES)[number])) {
      throw new BadRequestException(
        `Call purpose '${call.purpose}' is not valid for completing a follow-up task`,
      );
    }

    if (isRepeatBusinessKind(task.kind)) {
      if (!REPEAT_BUSINESS_ANSWERS.includes(dto.answer as RepeatBusinessAnswer)) {
        throw new BadRequestException(
          `Invalid answer '${dto.answer}' for a repeat-business call; use one of ${REPEAT_BUSINESS_ANSWERS.join(', ')}`,
        );
      }
    } else if (!FOLLOW_UP_ANSWERS.includes(dto.answer as FollowUpAnswer)) {
      throw new BadRequestException(`Invalid answer '${dto.answer}'`);
    }
    if (dto.foundOwnJob === true && (dto.answer !== 'working_elsewhere' || task.subjectType !== 'job_seeker')) {
      throw new BadRequestException("foundOwnJob can only be recorded with the answer 'working_elsewhere' on a job seeker's follow-up");
    }
    if (dto.foundOwnJob === true) {
      const seeker = await this.prisma.jobSeeker.findUnique({ where: { id: task.subjectId }, select: { status: true, code: true } });
      if (!seeker || ['closed', 'placed', 'deactivated'].includes(seeker.status)) {
        throw new BadRequestException(`Job seeker is '${seeker?.status ?? 'missing'}' and cannot be closed as found a job on his own`);
      }
    }

    const policy = await this.pricingService.current();

    if (dto.answer === 'working_at_introduced_business') {
      if (!dto.answerBusinessId) {
        throw new BadRequestException(
          'answerBusinessId is required when answer is working_at_introduced_business',
        );
      }

      const intro = await this.prisma.candidateIntroduction.findFirst({
        where: {
          jobSeekerId: task.subjectId,
          businessId: dto.answerBusinessId,
        },
      });
      if (!intro) {
        throw new BadRequestException(
          'Business must be one of the businesses introduced to this candidate',
        );
      }

      // Check bypass
      const firstIntroDate = await this.candidateIntroService.firstIntroduction(
        dto.answerBusinessId,
        task.subjectId,
      );
      if (firstIntroDate) {
        const bypassCutoff = new Date(firstIntroDate);
        bypassCutoff.setMonth(bypassCutoff.getMonth() + policy.noBypassMonths);

        if (now.getTime() <= bypassCutoff.getTime()) {
          const paidPlacement = await this.prisma.placement.findFirst({
            where: {
              businessId: dto.answerBusinessId,
              jobSeekerId: task.subjectId,
              OR: [
                { paidAt: { not: null } },
                {
                  status: {
                    in: ['confirmed', 'active', 'completed', 'dropped_out', 'guarantee_ended'],
                  },
                },
              ],
            },
          });

          if (!paidPlacement) {
            const business = await this.prisma.business.findUnique({
              where: { id: dto.answerBusinessId },
              select: { code: true, name: true },
            });
            const lastInterview = await this.prisma.interview.findFirst({
              where: {
                businessId: dto.answerBusinessId,
                jobSeekerId: task.subjectId,
              },
              orderBy: [{ createdAt: 'desc' }],
              select: { result: true },
            });

            await this.reviewFlagService.raise({
              kind: 'bypass_suspected',
              subjectType: 'job_seeker',
              subjectId: task.subjectId,
              raisedForStaffId: actorId,
              details: {
                businessId: dto.answerBusinessId,
                businessCode: business?.code,
                businessName: business?.name,
                jobSeekerId: task.subjectId,
                introductionDate: firstIntroDate.toISOString(),
                interviewResult: lastInterview?.result ?? 'none',
                callRecordId: call.id,
              },
            });
          }
        }
      }
    }

    if (task.kind === 'exit_call' && task.relatedType === 'replacement_claim' && task.relatedId) {
      await this.prisma.replacementClaim.update({
        where: { id: task.relatedId },
        data: { exitCallRecordId: call.id },
      });
    }

    const updated = await this.prisma.followUpTask.update({
      where: { id: task.id },
      data: {
        status: 'done',
        completedAt: now,
        callRecordId: call.id,
        answer: dto.answer,
        answerBusinessId: dto.answer === 'working_at_introduced_business' ? dto.answerBusinessId : null,
        notes: dto.notes ?? null,
      },
    });

    await this.auditService.log({
      actorId,
      action: 'follow_up_task.completed',
      entityType: 'follow_up_task',
      entityCode: updated.code,
      after: {
        id: updated.id,
        code: updated.code,
        status: updated.status,
        answer: updated.answer,
        answerBusinessId: updated.answerBusinessId,
        callRecordId: updated.callRecordId,
      },
    });

    // "Working elsewhere" from a job seeker: offer to record that he found a job on his
    // own (Master Guide, decided 9 Nov: profile closed, no refund), or record it now.
    let foundOwnJobRecorded = false;
    let offerFoundOwnJob = false;
    if (dto.answer === 'working_elsewhere' && task.subjectType === 'job_seeker') {
      if (dto.foundOwnJob === true) {
        if (!this.jobSeekerService) throw new Error('JobSeekerService is not available');
        await this.jobSeekerService.recordFoundOwnJob(task.subjectId, actorId, {
          reason: dto.notes?.trim() || `Follow-up ${updated.code}: working elsewhere, found a job on his own`,
          callRecordId: call.id,
          followUpTaskId: updated.id,
        });
        foundOwnJobRecorded = true;
      } else {
        const seeker = await this.prisma.jobSeeker.findUnique({ where: { id: task.subjectId }, select: { status: true } });
        offerFoundOwnJob = Boolean(seeker && !['closed', 'placed', 'deactivated'].includes(seeker.status));
      }
    }

    return { ...updated, offerFoundOwnJob, foundOwnJobRecorded };
  }

  async createScheduledTasks(now = new Date()): Promise<{ created: number; missed: number }> {
    const policy = await this.pricingService.current();
    const graceDays = policy.followUpGraceDays;
    let created = 0;

    // 1. Sweep missed tasks
    const missedCutoff = new Date(now.getTime() - graceDays * 24 * 60 * 60 * 1000);
    const missedResult = await this.prisma.followUpTask.updateMany({
      where: {
        status: 'pending',
        dueAt: { lt: missedCutoff },
      },
      data: {
        status: 'missed',
      },
    });

    // 2. not_selected_day_7, _30, _90
    const notSelectedInterviews = await this.prisma.interview.findMany({
      where: {
        result: 'not_selected',
      },
    });

    const notSelectedIntervals: Array<{ days: number; kind: FollowUpKind }> = [
      { days: 7, kind: 'not_selected_day_7' },
      { days: 30, kind: 'not_selected_day_30' },
      { days: 90, kind: 'not_selected_day_90' },
    ];

    for (const interview of notSelectedInterviews) {
      const baseDate = interview.resultRecordedAt ?? interview.createdAt;
      const daysElapsed = Math.floor((now.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000));

      for (const { days, kind } of notSelectedIntervals) {
        if (daysElapsed >= days) {
          const existing = await this.prisma.followUpTask.findFirst({
            where: {
              kind,
              relatedType: 'interview',
              relatedId: interview.id,
            },
          });

          if (!existing) {
            const code = await this.idService.generateCode('follow_up_task');
            await this.prisma.followUpTask.create({
              data: {
                code,
                kind,
                subjectType: 'job_seeker',
                subjectId: interview.jobSeekerId,
                relatedType: 'interview',
                relatedId: interview.id,
                dueAt: new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000),
                assignedStaffId: interview.proposedByStaffId,
                status: 'pending',
              },
            });
            created++;
          }
        }
      }
    }

    // 3. placement_check_in_day_7, _30
    const activePlacements = await this.prisma.placement.findMany({
      where: {
        joinedDate: { not: null },
        status: { in: ['confirmed', 'active', 'completed'] },
      },
      include: { business: true },
    });

    const placementIntervals: Array<{ days: number; kind: FollowUpKind }> = [
      { days: 7, kind: 'placement_check_in_day_7' },
      { days: 30, kind: 'placement_check_in_day_30' },
    ];

    for (const placement of activePlacements) {
      const baseDate = placement.joinedDate!;
      const daysElapsed = Math.floor((now.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000));

      for (const { days, kind } of placementIntervals) {
        if (daysElapsed >= days) {
          const existing = await this.prisma.followUpTask.findFirst({
            where: {
              kind,
              relatedType: 'placement',
              relatedId: placement.id,
            },
          });

          if (!existing) {
            const code = await this.idService.generateCode('follow_up_task');
            await this.prisma.followUpTask.create({
              data: {
                code,
                kind,
                subjectType: 'job_seeker',
                subjectId: placement.jobSeekerId,
                relatedType: 'placement',
                relatedId: placement.id,
                dueAt: new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000),
                assignedStaffId: placement.business.accountAgentId ?? placement.createdByStaffId,
                status: 'pending',
              },
            });
            created++;
          }
        }
      }
    }

    // 4. refund_check
    const guaranteeDays = policy.jobSeekerGuaranteeDays;
    const candidates = await this.prisma.jobSeeker.findMany({
      where: {
        paymentReceivedAt: { not: null },
        status: { notIn: ['placed', 'deactivated', 'closed', 'refunded'] },
      },
      include: {
        hits: {
          where: {
            reason: { in: ['offer_declined', 'offer_no_reply', 'interview_no_show', 'offer_rejected'] },
            reversedAt: null,
            // Hits from an earlier guarantee (before he paid ₹499 again) no longer count.
            supersededAt: null,
          },
        },
        registeredBy: true,
      },
    });

    for (const candidate of candidates) {
      if (candidate.hits.length > 0) continue;
      const daysElapsed = Math.floor(
        (now.getTime() - candidate.paymentReceivedAt!.getTime()) / (24 * 60 * 60 * 1000),
      );

      if (daysElapsed >= guaranteeDays - 2) {
        const existing = await this.prisma.followUpTask.findFirst({
          where: {
            kind: 'refund_check',
            subjectType: 'job_seeker',
            subjectId: candidate.id,
            // One refund check per guarantee: paying again starts a new one.
            createdAt: { gte: candidate.paymentReceivedAt! },
          },
        });

        if (!existing) {
          let assignedStaffId = candidate.registeredByStaffId;
          if (candidate.registeredBy?.teamLeadId) {
            const teamCallAgent = await this.prisma.staff.findFirst({
              where: {
                teamLeadId: candidate.registeredBy.teamLeadId,
                role: 'call_agent',
              },
            });
            if (teamCallAgent) {
              assignedStaffId = teamCallAgent.id;
            }
          } else if (candidate.registeredBy?.role === 'call_agent') {
            assignedStaffId = candidate.registeredBy.id;
          }

          const code = await this.idService.generateCode('follow_up_task');
          await this.prisma.followUpTask.create({
            data: {
              code,
              kind: 'refund_check',
              subjectType: 'job_seeker',
              subjectId: candidate.id,
              dueAt: new Date(candidate.paymentReceivedAt!.getTime() + guaranteeDays * 24 * 60 * 60 * 1000),
              assignedStaffId,
              status: 'pending',
            },
          });
          created++;
        }
      }
    }

    created += await this.createRepeatBusinessTasks(now, policy);

    return { created, missed: missedResult.count };
  }

  /**
   * N4 repeat-business reminders (confirmed 11 Nov). For the business's account agent
   * (or whoever created the placement when the business has none):
   * - day 30 after each employee joins (replacements included);
   * - the day after the 60-day guarantee ends, once per guarantee (the first
   *   employee's joining date starts it; replacements share the clock), only when
   *   the guarantee ran its course: not ended early or refunded, and no worker in
   *   the chain left and still unresolved.
   * Idempotent: one task per kind per placement. A reminder whose grace period has
   * already passed (for example a joining long before this feature) is not created.
   */
  private async createRepeatBusinessTasks(
    now: Date,
    policy: { followUpGraceDays: number; replacementWindowDays: number },
  ): Promise<number> {
    const dayMs = 24 * 60 * 60 * 1000;
    const graceMs = policy.followUpGraceDays * dayMs;
    const guaranteeCompleteDays = policy.replacementWindowDays + 1;
    let created = 0;

    const joined = await this.prisma.placement.findMany({
      where: {
        joinedDate: { not: null },
        status: { in: ['confirmed', 'active', 'completed', 'replaced'] },
      },
      include: { business: true },
    });

    for (const placement of joined) {
      const joinedDate = placement.joinedDate!;
      const elapsedMs = now.getTime() - joinedDate.getTime();
      const assignedStaffId = placement.business?.accountAgentId ?? placement.createdByStaffId ?? null;

      const day30Due = new Date(joinedDate.getTime() + REPEAT_BUSINESS_CHECK_IN_DAYS * dayMs);
      if (
        ['confirmed', 'active', 'completed'].includes(placement.status) &&
        elapsedMs >= REPEAT_BUSINESS_CHECK_IN_DAYS * dayMs &&
        now.getTime() <= day30Due.getTime() + graceMs
      ) {
        if (await this.createRepeatTaskOnce('repeat_business_day_30', placement, day30Due, assignedStaffId)) {
          created++;
        }
      }

      const isRoot = !placement.rootPlacementId || placement.rootPlacementId === placement.id;
      const day61Due = new Date(joinedDate.getTime() + guaranteeCompleteDays * dayMs);
      if (
        isRoot &&
        !placement.guaranteeEndedReason &&
        elapsedMs >= guaranteeCompleteDays * dayMs &&
        now.getTime() <= day61Due.getTime() + graceMs
      ) {
        const unresolved = await this.prisma.placement.findFirst({
          where: {
            OR: [{ id: placement.id }, { rootPlacementId: placement.id }],
            status: { in: ['dropped_out', 'guarantee_ended'] },
          },
          select: { id: true },
        });
        if (!unresolved && (await this.createRepeatTaskOnce('repeat_business_day_61', placement, day61Due, assignedStaffId))) {
          created++;
        }
      }
    }

    return created;
  }

  private async createRepeatTaskOnce(
    kind: 'repeat_business_day_30' | 'repeat_business_day_61',
    placement: { id: string; businessId: string },
    dueAt: Date,
    assignedStaffId: string | null,
  ): Promise<boolean> {
    const existing = await this.prisma.followUpTask.findFirst({
      where: { kind, relatedType: 'placement', relatedId: placement.id },
      select: { id: true },
    });
    if (existing) return false;
    const code = await this.idService.generateCode('follow_up_task');
    await this.prisma.followUpTask.create({
      data: {
        code,
        kind,
        subjectType: 'business',
        subjectId: placement.businessId,
        relatedType: 'placement',
        relatedId: placement.id,
        dueAt,
        assignedStaffId,
        status: 'pending',
      },
    });
    return true;
  }
}
