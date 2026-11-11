import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { IdModule } from '../../common/id/id.module';
import { PricingModule } from '../pricing/pricing.module';
import { PaymentModule } from '../payment/payment.module';
import { FinanceController } from './finance.controller';
import { ExpenseService } from './expense.service';
import { FinancePayoutsService } from './finance-payouts.service';
import { FinanceBooksService } from './finance-books.service';
import { FinanceHomeService } from './finance-home.service';
import { EXPENSE_BILL_STORAGE, expenseBillStorageFactory } from './expense-bill.storage';

/** Phase 22 Part A: the Finance back office (specs/phase-22.md). */
@Module({
  imports: [PrismaModule, AuditModule, IdModule, PricingModule, PaymentModule],
  controllers: [FinanceController],
  providers: [
    ExpenseService,
    FinancePayoutsService,
    FinanceBooksService,
    FinanceHomeService,
    { provide: EXPENSE_BILL_STORAGE, useFactory: expenseBillStorageFactory },
  ],
  exports: [ExpenseService, FinancePayoutsService, FinanceBooksService],
})
export class FinanceModule {}
