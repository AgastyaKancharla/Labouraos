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
import { CreatePlacementDto } from './dto/create-placement.dto';

@Injectable()
export class PlacementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
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
}
