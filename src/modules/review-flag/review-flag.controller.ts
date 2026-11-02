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
import { RolesGuard } from '../../common/rbac/roles.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import {
  ListReviewFlagsQuery,
  ResolveReviewFlagDto,
  ReviewFlagService,
} from './review-flag.service';

@Controller('review-flags')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReviewFlagController {
  constructor(private readonly reviewFlagService: ReviewFlagService) {}

  @Get()
  @RequireRoles('ceo', 'manager', 'team_lead')
  async list(
    @Req() req: Request & { user: JwtPayload },
    @Query() query: ListReviewFlagsQuery,
  ) {
    return this.reviewFlagService.list(req.user, query);
  }

  @Post(':id/resolve')
  @RequireRoles('ceo', 'manager', 'team_lead')
  async resolve(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
    @Body() body: ResolveReviewFlagDto,
  ) {
    return this.reviewFlagService.resolve(id, req.user, body);
  }
}
