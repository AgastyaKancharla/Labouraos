import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface PricingPolicy {
  activationFeePaise: number;
  placementFeePercent: number;
  gstPercent: number;
  referralPayoutPaise: number;
  replacementWindowDays: number;
  replacementSearchDays: number;
  jobSeekerGuaranteeDays: number;
  maxReplacementRejections: number;
  updatedAt: string;
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  // In-memory policy state initialized with §6 domain rules
  private policy: PricingPolicy = {
    activationFeePaise: 49900,
    placementFeePercent: 50,
    gstPercent: 18,
    referralPayoutPaise: 20000,
    replacementWindowDays: 60,
    replacementSearchDays: 15,
    jobSeekerGuaranteeDays: 30,
    maxReplacementRejections: 2,
    updatedAt: new Date().toISOString(),
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  getPolicy(): PricingPolicy {
    return { ...this.policy };
  }

  async updatePolicy(
    updates: Partial<PricingPolicy>,
    actorId: string,
  ): Promise<PricingPolicy> {
    const before = { ...this.policy };

    this.policy = {
      ...this.policy,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });

    if (actor) {
      await this.auditService.log({
        actorId: actor.id,
        action: 'pricing_change',
        entityType: 'pricing',
        entityCode: 'SYSTEM_PRICING',
        before,
        after: this.policy as unknown as Record<string, unknown>,
        city: 'Bengaluru',
      });
    }

    this.logger.log(`Pricing policy updated by actor ${actorId}`);
    return { ...this.policy };
  }
}
