import { IdService, formatCode } from './id.service';
import { PrismaService } from '../prisma/prisma.service';

jest.setTimeout(120000);

/**
 * B1 (12 Nov): placement fees and no-bypass charges share one GST invoice
 * series. After a restart the INV sequence is synced from the highest number
 * in BOTH tables, and it never moves down.
 */
describe('Invoice numbers stay unique across placement fees and no-bypass charges after a restart', () => {
  let prisma: PrismaService;
  let ids: IdService;
  const stamp = `${Date.now()}`;
  const chargeIds: string[] = [];
  const num = (code: string) => Number(code.split('-')[1]);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    ids = new IdService(prisma);
    await ids.onModuleInit();
  });

  afterAll(async () => {
    await prisma.bypassCharge.deleteMany({ where: { id: { in: chargeIds } } });
    await prisma.$disconnect();
  });

  async function chargeWithInvoice(n: number) {
    const charge = await prisma.bypassCharge.create({
      data: {
        code: `BYP-SEQ-${stamp}-${n}`,
        businessId: `seq-biz-${stamp}`,
        jobSeekerId: `seq-js-${stamp}-${n}`,
        hiredOn: new Date('2026-11-01T00:00:00Z'),
        introducedAt: new Date('2026-10-01T00:00:00Z'),
        monthlySalaryPaise: 1500000,
        feePercent: 50,
        penaltyPercent: 50,
        gstPercent: 18,
        feePaise: 750000,
        penaltyPaise: 375000,
        gstPaise: 202500,
        totalPaise: 1327500,
        reason: 'sequence test',
        invoiceCode: formatCode('INV', n),
        status: 'cancelled',
        raisedByStaffId: 'seq-test',
      },
    });
    chargeIds.push(charge.id);
  }

  it('moves past the highest no-bypass charge invoice number on restart', async () => {
    const before = num(await ids.generateCode('invoice'));
    // A charge numbered well above the sequence (as if the sequence was reset).
    await chargeWithInvoice(before + 500);
    await new IdService(prisma).onModuleInit(); // a restart
    expect(num(await ids.generateCode('invoice'))).toBeGreaterThan(before + 500);
  });

  it('never moves the sequence down when the highest invoice disappears', async () => {
    const high = num(await ids.generateCode('invoice'));
    await prisma.bypassCharge.deleteMany({ where: { id: { in: chargeIds } } });
    await ids.syncAllSequences();
    expect(num(await ids.generateCode('invoice'))).toBeGreaterThan(high);
  });

  it('syncSequenceUp takes the maximum over every source column', async () => {
    const start = num(await ids.generateCode('invoice'));
    await chargeWithInvoice(start + 300);
    await ids.syncSequenceUp('INV', [
      { table: 'Placement', column: 'invoiceCode' },
      { table: 'BypassCharge', column: 'invoiceCode' },
    ]);
    expect(num(await ids.generateCode('invoice'))).toBeGreaterThan(start + 300);
  });
});
