import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { ReferralService } from './referral.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { CreateReferralDto } from './dto/create-referral.dto';

@Controller('referrals')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Post()
  @RequireRoles('call_agent', 'manager', 'ceo')
  @RequirePermission('referral', 'write')
  async create(
    @Body() body: CreateReferralDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.referralService.create(body, req.user.sub);
  }

  @Get()
  @RequirePermission('referral', 'read')
  async findAll() {
    return this.referralService.findAll();
  }

  @Get(':id')
  @RequirePermission('referral', 'read')
  async findById(@Param('id') id: string) {
    return this.referralService.findById(id);
  }
}
