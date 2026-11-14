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
import { CompleteFollowUpTaskDto } from './dto/complete-follow-up-task.dto';
import { FollowUpService, ListFollowUpTasksQuery } from './follow-up.service';

@Controller('follow-up-tasks')
@UseGuards(JwtAuthGuard, RbacGuard)
export class FollowUpController {
  constructor(private readonly followUpService: FollowUpService) {}

  private actor(user: JwtPayload): { id: string; role: string } {
    return { id: user.sub, role: user.role };
  }

  @Get()
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent', 'field_agent', 'finance')
  async list(
    @Req() req: Request & { user: JwtPayload },
    @Query() query: ListFollowUpTasksQuery,
  ) {
    return this.followUpService.listTasks(this.actor(req.user), query);
  }

  @Get(':id/introduced-businesses')
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent', 'field_agent')
  async getIntroducedBusinesses(@Param('id') id: string, @Req() req: Request & { user: JwtPayload }) {
    return this.followUpService.getIntroducedBusinesses(id, this.actor(req.user));
  }

  @Post(':id/complete')
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent', 'field_agent')
  async complete(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
    @Body() body: CompleteFollowUpTaskDto,
  ) {
    await this.followUpService.assertMayComplete(id, this.actor(req.user));
    return this.followUpService.completeTask(id, body, req.user.sub);
  }
}
