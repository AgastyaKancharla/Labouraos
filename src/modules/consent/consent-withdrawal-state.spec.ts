import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CustomerHomeService } from '../customer-app/customer-home.service';
import { ConsentClock } from './consent-clock';
import { ConsentService } from './consent.service';
import { loadStandingWithdrawals, standingWithdrawals } from './consent-withdrawal-state';

class TestConsentClock extends ConsentClock {
  current = new Date();
  override now() {
    return new Date(this.current);
  }
}

const at = (iso: string) => new Date(iso);

describe('Is a consent purpose withdrawn right now? (refund guards, rev 200)', () => {
  it('a withdrawal stands until the same purpose is given again later', () => {
    const withdrawn = { subjectId: 'a', purpose: 'call_recording', granted: false, grantedAt: at('2026-11-01T00:00:00Z'), withdrawnAt: at('2026-11-05T00:00:00Z') };
    expect(standingWithdrawals([withdrawn]).get('a')).toEqual(at('2026-11-05T00:00:00Z'));
    const again = { subjectId: 'a', purpose: 'call_recording', granted: true, grantedAt: at('2026-11-06T00:00:00Z'), withdrawnAt: null };
    expect(standingWithdrawals([withdrawn, again]).has('a')).toBe(false);
    // A live grant of ANOTHER purpose, or one older than the withdrawal, does not lift it.
    const other = { subjectId: 'a', purpose: 'job_matching', granted: true, grantedAt: at('2026-11-07T00:00:00Z'), withdrawnAt: null };
    const older = { subjectId: 'a', purpose: 'call_recording', granted: true, grantedAt: at('2026-11-04T00:00:00Z'), withdrawnAt: null };
    expect(standingWithdrawals([withdrawn, other, older]).get('a')).toEqual(at('2026-11-05T00:00:00Z'));
    // The latest standing withdrawal per person.
    const second = { subjectId: 'a', purpose: 'profile_sharing', granted: false, grantedAt: null, withdrawnAt: at('2026-11-08T00:00:00Z') };
    expect(standingWithdrawals([withdrawn, again, second]).get('a')).toEqual(at('2026-11-08T00:00:00Z'));
  });

  describe('with the database', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let consent: ConsentService;
    let home: CustomerHomeService;
    const clock = new TestConsentClock();
    const ids: string[] = [];

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ConsentClock).useValue(clock).compile();
      app = moduleRef.createNestApplication();
      await app.init();
      prisma = app.get(PrismaService);
      consent = app.get(ConsentService);
      home = app.get(CustomerHomeService);
    }, 120000);

    afterAll(async () => {
      if (!prisma) return;
      await prisma.consent.deleteMany({ where: { subjectId: { in: ids } } });
      await prisma.statusHistory.deleteMany({ where: { subjectId: { in: ids } } });
      await prisma.jobSeeker.deleteMany({ where: { id: { in: ids } } });
      await app.close();
    });

    it('withdrawn after paying → the guard holds; given again → the guarantee is back; the withdrawal row is kept', async () => {
      const day = 24 * 60 * 60 * 1000;
      const paidAt = new Date(Date.now() - 3 * day);
      const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
      const seeker = await prisma.jobSeeker.create({
        data: {
          code: `JS-WS-${suffix}`, name: `Refund guard ${suffix}`, phone: `+9196${Math.floor(10000000 + Math.random() * 90000000)}`,
          trades: { create: { trade: 'Cook', isPrimary: true } }, minSalary: 1200000, maxSalary: 2200000,
          preferredCallWindowStart: '09:00', preferredCallWindowEnd: '20:00', status: 'active', paymentReceivedAt: paidAt, guaranteeStartsAt: paidAt, guaranteeFloorPaise: 1200000,
        },
      });
      ids.push(seeker.id);
      clock.current = new Date(paidAt.getTime() - day);
      for (const purpose of ['job_matching', 'profile_sharing', 'call_recording', 'aadhaar_verification', 'job_updates']) {
        await consent.grant({ subjectType: 'job_seeker', subjectId: seeker.id, purpose, noticeVersion: '1.2', language: 'en', method: 'sms_link' });
      }
      const guaranteeActive = async () => (await home.jobSeekerHome({ jobSeekerId: seeker.id } as never)).guarantee.active;
      expect((await loadStandingWithdrawals(prisma, [seeker.id])).has(seeker.id)).toBe(false);
      expect(await guaranteeActive()).toBe(true);

      // Withdrawn after paying: the refund guarantee is off.
      clock.current = new Date(paidAt.getTime() + day);
      await consent.withdraw({ subjectType: 'job_seeker', subjectId: seeker.id, purpose: 'call_recording', withdrawnMethod: 'agent_call' });
      const standing = await loadStandingWithdrawals(prisma, [seeker.id]);
      expect(standing.get(seeker.id)!.getTime()).toBeGreaterThanOrEqual(paidAt.getTime());
      expect(await guaranteeActive()).toBe(false);

      // Given again later: the guarantee is back, and the withdrawal stays in its own row.
      clock.current = new Date(paidAt.getTime() + 2 * day);
      await consent.grant({ subjectType: 'job_seeker', subjectId: seeker.id, purpose: 'call_recording', noticeVersion: '1.2', language: 'en', method: 'sms_link' });
      expect((await loadStandingWithdrawals(prisma, [seeker.id])).has(seeker.id)).toBe(false);
      expect(await guaranteeActive()).toBe(true);
      const rows = await prisma.consent.findMany({ where: { subjectId: seeker.id, purpose: 'call_recording' }, orderBy: { createdAt: 'asc' } });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ granted: false, withdrawnMethod: 'agent_call' });
      expect(rows[1]).toMatchObject({ granted: true, withdrawnAt: null });
    }, 120000);
  });
});
