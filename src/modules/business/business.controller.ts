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
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { BusinessService } from './business.service';
import { CreateBusinessDto, RecordVisitDto } from './dto/create-business.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';

import { VacancyService } from '../vacancy/vacancy.service';
import { CreateVacancyDto } from '../vacancy/dto/create-vacancy.dto';
import { ConsentLinkService } from '../consent/consent-link.service';

@Controller('businesses')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class BusinessController {
  constructor(
    private readonly businessService: BusinessService,
    private readonly vacancyService: VacancyService,
    private readonly consentLinkService: ConsentLinkService,
  ) {}

  @Post()
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'team_lead')
  @RequirePermission('business', 'write')
  async create(
    @Body() body: CreateBusinessDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.businessService.create(body, req.user.sub);
  }

  @Get()
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'finance', 'team_lead')
  @RequirePermission('business', 'read')
  async findAll(
    @Req() req: Request & { user: JwtPayload },
    @Query('area') filterArea?: string,
  ) {
    return this.businessService.findAll(req.user.sub, filterArea);
  }

  @Get(':id')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'finance', 'team_lead')
  @RequirePermission('business', 'read')
  async findById(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.businessService.findById(id, req.user.sub);
  }

  @Post(':id/agreement-links')
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('business', 'write')
  createAgreementLink(
    @Param('id') businessId: string,
    @Body() body: { language?: string },
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.consentLinkService.createAgreementLink(businessId, req.user.sub, body?.language);
  }

  @Post(':id/vacancies')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'team_lead')
  @RequirePermission('vacancy', 'write')
  async createVacancy(
    @Param('id') businessId: string,
    @Body() body: CreateVacancyDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.vacancyService.create(businessId, body, req.user.sub);
  }

  @Get(':id/vacancies')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'finance', 'team_lead')
  @RequirePermission('vacancy', 'read')
  async findVacanciesByBusiness(
    @Param('id') businessId: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.vacancyService.findByBusiness(businessId, req.user.sub);
  }

  @Post(':id/visits')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'team_lead')
  @RequirePermission('business', 'write')
  async recordVisit(
    @Param('id') businessId: string,
    @Body() body: RecordVisitDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.businessService.recordVisit(businessId, body, req.user.sub);
  }

  @Post(':id/storefront-photo')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo', 'team_lead')
  @RequirePermission('business', 'write')
  @UseInterceptors(FileInterceptor('photo'))
  uploadStorefrontPhoto(
    @Param('id') businessId: string,
    @UploadedFile() photo: { buffer: Buffer; mimetype: string } | undefined,
    @Req() req: Request & { user: JwtPayload },
  ) {
    if (!photo) {
      throw new BadRequestException('A storefront photo is required');
    }
    return this.businessService.uploadStorefrontPhoto(
      businessId,
      photo.buffer,
      photo.mimetype,
      req.user.sub,
    );
  }

  @Post(':id/erase')
  @RequireRoles('ceo', 'manager')
  @RequirePermission('business', 'write')
  async erase(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.businessService.erase(id, req.user.sub);
  }
}

