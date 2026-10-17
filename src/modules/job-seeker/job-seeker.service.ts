import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { OtpService } from '../../common/otp/otp.service';
import { CreateJobSeekerDto } from './dto/create-job-seeker.dto';
import {
  assertNoRawAadhaar,
  validateCallWindow,
  validateSalaryRange,
} from './job-seeker.validator';
import {
  refundGuaranteeDeadline,
  isWithinRefundGuarantee,
} from '../../common/money/money';

import { PaymentService } from '../payment/payment.service';

@Injectable()
export class JobSeekerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly otpService: OtpService,
    private readonly paymentService: PaymentService,
  ) {}

  async create(dto: CreateJobSeekerDto, actorId: string) {
    assertNoRawAadhaar(dto);

    const phone = (dto.phone ?? dto.mobileNumber)?.trim();
    if (!phone) {
      throw new BadRequestException('Mobile number is required');
    }

    if (!dto.tradeSkill || typeof dto.tradeSkill !== 'string') {
      throw new BadRequestException('tradeSkill is required');
    }

    validateCallWindow(dto.preferredCallWindowStart, dto.preferredCallWindowEnd);
    validateSalaryRange(dto.minSalary, dto.maxSalary);

    if (!dto.otpRequestId) {
      throw new BadRequestException('otpRequestId is required: mobile number must pass OTP verification');
    }

    const isVerified = await this.otpService.isVerified(dto.otpRequestId, phone);
    if (!isVerified) {
      throw new BadRequestException('Mobile number must pass OTP verification before registration');
    }

    if (dto.referredById) {
      const referral = await this.prisma.referral.findUnique({
        where: { id: dto.referredById },
      });
      if (!referral) {
        throw new BadRequestException(`Referral partner with id '${dto.referredById}' does not exist`);
      }
    }

    const existing = await this.prisma.jobSeeker.findUnique({
      where: { phone },
    });
    if (existing) {
      throw new ConflictException(`Job seeker with phone '${phone}' already exists`);
    }

    const code = await this.idService.generateCode('job_seeker');

    const jobSeeker = await this.prisma.jobSeeker.create({
      data: {
        code,
        name: dto.name?.trim() || 'Job Seeker',
        phone,
        phoneVerified: true,
        tradeSkill: dto.tradeSkill,
        minSalary: dto.minSalary,
        maxSalary: dto.maxSalary,
        preferredCallWindowStart: dto.preferredCallWindowStart,
        preferredCallWindowEnd: dto.preferredCallWindowEnd,
        city: dto.city ?? 'Bengaluru',
        status: 'pending_payment',
        referredById: dto.referredById ?? null,
      },
    });

    await this.auditService.log({
      actorId,
      action: 'job_seeker.create',
      entityType: 'job_seeker',
      entityCode: code,
      after: jobSeeker as unknown as Record<string, unknown>,
      city: jobSeeker.city,
    });

    return jobSeeker;
  }

  async findAll() {
    return this.prisma.jobSeeker.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, now: Date = new Date()) {
    const jobSeeker = await this.prisma.jobSeeker.findUnique({
      where: { id },
      include: {
        referredBy: true,
        payments: true,
      },
    });
    if (!jobSeeker) {
      throw new NotFoundException(`Job seeker '${id}' not found`);
    }

    const deadline = jobSeeker.paymentReceivedAt
      ? refundGuaranteeDeadline(jobSeeker.paymentReceivedAt)
      : null;
    const isWithinGuarantee = jobSeeker.paymentReceivedAt
      ? isWithinRefundGuarantee(jobSeeker.paymentReceivedAt, now)
      : false;

    return {
      ...jobSeeker,
      refundGuaranteeDeadline: deadline,
      isWithinRefundGuarantee: isWithinGuarantee,
    };
  }

  async createActivationPayment(jobSeekerId: string) {
    const jobSeeker = await this.prisma.jobSeeker.findUnique({
      where: { id: jobSeekerId },
    });
    if (!jobSeeker) {
      throw new NotFoundException(`Job seeker '${jobSeekerId}' not found`);
    }

    if (jobSeeker.status === 'active') {
      throw new BadRequestException('Job seeker is already active');
    }

    const charge = await this.paymentService.createCharge(
      49900,
      'job_seeker',
      jobSeeker.id,
    );

    const code = await this.idService.generateCode('payment');

    const payment = await this.prisma.payment.create({
      data: {
        code,
        city: jobSeeker.city,
        type: 'activation',
        amount: 49900,
        status: 'pending',
        gatewayReference: charge.gatewayReference,
        subjectType: 'job_seeker',
        subjectId: jobSeeker.id,
        jobSeekerId: jobSeeker.id,
      },
    });

    return {
      paymentId: payment.id,
      paymentCode: payment.code,
      paymentLink: charge.paymentLink,
      gatewayReference: charge.gatewayReference,
      amount: payment.amount,
      status: payment.status,
    };
  }
}
