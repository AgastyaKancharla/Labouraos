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
import { CreatePlacementDto } from './dto/create-placement.dto';
import { RespondPlacementDto } from './dto/respond-placement.dto';

@Injectable()
export class PlacementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
    private readonly jobSeekerService: JobSeekerService,
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
    // Update placement to confirmed and job seeker to placed
    const [updated] = await this.prisma.$transaction([
      this.prisma.placement.update({
        where: { id: placement.id },
        data: { status: 'confirmed' },
        include: { business: true, jobSeeker: true, vacancy: true },
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
      after: { status: updated.status, jobSeekerStatus: 'placed' },
    });

    return updated;
  }
}
