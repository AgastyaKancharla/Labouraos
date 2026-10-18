import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdService } from '../../common/id/id.service';
import { AuditService } from '../../common/audit/audit.service';
import { CreateVacancyDto } from './dto/create-vacancy.dto';

@Injectable()
export class VacancyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idService: IdService,
    private readonly auditService: AuditService,
  ) {}

  async create(businessId: string, dto: CreateVacancyDto, actorId: string) {
    if (!dto.tradeSkill || typeof dto.tradeSkill !== 'string' || !dto.tradeSkill.trim()) {
      throw new BadRequestException('tradeSkill is required');
    }

    if (
      typeof dto.offeredSalary !== 'number' ||
      !Number.isInteger(dto.offeredSalary) ||
      dto.offeredSalary <= 0
    ) {
      throw new BadRequestException('offeredSalary must be a positive integer in paise');
    }

    const headcount = dto.headcount ?? 1;
    if (typeof headcount !== 'number' || !Number.isInteger(headcount) || headcount < 1) {
      throw new BadRequestException('headcount must be a positive integer');
    }

    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) {
      throw new NotFoundException(`Business '${businessId}' not found`);
    }

    const staff = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!staff) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    if (staff.role === 'field_agent' && business.area !== staff.area) {
      throw new ForbiddenException(
        `Access denied: business is in area '${business.area}', not your area '${staff.area}'`,
      );
    }

    const code = await this.idService.generateCode('vacancy');

    const vacancy = await this.prisma.vacancy.create({
      data: {
        code,
        city: business.city,
        businessId: business.id,
        capturedByStaffId: staff.id,
        tradeSkill: dto.tradeSkill.trim(),
        offeredSalary: dto.offeredSalary,
        headcount,
        description: dto.description?.trim() ?? null,
        status: 'open',
      },
      include: {
        business: true,
      },
    });

    await this.auditService.log({
      actorId: staff.id,
      action: 'vacancy.created',
      entityType: 'vacancy',
      entityCode: vacancy.code,
      after: vacancy as unknown as Record<string, unknown>,
      city: vacancy.city,
    });

    return vacancy;
  }

  async findAll(actorId: string, filterStatus?: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (!staff) {
      throw new NotFoundException(`Staff '${actorId}' not found`);
    }

    const where: Prisma.VacancyWhereInput = {};
    if (filterStatus) {
      where.status = filterStatus;
    }

    if (staff.role === 'field_agent') {
      where.business = {
        area: staff.area ?? undefined,
        city: staff.city,
      };
    }

    return this.prisma.vacancy.findMany({
      where,
      include: { business: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, actorId: string) {
    const vacancy = await this.prisma.vacancy.findUnique({
      where: { id },
      include: { business: true },
    });
    if (!vacancy) {
      throw new NotFoundException(`Vacancy '${id}' not found`);
    }

    const staff = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (staff?.role === 'field_agent' && vacancy.business.area !== staff.area) {
      throw new ForbiddenException(
        `Access denied: vacancy business is in area '${vacancy.business.area}', not your area '${staff.area}'`,
      );
    }

    return vacancy;
  }

  async findByBusiness(businessId: string, actorId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) {
      throw new NotFoundException(`Business '${businessId}' not found`);
    }

    const staff = await this.prisma.staff.findUnique({
      where: { id: actorId },
    });
    if (staff?.role === 'field_agent' && business.area !== staff.area) {
      throw new ForbiddenException(
        `Access denied: business is in area '${business.area}', not your area '${staff.area}'`,
      );
    }

    return this.prisma.vacancy.findMany({
      where: { businessId },
      include: { business: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
