import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { calculatePlacementFee, calculateGst } from '../../common/money/money';
import { JobSeekerService } from '../job-seeker/job-seeker.service';
import { PaymentService } from '../payment/payment.service';
import { CreatePlacementDto } from './dto/create-placement.dto';
import { RespondPlacementDto } from './dto/respond-placement.dto';
import { RecordJoinedDto } from './dto/record-joined.dto';
import { RecordDropoutDto } from './dto/record-dropout.dto';

@Injectable()
export class PlacementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly jobSeekerService: JobSeekerService,
    private readonly paymentService: PaymentService,
  ) {}

  async create(vacancyId: string, dto: CreatePlacementDto, actorId: string) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const vacancy = await this.prisma.vacancy.findFirst({
      where: {
        OR: [{ id: vacancyId }, { code: vacancyId }],
      },
      include: { business: true },
    });
    if (!vacancy) {
      throw new NotFoundException(`Vacancy '${vacancyId}' not found`);
    }

    // Field agents can only place for vacancies in their assigned area
    if (actor.role === 'field_agent') {
      if (!actor.area || vacancy.business.area !== actor.area) {
        throw new ForbiddenException(
          `Field agent can only create placements for vacancies in their own area '${actor.area}', but vacancy belongs to '${vacancy.business.area}'`,
        );
      }
    }

    const agreedSalary = dto.agreedSalary ?? dto.monthlySalary;
    if (agreedSalary === undefined || agreedSalary <= 0 || !Number.isInteger(agreedSalary)) {
      throw new BadRequestException('agreedSalary must be a positive integer in paise');
    }

    if (!dto.jobSeekerId || typeof dto.jobSeekerId !== 'string') {
      throw new BadRequestException('jobSeekerId is required');
    }

    const jobSeeker = await this.prisma.jobSeeker.findFirst({
      where: {
        OR: [{ id: dto.jobSeekerId }, { code: dto.jobSeekerId }],
      },
    });
    if (!jobSeeker) {
      throw new NotFoundException(`Job seeker '${dto.jobSeekerId}' not found`);
    }

    if (jobSeeker.status === 'placed') {
      throw new BadRequestException(
        `Job seeker '${jobSeeker.code}' is already placed and cannot receive another offer`,
      );
    }

    if (jobSeeker.status === 'deactivated') {
      throw new BadRequestException(
        `Job seeker '${jobSeeker.code}' is deactivated and cannot receive an offer`,
      );
    }

    const placementFee = calculatePlacementFee(agreedSalary);
    const gstAmount = calculateGst(placementFee);
    const code = await this.idService.generateCode('placement');

    const placement = await this.prisma.placement.create({
      data: {
        code,
        city: vacancy.city,
        vacancyId: vacancy.id,
        jobSeekerId: jobSeeker.id,
        businessId: vacancy.businessId,
        agreedSalary,
        placementFee,
        gstAmount,
        status: 'offered',
      },
      include: {
        vacancy: true,
        jobSeeker: true,
        business: true,
      },
    });

    await this.auditService.log({
      action: 'placement_created',
      entityType: 'Placement',
      entityCode: placement.code,
      actorId: actor.id,
      city: placement.city,
      after: {
        status: placement.status,
        agreedSalary: placement.agreedSalary,
        placementFee: placement.placementFee,
        gstAmount: placement.gstAmount,
        vacancyId: vacancy.id,
        jobSeekerId: jobSeeker.id,
        businessId: vacancy.businessId,
      },
    });

    return placement;
  }

  async respond(id: string, dto: RespondPlacementDto, actorId: string) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const placement = await this.prisma.placement.findFirst({
      where: {
        OR: [{ id }, { code: id }],
      },
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
      },
    });
    if (!placement) {
      throw new NotFoundException(`Placement '${id}' not found`);
    }

    if (actor.role === 'field_agent') {
      if (!actor.area || placement.business.area !== actor.area) {
        throw new ForbiddenException(
          `Field agent can only manage placements in their own area '${actor.area}', but placement belongs to '${placement.business.area}'`,
        );
      }
    }

    if (placement.status !== 'offered') {
      throw new BadRequestException(
        `Placement must be in 'offered' status to respond. Current status: '${placement.status}'`,
      );
    }

    if (dto.response !== 'accepted' && dto.response !== 'rejected') {
      throw new BadRequestException("response must be either 'accepted' or 'rejected'");
    }

    const before = { status: placement.status };

    if (dto.response === 'rejected') {
      const note = dto.rejectionReason ?? dto.note ?? 'Offer rejected';
      // Record hit on job seeker (Phase 3 hit cycle: 3 hits deactivate)
      await this.jobSeekerService.recordHit(
        placement.jobSeekerId,
        'offer_rejected',
        note,
        actor.id,
      );

      const updated = await this.prisma.placement.update({
        where: { id: placement.id },
        data: { status: 'rejected' },
        include: { business: true, jobSeeker: true, vacancy: true },
      });

      await this.auditService.log({
        action: 'placement_rejected',
        entityType: 'Placement',
        entityCode: placement.code,
        actorId: actor.id,
        city: placement.city,
        before,
        after: { status: updated.status, rejectionReason: note },
      });

      return updated;
    }

    // dto.response === 'accepted'
    // Calculate 50% placement fee and 18% GST using money module helpers
    const placementFee = calculatePlacementFee(placement.agreedSalary);
    const gstAmount = calculateGst(placementFee);
    const totalAmount = placementFee + gstAmount;

    // Create payment charge via provider
    const charge = await this.paymentService.createCharge(
      totalAmount,
      'placement',
      placement.id,
    );
    const paymentCode = await this.idService.generateCode('payment');

    // Update placement to confirmed, job seeker to placed, and create payment in transaction
    const [updated, payment] = await this.prisma.$transaction([
      this.prisma.placement.update({
        where: { id: placement.id },
        data: {
          status: 'confirmed',
          placementFee,
          gstAmount,
        },
        include: { business: true, jobSeeker: true, vacancy: true, payments: true },
      }),
      this.prisma.payment.create({
        data: {
          code: paymentCode,
          city: placement.city,
          type: 'placement_fee',
          amount: totalAmount,
          status: 'pending',
          gatewayReference: charge.gatewayReference,
          subjectType: 'placement',
          subjectId: placement.id,
          businessId: placement.businessId,
          placementId: placement.id,
          // Never billed to or deducted from the job seeker
          jobSeekerId: null,
        },
      }),
      this.prisma.jobSeeker.update({
        where: { id: placement.jobSeekerId },
        data: { status: 'placed' },
      }),
    ]);

    await this.auditService.log({
      action: 'placement_confirmed',
      entityType: 'Placement',
      entityCode: placement.code,
      actorId: actor.id,
      city: placement.city,
      before,
      after: {
        status: updated.status,
        jobSeekerStatus: 'placed',
        paymentId: payment.id,
        paymentCode: payment.code,
        placementFee,
        gstAmount,
        totalAmount,
      },
    });

    return {
      ...updated,
      payment: {
        id: payment.id,
        code: payment.code,
        amount: payment.amount,
        placementFee,
        gstAmount,
        status: payment.status,
        paymentLink: charge.paymentLink,
        gatewayReference: charge.gatewayReference,
      },
    };
  }

  async recordJoined(id: string, dto: RecordJoinedDto, actorId: string) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const placement = await this.prisma.placement.findFirst({
      where: {
        OR: [{ id }, { code: id }],
      },
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
      },
    });
    if (!placement) {
      throw new NotFoundException(`Placement '${id}' not found`);
    }

    if (actor.role === 'field_agent') {
      if (!actor.area || placement.business.area !== actor.area) {
        throw new ForbiddenException(
          `Field agent can only manage placements in their own area '${actor.area}', but placement belongs to '${placement.business.area}'`,
        );
      }
    }

    if (placement.status !== 'confirmed') {
      throw new BadRequestException(
        `Placement must be in 'confirmed' status to record joining. Current status: '${placement.status}'`,
      );
    }

    let joinedDate: Date;
    if (dto?.joinedDate) {
      joinedDate = new Date(dto.joinedDate);
      if (isNaN(joinedDate.getTime())) {
        throw new BadRequestException('joinedDate must be a valid date string');
      }
    } else {
      joinedDate = new Date();
    }

    const before = {
      status: placement.status,
      joinedDate: placement.joinedDate,
    };

    const updated = await this.prisma.placement.update({
      where: { id: placement.id },
      data: {
        status: 'active',
        joinedDate,
      },
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
      },
    });

    await this.auditService.log({
      action: 'placement_joined',
      entityType: 'Placement',
      entityCode: placement.code,
      actorId: actor.id,
      city: placement.city,
      before,
      after: {
        status: updated.status,
        joinedDate: updated.joinedDate,
      },
    });

    return updated;
  }

  async recordDropout(id: string, dto: RecordDropoutDto, actorId: string) {
    const actor = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!actor) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const placement = await this.prisma.placement.findFirst({
      where: {
        OR: [{ id }, { code: id }],
      },
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
      },
    });
    if (!placement) {
      throw new NotFoundException(`Placement '${id}' not found`);
    }

    if (actor.role === 'field_agent') {
      if (!actor.area || placement.business.area !== actor.area) {
        throw new ForbiddenException(
          `Field agent can only manage placements in their own area '${actor.area}', but placement belongs to '${placement.business.area}'`,
        );
      }
    }

    if (placement.status !== 'active') {
      throw new BadRequestException(
        `Placement must be in 'active' status to report a dropout. Current status: '${placement.status}'`,
      );
    }

    if (
      !dto.eligibility ||
      (dto.eligibility !== 'employee_left' && dto.eligibility !== 'business_breach')
    ) {
      throw new BadRequestException(
        "eligibility must be either 'employee_left' or 'business_breach'",
      );
    }

    let dropoutReportedAt: Date;
    if (dto.dropoutReportedAt) {
      dropoutReportedAt = new Date(dto.dropoutReportedAt);
      if (isNaN(dropoutReportedAt.getTime())) {
        throw new BadRequestException('dropoutReportedAt must be a valid date string');
      }
    } else {
      dropoutReportedAt = new Date();
    }

    const before = {
      status: placement.status,
      dropoutReportedAt: placement.dropoutReportedAt,
      eligibility: placement.eligibility,
    };

    const updated = await this.prisma.placement.update({
      where: { id: placement.id },
      data: {
        status: 'dropped_out',
        dropoutReportedAt,
        eligibility: dto.eligibility,
      },
      include: {
        business: true,
        jobSeeker: true,
        vacancy: true,
      },
    });

    await this.auditService.log({
      action: 'placement_dropout',
      entityType: 'Placement',
      entityCode: placement.code,
      actorId: actor.id,
      city: placement.city,
      before,
      after: {
        status: updated.status,
        dropoutReportedAt: updated.dropoutReportedAt,
        eligibility: updated.eligibility,
        reason: dto.reason,
      },
    });

    return updated;
  }
}


