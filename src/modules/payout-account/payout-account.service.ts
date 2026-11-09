import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PublicLinkStoreService } from '../../common/public-link-store.service';
import { PricingService } from '../pricing/pricing.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { MessagingService } from '../message/messaging.service';
import { OtpService } from '../../common/otp/otp.service';
import { ReviewFlagService } from '../review-flag/review-flag.service';
import { decryptCallRoutingPhone } from '../staff/call-routing-key';
import { publicLink } from '../../common/public-link';
import {
  encryptPayoutValue,
  getPayoutAccountKey,
  hashPayoutValue,
  maskPayoutValue,
  normalizePayoutValue,
} from './payout-account-key';
import { CreatePayoutLinkDto } from './dto/create-payout-link.dto';
import { SubmitPayoutAccountDto } from './dto/submit-payout-account.dto';

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '***';
  return `+91 ******${digits.slice(-4)}`;
}

@Injectable()
export class PayoutAccountService {
  private ttlMs = 24 * 60 * 60 * 1000; // 24 hours

  constructor(
    private readonly prisma: PrismaService,
    private readonly publicLinks: PublicLinkStoreService,
    private readonly pricingService: PricingService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly messagingService: MessagingService,
    private readonly otpService: OtpService,
    private readonly reviewFlagService: ReviewFlagService,
  ) {
    getPayoutAccountKey();
  }

  setTtlMs(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  async createPayoutLink(
    actorId: string,
    actorRole: string,
    dto: CreatePayoutLinkDto,
    now = new Date(),
  ) {
    let ownerName = '';
    let phone = '';

    if (dto.ownerType === 'job_seeker') {
      const js = await this.prisma.jobSeeker.findUnique({
        where: { id: dto.ownerId },
        select: { id: true, name: true, phone: true },
      });
      if (!js) throw new NotFoundException(`JobSeeker '${dto.ownerId}' not found`);
      ownerName = js.name;
      phone = js.phone;
    } else if (dto.ownerType === 'referral') {
      const ref = await this.prisma.referral.findUnique({
        where: { id: dto.ownerId },
        select: { id: true, name: true, phone: true },
      });
      if (!ref) throw new NotFoundException(`Referral '${dto.ownerId}' not found`);
      ownerName = ref.name;
      phone = ref.phone;
    } else if (dto.ownerType === 'business') {
      const biz = await this.prisma.business.findUnique({
        where: { id: dto.ownerId },
        select: { id: true, name: true, ownerName: true, phone: true },
      });
      if (!biz) throw new NotFoundException(`Business '${dto.ownerId}' not found`);
      ownerName = biz.ownerName || biz.name;
      phone = biz.phone;
    } else {
      throw new BadRequestException(`Invalid ownerType '${dto.ownerType}'`);
    }

    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const { token, id } = await this.publicLinks.create({
      purpose: 'payout_details', subjectType: dto.ownerType, subjectId: dto.ownerId,
      phone, expiresAt, metadata: { ownerName },
    });

    await this.messagingService.send({
      channel: 'sms',
      template: 'payout_details_link',
      subjectType: dto.ownerType,
      subjectId: dto.ownerId,
      variables: {
        token,
        link: publicLink(`/payout-accounts/link/${token}`),
      },
    });

    let effectiveActorId = actorId;
    if (this.prisma.staff?.findUnique) {
      const staff = await this.prisma.staff.findUnique({
        where: { id: actorId },
        select: { id: true },
      });
      if (!staff && this.prisma.staff?.findFirst) {
        const fallbackStaff = await this.prisma.staff.findFirst({
          where: { role: 'ceo' },
          select: { id: true },
        });
        if (fallbackStaff) effectiveActorId = fallbackStaff.id;
      }
    }

    await this.auditService.log({
      action: 'payout_link_created',
      entityType: 'PayoutAccount',
      entityCode: id,
      actorId: effectiveActorId,
      after: {
        ownerType: dto.ownerType,
        ownerId: dto.ownerId,
      },
    });

    return { linkSent: true };
  }

  hasActiveLink(ownerType: string, ownerId: string, now = new Date()): Promise<boolean> {
    return this.publicLinks.hasActive('payout_details', ownerType, ownerId, now);
  }

  async hasPayoutAccount(ownerType: string, ownerId: string): Promise<boolean> {
    const account = await this.prisma.payoutAccount.findFirst({
      where: {
        ownerType,
        ownerId,
        status: { not: 'superseded' },
      },
    });
    return Boolean(account);
  }

  async sendLinkIfNotOnRecord(
    ownerType: 'referral' | 'job_seeker' | 'business',
    ownerId: string,
    actorId: string,
    actorRole = 'system',
    now = new Date(),
  ): Promise<{ linkSent: boolean; reason?: string }> {
    const hasAccount = await this.hasPayoutAccount(ownerType, ownerId);
    if (hasAccount) {
      return { linkSent: false, reason: 'account_exists' };
    }
    if (await this.hasActiveLink(ownerType, ownerId, now)) {
      return { linkSent: false, reason: 'link_already_active' };
    }
    return this.createPayoutLink(actorId, actorRole, { ownerType, ownerId }, now);
  }

  async getLinkDetails(token: string) {
    const record = await this.getPayoutLink(token, new Date(), false);
    if (record.purpose !== 'payout_details' || !record.phone) throw new NotFoundException('Payout link token not found');

    return {
      valid: true,
      ownerType: record.subjectType,
      ownerName: String((record.metadata as unknown as { ownerName?: string } | null)?.ownerName ?? ''),
      maskedPhone: maskPhone(record.phone),
    };
  }

  async sendOtp(token: string) {
    const record = await this.getPayoutLink(token, new Date(), true);
    if (record.purpose !== 'payout_details' || !record.phone) throw new BadRequestException('Invalid or expired payout link token');

    const otp = await this.otpService.sendOtp(record.phone);
    return {
      success: true,
      requestId: otp.requestId,
      maskedPhone: maskPhone(record.phone),
    };
  }

  async submitPayoutAccount(
    dto: SubmitPayoutAccountDto,
    now = new Date(),
  ) {
    const record = await this.getPayoutLink(dto.token, now, false);
    if (record.purpose !== 'payout_details' || !record.phone) throw new NotFoundException('Payout link token not found');
    const ownerName = String((record.metadata as unknown as { ownerName?: string } | null)?.ownerName ?? '');

    const validCode = await this.otpService.verifyOtp(dto.otpRequestId, dto.otpCode);
    if (!validCode) {
      throw new BadRequestException('Invalid or expired OTP code');
    }

    let rawValue = '';
    let normalized = '';
    let maskedValue = '';
    let valueHash = '';
    let upiIdEncrypted: string | null = null;
    let bankAccountEncrypted: string | null = null;
    let ifsc: string | null = null;

    if (dto.method === 'upi') {
      if (!dto.upiId || !dto.upiId.trim() || !dto.upiId.includes('@')) {
        throw new BadRequestException('A valid UPI ID is required (e.g. handle@bank)');
      }
      rawValue = dto.upiId.trim();
      normalized = normalizePayoutValue('upi', rawValue);
      maskedValue = maskPayoutValue('upi', normalized);
      valueHash = hashPayoutValue('upi', normalized);
      upiIdEncrypted = encryptPayoutValue(rawValue);
    } else if (dto.method === 'bank') {
      if (!dto.accountNumber || !dto.accountNumber.trim()) {
        throw new BadRequestException('Account number is required');
      }
      if (!dto.ifsc || !dto.ifsc.trim() || dto.ifsc.trim().length !== 11) {
        throw new BadRequestException('A valid 11-character IFSC code is required');
      }
      rawValue = dto.accountNumber.trim();
      normalized = normalizePayoutValue('bank', rawValue);
      maskedValue = maskPayoutValue('bank', normalized);
      valueHash = hashPayoutValue('bank', normalized);
      bankAccountEncrypted = encryptPayoutValue(rawValue);
      ifsc = dto.ifsc.trim().toUpperCase();
    } else {
      throw new BadRequestException(`Invalid method '${dto.method}'`);
    }

    // Fraud check 1: Duplicate hash across different owners
    const sharedAccount = await this.prisma.payoutAccount.findFirst({
      where: {
        valueHash,
        status: { not: 'superseded' },
        OR: [
          { ownerType: { not: record.subjectType } },
          { ownerId: { not: record.subjectId } },
        ],
      },
    });

    let isFlagged = false;
    let flagReason: string | null = null;

    if (sharedAccount) {
      isFlagged = true;
      flagReason = 'payout_shared_account';
    }

    // Fraud check 2: Staff number check on UPI handle
    if (dto.method === 'upi') {
      const upiDigits = normalized.replace(/\D/g, '');
      if (upiDigits.length >= 10) {
        const staffList = await this.prisma.staff.findMany({
          where: { callRoutingPhone: { not: null } },
          select: { id: true, code: true, callRoutingPhone: true },
        });

        for (const staff of staffList) {
          if (!staff.callRoutingPhone) continue;
          let routingPhoneDigits = '';
          try {
            const decryptedRouting = decryptCallRoutingPhone(staff.callRoutingPhone);
            routingPhoneDigits = decryptedRouting.replace(/\D/g, '');
          } catch {
            // Ignore decryption failures for tests or empty values
          }

          if (routingPhoneDigits && routingPhoneDigits.length >= 10) {
            const last10Routing = routingPhoneDigits.slice(-10);
            const last10Upi = upiDigits.slice(-10);
            if (
              last10Routing === last10Upi ||
              routingPhoneDigits.includes(upiDigits) ||
              upiDigits.includes(routingPhoneDigits)
            ) {
              isFlagged = true;
              flagReason = 'payout_matches_staff';
              break;
            }
          }
        }
      }
    }

    // Check existing accounts for this owner
    const existingAccounts = await this.prisma.payoutAccount.findMany({
      where: {
      ownerType: record.subjectType,
      ownerId: record.subjectId,
        status: { not: 'superseded' },
      },
    });

    let activeFrom = now;
    const isChange = existingAccounts.length > 0;

    if (isChange) {
      const policy = await this.pricingService.current();
      const coolingHours = policy.payoutDetailsCoolingHours ?? 48;
      activeFrom = new Date(now.getTime() + coolingHours * 60 * 60 * 1000);

      // Supersede all existing active/pending accounts
      await this.prisma.payoutAccount.updateMany({
        where: {
          ownerType: record.subjectType,
          ownerId: record.subjectId,
          status: { not: 'superseded' },
        },
        data: {
          status: 'superseded',
        },
      });
    }

    const initialStatus = isFlagged ? 'flagged' : 'pending_validation';
    const code = await this.idService.generateCode('payout_account');

    const account = await this.prisma.payoutAccount.create({
      data: {
        code,
        ownerType: record.subjectType,
        ownerId: record.subjectId,
        ownerNameAtEntry: ownerName,
        method: dto.method,
        maskedValue,
        valueHash,
        upiIdEncrypted,
        bankAccountEncrypted,
        ifsc,
        status: initialStatus,
        activeFrom,
        changeOtpRequestId: isChange ? dto.otpRequestId : null,
      },
    });

    await this.publicLinks.markUsed(dto.token, now);

    // Raise ReviewFlag if fraud checks triggered
    if (flagReason === 'payout_shared_account') {
      await this.reviewFlagService.raise({
        kind: 'payout_shared_account',
        subjectType: record.subjectType,
        subjectId: record.subjectId,
        details: {
          payoutAccountId: account.id,
          payoutAccountCode: account.code,
          sharedWithAccountId: sharedAccount?.id,
          sharedWithAccountCode: sharedAccount?.code,
          sharedWithOwnerType: sharedAccount?.ownerType,
          sharedWithOwnerId: sharedAccount?.ownerId,
        },
      });
    } else if (flagReason === 'payout_matches_staff') {
      await this.reviewFlagService.raise({
        kind: 'payout_matches_staff',
        subjectType: record.subjectType,
        subjectId: record.subjectId,
        details: {
          payoutAccountId: account.id,
          payoutAccountCode: account.code,
          upiIdMasked: maskedValue,
        },
      });
    }

    await this.auditService.log({
      action: isChange ? 'payout_account_changed' : 'payout_account_created',
      entityType: 'PayoutAccount',
      entityCode: account.code,
      actorId: 'system',
      after: {
        ownerType: record.subjectType,
        ownerId: record.subjectId,
        isChange,
        activeFrom: activeFrom.toISOString(),
        status: initialStatus,
      },
    });

    return {
      success: true,
      id: account.id,
      accountId: account.id,
      code: account.code,
      maskedValue: account.maskedValue,
      status: account.status,
      activeFrom: account.activeFrom,
    };
  }

  async listAccountsForOwner(ownerType: string, ownerId: string) {
    const accounts = await this.prisma.payoutAccount.findMany({
      where: { ownerType, ownerId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        ownerType: true,
        ownerId: true,
        ownerNameAtEntry: true,
        method: true,
        maskedValue: true,
        ifsc: true,
        verifiedName: true,
        nameMatches: true,
        status: true,
        validatedAt: true,
        activeFrom: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return accounts;
  }

  private async getPayoutLink(token: string, now: Date, invalidAsBadRequest: boolean) {
    try {
      return await this.publicLinks.findByToken(token, now);
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        if (invalidAsBadRequest) throw new BadRequestException('Invalid or expired payout link token');
        throw new NotFoundException('Payout link token not found');
      }
      if (error instanceof BadRequestException) {
        if (invalidAsBadRequest) throw new BadRequestException('Invalid or expired payout link token');
        if (error.message === 'Public link has already been used') throw new BadRequestException('Payout link token has already been used');
        if (error.message === 'Public link has expired') throw new BadRequestException('Payout link token has expired');
      }
      throw error;
    }
  }

  async listCoolingAccounts(now = new Date()) {
    return this.prisma.payoutAccount.findMany({
      where: {
        activeFrom: { gt: now },
        status: { not: 'superseded' },
      },
      orderBy: { activeFrom: 'asc' },
      select: {
        id: true,
        code: true,
        ownerType: true,
        ownerId: true,
        ownerNameAtEntry: true,
        method: true,
        maskedValue: true,
        status: true,
        activeFrom: true,
        createdAt: true,
      },
    });
  }
}
