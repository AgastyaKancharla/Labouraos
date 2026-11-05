import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConsentClock } from './consent-clock';
import { ConsentService } from './consent.service';
import { MessagingService } from '../message/messaging.service';
import { OtpService } from '../../common/otp/otp.service';
import { recordStatusChange } from '../../common/status-history/status-history.helper';
import { DEFAULT_NOTICE_VERSION } from './consent.constants';

export interface ConsentLinkTokenRecord {
  token: string;
  jobSeekerId: string;
  expiresAt: Date;
  usedAt?: Date | null;
  createdAt: Date;
}

export interface SubmitConsentDto {
  token: string;
  otpRequestId: string;
  otpCode?: string;
  purposes: string[];
  language?: string;
}

@Injectable()
export class ConsentLinkService {
  private readonly tokens = new Map<string, ConsentLinkTokenRecord>();
  private ttlMs = 24 * 60 * 60 * 1000; // 24 hours

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ConsentClock,
    private readonly consentService: ConsentService,
    private readonly messagingService: MessagingService,
    private readonly otpService: OtpService,
  ) {}

  setTtlMs(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  async createLink(jobSeekerId: string) {
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    const token = randomBytes(32).toString('hex');
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.ttlMs);

    const record: ConsentLinkTokenRecord = {
      token,
      jobSeekerId: seeker.id,
      expiresAt,
      usedAt: null,
      createdAt: now,
    };
    this.tokens.set(token, record);

    // Send single-use link via SMS
    await this.messagingService.send({
      channel: 'sms',
      template: 'consent_link',
      subjectType: 'job_seeker',
      subjectId: seeker.id,
      variables: {
        token,
        link: `/consent/${token}`,
      },
    });

    // NOTE: Job seeker's phone number must NEVER appear in this response
    return {
      success: true,
      token,
      expiresAt,
    };
  }

  validateToken(token: string): ConsentLinkTokenRecord {
    const record = this.tokens.get(token);
    if (!record) {
      throw new BadRequestException('Invalid consent link token');
    }
    if (record.usedAt) {
      throw new BadRequestException('Consent link has already been used');
    }
    if (this.clock.now().getTime() > record.expiresAt.getTime()) {
      throw new BadRequestException('Consent link has expired');
    }
    return record;
  }

  async getTokenDetails(token: string) {
    const record = this.validateToken(token);
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: record.jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException('Job seeker not found');
    }

    const firstLang = await this.prisma.jobSeekerLanguage.findFirst({
      where: { jobSeekerId: seeker.id },
    });
    const candidateLang = firstLang?.language?.toLowerCase() || 'kn';
    const preferredLanguage = ['kn', 'hi', 'en'].includes(candidateLang)
      ? candidateLang
      : 'kn';

    return {
      valid: true,
      jobSeekerId: seeker.id,
      candidateName: seeker.name,
      phone: seeker.phone,
      preferredLanguage,
    };
  }

  async sendOtp(token: string) {
    const record = this.validateToken(token);
    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: record.jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException('Job seeker not found');
    }

    const otp = await this.otpService.sendOtp(seeker.phone);
    return {
      success: true,
      requestId: otp.requestId,
      phone: seeker.phone,
    };
  }

  async submitConsent(dto: SubmitConsentDto) {
    const record = this.validateToken(dto.token);

    const seeker = await this.prisma.jobSeeker.findUnique({
      where: { id: record.jobSeekerId },
    });
    if (!seeker) {
      throw new NotFoundException('Job seeker not found');
    }

    // Verify OTP: either through otpCode or if already verified
    if (dto.otpCode) {
      const ok = await this.otpService.verifyOtp(dto.otpRequestId, dto.otpCode);
      if (!ok) {
        throw new BadRequestException('Invalid or expired OTP');
      }
    } else {
      const verified = await this.otpService.isVerified(dto.otpRequestId, seeker.phone);
      if (!verified) {
        throw new BadRequestException('OTP verification is required before submission');
      }
    }

    let language = dto.language;
    if (!language) {
      const firstLang = await this.prisma.jobSeekerLanguage.findFirst({
        where: { jobSeekerId: seeker.id },
      });
      const candidateLang = firstLang?.language?.toLowerCase() || 'kn';
      language = ['kn', 'hi', 'en'].includes(candidateLang) ? candidateLang : 'kn';
    }
    const purposes = Array.isArray(dto.purposes) ? dto.purposes : [];

    // Grant each selected purpose
    for (const purpose of purposes) {
      await this.consentService.grant({
        subjectType: 'job_seeker',
        subjectId: seeker.id,
        purpose,
        noticeVersion: DEFAULT_NOTICE_VERSION,
        language,
        method: 'sms_link',
        otpRequestId: dto.otpRequestId,
      });
    }

    // Mark token as used
    record.usedAt = this.clock.now();

    // Move a lead forward after first consent, or reactivate a paused seeker once all required purposes are restored.
    const hasAll = await this.consentService.hasAllRequired('job_seeker', seeker.id);
    let finalStatus = seeker.status;

    if (hasAll && (seeker.status === 'lead' || seeker.status === 'paused')) {
      const nextStatus = seeker.status === 'lead' ? 'consented' : 'active';
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.jobSeeker.update({
          where: { id: seeker.id },
          data: { status: nextStatus, ...(nextStatus === 'active' ? { pausedAt: null } : {}) },
        });
        await recordStatusChange(tx, {
          subjectType: 'job_seeker',
          subjectId: seeker.id,
          fromStatus: seeker.status,
          toStatus: nextStatus,
          changedByStaffId: null,
          reason: nextStatus === 'active'
            ? 'all_required_consents_restored_via_sms_link'
            : 'all_required_consents_granted_via_sms_link',
        });
        finalStatus = updated.status;
      });
    }

    return {
      success: true,
      status: finalStatus,
      grantedPurposes: purposes,
    };
  }
}
