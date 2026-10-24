import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { VacancyService } from './vacancy.service';
import { CreateVacancyDto } from './dto/create-vacancy.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';

@Controller('vacancies')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class VacancyController {
  constructor(private readonly vacancyService: VacancyService) {}

  @Post()
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo')
  @RequirePermission('vacancy', 'write')
  async createVacancy(
    @Body() body: CreateVacancyDto & { businessId: string },
    @Req() req: Request & { user: JwtPayload },
  ) {
    if (!body || !body.businessId) {
      throw new BadRequestException('businessId is required');
    }
    return this.vacancyService.create(body.businessId, body, req.user.sub);
  }

  @Get()
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'finance')
  @RequirePermission('vacancy', 'read')
  async findAll(
    @Req() req: Request & { user: JwtPayload },
    @Query('status') status?: string,
  ) {
    return this.vacancyService.findAll(req.user.sub, status);
  }

  @Get(':id/candidates')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'finance')
  @RequirePermission('vacancy', 'read')
  async getCandidates(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.vacancyService.getCandidates(id, req.user.sub);
  }

  @Get(':id/shortlist')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'finance')
  @RequirePermission('vacancy', 'read')
  async getShortlist(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.vacancyService.getCandidates(id, req.user.sub);
  }

  @Get(':id')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'finance')
  @RequirePermission('vacancy', 'read')
  async findById(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.vacancyService.findById(id, req.user.sub);
  }
}

