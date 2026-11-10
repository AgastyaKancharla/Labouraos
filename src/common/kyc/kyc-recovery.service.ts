import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KycService } from './kyc.service';
import { PublicLinkStoreService } from '../public-link-store.service';
import { MessagingService } from '../../modules/message/messaging.service';
import { publicLink } from '../public-link';

const ID_CHECK_STATE_ID = 'id-check';
const REGISTRATION_LINK_TTL_MS = 48 * 60 * 60 * 1000;

@Injectable()
export class KycRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kyc: KycService,
    private readonly links: PublicLinkStoreService,
    private readonly messages: MessagingService,
  ) {}

  async verify(params: Record<string, unknown>) {
    try {
      const result = await this.kyc.verifyOfflineAadhaar(params);
      if (result.failureType === 'provider') await this.markDown();
      return result;
    } catch (error: unknown) {
      await this.markDown();
      throw error;
    }
  }

  async markDown(now = new Date()): Promise<void> {
    const current = await this.prisma.kycServiceState.findUnique({ where: { id: ID_CHECK_STATE_ID } });
    if (current?.status === 'down') return;
    await this.prisma.kycServiceState.upsert({
      where: { id: ID_CHECK_STATE_ID },
      create: { id: ID_CHECK_STATE_ID, status: 'down', lastChangedAt: now },
      update: { status: 'down', lastChangedAt: now },
    });
  }

  async requestRecovery(jobSeekerId: string, registrationLinkId?: string): Promise<void> {
    const existing = await this.prisma.kycRecoveryRequest.findFirst({
      where: { jobSeekerId, status: 'waiting' },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.kycRecoveryRequest.update({
        where: { id: existing.id },
        data: { registrationLinkId: registrationLinkId ?? null },
      });
      return;
    }
    await this.prisma.kycRecoveryRequest.create({
      data: { jobSeekerId, registrationLinkId: registrationLinkId ?? null },
    });
  }

  async isDown(): Promise<boolean> {
    const state = await this.prisma.kycServiceState.findUnique({ where: { id: ID_CHECK_STATE_ID } });
    return state?.status === 'down';
  }

  async checkAndRecover(now = new Date()): Promise<{ checked: boolean; healthy: boolean; notified: number }> {
    const state = await this.prisma.kycServiceState.findUnique({ where: { id: ID_CHECK_STATE_ID } });
    if (!state || state.status !== 'down') return { checked: false, healthy: false, notified: 0 };

    let health: { healthy: boolean };
    try {
      health = await this.kyc.checkHealth();
    } catch {
      return { checked: true, healthy: false, notified: 0 };
    }
    if (!health.healthy) return { checked: true, healthy: false, notified: 0 };

    const changed = await this.prisma.kycServiceState.updateMany({
      where: { id: ID_CHECK_STATE_ID, status: 'down' },
      data: { status: 'up', lastChangedAt: now },
    });
    if (changed.count !== 1) return { checked: true, healthy: true, notified: 0 };

    const requests = await this.prisma.kycRecoveryRequest.findMany({
      where: { status: 'waiting' },
      orderBy: { requestedAt: 'asc' },
      select: { id: true, jobSeekerId: true, registrationLinkId: true },
    });
    let notified = 0;
    for (const request of requests) {
      const claimed = await this.prisma.kycRecoveryRequest.updateMany({
        where: { id: request.id, status: 'waiting' },
        data: { status: 'notifying' },
      });
      if (claimed.count !== 1) continue;

      let link: string | undefined;
      if (request.registrationLinkId) {
        const oldLink = await this.prisma.publicLink.findUnique({
          where: { id: request.registrationLinkId },
          select: { id: true, expiresAt: true, usedAt: true, revokedAt: true },
        });
        if (!oldLink || oldLink.expiresAt.getTime() <= now.getTime() || oldLink.revokedAt || oldLink.usedAt) {
          if (oldLink && !oldLink.revokedAt) {
            await this.prisma.publicLink.updateMany({
              where: { id: oldLink.id, revokedAt: null },
              data: { revokedAt: now },
            });
          }
          const seeker = await this.prisma.jobSeeker.findUnique({
            where: { id: request.jobSeekerId },
            select: { id: true, phone: true, messageLanguage: true },
          });
          if (seeker) {
            const created = await this.links.create({
              purpose: 'registration',
              subjectType: 'job_seeker',
              subjectId: seeker.id,
              phone: seeker.phone,
              language: seeker.messageLanguage ?? 'en',
              expiresAt: new Date(now.getTime() + REGISTRATION_LINK_TTL_MS),
              metadata: { resumable: true },
            });
            link = publicLink(`/consent/${created.token}`);
            await this.prisma.kycRecoveryRequest.update({
              where: { id: request.id },
              data: { registrationLinkId: created.id },
            });
          }
        }
      }

      await this.messages.send({
        channel: 'sms',
        template: 'id_check_recovered',
        subjectType: 'job_seeker',
        subjectId: request.jobSeekerId,
        variables: link ? { link } : {},
      });
      await this.prisma.kycRecoveryRequest.update({
        where: { id: request.id },
        data: { status: 'notified', notifiedAt: now },
      });
      notified += 1;
    }
    return { checked: true, healthy: true, notified };
  }
}
