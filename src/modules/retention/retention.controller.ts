import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { RetentionService } from './retention.service';

@Controller('retention')
@UseGuards(JwtAuthGuard, RbacGuard)
export class RetentionController {
  constructor(private readonly retentionService: RetentionService) {}

  @Get('summary')
  @RequireRoles('ceo')
  async getLatestSummary() {
    return this.retentionService.getLatestSummary();
  }

  @Post('dry-run')
  @RequireRoles('ceo')
  async runDryRun() {
    return this.retentionService.runRetentionCleanup({ dryRun: true });
  }

  @Post('run')
  @RequireRoles('ceo')
  async runRetention(@Query('dryRun') dryRun?: string) {
    const isDryRun = dryRun === 'true' || dryRun === '1';
    return this.retentionService.runRetentionCleanup({ dryRun: isDryRun });
  }
}
