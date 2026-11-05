import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditService } from "../../common/audit/audit.service";
import { PrismaService } from "../../common/prisma/prisma.service";
import { PricingService } from "../pricing/pricing.service";
import { MessagingService } from "../message/messaging.service";
import { JOB_SEEKER_CONSENT_PURPOSES } from "./consent.constants";
import { ConsentClock } from "./consent-clock";
import { ConsentService } from "./consent.service";

const PURPOSE_LABELS: Record<string, string> = {
  job_matching: "job matching",
  profile_sharing: "sharing your profile with businesses",
  call_recording: "recording calls",
  aadhaar_verification: "identity verification",
  job_updates: "job updates",
  promotions: "promotional messages",
};

export interface AgentConsentWithdrawalDto {
  jobSeekerId: string;
  purposes: string[];
  callRecordId: string;
}

@Injectable()
export class ConsentWithdrawalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ConsentClock,
    private readonly consentService: ConsentService,
    private readonly pricing: PricingService,
    private readonly messaging: MessagingService,
    private readonly audit: AuditService,
  ) {}

  async eligibility(actor: { id: string }, jobSeekerId: string) {
    if (!jobSeekerId) throw new BadRequestException('jobSeekerId is required');
    const seeker = await this.prisma.jobSeeker.findUnique({ where: { id: jobSeekerId }, select: { id: true } });
    if (!seeker) throw new NotFoundException('Job seeker not found');
    const policy = await this.pricing.current();
    const now = this.clock.now();
    const call = await this.prisma.callRecord.findFirst({
      where: {
        staffId: actor.id,
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        answered: true,
        endedAt: { lte: now, gte: new Date(now.getTime() - policy.consentWithdrawalCallWindowMinutes * 60_000) },
      },
      orderBy: { endedAt: 'desc' },
      select: { id: true },
    });
    return { eligible: Boolean(call), callRecordId: call?.id ?? null };
  }

  async withdraw(
    actor: { id: string; role: string },
    dto: AgentConsentWithdrawalDto,
  ) {
    if (!dto.callRecordId) {
      throw new BadRequestException(
        "An answered, recent call with this job seeker is required",
      );
    }
    if (
      !Array.isArray(dto.purposes) ||
      dto.purposes.length === 0 ||
      dto.purposes.some(
        (purpose) =>
          !(JOB_SEEKER_CONSENT_PURPOSES as readonly string[]).includes(purpose),
      )
    ) {
      throw new BadRequestException(
        "Select one or more valid job seeker consent purposes",
      );
    }

    const [call, seeker, policy] = await Promise.all([
      this.prisma.callRecord.findUnique({ where: { id: dto.callRecordId } }),
      this.prisma.jobSeeker.findUnique({ where: { id: dto.jobSeekerId } }),
      this.pricing.current(),
    ]);
    if (!seeker) {
      throw new NotFoundException("Job seeker not found");
    }

    const now = this.clock.now();
    const callEndedAt = call?.endedAt?.getTime();
    const withinWindow =
      callEndedAt !== undefined &&
      callEndedAt <= now.getTime() &&
      now.getTime() - callEndedAt <=
        policy.consentWithdrawalCallWindowMinutes * 60_000;
    if (
      !call ||
      call.answered !== true ||
      call.staffId !== actor.id ||
      call.subjectType !== "job_seeker" ||
      call.subjectId !== seeker.id ||
      !withinWindow
    ) {
      throw new BadRequestException(
        "Consent can be withdrawn only during an answered, recent call with this job seeker by the logged-in agent",
      );
    }

    const withdrawnPurposes: string[] = [];
    for (const purpose of [...new Set(dto.purposes)]) {
      const result = await this.consentService.withdraw({
        subjectType: "job_seeker",
        subjectId: seeker.id,
        purpose,
        withdrawnMethod: "agent_call",
        withdrawnByStaffId: actor.id,
        withdrawnCallRecordId: call.id,
      });
      if (result.withdrawn) withdrawnPurposes.push(purpose);
    }

    if (withdrawnPurposes.length === 0) {
      return { withdrawn: false, purposes: [] };
    }

    await this.audit.log({
      actorId: actor.id,
      action: "consent_withdrawn_by_agent_call",
      entityType: "job_seeker",
      entityCode: seeker.code,
      before: { activePurposes: withdrawnPurposes },
      after: { withdrawnPurposes, callRecordId: call.id },
      changedFields: ["consentPurposes"],
      reason:
        "The job seeker requested consent withdrawal during an answered call",
    });

    await this.messaging.send({
      channel: "sms",
      template: "consent_withdrawn",
      subjectType: "job_seeker",
      subjectId: seeker.id,
      relatedType: "call_record",
      relatedId: call.id,
      variables: {
        purposes: withdrawnPurposes.map((purpose) => PURPOSE_LABELS[purpose]).join(", "),
        undoInstructions:
          "To give consent again, ask your Laboura agent to send a consent link and complete it on your phone by OTP.",
      },
    });

    return { withdrawn: true, purposes: withdrawnPurposes };
  }
}
