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
import { UpdateApprovalLimitsDto, UpdateCompanyDetailsDto } from './dto/money-settings.dto';

@Controller('pricing')
@UseGuards(JwtAuthGuard, RbacGuard)
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  /**
   * Pricing and policy settings are the CEO's alone: a Manager does not see
   * them (Master Guide, CEO and founders vs. Manager).
   */
  @Get()
  @RequirePermission('pricing', 'read')
  @RequireRoles('ceo')
  async getPricing(): Promise<PricingPolicy> {
    return this.pricingService.current();
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

  /** Finance reads its own limits (Finance portal: Approval limits). */
  @Get('approval-limits')
  @RequirePermission('payment', 'read')
  @RequireRoles('ceo', 'finance')
  async getApprovalLimits() {
    return this.pricingService.getApprovalLimits();
  }

  @Put('approval-limits')
  @RequirePermission('pricing', 'write')
  @RequireRoles('ceo')
  async updateApprovalLimits(
    @Body() body: UpdateApprovalLimitsDto,
    @Req() req: Request & { user: JwtPayload },
  ): Promise<PricingPolicy> {
    return this.pricingService.updateApprovalLimits(body, req.user.sub);
  }

  @Put('company-details')
  @RequirePermission('pricing', 'write')
  @RequireRoles('ceo')
  async updateCompanyDetails(
    @Body() body: UpdateCompanyDetailsDto,
    @Req() req: Request & { user: JwtPayload },
  ): Promise<PricingPolicy> {
    return this.pricingService.updateCompanyDetails(body, req.user.sub);
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
