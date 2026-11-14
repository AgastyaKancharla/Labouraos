import { Controller, Get, Param, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { ScreensFieldService } from './screens-field.service';

type Authed = Request & { user: JwtPayload };

/**
 * Reads for Laboura Field (FA03 Home, FA05 Visits, FA08 Business, FA12
 * Targets, FA13 Map). The day's own work is for field agents only; the
 * business page is also open to their Team Lead and management. Phone
 * numbers are masked (only the CEO sees them in full, audit-logged).
 */
@Controller('field-work')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class ScreensFieldController {
  constructor(private readonly screens: ScreensFieldService) {}

  @Get('home')
  @RequireRoles('field_agent')
  home(@Req() req: Authed) {
    return this.screens.home(req.user);
  }

  @Get('visits')
  @RequireRoles('field_agent')
  visits(@Req() req: Authed) {
    return this.screens.visits(req.user);
  }

  /** Where I am, shops around me by status, and revisits due nearby (also FA20's "nearby already in Laboura"). */
  @Get('map')
  @RequireRoles('field_agent')
  map(@Req() req: Authed, @Query('lat') lat?: string, @Query('lng') lng?: string, @Query('radius') radius?: string) {
    return this.screens.map(req.user, lat, lng, radius);
  }

  @Get('targets')
  @RequireRoles('field_agent')
  targets(@Req() req: Authed) {
    return this.screens.targets(req.user);
  }

  /** FA08 in Laboura Field: field agents only (owner decision 14 Nov; office screens use /businesses). */
  @Get('businesses/:ref')
  @RequireRoles('field_agent')
  business(@Req() req: Authed, @Param('ref') ref: string) {
    return this.screens.business(req.user, ref);
  }
}
