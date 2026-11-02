import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import {
  ListReviewFlagsQuery,
  ResolveReviewFlagDto,
  ReviewFlagService,
} from './review-flag.service';

@Controller('review-flags')
@UseGuards(JwtAuthGuard, RbacGuard)
export class ReviewFlagController {
  constructor(private readonly reviewFlagService: ReviewFlagService) {}

  private actor(user: JwtPayload): { id: string; role: string } {
    return { id: user.sub, role: user.role };
  }

  @Get()
  @RequireRoles('ceo', 'manager', 'team_lead')
  async list(
    @Req() req: Request & { user: JwtPayload },
    @Query() query: ListReviewFlagsQuery,
  ) {
    return this.reviewFlagService.list(this.actor(req.user), query);
  }

  @Post(':id/resolve')
  @RequireRoles('ceo', 'manager', 'team_lead')
  async resolve(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
    @Body() body: ResolveReviewFlagDto,
  ) {
    return this.reviewFlagService.resolve(id, this.actor(req.user), body);
  }
}
