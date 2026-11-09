import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PricingService } from '../pricing/pricing.service';
import { CreateTradeInput, TradeService } from './trade.service';

@Controller('trades')
@UseGuards(JwtAuthGuard, RbacGuard)
export class TradeController {
  constructor(
    private readonly trades: TradeService,
    private readonly pricing: PricingService,
  ) {}

  @Get()
  @RequirePermission('trade', 'read')
  @RequireRoles('call_agent', 'field_agent', 'team_lead', 'manager', 'ceo', 'finance')
  async listActive() {
    return this.trades.listActive(await this.pricing.current());
  }

  @Get('manage')
  @RequirePermission('trade', 'read')
  @RequireRoles('manager', 'ceo')
  listAll() {
    return this.trades.listAll();
  }

  @Get('suggestions')
  @RequirePermission('trade', 'read')
  @RequireRoles('manager', 'ceo')
  listSuggestions() {
    return this.trades.listSuggestions();
  }

  @Get('unlisted-report')
  @RequirePermission('trade', 'read')
  @RequireRoles('manager', 'ceo')
  listUnlistedReport() {
    return this.trades.listUnlistedReport();
  }

  @Post()
  @RequirePermission('trade', 'write')
  @RequireRoles('manager', 'ceo')
  create(@Body() body: CreateTradeInput, @Req() req: Request & { user: JwtPayload }) {
    return this.trades.createTrade(body, req.user.sub);
  }

  @Patch(':id')
  @RequirePermission('trade', 'write')
  @RequireRoles('manager', 'ceo')
  update(
    @Param('id') id: string,
    @Body() body: Partial<CreateTradeInput> & { active?: boolean },
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.trades.updateTrade(id, body, req.user.sub);
  }

  @Patch(':id/deactivate')
  @RequirePermission('trade', 'write')
  @RequireRoles('manager', 'ceo')
  deactivate(@Param('id') id: string, @Req() req: Request & { user: JwtPayload }) {
    return this.trades.deactivate(id, req.user.sub);
  }

  @Post('suggestions/:id/add')
  @RequirePermission('trade', 'write')
  @RequireRoles('manager', 'ceo')
  addSuggestion(
    @Param('id') id: string,
    @Body() body: Omit<CreateTradeInput, 'name'>,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.trades.addSuggestion(id, body, req.user.sub);
  }

  @Post('suggestions/:id/map')
  @RequirePermission('trade', 'write')
  @RequireRoles('manager', 'ceo')
  mapSuggestion(
    @Param('id') id: string,
    @Body('tradeId') tradeId: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.trades.mapSuggestion(id, tradeId, req.user.sub);
  }

  @Post('suggestions/:id/dismiss')
  @RequirePermission('trade', 'write')
  @RequireRoles('manager', 'ceo')
  dismissSuggestion(@Param('id') id: string, @Req() req: Request & { user: JwtPayload }) {
    return this.trades.dismissSuggestion(id, req.user.sub);
  }
}
