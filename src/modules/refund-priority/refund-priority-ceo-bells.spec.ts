import { NotificationDraft } from '../notification/notification.service';
import { NotificationSourcesService } from '../notification/notification-sources.service';
import { StaffDirectory } from '../notification/staff-directory';
import { PriorityRow, RefundPriorityService } from './refund-priority.service';

/**
 * Owner decision 12 Nov: "The CEO also gets a bell ... when job seekers or
 * business vacancies come close to a refund (the same 15-day window)." One bell
 * per person (or business placement) and recipient, cleared by itself when the
 * work is done; the CEO's bell may show rupees, the Manager's and Team Lead's
 * keep counts only.
 */
describe('close-to-refund bells for the CEO', () => {
  const now = new Date('2026-11-20T06:00:00Z');
  const person = (id: string, role: string, reportsToId: string | null, teamLeadId: string | null = null) => ({
    id, code: id.toUpperCase(), name: `Name ${id}`, role, status: 'active', reportsToId, teamLeadId,
  });
  const rows = [
    person('ceo-1', 'ceo', null),
    person('ceo-2', 'ceo', null),
    person('mg-1', 'manager', 'ceo-1'),
    person('tl-1', 'team_lead', 'mg-1'),
    person('ca-1', 'call_agent', null, 'tl-1'),
    person('fa-1', 'field_agent', null, 'tl-1'),
    // A field agent with no reporting line: the bell still reaches the CEOs.
    person('fa-2', 'field_agent', null, null),
  ];
  const seeker: PriorityRow = {
    kind: 'job_seeker', id: 'js-1', code: 'JS-00012', name: 'Asha', trade: 'Cook', daysLeft: 12, bucket: '11-15', deadline: '2026-12-02T00:00:00.000Z', priority: true,
    agent: { id: 'ca-1', code: 'CA-1', name: 'Deepa' }, businessId: null, businessName: null, atStakePaise: 49_900,
  };
  const business: PriorityRow = {
    kind: 'business', id: 'pl-1', code: 'PL-00007', name: 'Hotel Sagar', trade: 'Waiter', daysLeft: 4, bucket: '0-5', deadline: '2026-11-24T00:00:00.000Z', priority: true,
    agent: { id: 'fa-1', code: 'FA-1', name: 'Kiran' }, businessId: 'bz-1', businessName: 'Hotel Sagar', atStakePaise: 1_062_000,
  };
  const orphan: PriorityRow = { ...business, id: 'pl-2', code: 'PL-00008', agent: { id: 'fa-2', code: 'FA-2', name: 'Manju' }, atStakePaise: 900_000 };

  async function sync(known: PriorityRow[]) {
    const notifications = { reconcileKind: jest.fn().mockResolvedValue({ opened: 0, cleared: 0 }) };
    const sources = { directory: jest.fn().mockResolvedValue(new StaffDirectory(rows)) } as unknown as NotificationSourcesService;
    // The real one-draft-per-active-recipient helper.
    (sources as unknown as { drafts: unknown }).drafts = NotificationSourcesService.prototype.drafts.bind(sources);
    const service = new RefundPriorityService({} as never, {} as never, {} as never, { now: () => now } as never, notifications as never, sources);
    await service.syncBells(now, known);
    const [kind, drafts] = notifications.reconcileKind.mock.calls[0] as [string, NotificationDraft[]];
    return { kind, drafts };
  }

  it('rings the CEO for a job seeker and a business placement in the window, with the rupees at stake', async () => {
    const { kind, drafts } = await sync([seeker, business]);
    expect(kind).toBe('refund_priority');
    const ceoBells = drafts.filter((d) => d.recipientStaffId === 'ceo-1');
    expect(ceoBells.map((d) => d.subjectType).sort()).toEqual(['job_seeker', 'placement']);
    const forSeeker = ceoBells.find((d) => d.subjectId === 'js-1')!;
    expect(forSeeker.title).toBe('JS-00012: 12 days to a refund, no suitable offer yet');
    expect(forSeeker.body).toBe('Cook · 11-15 days · ₹499 at stake');
    expect(forSeeker.link).toBe('/ceo/job-seekers/near-refund');
    const forBusiness = ceoBells.find((d) => d.subjectId === 'pl-1')!;
    expect(forBusiness.title).toBe('Hotel Sagar: 4 days to a refund, no replacement yet');
    expect(forBusiness.body).toBe('Waiter · PL-00007 · 0-5 days · ₹10,620 at stake');
    // Only the CEO at the top of the line, not every CEO.
    expect(drafts.some((d) => d.recipientStaffId === 'ceo-2')).toBe(false);
  });

  it('keeps the agent, Team Lead and Manager on counts only, one bell per item and recipient', async () => {
    const { drafts } = await sync([seeker, business]);
    const others = drafts.filter((d) => !d.recipientStaffId.startsWith('ceo-'));
    expect(others.map((d) => `${d.recipientStaffId}:${d.subjectId}`).sort()).toEqual(['ca-1:js-1', 'fa-1:pl-1', 'mg-1:js-1', 'mg-1:pl-1', 'tl-1:js-1', 'tl-1:pl-1']);
    expect(others.every((d) => !d.title.includes('₹') && !(d.body ?? '').includes('₹'))).toBe(true);
    const keys = drafts.map((d) => `${d.recipientStaffId}|${d.subjectType}|${d.subjectId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('reaches every active CEO when the agent has no reporting line', async () => {
    const { drafts } = await sync([orphan]);
    expect(drafts.map((d) => d.recipientStaffId).sort()).toEqual(['ceo-1', 'ceo-2', 'fa-2']);
    expect(drafts.filter((d) => d.recipientStaffId.startsWith('ceo-')).every((d) => (d.body ?? '').includes('₹9,000 at stake'))).toBe(true);
  });
});
