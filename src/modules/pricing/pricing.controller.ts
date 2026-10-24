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

@Controller('pricing')
@UseGuards(JwtAuthGuard, RbacGuard)
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get()
  @RequirePermission('pricing', 'read')
  @RequireRoles('ceo', 'manager')
  getPricing(): PricingPolicy {
    return this.pricingService.getPolicy();
  }

  @Post()
  @RequirePermission('pricing', 'write')
  @RequireRoles('ceo')
  async updatePricingPost(
    @Body() body: Partial<PricingPolicy>,
    @Req() req: Request & { user: JwtPayload },
  ): Promise<PricingPolicy> {
    return this.pricingService.updatePolicy(body, req.user.sub);
  }

  @Put()
  @RequirePermission('pricing', 'write')
  @RequireRoles('ceo')
  async updatePricingPut(
    @Body() body: Partial<PricingPolicy>,
    @Req() req: Request & { user: JwtPayload },
  ): Promise<PricingPolicy> {
    return this.pricingService.updatePolicy(body, req.user.sub);
  }
}
