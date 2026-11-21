import { Test } from '@nestjs/testing';
import { BANK_COLLECTION_PROVIDER, BankCollectionProvider, NoBankApiProvider, safeExtraMethods } from './bank-collection-provider';
import { UpiCollectionService } from './upi-collection.service';

/**
 * 21 Nov (rev 204): no payment gateway. The payment page is direct UPI (QR and
 * "Or pay with" app buttons, all from the one upi://pay link); a future bank
 * API plugs in behind BankCollectionProvider for automatic confirmation and,
 * optionally, card / netbanking. Nothing talks to a bank yet.
 */
describe('Bank collection provider seam (21 Nov, rev 204)', () => {
  const env = { vpa: process.env.COMPANY_UPI_VPA, name: process.env.COMPANY_UPI_PAYEE_NAME };
  beforeAll(() => {
    process.env.COMPANY_UPI_VPA = 'laboura@icici';
    process.env.COMPANY_UPI_PAYEE_NAME = 'Laboura Staffing Pvt Ltd';
  });
  afterAll(() => {
    for (const [key, value] of [['COMPANY_UPI_VPA', env.vpa], ['COMPANY_UPI_PAYEE_NAME', env.name]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const payment = {
    id: 'pay-1', code: 'PAY-00042', method: 'upi_direct', status: 'pending', type: 'placement_fee', jobSeekerId: null,
    expectedAmountPaise: 944000, upiReference: 'PAY-42-K7Q2',
  };
  const service = (bank?: BankCollectionProvider) =>
    new UpiCollectionService({} as never, {} as never, {} as never, undefined, undefined, bank);

  it('today there is no bank API: direct UPI only, no card or netbanking, Finance matches by hand', async () => {
    const page = await service(new NoBankApiProvider()).paymentPageFor(payment as never);
    expect(page).toMatchObject({ amountPaise: 944000, upiReference: 'PAY-42-K7Q2', extraMethods: [], confirmsAutomatically: false });
    // The QR and every app button share this one link: payee, exact amount, reference.
    expect(page.upiUri).toBe('upi://pay?pa=laboura%40icici&pn=Laboura+Staffing+Pvt+Ltd&am=9440.00&tn=PAY-00042&tr=PAY-42-K7Q2&cu=INR');
    expect(page.qrSvg).toContain('<svg');
  });

  it('a bank API, once connected, adds its card / netbanking options (https only) and automatic confirmation', async () => {
    const seen: unknown[] = [];
    const bank: BankCollectionProvider = {
      name: 'future-bank',
      confirmsAutomatically: true,
      extraMethods: async (request) => {
        seen.push(request);
        return [
          { kind: 'card', label: 'Pay by card', startUrl: 'https://bank.example/pay/PAY-42' },
          { kind: 'netbanking', label: 'Netbanking', startUrl: 'javascript:alert(1)' },
        ];
      },
    };
    const page = await service(bank).paymentPageFor(payment as never);
    expect(page.extraMethods).toEqual([{ kind: 'card', label: 'Pay by card', startUrl: 'https://bank.example/pay/PAY-42' }]);
    expect(page.confirmsAutomatically).toBe(true);
    expect(seen).toEqual([{ paymentId: 'pay-1', paymentCode: 'PAY-00042', amountPaise: 944000, upiReference: 'PAY-42-K7Q2' }]);
  });

  it('keeps only card / netbanking with an https start page', () => {
    expect(safeExtraMethods([
      { kind: 'card', label: 'Card', startUrl: 'https://bank.example/a' },
      { kind: 'netbanking', label: 'NB', startUrl: 'http://bank.example/b' },
      { kind: 'wallet' as never, label: 'W', startUrl: 'https://bank.example/c' },
      { kind: 'card', label: 'Bad', startUrl: 'not a url' },
    ])).toEqual([{ kind: 'card', label: 'Card', startUrl: 'https://bank.example/a' }]);
  });

  it('the payment module binds the no-bank provider (no gateway, no bank integration)', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [{ provide: BANK_COLLECTION_PROVIDER, useClass: NoBankApiProvider }] }).compile();
    const bound = moduleRef.get<BankCollectionProvider>(BANK_COLLECTION_PROVIDER);
    expect(bound.name).toBe('none');
    expect(await bound.extraMethods({ paymentId: 'p', paymentCode: 'c', amountPaise: 1, upiReference: 'r' })).toEqual([]);
  });
});
