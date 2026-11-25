import { HttpException } from '@nestjs/common';
import { CustomerScopeService } from '../../common/customer-auth/customer-scope.service';
import { CustomerNotificationService } from './customer-notification.service';
import { CustomerNotificationSettingsService } from './customer-notification-settings.service';
import { CustomerPushSenderService } from './customer-push-sender.service';
import { CustomerInboxService } from './customer-inbox.service';
import { CustomerNotificationClock } from './customer-notification.clock';
import {
  createCustomerPushProvider,
  CustomerPushProvider,
  ExpoCustomerPushProvider,
  MockCustomerPushProvider,
  PushMessage,
  PushReceipt,
  PushTicket,
} from './push-provider';
import { FakePrisma } from './testing/fake-prisma';
import { CUSTOMER_EVENT_KINDS, CUSTOMER_EVENTS } from './customer-notification.constants';
import { CUSTOMER_NOTIFICATION_WORDING, renderWording } from './customer-notification.wording';
import { istDayStart, isQuietTime, quietEndsAt } from './quiet-hours';

/** IST wall-clock time on 20 Nov 2026 as a UTC instant. */
function ist(hhmm: string, day = 20): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, day, h, m) - (5 * 60 + 30) * 60 * 1000);
}

function codeOf(error: unknown): string | undefined {
  return error instanceof HttpException ? (error.getResponse() as { code?: string }).code : undefined;
}

async function expectCode(work: Promise<unknown>, code: string): Promise<void> {
  try {
    await work;
  } catch (error) {
    expect(codeOf(error)).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

class FixedClock extends CustomerNotificationClock {
  constructor(public at: Date) {
    super();
  }
  now(): Date {
    return this.at;
  }
}

/** A provider stub that records what it was asked and answers as told. */
class StubProvider implements CustomerPushProvider {
  readonly mode = 'mock' as const;
  sent: PushMessage[] = [];
  answer: (m: PushMessage) => PushTicket = () => ({ status: 'ok', id: `t-${this.sent.length}` });
  receipts: Record<string, PushReceipt> = {};
  failNext = false;
  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Expo down');
    }
    return messages.map((m) => {
      this.sent.push(m);
      return this.answer(m);
    });
  }
  async getReceipts(ids: string[]): Promise<Record<string, PushReceipt>> {
    return Object.fromEntries(ids.filter((id) => this.receipts[id]).map((id) => [id, this.receipts[id]]));
  }
}

function setup(at: Date = ist('10:00')) {
  const prisma = new FakePrisma();
  const clock = new FixedClock(at);
  const settings = new CustomerNotificationSettingsService(prisma as never, clock);
  const kicker = { kick: jest.fn().mockResolvedValue(undefined) };
  const scope = new CustomerScopeService(prisma as never);
  const notifications = new CustomerNotificationService(prisma as never, settings, clock, scope, kicker as never);
  const provider = new StubProvider();
  const sender = new CustomerPushSenderService(prisma as never, settings, clock, provider, scope);
  const inbox = new CustomerInboxService(prisma as never, clock, scope);

  let n = 0;
  async function account(
    opts: { language?: string; token?: string | null; jobSeekerId?: string; businessId?: string; referralId?: string; role?: string; phone?: string; linkedVia?: string } = {},
  ) {
    n += 1;
    const acc = await prisma.customerAccount.create({ data: { id: `acc-${n}`, language: opts.language ?? 'en', status: 'active', createdVia: 'phone', phone: opts.phone ?? null } });
    if (opts.jobSeekerId || opts.businessId || opts.referralId) {
      await prisma.customerProfile.create({
        data: {
          id: `prof-${n}`,
          accountId: acc.id,
          kind: opts.jobSeekerId ? 'job_seeker' : opts.businessId ? 'business' : 'referral',
          jobSeekerId: opts.jobSeekerId ?? null,
          businessId: opts.businessId ?? null,
          referralId: opts.referralId ?? null,
          branchId: null,
          role: opts.role ?? (opts.businessId ? 'owner' : 'self'),
          linkedVia: opts.linkedVia ?? 'invite',
          status: 'active',
        },
      });
    }
    // Every phone gets a signed-in session (only phones with a live sign-in get pushes).
    const device = await prisma.customerDevice.create({
      data: {
        id: `dev-${n}`, accountId: acc.id, installationId: `inst-${n}`, platform: 'android', pushPermission: 'granted',
        pushToken: opts.token === null ? null : (opts.token ?? `ExponentPushToken[device-${n}-abcdefgh]`),
      },
    });
    await prisma.customerSession.create({ data: { id: `sess-${n}`, accountId: acc.id, deviceId: device.id } });
    return acc.id as string;
  }

  /** The principal the customer guard would give this account's phone. */
  const me = (accountId: string) => {
    const s = prisma.tables.customerSession.find((r) => r.accountId === accountId)!;
    return { accountId, sessionId: s.id as string, deviceId: s.deviceId as string };
  };

  return { prisma, clock, settings, notifications, provider, sender, inbox, kicker, account, me };
}

describe('Customer notifications: wording in English only (rev 193)', () => {
  it('has English, and only English, for every event', () => {
    for (const kind of CUSTOMER_EVENT_KINDS) {
      const table = CUSTOMER_NOTIFICATION_WORDING[kind];
      expect(Object.keys(table)).toEqual(['en']);
      const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
      expect(`${table.en.title} ${table.en.body}`).not.toMatch(/\p{Script=Kannada}|\p{Script=Devanagari}/u);
      const used = [...placeholders(table.en.title), ...placeholders(table.en.body)].map((p) => p.slice(1, -1));
      expect(used.sort()).toEqual([...new Set(used)].sort().filter((v) => CUSTOMER_EVENTS[kind].vars.includes(v as never)));
    }
  });

  it('keeps private details off the lock screen (no rupee amounts, phone numbers or addresses)', () => {
    for (const kind of CUSTOMER_EVENT_KINDS) {
      for (const w of Object.values(CUSTOMER_NOTIFICATION_WORDING[kind])) {
        expect(`${w.title} ${w.body}`).not.toMatch(/₹|\+91|\d{10}/);
      }
    }
  });

  it('fills placeholders in the person\'s language and refuses a missing one', () => {
    expect(renderWording('signup_reminder', 'kn', { stepsLeft: 2 }).body).toContain('2');
    expect(renderWording('signup_reminder', 'xx', { stepsLeft: 2 }).language).toBe('en');
    expect(() => renderWording('referral_joined', 'en', {})).toThrow(/firstName/);
  });
});

describe('Customer notifications: quiet hours in India time', () => {
  it('is quiet from 21:00 to 09:00 IST', () => {
    expect(isQuietTime(ist('20:59'), '21:00', '09:00')).toBe(false);
    expect(isQuietTime(ist('21:00'), '21:00', '09:00')).toBe(true);
    expect(isQuietTime(ist('03:00'), '21:00', '09:00')).toBe(true);
    expect(isQuietTime(ist('08:59'), '21:00', '09:00')).toBe(true);
    expect(isQuietTime(ist('09:00'), '21:00', '09:00')).toBe(false);
  });

  it('ends quiet hours at the next 09:00 IST', () => {
    expect(quietEndsAt(ist('22:30'), '09:00').toISOString()).toBe(ist('09:00', 21).toISOString());
    expect(quietEndsAt(ist('06:00'), '09:00').toISOString()).toBe(ist('09:00').toISOString());
    expect(istDayStart(ist('00:10')).toISOString()).toBe(ist('00:00').toISOString());
  });
});

describe('Customer notifications: notify and send', () => {
  it('writes the inbox row in English, even for an account that had Hindi saved, and queues the push', async () => {
    const t = setup();
    const accountId = await t.account({ language: 'hi', jobSeekerId: 'js-1' });
    const result = await t.notifications.notify({ jobSeekerId: 'js-1' }, 'refund_approved');
    expect(result).toEqual({ inbox: 1, queued: 1, held: 0, skipped: [] });
    const [row] = t.prisma.tables.customerInboxMessage;
    expect(row).toMatchObject({ accountId, profileId: 'prof-1', kind: 'refund_approved', language: 'en', pushStatus: 'queued', category: 'service' });
    expect(row.title).toBe(CUSTOMER_NOTIFICATION_WORDING.refund_approved.en.title);
    expect(t.kicker.kick).toHaveBeenCalledTimes(1);

    const sent = await t.sender.sendDue();
    expect(sent.sent).toBe(1);
    expect(t.provider.sent[0]).toMatchObject({ channelId: 'service', data: expect.objectContaining({ deepLink: '/home', profileId: 'prof-1', kind: 'refund_approved' }) });
    expect(t.prisma.tables.customerInboxMessage[0].pushStatus).toBe('sent');
  });

  it('is never a contact attempt: the log row is the customer account\'s, channel push or in_app', async () => {
    const t = setup();
    const accountId = await t.account({ jobSeekerId: 'js-1' });
    await t.account({ jobSeekerId: 'js-2', token: null });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'hit_recorded');
    await t.notifications.notify({ jobSeekerId: 'js-2' }, 'hit_recorded');
    const logs = t.prisma.tables.messageLog;
    expect(logs.map((l) => l.channel).sort()).toEqual(['in_app', 'push']);
    for (const log of logs) {
      expect(log.subjectType).toBe('customer_account');
      expect(log.subjectType).not.toBe('job_seeker');
    }
    expect(logs[0]).toMatchObject({ subjectId: accountId, relatedType: 'job_seeker', relatedId: 'js-1' });
    // FakePrisma has no contactAttempt table: any attempt to write one would throw.
    expect((t.prisma as unknown as Record<string, unknown>).contactAttempt).toBeUndefined();
  });

  it('gives nothing to a record without the app, and fails nobody', async () => {
    const t = setup();
    await expect(t.notifications.notify({ jobSeekerId: 'nobody' }, 'refund_paid')).resolves.toEqual({ inbox: 0, queued: 0, held: 0, skipped: [] });
    await expect(t.notifications.notifySafely({ jobSeekerId: 'x' }, 'referral_joined', {})).resolves.toBeNull();
  });

  it('adds one message per event (dedupe key)', async () => {
    const t = setup();
    await t.account({ jobSeekerId: 'js-1' });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'refund_paid', {}, { dedupeKey: 'refund_paid:p1' });
    const again = await t.notifications.notify({ jobSeekerId: 'js-1' }, 'refund_paid', {}, { dedupeKey: 'refund_paid:p1' });
    expect(again.skipped).toEqual([{ accountId: 'acc-1', reason: 'duplicate' }]);
    expect(t.prisma.tables.customerInboxMessage).toHaveLength(1);
  });

  it('a business notification reaches owner-level people, and a branch manager only for their branch', async () => {
    const t = setup();
    await t.account({ businessId: 'bz-1' });
    const managerId = await t.account();
    await t.prisma.customerProfile.create({ data: { id: 'prof-mgr', accountId: managerId, kind: 'business', businessId: 'bz-1', branchId: 'br-1', status: 'active' } });
    expect((await t.notifications.notify({ businessId: 'bz-1' }, 'business_approved')).inbox).toBe(1);
    expect((await t.notifications.notify({ businessId: 'bz-1', branchId: 'br-1' }, 'vacancy_confirmed', { vacancyCode: 'VC-00001' })).inbox).toBe(2);
    expect((await t.notifications.notify({ businessId: 'bz-1', branchId: 'br-2' }, 'vacancy_confirmed', { vacancyCode: 'VC-00002' })).inbox).toBe(1);
  });
});

describe('Customer notifications: quiet hours 9 PM to 9 AM (everything but receipts held until 9 AM)', () => {
  it('holds a non-urgent push at night and sends it at 9 AM', async () => {
    const t = setup(ist('22:15'));
    await t.account({ jobSeekerId: 'js-1' });
    const result = await t.notifications.notify({ jobSeekerId: 'js-1' }, 'guarantee_countdown', { daysLeft: 5 });
    expect(result).toMatchObject({ inbox: 1, queued: 0, held: 1 });
    const row = t.prisma.tables.customerInboxMessage[0];
    expect(row.pushStatus).toBe('held_quiet_hours');
    expect((row.scheduledFor as Date).toISOString()).toBe(ist('09:00', 21).toISOString());
    expect(t.kicker.kick).not.toHaveBeenCalled();

    t.clock.at = ist('23:30');
    expect((await t.sender.sendDue()).sent).toBe(0);
    t.clock.at = ist('09:01', 21);
    expect((await t.sender.sendDue()).sent).toBe(1);
    expect(t.provider.sent).toHaveLength(1);
  });

  it('a queued push that reaches the worker after 9 PM is held, not sent', async () => {
    const t = setup(ist('20:59'));
    await t.account({ jobSeekerId: 'js-1' });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'offer_check');
    t.clock.at = ist('21:00');
    const result = await t.sender.sendDue();
    expect(result).toMatchObject({ sent: 0, heldQuietHours: 1 });
    expect(t.prisma.tables.customerInboxMessage[0].pushStatus).toBe('held_quiet_hours');
  });

  it('sends a receipt for what the person just did at once at night, but holds an urgent offer until 9 AM', async () => {
    const t = setup(ist('23:00'));
    await t.account({ jobSeekerId: 'js-1' });
    const offer = await t.notifications.notify({ jobSeekerId: 'js-1' }, 'interview_booked', { hours: 48 }, { urgent: true });
    expect(offer).toMatchObject({ inbox: 1, queued: 0, held: 1 });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'payment_confirmed', { days: 30 }, { selfAction: true });
    const held = t.prisma.tables.customerInboxMessage.find((r) => r.kind === 'interview_booked')!;
    expect(held).toMatchObject({ pushStatus: 'held_quiet_hours', priority: 'urgent' });
    expect((held.scheduledFor as Date).toISOString()).toBe(ist('09:00', 21).toISOString());

    expect(await t.sender.sendDue()).toMatchObject({ sent: 1 });
    expect(t.provider.sent.map((m) => m.priority)).toEqual(['normal']);
    t.clock.at = ist('04:00', 21);
    expect(await t.sender.sendDue()).toMatchObject({ sent: 0 });

    t.clock.at = ist('09:01', 21);
    expect(await t.sender.sendDue()).toMatchObject({ sent: 1 });
    expect(t.provider.sent.map((m) => m.priority)).toEqual(['normal', 'high']);
  });

  it('an urgent offer sent at 9 AM is still outside the daily cap', async () => {
    const t = setup(ist('22:00'));
    await t.account({ jobSeekerId: 'js-1' });
    for (let i = 0; i < 3; i += 1) await t.notifications.notify({ jobSeekerId: 'js-1' }, 'guarantee_countdown', { daysLeft: i });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'interview_booked', { hours: 48 }, { urgent: true });
    expect(await t.sender.sendDue()).toMatchObject({ sent: 0 });
    expect(t.prisma.tables.customerInboxMessage.every((r) => r.pushStatus === 'held_quiet_hours')).toBe(true);

    t.clock.at = ist('09:01', 21);
    expect(await t.sender.sendDue()).toMatchObject({ sent: 4, heldDailyCap: 0 });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'offer_check');
    expect(await t.sender.sendDue()).toMatchObject({ sent: 0, heldDailyCap: 1 });
  });
});

describe('Customer notifications: at most 3 non-urgent pushes a day', () => {
  it('pushes the first 3; the 4th stays in the inbox only', async () => {
    const t = setup(ist('10:00'));
    await t.account({ jobSeekerId: 'js-1' });
    for (const kind of ['offer_check', 'joining_day_check', 'hit_recorded', 'refund_paid'] as const) {
      await t.notifications.notify({ jobSeekerId: 'js-1' }, kind);
    }
    const result = await t.sender.sendDue();
    expect(result).toMatchObject({ sent: 3, heldDailyCap: 1 });
    expect(t.prisma.tables.customerInboxMessage).toHaveLength(4);
    const capped = t.prisma.tables.customerInboxMessage.find((r) => r.pushStatus === 'held_daily_cap')!;
    expect(capped.kind).toBe('refund_paid');
    const log = t.prisma.tables.messageLog.find((l) => l.id === capped.messageLogId)!;
    expect(log).toMatchObject({ channel: 'in_app', status: 'sent' });
  });

  it('counts across the day, never counts urgent ones or receipts, and starts again the next day', async () => {
    const t = setup(ist('10:00'));
    await t.account({ jobSeekerId: 'js-1' });
    for (let i = 0; i < 3; i += 1) await t.notifications.notify({ jobSeekerId: 'js-1' }, 'guarantee_countdown', { daysLeft: i });
    await t.sender.sendDue();
    t.clock.at = ist('15:00');
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'interview_booked', { hours: 48 }, { urgent: true });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'payment_confirmed', { days: 30 }, { selfAction: true });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'offer_check');
    expect(await t.sender.sendDue()).toMatchObject({ sent: 2, heldDailyCap: 1 });
    t.clock.at = ist('10:00', 21);
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'offer_check');
    expect(await t.sender.sendDue()).toMatchObject({ sent: 1, heldDailyCap: 0 });
  });
});

describe('Customer notifications: switches and the promotions consent', () => {
  async function jobSeekerWithConsents(t: ReturnType<typeof setup>, purposes: string[]) {
    const accountId = await t.account({ jobSeekerId: 'js-1' });
    for (const purpose of purposes) {
      await t.prisma.consent.create({
        data: { subjectType: 'job_seeker', subjectId: 'js-1', purpose, granted: true, grantedAt: new Date(), noticeVersion: '1.0', language: 'kn', method: 'sms_link' },
      });
    }
    return accountId;
  }

  it('sends promotions only with the promotions consent', async () => {
    const t = setup();
    const accountId = await jobSeekerWithConsents(t, ['job_updates']);
    expect((await t.notifications.notify({ jobSeekerId: 'js-1' }, 'promotion')).skipped).toEqual([{ accountId, reason: 'switched_off' }]);
    expect((await t.notifications.notify({ jobSeekerId: 'js-1' }, 'refund_paid', {}, { promotional: true })).inbox).toBe(0);
    expect(t.prisma.tables.customerInboxMessage).toHaveLength(0);

    await t.settings.update(accountId, { promotions: true });
    const consent = t.prisma.tables.consent.find((c) => c.purpose === 'promotions')!;
    expect(consent).toMatchObject({ granted: true, method: 'in_app', withdrawnAt: null });
    const sent = await t.notifications.notify({ jobSeekerId: 'js-1' }, 'promotion');
    expect(sent.inbox).toBe(1);
    expect(t.prisma.tables.customerInboxMessage[0]).toMatchObject({ category: 'promotions', deepLink: '/inbox' });

    await t.settings.update(accountId, { promotions: false });
    expect(t.prisma.tables.consent.find((c) => c.purpose === 'promotions')).toMatchObject({ granted: false, withdrawnMethod: 'in_app' });
    expect((await t.notifications.notify({ jobSeekerId: 'js-1' }, 'promotion')).inbox).toBe(0);
  });

  it('a withdrawn promotions consent stops promotions even if the switch is on', async () => {
    const t = setup();
    const accountId = await jobSeekerWithConsents(t, ['promotions']);
    expect((await t.settings.view(accountId)).promotions).toBe(true);
    await t.prisma.consent.updateMany({ where: { purpose: 'promotions' }, data: { granted: false, withdrawnAt: new Date() } });
    expect((await t.notifications.notify({ jobSeekerId: 'js-1' }, 'promotion')).skipped[0].reason).toBe('no_consent');
  });

  it('job alerts follow the Job updates switch; switching it off never withdraws the registration consent', async () => {
    const t = setup();
    const accountId = await jobSeekerWithConsents(t, ['job_updates']);
    expect((await t.settings.view(accountId)).jobUpdates).toBe(true);
    expect((await t.notifications.notify({ jobSeekerId: 'js-1' }, 'job_match')).inbox).toBe(1);
    await t.settings.update(accountId, { jobUpdates: false });
    expect((await t.notifications.notify({ jobSeekerId: 'js-1' }, 'job_match')).skipped[0].reason).toBe('switched_off');
    expect(t.prisma.tables.consent.find((c) => c.purpose === 'job_updates')).toMatchObject({ granted: true, withdrawnAt: null });
  });

  it('Service off: the message is still in the inbox, with no push', async () => {
    const t = setup();
    const accountId = await t.account({ referralId: 'rf-1' });
    await t.settings.update(accountId, { service: false });
    const result = await t.notifications.notify({ referralId: 'rf-1' }, 'payout_paid');
    expect(result).toMatchObject({ inbox: 1, queued: 0 });
    expect(t.prisma.tables.customerInboxMessage[0].pushStatus).toBe('off');
    expect((await t.sender.sendDue()).sent).toBe(0);
  });

  it('a switch turned off after queueing stops the push', async () => {
    const t = setup();
    const accountId = await t.account({ referralId: 'rf-1' });
    await t.notifications.notify({ referralId: 'rf-1' }, 'payout_paid');
    await t.settings.update(accountId, { service: false });
    expect(await t.sender.sendDue()).toMatchObject({ sent: 0, off: 1 });
  });

  it('Service cannot be switched off while a job seeker\'s guarantee runs (409 SERVICE_LOCKED)', async () => {
    const t = setup();
    const accountId = await t.account({ jobSeekerId: 'js-1' });
    await t.prisma.pricingPolicy.create({ data: { jobSeekerGuaranteeDays: 30, effectiveFrom: new Date('2026-01-01') } });
    await t.prisma.jobSeeker.create({ data: { id: 'js-1', status: 'active', paymentReceivedAt: new Date(t.clock.at.getTime() - 5 * 86_400_000), guaranteeStartsAt: new Date(t.clock.at.getTime() - 5 * 86_400_000) } });
    expect((await t.settings.view(accountId)).serviceLocked).toBe(true);
    await expectCode(t.settings.update(accountId, { service: false }), 'SERVICE_LOCKED');
    // After the 30 days it can be switched off.
    t.clock.at = new Date(t.clock.at.getTime() + 26 * 86_400_000);
    await expect(t.settings.update(accountId, { service: false })).resolves.toMatchObject({ service: false, serviceLocked: false });
  });

  it('Service is locked while a business placement guarantee runs', async () => {
    const t = setup();
    const accountId = await t.account({ businessId: 'bz-1' });
    await t.prisma.placement.create({ data: { businessId: 'bz-1', status: 'active' } });
    await expectCode(t.settings.update(accountId, { service: false }), 'SERVICE_LOCKED');
  });

  it('refuses a switch that is not true or false', async () => {
    const t = setup();
    const accountId = await t.account();
    await expectCode(t.settings.update(accountId, { promotions: 'yes' }), 'VALIDATION_FAILED');
  });
});

describe('Customer notifications: dead tokens and receipts', () => {
  it('removes a token Expo reports as DeviceNotRegistered when sending', async () => {
    const t = setup();
    await t.account({ jobSeekerId: 'js-1', token: 'ExponentPushToken[gone-device-123456]' });
    t.provider.answer = () => ({ status: 'error', message: 'not registered', error: 'DeviceNotRegistered' });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'refund_paid');
    const result = await t.sender.sendDue();
    expect(result).toMatchObject({ sent: 0, failed: 1, deadTokensRemoved: 1 });
    expect(t.prisma.tables.customerDevice[0].pushToken).toBeNull();
    expect(t.prisma.tables.customerInboxMessage[0].pushStatus).toBe('failed');
    // The next message has no phone to go to: inbox only.
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'refund_paid');
    expect(t.prisma.tables.customerInboxMessage[1].pushStatus).toBe('none');
  });

  it('removes a token after the receipt check, and marks the log delivered when another phone got it', async () => {
    const t = setup();
    const accountId = await t.account({ jobSeekerId: 'js-1', token: 'ExponentPushToken[phone-one-123456]' });
    await t.prisma.customerDevice.create({ data: { id: 'dev-b', accountId, installationId: 'inst-b', platform: 'ios', pushToken: 'ExponentPushToken[phone-two-123456]' } });
    await t.prisma.customerSession.create({ data: { accountId, deviceId: 'dev-b' } });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'refund_paid');
    const { tickets } = await t.sender.sendDue();
    expect(tickets).toHaveLength(2);
    t.provider.receipts = {
      [tickets[0].ticketId]: { status: 'ok' },
      [tickets[1].ticketId]: { status: 'error', message: 'gone', error: 'DeviceNotRegistered' },
    };
    expect(tickets.every((ticket) => !('token' in ticket) && typeof ticket.deviceId === 'string')).toBe(true);
    const outcome = await t.sender.checkReceipts(tickets);
    expect(outcome).toEqual({ ok: 1, errors: 1, deadTokensRemoved: 1, pending: [] });
    expect(t.prisma.tables.customerDevice.map((d) => d.pushToken)).toEqual(['ExponentPushToken[phone-one-123456]', null]);
    expect(t.prisma.tables.messageLog[0].status).toBe('delivered');
  });

  it('retries later when the push service is down', async () => {
    const t = setup();
    await t.account({ jobSeekerId: 'js-1' });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'refund_paid');
    t.prisma.tables.customerInboxMessage[0].createdAt = t.clock.at; // the database stamps it "now"
    t.provider.failNext = true;
    expect(await t.sender.sendDue()).toMatchObject({ sent: 0, retried: 1 });
    expect(t.prisma.tables.customerInboxMessage[0].pushStatus).toBe('queued');
    t.clock.at = new Date(t.clock.at.getTime() + 6 * 60_000);
    expect((await t.sender.sendDue()).sent).toBe(1);
  });

  it('gives up on a push that could not be sent for a day (the inbox keeps it)', async () => {
    const t = setup();
    await t.account({ jobSeekerId: 'js-1' });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'refund_paid');
    t.prisma.tables.customerInboxMessage[0].createdAt = new Date(t.clock.at.getTime() - 25 * 3_600_000);
    t.provider.failNext = true;
    expect(await t.sender.sendDue()).toMatchObject({ sent: 0, failed: 1 });
    expect(t.prisma.tables.customerInboxMessage[0].pushStatus).toBe('failed');
  });
});

describe('Customer notifications: the mock and Expo providers', () => {
  it('uses the mock provider unless CUSTOMER_PUSH_PROVIDER_MODE is real', () => {
    expect(createCustomerPushProvider({})).toBeInstanceOf(MockCustomerPushProvider);
    expect(createCustomerPushProvider({ CUSTOMER_PUSH_PROVIDER_MODE: 'mock' })).toBeInstanceOf(MockCustomerPushProvider);
    expect(createCustomerPushProvider({ CUSTOMER_PUSH_PROVIDER_MODE: 'real' })).toBeInstanceOf(ExpoCustomerPushProvider);
    expect(() => createCustomerPushProvider({ CUSTOMER_PUSH_PROVIDER_MODE: 'firebase' })).toThrow(/Unsupported/);
  });

  it('the mock logs instead of sending and answers like Expo for an uninstalled app', async () => {
    const mock = new MockCustomerPushProvider();
    const base = { title: 't', body: 'b', data: {}, channelId: 'service', priority: 'normal' as const, sound: 'default' as const };
    const tickets = await mock.send([
      { ...base, to: 'ExponentPushToken[ok-123456789]' },
      { ...base, to: 'ExponentPushToken[DeviceNotRegistered-1]' },
    ]);
    expect(tickets[0].status).toBe('ok');
    expect(tickets[1]).toMatchObject({ status: 'error', error: 'DeviceNotRegistered' });
    expect(mock.sent).toHaveLength(2);
  });

  it('Expo: batches of 100, the access token when set, tickets in order', async () => {
    const calls: { url: string; body: unknown[]; auth?: string }[] = [];
    const fetchImpl = jest.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
      const body = JSON.parse(init.body) as unknown[];
      calls.push({ url, body, auth: init.headers.Authorization });
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: body.map((_, i) => (i === 0 ? { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: `id-${i}` })) }),
      };
    });
    const expo = new ExpoCustomerPushProvider('secret-token', fetchImpl);
    const message = { to: 'ExponentPushToken[a-123456789]', title: 't', body: 'b', data: {}, channelId: 'service', priority: 'high' as const, sound: 'default' as const };
    const tickets = await expo.send(Array.from({ length: 150 }, () => message));
    expect(calls.map((c) => c.body.length)).toEqual([100, 50]);
    expect(calls[0].url).toBe('https://exp.host/--/api/v2/push/send');
    expect(calls[0].auth).toBe('Bearer secret-token');
    expect(tickets).toHaveLength(150);
    expect(tickets[0]).toMatchObject({ status: 'error', error: 'DeviceNotRegistered' });
    expect(tickets[1]).toEqual({ status: 'ok', id: 'id-1' });
  });

  it('Expo: reads receipts, and an HTTP error marks that batch unsent so the worker retries it', async () => {
    const ok = new ExpoCustomerPushProvider(undefined, async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { a: { status: 'ok' }, b: { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } } }),
    }));
    await expect(ok.getReceipts(['a', 'b'])).resolves.toEqual({
      a: { status: 'ok' },
      b: { status: 'error', message: 'gone', error: 'DeviceNotRegistered' },
    });
    const down = new ExpoCustomerPushProvider(undefined, async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await expect(down.send([{ to: 'x', title: 't', body: 'b', data: {}, channelId: 'service', priority: 'normal', sound: null }])).resolves.toEqual([
      { status: 'unsent', reason: 'Expo push service answered HTTP 503' },
    ]);
  });
});

describe('Customer notifications: my own inbox and my own phone only', () => {
  it('lists only my messages, newest first, with paging and the unread count', async () => {
    const t = setup();
    const mine = await t.account({ jobSeekerId: 'js-1' });
    await t.account({ jobSeekerId: 'js-2' });
    for (let i = 0; i < 3; i += 1) {
      t.clock.at = new Date(t.clock.at.getTime() + 1000);
      await t.notifications.notify({ jobSeekerId: 'js-1' }, 'guarantee_countdown', { daysLeft: i });
    }
    await t.notifications.notify({ jobSeekerId: 'js-2' }, 'payment_confirmed', { days: 30 });
    const page1 = await t.inbox.list(mine, { limit: '2' });
    expect(page1.items).toHaveLength(2);
    expect(page1.unreadCount).toBe(3);
    expect(page1.items.every((m) => m.kind === 'guarantee_countdown')).toBe(true);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await t.inbox.list(mine, { cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    expect(new Set([...page1.items, ...page2.items].map((m) => m.id)).size).toBe(3);
  });

  it('marks my message read; someone else\'s message answers 404 as if it did not exist', async () => {
    const t = setup();
    const mine = await t.account({ jobSeekerId: 'js-1' });
    const other = await t.account({ jobSeekerId: 'js-2' });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'offer_check');
    await t.notifications.notify({ jobSeekerId: 'js-2' }, 'offer_check');
    const myMessage = t.prisma.tables.customerInboxMessage.find((m) => m.accountId === mine)!;
    const theirMessage = t.prisma.tables.customerInboxMessage.find((m) => m.accountId === other)!;
    await t.inbox.markRead(mine, myMessage.id as string);
    expect(myMessage.readAt).toBeInstanceOf(Date);
    await expectCode(t.inbox.markRead(mine, theirMessage.id as string), 'MESSAGE_NOT_FOUND');
    expect(theirMessage.readAt).toBeNull();
    await t.inbox.markAllRead(mine);
    expect(theirMessage.readAt).toBeNull();
  });

  it('saves my push token on my signed-in phone, and moves it from another account that used this same app installation', async () => {
    const t = setup();
    const before = await t.account({ token: 'ExponentPushToken[shared-phone-1234]' });
    const mine = await t.account({ token: null });
    // The same installation (someone else used the app on this phone before).
    t.prisma.tables.customerDevice.find((d) => d.accountId === mine)!.installationId = 'inst-1';
    await t.inbox.putDevice(t.me(mine), { platform: 'android', appVersion: '1.0.0', pushToken: 'ExponentPushToken[shared-phone-1234]', pushPermission: 'granted' });
    const devices = t.prisma.tables.customerDevice;
    expect(devices.find((d) => d.accountId === before)!.pushToken).toBeNull();
    expect(devices.find((d) => d.accountId === mine)).toMatchObject({ pushToken: 'ExponentPushToken[shared-phone-1234]', pushPermission: 'granted' });
    await t.inbox.removePushToken(t.me(mine), undefined);
    expect(devices.find((d) => d.accountId === mine)!.pushToken).toBeNull();
  });

  it('refuses a token that is not an Expo push token', async () => {
    const t = setup();
    const mine = await t.account({ token: null });
    await expectCode(t.inbox.putDevice(t.me(mine), { platform: 'android', pushToken: 'fcm:abc' }), 'VALIDATION_FAILED');
  });
});

describe('Customer notifications: privacy review fixes', () => {
  it('H1: a corrected number cuts the old phone\'s account off at once (no inbox row, queued pushes cancelled)', async () => {
    const t = setup();
    const old = await t.account({ jobSeekerId: 'js-1', phone: '+919812345678', linkedVia: 'phone_match' });
    await t.prisma.jobSeeker.create({ data: { id: 'js-1', status: 'active', phone: '9812345678', anonymisedAt: null } });
    expect((await t.notifications.notify({ jobSeekerId: 'js-1' }, 'offer_check')).inbox).toBe(1);
    // An agent corrects the job seeker's number before the worker's round.
    t.prisma.tables.jobSeeker[0].phone = '9800000000';
    expect(await t.sender.sendDue()).toMatchObject({ sent: 0, cancelled: 1 });
    expect(t.provider.sent).toHaveLength(0);
    expect(t.prisma.tables.customerProfile[0]).toMatchObject({ status: 'revoked' });
    expect((await t.inbox.list(old, {})).items).toHaveLength(0);
    // Later events reach nobody.
    expect(await t.notifications.notify({ jobSeekerId: 'js-1' }, 'hit_recorded')).toMatchObject({ inbox: 0 });
    expect(await t.notifications.notify({ accountId: old, profileId: 'prof-1' }, 'hit_recorded')).toMatchObject({ inbox: 0 });
  });

  it('H1: an anonymised record gets nothing', async () => {
    const t = setup();
    await t.account({ jobSeekerId: 'js-1' });
    await t.prisma.jobSeeker.create({ data: { id: 'js-1', status: 'inactive', phone: null, anonymisedAt: new Date() } });
    expect(await t.notifications.notify({ jobSeekerId: 'js-1' }, 'offer_check')).toMatchObject({ inbox: 0 });
  });

  it('H2: an account being deleted or blocked gets no push, and its phones lose their tokens', async () => {
    for (const status of ['deletion_requested', 'blocked']) {
      const t = setup();
      const accountId = await t.account({ jobSeekerId: 'js-1' });
      await t.notifications.notify({ jobSeekerId: 'js-1' }, 'offer_check');
      t.prisma.tables.customerAccount[0].status = status;
      expect(await t.sender.sendDue()).toMatchObject({ sent: 0 });
      expect(t.provider.sent).toHaveLength(0);
      expect(t.prisma.tables.customerDevice.find((d) => d.accountId === accountId)!.pushToken).toBeNull();
      expect(t.prisma.tables.customerInboxMessage[0].pushStatus).toBe('none');
    }
  });

  it('H3: Service switched off before a guarantee started is on while it runs', async () => {
    const t = setup();
    const accountId = await t.account({ jobSeekerId: 'js-1' });
    await t.settings.update(accountId, { service: false });
    await t.prisma.pricingPolicy.create({ data: { jobSeekerGuaranteeDays: 30, effectiveFrom: new Date('2026-01-01') } });
    await t.prisma.jobSeeker.create({ data: { id: 'js-1', status: 'active', paymentReceivedAt: t.clock.at, guaranteeStartsAt: t.clock.at } });
    expect(await t.notifications.notify({ jobSeekerId: 'js-1' }, 'interview_booked', { hours: 48 }, { urgent: true })).toMatchObject({ queued: 1 });
    expect(await t.sender.sendDue()).toMatchObject({ sent: 1, off: 0 });
    // A row queued before, with the switch off and the guarantee running, is sent by the worker too.
    t.prisma.tables.customerInboxMessage[0].pushStatus = 'queued';
    t.prisma.tables.customerInboxMessage[0].scheduledFor = t.clock.at;
    expect(await t.sender.sendDue()).toMatchObject({ off: 0 });
  });

  it('H4: a consent withdrawn after the message was written stops the push and hides the message', async () => {
    const t = setup();
    const accountId = await t.account({ jobSeekerId: 'js-1' });
    await t.prisma.consent.create({
      data: { subjectType: 'job_seeker', subjectId: 'js-1', purpose: 'job_updates', granted: true, grantedAt: new Date(), noticeVersion: '1.0', language: 'en', method: 'sms_link' },
    });
    expect((await t.notifications.notify({ jobSeekerId: 'js-1' }, 'job_match')).inbox).toBe(1);
    await t.prisma.consent.updateMany({ where: { purpose: 'job_updates' }, data: { granted: false, withdrawnAt: new Date() } });
    expect(await t.sender.sendDue()).toMatchObject({ sent: 0, cancelled: 1 });
    expect((await t.inbox.list(accountId, {})).items).toHaveLength(0);
  });

  it('H4: promotions need the consent for a business, a partner and an account with no record too', async () => {
    const t = setup();
    const owner = await t.account({ businessId: 'bz-1' });
    const partner = await t.account({ referralId: 'rf-1' });
    const bare = await t.account();
    for (const id of [owner, partner, bare]) {
      t.prisma.tables.customerNotificationSetting.push({ id: `set-${id}`, accountId: id, service: true, jobUpdates: false, promotions: true, quietStart: '21:00', quietEnd: '09:00', dailyCap: 3 });
    }
    expect((await t.notifications.notify({ businessId: 'bz-1' }, 'promotion')).skipped).toEqual([{ accountId: owner, reason: 'no_consent' }]);
    expect((await t.notifications.notify({ referralId: 'rf-1' }, 'promotion')).skipped).toEqual([{ accountId: partner, reason: 'no_consent' }]);
    expect((await t.notifications.notify({ accountId: bare }, 'promotion')).skipped).toEqual([{ accountId: bare, reason: 'no_consent' }]);
    await t.prisma.consent.create({
      data: { subjectType: 'business', subjectId: 'bz-1', purpose: 'promotions', granted: true, grantedAt: new Date(), noticeVersion: '1.0', language: 'en', method: 'in_app' },
    });
    expect((await t.notifications.notify({ businessId: 'bz-1' }, 'promotion')).inbox).toBe(1);
  });

  it('M1: two rounds at once (worker and a second process) still push at most 3 non-urgent a day', async () => {
    const t = setup();
    const accountId = await t.account({ jobSeekerId: 'js-1' });
    for (let i = 0; i < 5; i += 1) await t.notifications.notify({ jobSeekerId: 'js-1' }, 'guarantee_countdown', { daysLeft: i });
    const [a, b] = await Promise.all([t.sender.sendDue(), t.sender.sendDue()]);
    expect(a.sent + b.sent).toBe(3);
    expect(t.provider.sent).toHaveLength(3);
    expect(t.prisma.tables.customerInboxMessage.filter((r) => r.pushStatus === 'held_daily_cap')).toHaveLength(2);
    expect(t.prisma.advisoryLocks).toContain(`customer-push:${accountId}`);
  });

  it('M2: when one batch fails, only messages Expo never took are sent again', async () => {
    const t = setup();
    const accountId = await t.account({ jobSeekerId: 'js-1', token: 'ExponentPushToken[phone-ok-12345678]' });
    await t.prisma.customerDevice.create({ data: { id: 'dev-x', accountId, installationId: 'inst-x', platform: 'ios', pushToken: 'ExponentPushToken[phone-down-1234567]' } });
    await t.prisma.customerSession.create({ data: { accountId, deviceId: 'dev-x' } });
    await t.account({ jobSeekerId: 'js-2', token: 'ExponentPushToken[other-down-1234567]' });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'refund_paid');
    await t.notifications.notify({ jobSeekerId: 'js-2' }, 'refund_paid');
    for (const row of t.prisma.tables.customerInboxMessage) row.createdAt = t.clock.at;
    t.provider.answer = (m) => (m.to.includes('down') ? { status: 'unsent', reason: 'timeout' } : { status: 'ok', id: `t-${m.to}` });
    expect(await t.sender.sendDue()).toMatchObject({ sent: 1, retried: 1, failed: 0 });
    const [first, second] = t.prisma.tables.customerInboxMessage;
    expect(first.pushStatus).toBe('sent'); // one phone got it: never repeated
    expect(second.pushStatus).toBe('queued');
  });

  it('M3: a receipt skips quiet hours only for the one person who did it', async () => {
    const t = setup(ist('23:00'));
    await t.account({ jobSeekerId: 'js-1' });
    // Matched by Finance overnight: not the person's own action, waits for 9 AM.
    expect(await t.notifications.notify({ jobSeekerId: 'js-1' }, 'payment_confirmed', { days: 30 })).toMatchObject({ held: 1 });
    // Two owners: the payer is not known, so nobody skips quiet hours.
    await t.account({ businessId: 'bz-1' });
    await t.account({ businessId: 'bz-1' });
    expect(await t.notifications.notify({ businessId: 'bz-1' }, 'fee_paid', {}, { selfAction: true })).toMatchObject({ held: 2, queued: 0 });
    // A card payment by the one owner of another business goes at once.
    await t.account({ businessId: 'bz-2' });
    expect(await t.notifications.notify({ businessId: 'bz-2' }, 'fee_paid', {}, { selfAction: true })).toMatchObject({ queued: 1 });
  });

  it('M4: money events reach business owners with no branch limit only, never HR, supervisors or branch managers', async () => {
    const t = setup();
    const owner = await t.account({ businessId: 'bz-1' });
    await t.account({ businessId: 'bz-1', role: 'hr' });
    const manager = await t.account();
    await t.prisma.customerProfile.create({ data: { id: 'prof-br', accountId: manager, kind: 'business', businessId: 'bz-1', branchId: 'br-1', role: 'manager', status: 'active' } });
    for (const kind of ['fee_paid', 'refund_approved', 'refund_paid'] as const) {
      await t.notifications.notify({ businessId: 'bz-1', branchId: 'br-1' }, kind);
    }
    expect(new Set(t.prisma.tables.customerInboxMessage.map((r) => r.accountId))).toEqual(new Set([owner]));
    // Other business events still reach the owner-level people and the branch.
    expect((await t.notifications.notify({ businessId: 'bz-1', branchId: 'br-1' }, 'vacancy_confirmed', { vacancyCode: 'VC-00001' })).inbox).toBe(3);
  });

  it('M5: a phone with no live sign-in gets no push', async () => {
    const t = setup();
    await t.account({ jobSeekerId: 'js-1' });
    t.prisma.tables.customerSession[0].expiresAt = new Date(t.clock.at.getTime() - 1000);
    expect(await t.notifications.notify({ jobSeekerId: 'js-1' }, 'offer_check')).toMatchObject({ queued: 0, inbox: 1 });
    expect(t.prisma.tables.customerInboxMessage[0].pushStatus).toBe('none');
  });

  it('M5: the token is saved on the session\'s own phone only, and at most 5 phones keep one', async () => {
    const t = setup();
    const mine = await t.account({ token: null });
    await expectCode(t.inbox.putDevice(t.me(mine), { installationId: 'someone-elses-phone', platform: 'android', pushToken: 'ExponentPushToken[abc-123456789]' }), 'VALIDATION_FAILED');
    await expectCode(t.inbox.putDevice({ accountId: mine, sessionId: 's', deviceId: null }, { platform: 'android' }), 'INSTALLATION_REQUIRED');
    for (let i = 0; i < 5; i += 1) {
      await t.prisma.customerDevice.create({
        data: { id: `old-${i}`, accountId: mine, installationId: `old-${i}`, platform: 'android', pushToken: `ExponentPushToken[old-${i}-123456789]`, lastSeenAt: new Date(2026, 0, i + 1) },
      });
    }
    await t.inbox.putDevice(t.me(mine), { installationId: 'inst-1', platform: 'android', pushToken: 'ExponentPushToken[new-phone-12345678]' });
    const withTokens = t.prisma.tables.customerDevice.filter((d) => d.accountId === mine && d.pushToken);
    expect(withTokens).toHaveLength(5);
    expect(withTokens.map((d) => d.id)).not.toContain('old-0');
    expect(withTokens.map((d) => d.id)).toContain('dev-1');
  });

  it('L1: a referral push says "Someone you referred"; the first name is in the inbox only', async () => {
    const t = setup();
    const partner = await t.account({ referralId: 'rf-1' });
    await t.notifications.notify({ referralId: 'rf-1' }, 'referral_joined', { firstName: 'Ravi' });
    await t.sender.sendDue();
    expect(t.provider.sent[0].body).toContain('Someone you referred');
    expect(`${t.provider.sent[0].title} ${t.provider.sent[0].body}`).not.toContain('Ravi');
    expect((await t.inbox.list(partner, {})).items[0].body).toContain('Ravi');
  });

  it('L2: a token on another account\'s signed-in phone is refused (409), never moved; a race answers without a 500', async () => {
    const t = setup();
    await t.account({ token: 'ExponentPushToken[their-phone-1234567]' });
    const mine = await t.account({ token: null });
    await expectCode(t.inbox.putDevice(t.me(mine), { platform: 'android', pushToken: 'ExponentPushToken[their-phone-1234567]' }), 'PUSH_TOKEN_IN_USE');
    expect(t.prisma.tables.customerDevice[0].pushToken).toBe('ExponentPushToken[their-phone-1234567]');
    // Their phone signed out: the token can move.
    t.prisma.tables.customerSession[0].revokedAt = new Date();
    await t.inbox.putDevice(t.me(mine), { platform: 'android', pushToken: 'ExponentPushToken[their-phone-1234567]' });
    expect(t.prisma.tables.customerDevice.find((d) => d.accountId === mine)!.pushToken).toBe('ExponentPushToken[their-phone-1234567]');
    // Two saves at the same moment: the unique index answers P2002, which is read again, not a 500.
    const original = t.prisma.$transaction.bind(t.prisma);
    let first = true;
    jest.spyOn(t.prisma, '$transaction').mockImplementation(async (work: (tx: FakePrisma) => Promise<unknown>) => {
      if (first) {
        first = false;
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      return original(work);
    });
    await expect(t.inbox.putDevice(t.me(mine), { platform: 'android', pushToken: 'ExponentPushToken[their-phone-1234567]' })).resolves.toBeUndefined();
  });

  it('L4: messages about a profile that was revoked are cancelled and leave the inbox', async () => {
    const t = setup();
    const accountId = await t.account({ jobSeekerId: 'js-1' });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'offer_check');
    await t.notifications.notify({ accountId }, 'refund_paid');
    t.prisma.tables.customerProfile[0].status = 'revoked';
    expect(await t.sender.sendDue()).toMatchObject({ sent: 1, cancelled: 1 });
    const listed = await t.inbox.list(accountId, {});
    expect(listed.items.map((m) => m.kind)).toEqual(['refund_paid']);
    expect(listed.unreadCount).toBe(1);
  });

  it('L5: internal fields never go out in the push data', async () => {
    const t = setup();
    await t.account({ jobSeekerId: 'js-1' });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'payment_confirmed', { days: 30 }, { selfAction: true });
    expect(t.prisma.tables.customerInboxMessage[0].data).toMatchObject({ trigger: 'self' });
    await t.sender.sendDue();
    expect(t.provider.sent[0].data).not.toHaveProperty('trigger');
  });

  it('L6: a receipt error is logged by its code only, never Expo\'s message', async () => {
    const t = setup();
    await t.account({ jobSeekerId: 'js-1' });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'refund_paid');
    const { tickets } = await t.sender.sendDue();
    t.provider.receipts = { [tickets[0].ticketId]: { status: 'error', message: 'Token ExponentPushToken[device-1-abcdefgh] is bad', error: 'MessageRateExceeded' } };
    const warn = jest.spyOn((t.sender as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
    await t.sender.checkReceipts(tickets);
    expect(warn).toHaveBeenCalledWith('Push receipt error MessageRateExceeded');
    expect(warn.mock.calls.flat().join(' ')).not.toContain('ExponentPushToken');
  });

  it('L3: a receipt Expo has not produced yet comes back pending; a phone that saved a new token since keeps it', async () => {
    const t = setup();
    await t.account({ jobSeekerId: 'js-1' });
    await t.notifications.notify({ jobSeekerId: 'js-1' }, 'refund_paid');
    const { tickets } = await t.sender.sendDue();
    expect(await t.sender.checkReceipts(tickets)).toMatchObject({ pending: tickets });
    // The phone saved a new token after the push; an old ticket's DeviceNotRegistered must not remove it.
    t.prisma.tables.customerDevice[0].pushToken = 'ExponentPushToken[fresh-token-1234567]';
    t.prisma.tables.customerDevice[0].pushTokenUpdatedAt = new Date(t.clock.at.getTime() + 60_000);
    t.provider.receipts = { [tickets[0].ticketId]: { status: 'error', message: 'gone', error: 'DeviceNotRegistered' } };
    expect(await t.sender.checkReceipts(tickets)).toMatchObject({ deadTokensRemoved: 0 });
    expect(t.prisma.tables.customerDevice[0].pushToken).toBe('ExponentPushToken[fresh-token-1234567]');
  });
});
