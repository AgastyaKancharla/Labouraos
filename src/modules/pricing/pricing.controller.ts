import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { PricingService, PricingPolicy } from './pricing.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { UpdateMinimumWagesDto } from './dto/update-minimum-wages.dto';
import { ATTENDANCE_SETTING_KEYS } from '../attendance/attendance.constants';

@Controller('pricing')
@UseGuards(JwtAuthGuard, RbacGuard)
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get()
  @RequirePermission('pricing', 'read')
  @RequireRoles('ceo', 'manager')
  async getPricing(@Req() req: Request & { user: JwtPayload }): Promise<PricingPolicy> {
    const policy = await this.pricingService.current();
    if (req.user.role !== 'manager') return policy;
    const hidden = { ...policy } as PricingPolicy & Record<string, unknown>;
    for (const key of ATTENDANCE_SETTING_KEYS) {
      delete hidden[key];
    }
    return hidden;
  }

  @Post()
  @RequirePermission('pricing', 'write')
  @RequireRoles('ceo')
  async updatePricingPost(
    @Body() body: Partial<PricingPolicy>,
    @Req() req: Request & { user: JwtPayload },
  ): Promise<PricingPolicy> {
    return this.pricingService.createVersion(body, req.user.sub);
  }

  @Put()
  @RequirePermission('pricing', 'write')
  @RequireRoles('ceo')
  async updatePricingPut(
    @Body() body: Partial<PricingPolicy>,
    @Req() req: Request & { user: JwtPayload },
  ): Promise<PricingPolicy> {
    return this.pricingService.createVersion(body, req.user.sub);
  }

  @Put('legal-minimum-wages')
  @RequirePermission('pricing', 'write')
  @RequireRoles('ceo')
  async updateLegalMinimumWages(
    @Body() body: UpdateMinimumWagesDto,
    @Req() req: Request & { user: JwtPayload },
  ): Promise<PricingPolicy> {
    return this.pricingService.updateMinimumWages(body, req.user.sub);
  }
}
