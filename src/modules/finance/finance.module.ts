import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { IdModule } from '../../common/id/id.module';
import { PricingModule } from '../pricing/pricing.module';
import { PaymentModule } from '../payment/payment.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { NotificationModule } from '../notification/notification.module';
import { RefundModule } from '../refund/refund.module';
import { MonthLockModule } from '../month-lock/month-lock.module';
import { FinanceController } from './finance.controller';
import { ExpenseService } from './expense.service';
import { FinancePayoutsService } from './finance-payouts.service';
import { FinanceBooksService } from './finance-books.service';
import { FinanceHomeService } from './finance-home.service';
import { EXPENSE_BILL_STORAGE, expenseBillStorageFactory } from './expense-bill.storage';
import { FinanceBController } from './finance-b.controller';
import { PayrollSelfController } from './payroll-self.controller';
import { PayrollCorrectionsController } from './payroll-corrections.controller';
import { PayrollService } from './payroll.service';
import { MonthEndService } from './month-end.service';
import { FinanceTaxService } from './finance-tax.service';
import { FinanceReportsService } from './finance-reports.service';
import { FinanceRefundsService } from './finance-refunds.service';

/** Phase 22: the Finance back office, parts A and B (specs/phase-22.md). */
@Module({
  imports: [PrismaModule, AuditModule, IdModule, PricingModule, PaymentModule, AttendanceModule, NotificationModule, RefundModule, MonthLockModule],
  controllers: [FinanceController, FinanceBController, PayrollSelfController, PayrollCorrectionsController],
  providers: [
    ExpenseService,
    FinancePayoutsService,
    FinanceBooksService,
    FinanceHomeService,
    PayrollService,
    MonthEndService,
    FinanceTaxService,
    FinanceReportsService,
    FinanceRefundsService,
    { provide: EXPENSE_BILL_STORAGE, useFactory: expenseBillStorageFactory },
  ],
  exports: [ExpenseService, FinancePayoutsService, FinanceBooksService, PayrollService],
})
export class FinanceModule {}
