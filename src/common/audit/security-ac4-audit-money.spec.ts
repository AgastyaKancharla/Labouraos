import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import { auditRowForViewer } from '../rbac/money-visibility';

/**
 * Security AC-4: Team Leads read their team's audit rows, and those rows carried
 * money (payout and fee amounts) in before/after. Only the CEO and Finance see
 * money in audit rows.
 */
describe('Security AC-4: money is stripped from audit rows except for the CEO and Finance', () => {
  it('unit: keeps job salaries, removes company money and hides rupees in the reason', () => {
    const row = { id: 'a1', before: { amountPaise: 99900, status: 'pending' }, after: { amountPaise: 99900, placementFee: 800000, agreedSalary: 1600000, status: 'approved' }, reason: 'Approved payout of ₹999' };
    for (const role of ['team_lead', 'manager', 'call_agent', 'field_agent', undefined]) {
      const out = auditRowForViewer(row, role);
      expect(out.after).toEqual({ agreedSalary: 1600000, status: 'approved' });
      expect(out.before).toEqual({ status: 'pending' });
      expect(out.reason).not.toContain('999');
    }
    for (const role of ['ceo', 'finance']) expect(auditRowForViewer(row, role)).toBe(row);
  });

  it('L7: hides "Rs 500", "Rs. 500", "INR 500" and "500 rupees" in the reason too', () => {
    const forms = ['Rs 500', 'Rs. 500', 'Rs.500', 'rs 1,500', 'INR 500', 'inr500', 'Rupees 500', '500 rupees', '1,500.50 Rupees', '500 Rs', '₹ 500'];
    for (const form of forms) {
      const out = auditRowForViewer({ before: null, after: null, reason: `Refund of ${form} approved` }, 'team_lead');
      expect(out.reason).toBe('Refund of ₹ (hidden) approved');
    }
    // Words that merely contain the letters are left alone.
    const plain = auditRowForViewer({ before: null, after: null, reason: 'Worked 500 hours; called rs-team; INR is the currency' }, 'team_lead');
    expect(plain.reason).toBe('Worked 500 hours; called rs-team; INR is the currency');
  });

  it('L7 residue: "500 INR", "500/-", "rs: 500", "Rs-500", "रु 500" and scaled amounts are hidden whole; bare numbers are not', () => {
    const forms = ['500 INR', '500/-', '1,500 /-', 'rs: 500', 'Rs-500', 'Rs - 500', 'रु 500', 'रु500', '₹ 5 lakh', '₹5 lakhs', 'Rs 2 crore', 'Rs.1.5 cr', 'INR 20k', '5 lakh rupees', 'Rs 500/-'];
    for (const form of forms) {
      const out = auditRowForViewer({ before: null, after: null, reason: `Refund of ${form} approved` }, 'team_lead');
      expect(out.reason).toBe('Refund of ₹ (hidden) approved');
    }
    const plain = auditRowForViewer({ before: null, after: null, reason: 'Call 3 of 5 on 12-11-2026; 2 lakh people; ticket 500' }, 'team_lead');
    expect(plain.reason).toBe('Call 3 of 5 on 12-11-2026; 2 lakh people; ticket 500');
  });

  describe('over HTTP', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    const suffix = Date.now().toString().slice(-7);
    const staffIds: string[] = [];
    const tokens: Record<'ceo' | 'lead', string> = { ceo: '', lead: '' };
    const entityCode = `PAY-AC4-${suffix}`;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
      prisma = app.get(PrismaService);
      const jwt = app.get(JwtService);
      const lead = await prisma.staff.create({ data: { code: `AC4TL-${suffix}`, name: 'AC4 Lead', email: `ac4tl_${suffix}@laboura.local`, passwordHash: 'h', role: 'team_lead', city: 'Bengaluru' } });
      const agent = await prisma.staff.create({ data: { code: `AC4CA-${suffix}`, name: 'AC4 Agent', email: `ac4ca_${suffix}@laboura.local`, passwordHash: 'h', role: 'call_agent', city: 'Bengaluru', teamLeadId: lead.id } });
      const ceo = await prisma.staff.create({ data: { code: `AC4CEO-${suffix}`, name: 'AC4 CEO', email: `ac4ceo_${suffix}@laboura.local`, passwordHash: 'h', role: 'ceo', city: 'Bengaluru' } });
      staffIds.push(agent.id, lead.id, ceo.id);
      tokens.lead = await jwt.signAsync({ sub: lead.id, role: 'team_lead', email: lead.email, code: lead.code });
      tokens.ceo = await jwt.signAsync({ sub: ceo.id, role: 'ceo', email: ceo.email, code: ceo.code });
      await app.get(AuditService).log({
        actorId: agent.id, action: 'payment.test_ac4', entityType: 'payment', entityCode,
        before: { status: 'pending', amountPaise: 99900 }, after: { status: 'approved', amountPaise: 99900, refundAmountPaise: 49900 },
        changedFields: ['status'], reason: 'Approved ₹999', city: 'Bengaluru',
      });
    });

    afterAll(async () => {
      try {
        await prisma.auditLog.deleteMany({ where: { entityCode } }).catch(() => undefined);
        await prisma.staff.deleteMany({ where: { id: { in: staffIds } } }).catch(() => undefined);
      } finally {
        await app?.close();
      }
    });

    const list = (token: string) =>
      request(app.getHttpServer()).get('/audit-logs').query({ entityType: 'payment', entityCode }).set('Authorization', `Bearer ${token}`).expect(200);

    it('a Team Lead reads the row without any money, in the list and by id', async () => {
      const rows = (await list(tokens.lead)).body as Array<{ id: string; before: unknown; after: unknown; reason: string }>;
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows[0])).not.toMatch(/99900|49900|999/);
      expect(rows[0].after).toEqual({ status: 'approved' });
      const one = await request(app.getHttpServer()).get(`/audit-logs/${rows[0].id}`).set('Authorization', `Bearer ${tokens.lead}`).expect(200);
      expect(JSON.stringify(one.body)).not.toMatch(/99900|49900/);
    });

    it('the CEO still sees the amounts', async () => {
      const rows = (await list(tokens.ceo)).body as Array<{ after: Record<string, unknown> }>;
      expect(rows[0].after).toMatchObject({ amountPaise: 99900, refundAmountPaise: 49900 });
    });
  });
});
