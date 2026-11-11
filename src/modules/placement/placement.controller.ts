import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PlacementService } from './placement.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequirePermission } from '../../common/rbac/permissions.decorator';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { seesMoney } from '../../common/rbac/money-visibility';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RecordJoinedDto } from './dto/record-joined.dto';
import { ReportClaimDto } from './dto/report-claim.dto';
import { DecideClaimDto } from './dto/decide-claim.dto';
import { ApprovePlacementRefundDto } from './dto/approve-refund.dto';
import { ExportPlacementsQueryDto, formatPlacementsCsv } from './dto/export-placements.dto';

@Controller('vacancies/:id/placements')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class VacancyPlacementController {
  constructor(private readonly placementService: PlacementService) {}

}

@Controller('placements')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(PiiMaskingInterceptor)
export class PlacementController {
  constructor(private readonly placementService: PlacementService) {}

  @Post(':id/joined')
  @RequireRoles('field_agent', 'call_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('placement', 'write')
  async recordJoined(
    @Param('id') id: string,
    @Body() dto: RecordJoinedDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.placementService.recordJoined(id, dto, req.user.sub);
  }

  @Get(':id/claims')
  @RequireRoles('field_agent', 'call_agent', 'team_lead', 'manager', 'ceo', 'finance')
  @RequirePermission('placement', 'read')
  async listClaims(
    @Param('id') id: string,
  ) {
    return this.placementService.listClaims(id);
  }

  @Post(':id/claims')
  @RequireRoles('field_agent', 'call_agent', 'team_lead', 'manager', 'ceo')
  @RequirePermission('placement', 'write')
  async reportClaim(
    @Param('id') id: string,
    @Body() dto: ReportClaimDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.placementService.reportClaim(id, dto, req.user.sub);
  }

  @Post(':id/claims/:claimId/decide')
  @RequireRoles('team_lead', 'manager', 'ceo')
  @RequirePermission('placement', 'write')
  async decideClaim(
    @Param('id') id: string,
    @Param('claimId') claimId: string,
    @Body() dto: DecideClaimDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.placementService.decideClaim(id, claimId, dto, req.user.sub);
  }

  @Post(':id/resend-payment')
  @RequireRoles('ceo', 'manager', 'team_lead', 'call_agent', 'field_agent')
  @RequirePermission('placement', 'write')
  async resendPayment(@Param('id') id: string) {
    return this.placementService.resendPaymentLink(id);
  }

  @Post(':id/refund')
  @RequireRoles('ceo', 'finance')
  @RequirePermission('payment', 'write')
  async approveRefund(
    @Param('id') id: string,
    @Body() dto: ApprovePlacementRefundDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.placementService.approveRefund(id, dto, req.user.sub);
  }

  @Get()
  @RequireRoles('ceo', 'manager', 'finance', 'call_agent', 'field_agent', 'team_lead')
  @RequirePermission('placement', 'read')
  async findAll(@Req() req: Request & { user: JwtPayload }) {
    return this.placementService.findAll(req.user.sub);
  }

  @Get('claims/pending')
  @RequireRoles('ceo', 'manager', 'team_lead')
  @RequirePermission('placement', 'read')
  async listPendingClaims(@Req() req: Request & { user: JwtPayload }) {
    return this.placementService.listPendingClaims(req.user.sub);
  }

  @Get('export')
  @RequireRoles('ceo', 'manager', 'finance')
  @RequirePermission('placement', 'read')
  async exportPlacements(
    @Query() query: ExportPlacementsQueryDto,
    @Req() req: Request & { user: JwtPayload },
    @Res({ passthrough: true }) res: Response,
  ) {
    const rows = await this.placementService.exportPlacements(query, req.user.sub);

    const acceptHeader = req.headers['accept'] || '';
    if (acceptHeader.includes('application/json')) {
      res.setHeader('Content-Type', 'application/json');
      return rows;
    }

    // A Manager may export lists but never sees money: the salary and fee
    // columns are left out of the file (JSON answers are stripped globally).
    const csvData = formatPlacementsCsv(rows, { includeMoney: seesMoney(req.user.role) });
    const dateStr = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="placements-export-${dateStr}.csv"`,
    );
    return csvData;
  }

  @Get(':id')
  @RequireRoles('ceo', 'manager', 'finance', 'call_agent', 'field_agent', 'team_lead')
  @RequirePermission('placement', 'read')
  async findById(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.placementService.findById(id, req.user.sub);
  }

  @Patch(':id')
  @RequireRoles('ceo', 'manager', 'call_agent', 'field_agent', 'team_lead')
  @RequirePermission('placement', 'write')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.placementService.update(id, body, {
      id: req.user.sub,
      role: req.user.role,
      teamLeadId: req.user.teamLeadId,
    });
  }

  @Get(':id/invoice')
  @RequireRoles('ceo', 'finance')
  @RequirePermission('placement', 'read')
  async getInvoice(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.placementService.getInvoice(id, req.user.sub);
  }
}




