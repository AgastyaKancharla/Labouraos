import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { PlacementService } from './placement.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { CreatePlacementDto } from './dto/create-placement.dto';
import { RespondPlacementDto } from './dto/respond-placement.dto';
import { RecordJoinedDto } from './dto/record-joined.dto';

@Controller('vacancies/:id/placements')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class VacancyPlacementController {
  constructor(private readonly placementService: PlacementService) {}

  @Post()
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo')
  @RequirePermission('placement', 'write')
  async create(
    @Param('id') vacancyId: string,
    @Body() dto: CreatePlacementDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.placementService.create(vacancyId, dto, req.user.sub);
  }
}

@Controller('placements')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class PlacementController {
  constructor(private readonly placementService: PlacementService) {}

  @Post(':id/respond')
  @RequireRoles('field_agent', 'call_agent', 'manager', 'ceo')
  @RequirePermission('placement', 'write')
  async respond(
    @Param('id') id: string,
    @Body() dto: RespondPlacementDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.placementService.respond(id, dto, req.user.sub);
  }

  @Post(':id/joined')
  @RequireRoles('field_agent', 'call_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('placement', 'write')
  async recordJoined(
    @Param('id') id: string,
    @Body() dto: RecordJoinedDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.placementService.recordJoined(id, dto, req.user.sub);
  }
}

