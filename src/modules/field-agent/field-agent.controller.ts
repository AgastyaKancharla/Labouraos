import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { BusinessVerificationService, CheckInDto } from '../business/business-verification.service';

/**
 * Laboura Field's visit check-in. The old field agent page's priority
 * dashboard (/field-agent/priority-dashboard and /priority/*) was removed on
 * 14 Nov with the retired consoles: no current screen used it, and the
 * close-to-refund list now lives in the refund-priority module.
 */
@Controller('field-agent')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class FieldAgentController {
  constructor(private readonly verificationService: BusinessVerificationService) {}

  @Post('check-in')
  @RequireRoles('field_agent')
  async checkIn(@Body() body: CheckInDto, @Req() req: Request & { user: JwtPayload }) {
    return this.verificationService.checkIn(req.user.sub, body);
  }
}
