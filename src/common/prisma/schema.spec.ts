import { PrismaClient } from '@prisma/client';

describe('Data Model Relationships', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('asserts every relationship can be created and read back', async () => {
    const timestamp = Date.now();

    // 1. Create Staff (Team Lead)
    const teamLead = await prisma.staff.create({
      data: {
        code: `TL-${timestamp}`,
        name: 'Lead Staff',
        email: `lead_${timestamp}@laboura.local`,
        passwordHash: 'hash',
        role: 'team_lead',
        city: 'Bengaluru',
      },
    });

    // 2. Create Staff (Agent under Team Lead)
    const agent = await prisma.staff.create({
      data: {
        code: `CA-${timestamp}`,
        name: 'Agent Staff',
        email: `agent_${timestamp}@laboura.local`,
        passwordHash: 'hash',
        role: 'call_agent',
        city: 'Bengaluru',
        teamLeadId: teamLead.id,
      },
      include: {
        teamLead: true,
      },
    });

    expect(agent.teamLead).toBeDefined();
    expect(agent.teamLead?.id).toBe(teamLead.id);

    // 3. Create Referral
    const referral = await prisma.referral.create({
      data: {
        code: `RF-${timestamp}`,
        name: 'Referral Partner',
        phone: `+9198${String(timestamp).slice(-8)}`,
        phoneVerified: true,
        type: 'individual',
        city: 'Bengaluru',
      },
    });

    // 4. Create JobSeeker linked to Referral
    const jobSeeker = await prisma.jobSeeker.create({
      data: {
        code: `JS-${timestamp}`,
        name: 'Candidate Worker',
        phone: `+9199${String(timestamp).slice(-8)}`,
        phoneVerified: true,
        tradeSkill: 'Electrician',
        minSalary: 1800000, // paise
        maxSalary: 2500000, // paise
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        hitCount: 0,
        kycStatus: 'verified',
        kycReference: `KYC-REF-${timestamp}`,
        referredById: referral.id,
        city: 'Bengaluru',
      },
      include: {
        referredBy: true,
      },
    });

    expect(jobSeeker.referredBy).toBeDefined();
    expect(jobSeeker.referredBy?.id).toBe(referral.id);
    expect(Number.isInteger(jobSeeker.minSalary)).toBe(true);
    expect(Number.isInteger(jobSeeker.maxSalary)).toBe(true);

    // 5. Create Business
    const business = await prisma.business.create({
      data: {
        code: `BZ-${timestamp}`,
        name: 'TechPark Facilities',
        contactName: 'Operations Head',
        phone: `+9180${String(timestamp).slice(-8)}`,
        area: 'Koramangala',
        city: 'Bengaluru',
      },
    });

    // 6. Create Vacancy linked to Business & Staff (Agent)
    const vacancy = await prisma.vacancy.create({
      data: {
        code: `VC-${timestamp}`,
        businessId: business.id,
        capturedByStaffId: agent.id,
        tradeSkill: 'Electrician',
        offeredSalary: 2200000, // paise
        status: 'open',
        city: 'Bengaluru',
      },
      include: {
        business: true,
        capturedBy: true,
      },
    });

    expect(vacancy.business.id).toBe(business.id);
    expect(vacancy.capturedBy?.id).toBe(agent.id);
    expect(Number.isInteger(vacancy.offeredSalary)).toBe(true);

    // 7. Create Placement linking Vacancy, JobSeeker, Business
    const placement = await prisma.placement.create({
      data: {
        code: `PL-${timestamp}`,
        vacancyId: vacancy.id,
        jobSeekerId: jobSeeker.id,
        businessId: business.id,
        placementFee: 1100000, // 50% of 2200000
        gstAmount: 198000, // 18% of 1100000
        joinedDate: new Date(),
        status: 'active',
        replacementRejectionCount: 0,
        city: 'Bengaluru',
      },
      include: {
        vacancy: true,
        jobSeeker: true,
        business: true,
      },
    });

    expect(placement.vacancy.id).toBe(vacancy.id);
    expect(placement.jobSeeker.id).toBe(jobSeeker.id);
    expect(placement.business.id).toBe(business.id);
    expect(Number.isInteger(placement.placementFee)).toBe(true);
    expect(Number.isInteger(placement.gstAmount)).toBe(true);

    // 8. Create Payment linking to Placement, JobSeeker, Business
    const payment = await prisma.payment.create({
      data: {
        code: `PAY-${timestamp}`,
        type: 'placement_fee',
        amount: 1298000, // paise (1100000 + 198000)
        status: 'completed',
        gatewayReference: `razorpay_${timestamp}`,
        subjectType: 'placement',
        subjectId: placement.id,
        placementId: placement.id,
        jobSeekerId: jobSeeker.id,
        businessId: business.id,
        city: 'Bengaluru',
      },
      include: {
        placement: true,
        jobSeeker: true,
        business: true,
      },
    });

    expect(payment.placement?.id).toBe(placement.id);
    expect(payment.jobSeeker?.id).toBe(jobSeeker.id);
    expect(payment.business?.id).toBe(business.id);
    expect(Number.isInteger(payment.amount)).toBe(true);

    // 9. Create AuditLog linked to Staff (actor)
    const auditLog = await prisma.auditLog.create({
      data: {
        code: `AUD-${timestamp}`,
        actorId: agent.id,
        action: 'placement_created',
        entityType: 'Placement',
        entityCode: placement.code,
        before: {},
        after: { status: 'active', placementFee: 1100000 },
        city: 'Bengaluru',
      },
      include: {
        actor: true,
      },
    });

    expect(auditLog.actor?.id).toBe(agent.id);
    expect(auditLog.entityCode).toBe(placement.code);

    // Cleanup created test records
    await prisma.auditLog.delete({ where: { id: auditLog.id } });
    await prisma.payment.delete({ where: { id: payment.id } });
    await prisma.placement.delete({ where: { id: placement.id } });
    await prisma.vacancy.delete({ where: { id: vacancy.id } });
    await prisma.business.delete({ where: { id: business.id } });
    await prisma.jobSeeker.delete({ where: { id: jobSeeker.id } });
    await prisma.referral.delete({ where: { id: referral.id } });
    await prisma.staff.delete({ where: { id: agent.id } });
    await prisma.staff.delete({ where: { id: teamLead.id } });
  });
});
