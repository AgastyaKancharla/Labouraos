import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt-payload.interface';
import { RbacGuard } from '../../common/rbac/rbac.guard';
import { RequireRoles } from '../../common/rbac/roles.decorator';
import { PiiMaskingInterceptor } from '../../common/rbac/pii-masking.interceptor';
import { cleanOption, cleanSearch, parseRange } from '../ceo-portal/ceo-common';
import { BillUpload, CreateExpenseInput, ExpenseService, PayExpenseInput } from './expense.service';
import { FinancePayoutsService, PayInput } from './finance-payouts.service';
import { FinanceBooksService } from './finance-books.service';
import { FinanceInvoiceActionsService } from './finance-invoice-actions.service';
import { FinanceHomeService } from './finance-home.service';
import { MAX_BILL_BYTES } from './expense-bill.storage';

type AuthedRequest = Request & { user: JwtPayload };
type Q = Record<string, string | undefined>;

/**
 * The Finance back office, Part A (specs/phase-22.md). Finance and the CEO
 * only: Managers have no money powers and see no money, Team Leads and agents
 * none at all. Every write is audit-logged in the services.
 */
@Controller('finance')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles('ceo', 'finance')
@UseInterceptors(PiiMaskingInterceptor)
export class FinanceController {
  constructor(
    private readonly expenses: ExpenseService,
    private readonly payouts: FinancePayoutsService,
    private readonly books: FinanceBooksService,
    private readonly home: FinanceHomeService,
    private readonly invoiceActions: FinanceInvoiceActionsService,
  ) {}

  // Money today -----------------------------------------------------------

  @Get('home')
  @RequireRoles('ceo', 'finance')
  getHome() {
    return this.home.home(new Date());
  }

  @Get('counts')
  @RequireRoles('ceo', 'finance')
  getCounts() {
    return this.home.counts(new Date());
  }

  // Expenses & bills ------------------------------------------------------

  @Get('expenses')
  @RequireRoles('ceo', 'finance')
  listExpenses(@Query() q: Q) {
    const now = new Date();
    return this.expenses.list(parseRange(q.fromDate, q.toDate, now), {
      category: cleanOption(q.category),
      status: cleanOption(q.status),
      search: cleanSearch(q.search),
    });
  }

  @Post('expenses')
  @RequireRoles('ceo', 'finance')
  @UseInterceptors(FileInterceptor('bill', { limits: { fileSize: MAX_BILL_BYTES } }))
  createExpense(@Body() body: CreateExpenseInput, @UploadedFile() bill: BillUpload | undefined, @Req() req: AuthedRequest) {
    return this.expenses.create(body ?? {}, bill, req.user.sub);
  }

  @Post('expenses/:id/bill')
  @RequireRoles('ceo', 'finance')
  @UseInterceptors(FileInterceptor('bill', { limits: { fileSize: MAX_BILL_BYTES } }))
  attachBill(@Param('id') id: string, @UploadedFile() bill: BillUpload | undefined, @Req() req: AuthedRequest) {
    return this.expenses.attachBill(id, bill, req.user.sub);
  }

  @Get('expenses/:id/bill')
  @RequireRoles('ceo', 'finance')
  async getBill(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const file = await this.expenses.bill(id);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(file.body);
  }

  @Post('expenses/:id/approve')
  @RequireRoles('ceo', 'finance')
  @HttpCode(HttpStatus.OK)
  approveExpense(@Param('id') id: string, @Body() body: { pay?: PayExpenseInput }, @Req() req: AuthedRequest) {
    return this.expenses.approve(id, req.user.sub, body?.pay);
  }

  @Post('expenses/:id/pay')
  @RequireRoles('ceo', 'finance')
  @HttpCode(HttpStatus.OK)
  payExpense(@Param('id') id: string, @Body() body: PayExpenseInput, @Req() req: AuthedRequest) {
    return this.expenses.pay(id, req.user.sub, body ?? {});
  }

  @Post('expenses/:id/reject')
  @RequireRoles('ceo', 'finance')
  @HttpCode(HttpStatus.OK)
  rejectExpense(@Param('id') id: string, @Body() body: { reason?: unknown }, @Req() req: AuthedRequest) {
    return this.expenses.reject(id, req.user.sub, body?.reason);
  }

  @Get('profit')
  @RequireRoles('ceo', 'finance')
  profit(@Query() q: Q) {
    return this.expenses.profit(parseRange(q.fromDate, q.toDate, new Date()));
  }

  @Put('expense-budgets')
  @RequireRoles('ceo')
  setBudgets(@Body() body: { month?: unknown; budgets?: unknown }, @Req() req: AuthedRequest) {
    return this.expenses.setBudgets(body ?? {}, req.user.sub);
  }

  // Payouts (paid daily) --------------------------------------------------

  @Get('payouts')
  @RequireRoles('ceo', 'finance')
  listPayouts(@Query() q: Q) {
    return this.payouts.list({ status: cleanOption(q.status), who: cleanOption(q.who), search: cleanSearch(q.search) }, new Date());
  }

  @Post('payouts/pay-all')
  @RequireRoles('ceo', 'finance')
  @HttpCode(HttpStatus.OK)
  payAll(@Body() body: { items?: unknown }, @Req() req: AuthedRequest) {
    return this.payouts.payAll(body?.items, req.user.sub);
  }

  @Post('payouts/:id/pay')
  @RequireRoles('ceo', 'finance')
  @HttpCode(HttpStatus.OK)
  payPayout(@Param('id') id: string, @Body() body: PayInput, @Req() req: AuthedRequest) {
    return this.payouts.pay(id, body ?? {}, req.user.sub);
  }

  @Post('payouts/:id/failed')
  @RequireRoles('ceo', 'finance')
  @HttpCode(HttpStatus.OK)
  payoutFailed(@Param('id') id: string, @Body() body: { reason?: unknown }, @Req() req: AuthedRequest) {
    return this.payouts.markFailed(id, body?.reason, req.user.sub);
  }

  @Post('payouts/:id/retry')
  @RequireRoles('ceo', 'finance')
  @HttpCode(HttpStatus.OK)
  retryPayout(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.payouts.retry(id, req.user.sub);
  }

  // Money in · Match · Bank · Invoices -------------------------------------

  @Get('money-in')
  @RequireRoles('ceo', 'finance')
  moneyIn(@Query() q: Q) {
    const now = new Date();
    return this.books.moneyIn(parseRange(q.fromDate, q.toDate, now), { status: cleanOption(q.status), type: cleanOption(q.type), search: cleanSearch(q.search) }, now);
  }

  @Get('bank-credits/:id/matches')
  @RequireRoles('ceo', 'finance')
  matches(@Param('id') id: string) {
    return this.books.matches(id);
  }

  @Post('bank-credits/:id/return')
  @RequireRoles('ceo', 'finance')
  @HttpCode(HttpStatus.OK)
  returnCredit(@Param('id') id: string, @Body() body: { utr?: unknown; reason?: unknown }, @Req() req: AuthedRequest) {
    return this.books.returnCredit(id, body ?? {}, req.user.sub);
  }

  @Get('bank')
  @RequireRoles('ceo', 'finance')
  bank(@Query() q: Q) {
    const now = new Date();
    return this.books.bank(parseRange(q.fromDate, q.toDate, now), now);
  }

  @Post('bank/close-day')
  @RequireRoles('ceo', 'finance')
  @HttpCode(HttpStatus.OK)
  closeDay(@Body() body: { day?: unknown; bankClosingPaise?: unknown; note?: unknown }, @Req() req: AuthedRequest) {
    return this.books.closeDay(body ?? {}, req.user.sub);
  }

  /** FN-Invoices "Tell the account agent": a bell to the business's account agent about an unpaid fee. */
  @Post('invoices/:paymentId/tell-account-agent')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('ceo', 'finance')
  tellAccountAgent(@Param('paymentId') paymentId: string, @Req() req: AuthedRequest) {
    return this.invoiceActions.tellAccountAgent(req.user.sub, paymentId, new Date());
  }

  @Get('invoices')
  @RequireRoles('ceo', 'finance')
  invoices(@Query() q: Q) {
    const now = new Date();
    return this.books.invoices(parseRange(q.fromDate, q.toDate, now), { status: cleanOption(q.status), type: cleanOption(q.type), search: cleanSearch(q.search) }, now);
  }

  @Post('tds-receivables/:id/certificate-received')
  @RequireRoles('ceo', 'finance')
  @HttpCode(HttpStatus.OK)
  certificateReceived(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.books.certificateReceived(id, req.user.sub);
  }
}
