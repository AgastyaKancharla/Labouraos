import { EditPolicyService } from './edit-policy.service';

/**
 * Security review M2: a job seeker who registered in the customer app has no
 * registering agent. Edit rights must not fail open: only the agent assigned to
 * help that sign-up (SignupTracker.assignedStaffId), their Team Lead, or
 * management may edit it. Older records with no creator keep the old rule.
 */
describe('Edit policy for app sign-ups', () => {
  const tracker = { findFirst: jest.fn() };
  const prisma = {
    payment: { findFirst: jest.fn().mockResolvedValue(null) },
    signupTracker: tracker,
    staff: { findUnique: jest.fn() },
    auditLog: { findFirst: jest.fn() },
  };
  const policy = new EditPolicyService(prisma as never, {} as never);
  const seeker = { id: 'js-1', registeredByStaffId: null, paymentReceivedAt: null };

  beforeEach(() => jest.clearAllMocks());

  it('an agent who is not the assigned helper cannot edit an app sign-up', async () => {
    tracker.findFirst.mockResolvedValue({ assignedStaffId: 'agent-helper' });
    const result = await policy.checkEditPermission({ id: 'agent-other', role: 'call_agent' } as never, 'job_seeker', seeker);
    expect(result.allowed).toBe(false);
  });

  it('the assigned helper can, and so can nobody when no helper is assigned yet (Team Lead and above only)', async () => {
    tracker.findFirst.mockResolvedValue({ assignedStaffId: 'agent-helper' });
    expect((await policy.checkEditPermission({ id: 'agent-helper', role: 'call_agent' } as never, 'job_seeker', seeker)).allowed).toBe(true);
    tracker.findFirst.mockResolvedValue({ assignedStaffId: null });
    expect((await policy.checkEditPermission({ id: 'agent-x', role: 'field_agent' } as never, 'job_seeker', seeker)).allowed).toBe(false);
    expect((await policy.checkEditPermission({ id: 'tl-1', role: 'team_lead' } as never, 'job_seeker', seeker)).allowed).toBe(true);
  });

  it('a Team Lead of another team cannot edit a sign-up helped by someone else\'s agent', async () => {
    tracker.findFirst.mockResolvedValue({ assignedStaffId: 'agent-helper' });
    prisma.staff.findUnique.mockResolvedValue({ teamLeadId: 'tl-other' });
    expect((await policy.checkEditPermission({ id: 'tl-1', role: 'team_lead' } as never, 'job_seeker', seeker)).allowed).toBe(false);
    prisma.staff.findUnique.mockResolvedValue({ teamLeadId: 'tl-1' });
    expect((await policy.checkEditPermission({ id: 'tl-1', role: 'team_lead' } as never, 'job_seeker', seeker)).allowed).toBe(true);
  });

  it('a referral partner created by a customer account is treated the same', async () => {
    prisma.auditLog.findFirst.mockResolvedValue({ actorId: 'customer:acc-1' });
    tracker.findFirst.mockResolvedValue({ assignedStaffId: null });
    const partner = { id: 'rf-1', code: 'RF-00001' };
    expect((await policy.checkEditPermission({ id: 'agent-x', role: 'call_agent' } as never, 'referral', partner)).allowed).toBe(false);
    expect((await policy.checkEditPermission({ id: 'tl-1', role: 'team_lead' } as never, 'referral', partner)).allowed).toBe(true);
  });

  it('an older record with no creator and no app sign-up keeps the old rule', async () => {
    tracker.findFirst.mockResolvedValue(null);
    expect((await policy.checkEditPermission({ id: 'agent-x', role: 'call_agent' } as never, 'job_seeker', seeker)).allowed).toBe(true);
  });
});
