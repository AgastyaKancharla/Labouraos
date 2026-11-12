import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { cleanOption, cleanSearch, parseRange } from '../ceo-portal/ceo-common';
import { PayrollService } from './payroll.service';
import { MonthEndService } from './month-end.service';
import { FinanceTaxService } from './finance-tax.service';
import { FinanceReportsService } from './finance-reports.service';
import { FinanceRefundsService } from './finance-refunds.service';

type AuthedRequest = Request & { user: JwtPayload };
type Q = Record<string, string | undefined>;

function sendCsv(res: Response, file: { filename: string; csv: string }): string {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  return file.csv;
}

/**
 * The Finance back office, Part B (specs/phase-22.md): salaries from
 * attendance, tax, reports and CA downloads, the month-end review and close,
 * and the refund queue. Finance and the CEO only — Managers never see a
 * salary or a rupee; the CEO alone approves the salary total and closes or
 * reopens a month. Every write is audit-logged in the services.
 */
@Controller('finance')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles('ceo', 'finance')
@UseInterceptors(PiiMaskingInterceptor)
export class FinanceBController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly monthEnd: MonthEndService,
    private readonly tax: FinanceTaxService,
    private readonly reports: FinanceReportsService,
    private readonly refunds: FinanceRefundsService,
  ) {}

  private actor(req: AuthedRequest) {
    return { id: req.user.sub, role: req.user.role };
  }

  // Salaries ----------------------------------------------------------------

  @Get('salaries')
  @RequireRoles('ceo', 'finance')
  salaries(@Query('month') month?: string) {
    return this.payroll.sheet(month, new Date());
  }

  @Get('salaries/sheet.csv')
  @RequireRoles('ceo', 'finance')
  async salarySheetCsv(@Query('month') month: string | undefined, @Res({ passthrough: true }) res: Response) {
    return sendCsv(res, await this.payroll.sheetCsv(month, new Date()));
  }

  @Post('salaries/:month/prepare')
  @RequireRoles('ceo', 'finance')
  @HttpCode(HttpStatus.OK)
  prepare(@Param('month') month: string, @Req() req: AuthedRequest) {
    return this.payroll.prepare(month, this.actor(req), new Date());
  }

  @Post('salaries/:month/approve')
  @RequireRoles('ceo')
  @HttpCode(HttpStatus.OK)
  approve(@Param('month') month: string, @Body() body: { netPaise?: unknown; preparedAt?: unknown }, @Req() req: AuthedRequest) {
    return this.payroll.approve(month, body ?? {}, this.actor(req), new Date());
  }

  @Post('salaries/:month/send-back')
  @RequireRoles('ceo')
  @HttpCode(HttpStatus.OK)
  sendBack(@Param('month') month: string, @Body() body: { reason?: unknown }, @Req() req: AuthedRequest) {
    return this.payroll.sendBack(month, body?.reason, this.actor(req), new Date());
  }

  @Post('salaries/:month/lines/:lineId/pay')
  @RequireRoles('ceo', 'finance')
  @HttpCode(HttpStatus.OK)
  payLine(@Param('month') month: string, @Param('lineId') lineId: string, @Body() body: { utr?: unknown; paidFrom?: unknown }, @Req() req: AuthedRequest) {
    return this.payroll.payLine(month, lineId, body ?? {}, this.actor(req), new Date());
  }

  @Post('salaries/:month/payslips/resend')
  @RequireRoles('ceo', 'finance')
  @HttpCode(HttpStatus.OK)
  resendPayslips(@Param('month') month: string, @Req() req: AuthedRequest) {
    return this.payroll.resendPayslips(month, this.actor(req), new Date());
  }

  @Get('salaries/:month/payslips/:staffId')
  @RequireRoles('ceo', 'finance')
  payslip(@Param('month') month: string, @Param('staffId') staffId: string) {
    return this.payroll.payslipFor(month, staffId);
  }

  @Get('staff-salaries')
  @RequireRoles('ceo', 'finance')
  staffSalaries() {
    return this.payroll.staffSalaries(new Date());
  }

  @Put('staff-salaries/:staffId')
  @RequireRoles('ceo')
  setSalary(@Param('staffId') staffId: string, @Body() body: { monthlyPaise?: unknown; effectiveFromMonth?: unknown; note?: unknown }, @Req() req: AuthedRequest) {
    return this.payroll.setSalary(staffId, body ?? {}, this.actor(req));
  }

  // Tax · reports · CA downloads -----------------------------------------

  @Get('tax')
  @RequireRoles('ceo', 'finance')
  getTax(@Query('month') month?: string) {
    return this.tax.tax(month, new Date());
  }

  @Get('reports')
  @RequireRoles('ceo', 'finance')
  getReports(@Query() q: Q) {
    const now = new Date();
    return this.reports.summary(parseRange(q.fromDate, q.toDate, now), now);
  }

  @Get('reports/books.csv')
  @RequireRoles('ceo', 'finance')
  async booksCsv(@Query('month') month: string | undefined, @Res({ passthrough: true }) res: Response) {
    return sendCsv(res, await this.tax.booksCsv(month));
  }

  @Get('reports/gstr1.csv')
  @RequireRoles('ceo', 'finance')
  async gstr1Csv(@Query('month') month: string | undefined, @Res({ passthrough: true }) res: Response) {
    return sendCsv(res, await this.tax.gstr1Csv(month));
  }

  @Get('reports/tds.csv')
  @RequireRoles('ceo', 'finance')
  async tdsCsv(@Query('month') month: string | undefined, @Res({ passthrough: true }) res: Response) {
    return sendCsv(res, await this.tax.tdsCsv(month));
  }

  @Get('reports/tax.csv')
  @RequireRoles('ceo', 'finance')
  async taxCsv(@Query('month') month: string | undefined, @Res({ passthrough: true }) res: Response) {
    return sendCsv(res, await this.tax.taxCsv(month, new Date()));
  }

  @Get('reports/salary-sheet.csv')
  @RequireRoles('ceo', 'finance')
  async salaryCsv(@Query('month') month: string | undefined, @Res({ passthrough: true }) res: Response) {
    return sendCsv(res, await this.payroll.sheetCsv(month, new Date()));
  }

  // Month-end review -------------------------------------------------------

  @Get('month-end')
  @RequireRoles('ceo', 'finance')
  review(@Query('month') month?: string) {
    return this.monthEnd.review(month, new Date());
  }

  @Get('month-end/review.csv')
  @RequireRoles('ceo', 'finance')
  async reviewCsv(@Query('month') month: string | undefined, @Res({ passthrough: true }) res: Response) {
    return sendCsv(res, await this.monthEnd.reviewCsv(month, new Date()));
  }

  @Post('month-end/:month/marks')
  @RequireRoles('ceo')
  @HttpCode(HttpStatus.OK)
  mark(@Param('month') month: string, @Body() body: { subjectType?: unknown; subjectId?: unknown; mark?: unknown; note?: unknown }, @Req() req: AuthedRequest) {
    return this.monthEnd.mark(month, body ?? {}, this.actor(req));
  }

  @Post('month-end/:month/close')
  @RequireRoles('ceo')
  @HttpCode(HttpStatus.OK)
  close(@Param('month') month: string, @Body() body: { note?: unknown }, @Req() req: AuthedRequest) {
    return this.monthEnd.close(month, body?.note, this.actor(req), new Date());
  }

  @Post('month-end/:month/reopen')
  @RequireRoles('ceo')
  @HttpCode(HttpStatus.OK)
  reopen(@Param('month') month: string, @Body() body: { reason?: unknown }, @Req() req: AuthedRequest) {
    return this.monthEnd.reopen(month, body?.reason, this.actor(req), new Date());
  }

  // Refunds ------------------------------------------------------------------

  @Get('refunds')
  @RequireRoles('ceo', 'finance')
  listRefunds(@Query() q: Q, @Req() req: AuthedRequest) {
    return this.refunds.list(req.user.sub, { who: cleanOption(q.who), approval: cleanOption(q.approval), search: cleanSearch(q.search) }, new Date());
  }

  @Get('refunds/:ref')
  @RequireRoles('ceo', 'finance')
  refund(@Param('ref') ref: string, @Req() req: AuthedRequest) {
    return this.refunds.detail(req.user.sub, ref, new Date());
  }

  /** FN-Refund "Reject" with a reason: Finance within its limits, the CEO for any refund. */
  @Post('refunds/:ref/reject')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('ceo', 'finance')
  rejectRefund(@Param('ref') ref: string, @Body() body: { reason?: unknown }, @Req() req: AuthedRequest) {
    return this.refunds.reject({ id: req.user.sub, role: req.user.role }, ref, body?.reason, new Date());
  }
}
