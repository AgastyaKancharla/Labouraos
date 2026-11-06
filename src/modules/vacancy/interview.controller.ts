import { Body, Controller, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { InterviewService } from './interview.service';

type AuthenticatedRequest = Request & { user: JwtPayload };

@Controller('interviews')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class InterviewController {
  constructor(private readonly interviews: InterviewService) {}

  @Post()
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo')
  book(@Body() body: { vacancyId: string; jobSeekerId: string; slotId: string }, @Req() req: AuthenticatedRequest) {
    return this.interviews.book(body, req.user.sub);
  }
}
