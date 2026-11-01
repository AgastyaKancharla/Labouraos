import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { TargetService } from './target.service';
import { CallAgentMetricsService } from './call-agent-metrics.service';
import { FieldAgentMetricsService } from './field-agent-metrics.service';
import { MoneyAtRiskService } from './money-at-risk.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { CreateTargetDto } from './dto/create-target.dto';
import { UpdateTargetDto } from './dto/update-target.dto';

@Controller('targets')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class TargetController {
  constructor(
    private readonly targetService: TargetService,
    private readonly callAgentMetricsService: CallAgentMetricsService,
    private readonly fieldAgentMetricsService: FieldAgentMetricsService,
    private readonly moneyAtRiskService: MoneyAtRiskService,
  ) {}

  @Get('money-at-risk')
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent', 'field_agent')
  @RequirePermission('target', 'read')
  async getMoneyAtRisk(
    @Query('staffId') staffId: string | undefined,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.moneyAtRiskService.getMoneyAtRisk(staffId, req.user);
  }

  @Get('metrics/call-agent/:staffId')
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent')
  @RequirePermission('target', 'read')
  async getCallAgentMetrics(
    @Param('staffId') staffId: string,
    @Query('year') year: string | undefined,
    @Query('month') month: string | undefined,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.callAgentMetricsService.getCallAgentMetrics(
      staffId,
      year ? parseInt(year, 10) : undefined,
      month ? parseInt(month, 10) : undefined,
      req.user,
    );
  }

  @Get('metrics/field-agent/:staffId')
  @RequireRoles('ceo', 'manager', 'team_lead', 'field_agent')
  @RequirePermission('target', 'read')
  async getFieldAgentMetrics(
    @Param('staffId') staffId: string,
    @Query('year') year: string | undefined,
    @Query('month') month: string | undefined,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.fieldAgentMetricsService.getFieldAgentMetrics(
      staffId,
      year ? parseInt(year, 10) : undefined,
      month ? parseInt(month, 10) : undefined,
      req.user,
    );
  }

  @Post()
  @RequireRoles('ceo', 'manager')
  @RequirePermission('target', 'write')
  async create(
    @Body() dto: CreateTargetDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.targetService.setTarget(dto, req.user.sub);
  }

  @Patch(':id')
  @RequireRoles('ceo', 'manager')
  @RequirePermission('target', 'write')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTargetDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.targetService.updateTarget(id, dto, req.user.sub);
  }

  @Get(':id')
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent', 'field_agent')
  @RequirePermission('target', 'read')
  async findOne(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.targetService.getTargetById(id, req.user);
  }

  @Get()
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent', 'field_agent')
  @RequirePermission('target', 'read')
  async findAll(
    @Query('staffId') staffId: string | undefined,
    @Query('year') year: string | undefined,
    @Query('month') month: string | undefined,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.targetService.listTargets(
      {
        staffId,
        year: year ? parseInt(year, 10) : undefined,
        month: month ? parseInt(month, 10) : undefined,
      },
      req.user,
    );
  }
}
