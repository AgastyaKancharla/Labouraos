import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PublicLinkPurpose, Prisma } from '@prisma/client';
import { PrismaService } from './prisma/prisma.service';
import { decryptCallRoutingPhone, encryptCallRoutingPhone } from '../modules/staff/call-routing-key';
import { normaliseIndianMobile } from './phone/indian-mobile';

/**
 * The number on a public link, readable: the column holds AES-GCM ciphertext,
 * so a direct Prisma read must decrypt it before masking or display. Older or
 * hand-written rows that hold the plain number are returned as they are.
 * Either way the answer is in the one stored format (+91 and 10 digits).
 */
export function readPublicLinkPhone(stored: string | null | undefined): string | null {
  if (!stored) return null;
  let plain = stored;
  try {
    plain = decryptCallRoutingPhone(stored);
  } catch {
    plain = stored;
  }
  return normaliseIndianMobile(plain);
}

export interface CreatePublicLinkInput {
  purpose: PublicLinkPurpose;
  subjectType: string;
  subjectId: string;
  phone?: string;
  language?: string;
  expiresAt: Date;
  createdByStaffId?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface PublicLinkContext {
  userAgent?: string;
  ipHash?: string;
}

@Injectable()
export class PublicLinkStoreService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreatePublicLinkInput): Promise<{ token: string; id: string }> {
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const row = await this.prisma.publicLink.create({
      data: {
        tokenHash,
        purpose: input.purpose,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        phone: input.phone ? encryptCallRoutingPhone(normaliseIndianMobile(input.phone)) : null,
        language: input.language ?? null,
        expiresAt: input.expiresAt,
        createdByStaffId: input.createdByStaffId ?? null,
        metadata: input.metadata,
      },
      select: { id: true },
    });
    return { token, id: row.id };
  }

  async findByToken(token: string, now = new Date()) {
    const row = await this.prisma.publicLink.findUnique({
      where: { tokenHash: this.hashToken(token) },
    });
    if (!row) throw new NotFoundException('Public link token not found');
    if (row.revokedAt) throw new BadRequestException('Public link has been revoked');
    if (row.usedAt) throw new BadRequestException('Public link has already been used');
    if (row.expiresAt.getTime() <= now.getTime()) throw new BadRequestException('Public link has expired');

    if (!row.openedAt) {
      await this.prisma.publicLink.updateMany({
        where: { id: row.id, openedAt: null },
        data: { openedAt: now },
      });
    }
    return { ...row, phone: row.phone ? normaliseIndianMobile(decryptCallRoutingPhone(row.phone)) : null };
  }

  async markUsed(token: string, now = new Date(), context: PublicLinkContext = {}): Promise<void> {
    const changed = await this.prisma.publicLink.updateMany({
      where: {
        tokenHash: this.hashToken(token),
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        usedAt: now,
        completedUserAgent: context.userAgent ?? null,
        completedIpHash: context.ipHash ?? null,
      },
    });
    if (changed.count !== 1) throw new BadRequestException('Public link is no longer valid');
  }

  async hasActive(purpose: PublicLinkPurpose, subjectType: string, subjectId: string, now = new Date()) {
    return Boolean(await this.prisma.publicLink.findFirst({
      where: { purpose, subjectType, subjectId, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      select: { id: true },
    }));
  }

  async revoke(token: string, now = new Date()): Promise<void> {
    await this.prisma.publicLink.updateMany({
      where: { tokenHash: this.hashToken(token), usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async revokeActive(purpose: PublicLinkPurpose, subjectType: string, subjectId: string, now = new Date()) {
    return this.prisma.publicLink.updateMany({
      where: { purpose, subjectType, subjectId, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
  }

  async deleteExpiredBefore(cutoff: Date) {
    const [links, sessions] = await this.prisma.$transaction([
      this.prisma.publicLink.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
      this.prisma.otpSession.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
    ]);
    return { links: links.count, sessions: sessions.count };
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
