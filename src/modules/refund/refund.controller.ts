import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { RefundService } from './refund.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RefundDueRow } from './dto/refund-due.dto';

@Controller('refunds')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class RefundController {
  constructor(private readonly refundService: RefundService) {}

  @Get('due')
  @RequireRoles('ceo', 'manager', 'finance')
  @RequirePermission('payment', 'read')
  async getRefundsDue(
    @Req() req: Request & { user: JwtPayload },
    @Query('asOf') asOf?: string,
    @Query('now') nowQuery?: string,
  ): Promise<RefundDueRow[]> {
    const timeParam = asOf || nowQuery;
    const now = timeParam ? new Date(timeParam) : new Date();
    return this.refundService.getRefundsDue(req.user.sub, now);
  }
}
