import { Injectable } from '@nestjs/common';
import { DateRange, sumPaise } from '../ceo-portal/ceo-common';
import { ExpenseService } from './expense.service';
import { FinanceBooksService } from './finance-books.service';

/**
 * Reports (FN-Reports; Phase 22 Part B): profit and loss for a period (the
 * same figures as the CEO's Expenses page, with salaries from payroll) and the
 * cash flow through the company account in our books.
 */
@Injectable()
export class FinanceReportsService {
  constructor(
    private readonly expenses: ExpenseService,
    private readonly books: FinanceBooksService,
  ) {}

  async summary(range: DateRange, now = new Date()) {
    const to = range.to > now ? now : range.to;
    const [profit, bank] = await Promise.all([this.expenses.profit(range), this.books.bank({ from: range.from, to }, now)]);
    const days = [...bank.days].reverse();
    const first = days[0];
    const last = days[days.length - 1];
    const lines = bank.lines;
    const out = (source: string) => sumPaise(lines.filter((l) => l.direction === 'debit' && l.source === source).map((l) => l.amountPaise));
    const moneyInPaise = sumPaise(lines.filter((l) => l.direction === 'credit').map((l) => l.amountPaise));
    const moneyOutPaise = sumPaise(lines.filter((l) => l.direction === 'debit').map((l) => l.amountPaise));
    return {
      period: profit.period,
      profit,
      cashFlow: {
        startPaise: first?.openingPaise ?? 0,
        moneyInPaise,
        moneyOutPaise,
        out: { refundsAndPayoutsPaise: out('payment'), expensesPaise: out('expense'), salariesPaise: out('salary'), returnedPaise: out('return') },
        endPaise: last ? (last.closed ? last.closed.bankClosingPaise : last.booksClosingPaise) : 0,
        daysClosed: days.filter((d) => d.closed).length,
        days: days.length,
        note: 'Through the company account, in our books · GST paid to the government is not recorded in Laboura yet',
      },
    };
  }
}
