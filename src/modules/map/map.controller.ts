import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { MapService } from './map.service';

@Controller('map')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles('ceo', 'manager', 'team_lead', 'call_agent', 'field_agent')
export class MapController {
  constructor(private readonly mapService: MapService) {}

  @Get('points')
  getPoints(@Query('bbox') bbox: string, @Query('trade') trade?: string) {
    return this.mapService.points(bbox, trade);
  }
}
