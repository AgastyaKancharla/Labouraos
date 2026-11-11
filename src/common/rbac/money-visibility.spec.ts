import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { HIDDEN_AMOUNT_TEXT, isJobSalaryKey, isMoneyKey, seesMoney, stripMoney } from './money-visibility';
import {
  collectFullPhoneRecords,
  FULL_PHONE_VIEW_ACTION,
  FULL_PHONE_VIEW_ENTITY,
  PiiMaskingInterceptor,
} from './pii-masking.interceptor';
import { AuditService } from '../audit/audit.service';
import { isValidReceiptToken, receiptLink, receiptToken } from '../../modules/payment/receipt-link';

function contextFor(user: Record<string, unknown> | undefined, request: Record<string, unknown> = {}) {
  const req = { user, method: 'GET', path: '/job-seekers/js-1', route: { path: '/job-seekers/:id' }, ...request };
  return {
    req,
    context: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext,
  };
}

function handlerReturning(data: unknown): CallHandler {
  return { handle: () => of(data) };
}

describe('Managers see no money (money-visibility)', () => {
  it('lets job-related salary through but never fees, payments or staff pay', () => {
    for (const key of ['minSalary', 'maxSalary', 'salaryMinPaise', 'salaryMaxPaise', 'agreedSalary', 'selectedSalaryPaise', 'expectedSalary', 'monthlySalaryINR']) {
      expect(isJobSalaryKey(key)).toBe(true);
    }
    for (const key of ['placementFee', 'placementFeeINR', 'amountPaise', 'activationFeePaise', 'totalAtRiskRupees', 'netPayPaise', 'staffMonthlyPayPaise', 'grossSalaryPaise']) {
      expect(isJobSalaryKey(key)).toBe(false);
    }
    const out = stripMoney({ minSalary: 1500000, agreedSalary: 2000000, placementFee: 1000000, amountPaise: 49900 });
    expect(out).toEqual({ minSalary: 1500000, agreedSalary: 2000000 });
  });

  it('recognises every money field name used in the code', () => {
    for (const key of [
      'amount',
      'amountPaise',
      'gstAmount',
      'placementFee',
      'agreedSalary',
      'minSalary',
      'maxSalary',
      'salaryMinPaise',
      'activationFeePaise',
      'totalAtRiskRupees',
      'monthlySalaryINR',
      'placementFeeINR',
      'expectedAmountPaise',
    ]) {
      expect(isMoneyKey(key)).toBe(true);
    }
    for (const key of [
      'id',
      'code',
      'status',
      'refundRate',
      'candidatesCount',
      'placementsCount',
      'salaryPeriod',
      'phone',
      'paymentReceivedAt',
    ]) {
      expect(isMoneyKey(key)).toBe(false);
    }
  });

  it('removes nested money fields, keeps counts and rates, and hides rupee text', () => {
    const stripped = stripMoney({
      totalAtRiskPaise: 99800,
      totalAtRiskRupees: 998,
      candidatesCount: 2,
      refundRate: 0.05,
      rows: [{ code: 'JS-00001', amountPaise: 49900, amountRupees: 499, daysLeft: 3 }],
      audit: { before: { placementFee: 1200000 }, after: { placementFee: 1300000, status: 'ok' } },
      message: 'Pay ₹499 now, or ₹12,000.50 later',
      createdAt: new Date('2026-11-11T00:00:00Z'),
    });
    expect(stripped).toEqual({
      candidatesCount: 2,
      refundRate: 0.05,
      rows: [{ code: 'JS-00001', daysLeft: 3 }],
      audit: { before: {}, after: { status: 'ok' } },
      message: `Pay ${HIDDEN_AMOUNT_TEXT} now, or ${HIDDEN_AMOUNT_TEXT} later`,
      createdAt: new Date('2026-11-11T00:00:00Z'),
    });
    expect(JSON.stringify(stripped)).not.toMatch(/499|12,000|99800|1200000/);
  });

  it('applies to Managers only', () => {
    expect(seesMoney('manager')).toBe(false);
    for (const role of ['ceo', 'finance', 'team_lead', 'call_agent', 'field_agent']) {
      expect(seesMoney(role)).toBe(true);
    }
  });
});

describe('PiiMaskingInterceptor: phones and money by role', () => {
  const seeker = {
    id: 'js-1',
    code: 'JS-00001',
    phone: '+919876543210',
    minSalary: 1500000,
    business: { id: 'bz-1', code: 'BZ-00001', contactPhone: '+919811112222', virtualNumber: '18001234567' },
  };

  it('gives a Manager last-4 phones and no money', async () => {
    const audit = { log: jest.fn() } as unknown as AuditService;
    const { context } = contextFor({ sub: 'mgr-1', role: 'manager', code: 'MGR-00001' });
    const out = (await lastValueFrom(
      new PiiMaskingInterceptor(audit).intercept(context, handlerReturning(seeker)),
    )) as Record<string, unknown>;
    expect(out.phone).toBe('******3210');
    expect((out.business as Record<string, unknown>).contactPhone).toBe('******2222');
    // Job-related salary is a work detail a Manager sees (decided 11 Nov).
    expect(out.minSalary).toBe(1500000);
    expect(JSON.stringify(out)).not.toContain('9876543210');
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('gives the CEO full numbers and writes one audit row listing the records', async () => {
    const audit = { log: jest.fn().mockResolvedValue({}) } as unknown as AuditService;
    const { context, req } = contextFor({ sub: 'ceo-1', role: 'ceo', code: 'CEO-00001' });
    const interceptor = new PiiMaskingInterceptor(audit);
    const out = (await lastValueFrom(
      interceptor.intercept(context, handlerReturning([seeker])),
    )) as Record<string, unknown>[];
    expect(out[0].phone).toBe('+919876543210');
    expect(out[0].minSalary).toBe(1500000);
    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = (audit.log as jest.Mock).mock.calls[0][0];
    expect(entry).toMatchObject({
      actorId: 'ceo-1',
      action: FULL_PHONE_VIEW_ACTION,
      entityType: FULL_PHONE_VIEW_ENTITY,
      entityCode: 'CEO-00001',
    });
    expect(entry.after.route).toBe('/job-seekers/:id');
    expect(entry.after.records).toEqual([
      { id: 'js-1', code: 'JS-00001', fields: ['phone'] },
      { id: 'bz-1', code: 'BZ-00001', fields: ['contactPhone'] },
    ]);
    expect(JSON.stringify(entry)).not.toContain('9876543210');
    expect(JSON.stringify(entry)).not.toContain('9811112222');

    // The global and the controller-level interceptor both run on one request:
    // still one audit row.
    await lastValueFrom(interceptor.intercept(context, handlerReturning([seeker])));
    expect(req).toBeDefined();
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('writes no audit row when the CEO answer holds no full number', async () => {
    const audit = { log: jest.fn() } as unknown as AuditService;
    const { context } = contextFor({ sub: 'ceo-1', role: 'ceo', code: 'CEO-00001' });
    await lastValueFrom(
      new PiiMaskingInterceptor(audit).intercept(
        context,
        handlerReturning({ id: 'x', phone: '******3210', virtualNumber: '18001234567' }),
      ),
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('lists records by id and code only', () => {
    expect(collectFullPhoneRecords({ items: [{ id: 'a', phone: '9876543210', name: 'X' }] })).toEqual([
      { id: 'a', fields: ['phone'] },
    ]);
  });
});

describe('payment receipt link token', () => {
  const previous = process.env.JWT_SECRET;
  const previousUrl = process.env.PUBLIC_APP_URL;
  beforeAll(() => {
    process.env.JWT_SECRET = previous && previous.length >= 32 ? previous : 'receipt_test_secret_at_least_32_characters';
    process.env.PUBLIC_APP_URL = previousUrl || 'https://app.laboura.in';
  });
  afterAll(() => {
    process.env.JWT_SECRET = previous;
    process.env.PUBLIC_APP_URL = previousUrl;
  });

  it('accepts only the token signed for that payment', () => {
    const token = receiptToken('pay-1');
    expect(isValidReceiptToken('pay-1', token)).toBe(true);
    expect(isValidReceiptToken('pay-2', token)).toBe(false);
    expect(isValidReceiptToken('pay-1', `${token}x`)).toBe(false);
    expect(isValidReceiptToken('pay-1', '')).toBe(false);
    expect(isValidReceiptToken('pay-1', undefined)).toBe(false);
    expect(receiptLink('pay-1')).toBe(`https://app.laboura.in/payments/pay-1/receipt?token=${token}`);
  });
});
