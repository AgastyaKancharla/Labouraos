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
  FollowUpKind,
} from './follow-up.constants';
import { CompleteFollowUpTaskDto } from './dto/complete-follow-up-task.dto';
import { JobSeekerService } from '../job-seeker/job-seeker.service';

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
  ) {}

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
      const teamMembers = await this.prisma.staff.findMany({
        where: { teamLeadId: actor.id },
        select: { id: true },
      });
      const memberIds = [actor.id, ...teamMembers.map((m) => m.id)];
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

  async getIntroducedBusinesses(taskId: string) {
    const task = await this.prisma.followUpTask.findUnique({
      where: { id: taskId },
    });
    if (!task) {
      throw new NotFoundException(`FollowUpTask '${taskId}' not found`);
    }

    const introductions = await this.prisma.candidateIntroduction.findMany({
      where: { jobSeekerId: task.subjectId },
      select: {
        business: {
          select: { id: true, code: true, name: true, city: true, locality: true },
        },
      },
      distinct: ['businessId'],
    });

    return introductions.map((i) => i.business);
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

    if (!FOLLOW_UP_ANSWERS.includes(dto.answer)) {
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
        status: { notIn: ['placed', 'deactivated', 'closed'] },
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

    return { created, missed: missedResult.count };
  }
}
