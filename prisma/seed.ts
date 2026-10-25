import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

export async function seed(prismaClient?: PrismaClient) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed database when NODE_ENV is "production"!');
  }

  const prisma = prismaClient ?? new PrismaClient();
  const defaultPassword = 'Password123!Secure';
  const passwordHash = await bcrypt.hash(defaultPassword, 10);

  try {
    // 1. Staff Members (one of each role)
    // 1a. CEO
    const ceo = await prisma.staff.upsert({
      where: { email: 'ceo@laboura.local' },
      update: {
        name: 'Arjun Mehta',
        role: 'ceo',
        city: 'Bengaluru',
      },
      create: {
        code: 'CEO-00001',
        name: 'Arjun Mehta',
        email: 'ceo@laboura.local',
        passwordHash,
        role: 'ceo',
        city: 'Bengaluru',
      },
    });

    // 1b. Manager
    await prisma.staff.upsert({
      where: { email: 'manager@laboura.local' },
      update: {
        name: 'Priya Sharma',
        role: 'manager',
        city: 'Bengaluru',
      },
      create: {
        code: 'MGR-00001',
        name: 'Priya Sharma',
        email: 'manager@laboura.local',
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });

    // 1c. Team Lead
    const teamLead = await prisma.staff.upsert({
      where: { email: 'lead.koramangala@laboura.local' },
      update: {
        name: 'Vikram Rao',
        role: 'team_lead',
        area: 'Koramangala',
        city: 'Bengaluru',
      },
      create: {
        code: 'TL-00001',
        name: 'Vikram Rao',
        email: 'lead.koramangala@laboura.local',
        passwordHash,
        role: 'team_lead',
        area: 'Koramangala',
        city: 'Bengaluru',
      },
    });

    // 1d. Call Agent (under Team Lead)
    const callAgent = await prisma.staff.upsert({
      where: { email: 'call.agent@laboura.local' },
      update: {
        name: 'Deepa Nair',
        role: 'call_agent',
        area: 'Indiranagar',
        city: 'Bengaluru',
        teamLeadId: teamLead.id,
      },
      create: {
        code: 'CA-00001',
        name: 'Deepa Nair',
        email: 'call.agent@laboura.local',
        passwordHash,
        role: 'call_agent',
        area: 'Indiranagar',
        city: 'Bengaluru',
        teamLeadId: teamLead.id,
      },
    });

    // 1e. Field Agent (under Team Lead)
    const fieldAgent = await prisma.staff.upsert({
      where: { email: 'field.agent@laboura.local' },
      update: {
        name: 'Kiran Kumar',
        role: 'field_agent',
        area: 'Koramangala',
        city: 'Bengaluru',
        teamLeadId: teamLead.id,
      },
      create: {
        code: 'FA-00001',
        name: 'Kiran Kumar',
        email: 'field.agent@laboura.local',
        passwordHash,
        role: 'field_agent',
        area: 'Koramangala',
        city: 'Bengaluru',
        teamLeadId: teamLead.id,
      },
    });

    // 1f. Finance
    await prisma.staff.upsert({
      where: { email: 'finance@laboura.local' },
      update: {
        name: 'Sneha Patel',
        role: 'finance',
        city: 'Bengaluru',
      },
      create: {
        code: 'FIN-00001',
        name: 'Sneha Patel',
        email: 'finance@laboura.local',
        passwordHash,
        role: 'finance',
        city: 'Bengaluru',
      },
    });

    // 2. Businesses (different cities and areas)
    const bz1 = await prisma.business.upsert({
      where: { phone: '+918011110001' },
      update: {
        name: 'Metro Facility Solutions',
        area: 'Koramangala',
        city: 'Bengaluru',
        phoneVerified: true,
        latitude: 12.9352,
        longitude: 77.6245,
        geofenceFlag: false,
      },
      create: {
        code: 'BZ-00001',
        name: 'Metro Facility Solutions',
        contactName: 'Sunil Verma',
        phone: '+918011110001',
        phoneVerified: true,
        area: 'Koramangala',
        city: 'Bengaluru',
        latitude: 12.9352,
        longitude: 77.6245,
        geofenceFlag: false,
      },
    });

    const bz2 = await prisma.business.upsert({
      where: { phone: '+918011110002' },
      update: {
        name: 'Indira Retail Mart',
        area: 'Indiranagar',
        city: 'Bengaluru',
        phoneVerified: true,
        latitude: 12.9784,
        longitude: 77.6408,
        geofenceFlag: false,
      },
      create: {
        code: 'BZ-00002',
        name: 'Indira Retail Mart',
        contactName: 'Rohit Shenoy',
        phone: '+918011110002',
        phoneVerified: true,
        area: 'Indiranagar',
        city: 'Bengaluru',
        latitude: 12.9784,
        longitude: 77.6408,
        geofenceFlag: false,
      },
    });

    const bz3 = await prisma.business.upsert({
      where: { phone: '+918211110003' },
      update: {
        name: 'Mysuru Industrial Fabrications',
        area: 'Hebbal Industrial',
        city: 'Mysuru',
        phoneVerified: true,
        latitude: 12.3051,
        longitude: 76.6551,
        geofenceFlag: true,
        selfieUrl: 'https://storage.laboura.local/selfies/seed_bz3.jpg',
        selfieHash: 'hash_seed_bz3_geofence',
      },
      create: {
        code: 'BZ-00003',
        name: 'Mysuru Industrial Fabrications',
        contactName: 'Raghavendra K',
        phone: '+918211110003',
        phoneVerified: true,
        area: 'Hebbal Industrial',
        city: 'Mysuru',
        latitude: 12.3051,
        longitude: 76.6551,
        geofenceFlag: true,
        selfieUrl: 'https://storage.laboura.local/selfies/seed_bz3.jpg',
        selfieHash: 'hash_seed_bz3_geofence',
      },
    });

    // BusinessVisit for bz3 to record geofence mismatch
    await prisma.businessVisit.deleteMany({
      where: { businessId: bz3.id },
    });
    await prisma.businessVisit.create({
      data: {
        businessId: bz3.id,
        staffId: fieldAgent.id,
        latitude: 12.9352, // 140km away from Mysuru registered address
        longitude: 77.6245,
        selfieUrl: 'https://storage.laboura.local/selfies/seed_bz3.jpg',
        selfieHash: 'hash_seed_bz3_geofence',
        geofenceFlag: true,
      },
    });

    // 2b. Vacancies (1-2 per business)
    const vc1 = await prisma.vacancy.upsert({
      where: { code: 'VC-00001' },
      update: {
        tradeSkill: 'Electrician',
        offeredSalary: 2200000,
        headcount: 2,
        status: 'open',
      },
      create: {
        code: 'VC-00001',
        city: bz1.city,
        businessId: bz1.id,
        capturedByStaffId: fieldAgent.id,
        tradeSkill: 'Electrician',
        offeredSalary: 2200000,
        headcount: 2,
        status: 'open',
      },
    });

    const vc2 = await prisma.vacancy.upsert({
      where: { code: 'VC-00002' },
      update: {
        tradeSkill: 'Plumber',
        offeredSalary: 2000000,
        headcount: 1,
        status: 'open',
      },
      create: {
        code: 'VC-00002',
        city: bz1.city,
        businessId: bz1.id,
        capturedByStaffId: fieldAgent.id,
        tradeSkill: 'Plumber',
        offeredSalary: 2000000,
        headcount: 1,
        status: 'open',
      },
    });

    const vc3 = await prisma.vacancy.upsert({
      where: { code: 'VC-00003' },
      update: {
        tradeSkill: 'Painter',
        offeredSalary: 1800000,
        headcount: 1,
        status: 'open',
      },
      create: {
        code: 'VC-00003',
        city: bz2.city,
        businessId: bz2.id,
        capturedByStaffId: callAgent.id,
        tradeSkill: 'Painter',
        offeredSalary: 1800000,
        headcount: 1,
        status: 'open',
      },
    });

    const vc4 = await prisma.vacancy.upsert({
      where: { code: 'VC-00004' },
      update: {
        tradeSkill: 'Welder',
        offeredSalary: 2400000,
        headcount: 1,
        status: 'open',
      },
      create: {
        code: 'VC-00004',
        city: bz3.city,
        businessId: bz3.id,
        capturedByStaffId: fieldAgent.id,
        tradeSkill: 'Welder',
        offeredSalary: 2400000,
        headcount: 1,
        status: 'open',
      },
    });

    // 3. Referral Partners
    const referral = await prisma.referral.upsert({
      where: { code: 'RF-00001' },
      update: {
        name: 'Rajesh Sharma',
        phone: '+919800000001',
        type: 'individual',
        city: 'Bengaluru',
      },
      create: {
        code: 'RF-00001',
        name: 'Rajesh Sharma',
        phone: '+919800000001',
        phoneVerified: true,
        type: 'individual',
        city: 'Bengaluru',
      },
    });

    // 4. Job Seekers (different cities and statuses: active, pending_payment)
    const js1 = await prisma.jobSeeker.upsert({
      where: { phone: '+919900000001' },
      update: {
        name: 'Suresh Gowda',
        tradeSkill: 'Electrician',
        minSalary: 1800000,
        maxSalary: 2500000,
        status: 'active',
        paymentReceivedAt: new Date('2026-06-01T10:00:00.000Z'),
        referredById: referral.id,
        city: 'Bengaluru',
      },
      create: {
        code: 'JS-00001',
        name: 'Suresh Gowda',
        phone: '+919900000001',
        phoneVerified: true,
        tradeSkill: 'Electrician',
        minSalary: 1800000,
        maxSalary: 2500000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        paymentReceivedAt: new Date('2026-06-01T10:00:00.000Z'),
        hitCount: 0,
        kycStatus: 'verified',
        kycReference: 'KYC-VENDOR-REF-001',
        referredById: referral.id,
        city: 'Bengaluru',
      },
    });

    await prisma.jobSeeker.upsert({
      where: { phone: '+919900000002' },
      update: {
        name: 'Anand Kumar',
        tradeSkill: 'Plumber',
        minSalary: 1600000,
        maxSalary: 2200000,
        status: 'pending_payment',
        paymentReceivedAt: null,
        city: 'Bengaluru',
      },
      create: {
        code: 'JS-00002',
        name: 'Anand Kumar',
        phone: '+919900000002',
        phoneVerified: true,
        tradeSkill: 'Plumber',
        minSalary: 1600000,
        maxSalary: 2200000,
        preferredCallWindowStart: '10:00',
        preferredCallWindowEnd: '19:00',
        status: 'pending_payment',
        paymentReceivedAt: null,
        hitCount: 0,
        kycStatus: 'pending',
        city: 'Bengaluru',
      },
    });

    const js3 = await prisma.jobSeeker.upsert({
      where: { phone: '+919900000003' },
      update: {
        name: 'Manjunath R',
        tradeSkill: 'Driver',
        minSalary: 1500000,
        maxSalary: 2000000,
        status: 'active',
        paymentReceivedAt: new Date('2026-06-05T10:00:00.000Z'),
        city: 'Mysuru',
      },
      create: {
        code: 'JS-00003',
        name: 'Manjunath R',
        phone: '+919900000003',
        phoneVerified: true,
        tradeSkill: 'Driver',
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '20:00',
        status: 'active',
        paymentReceivedAt: new Date('2026-06-05T10:00:00.000Z'),
        hitCount: 0,
        kycStatus: 'verified',
        kycReference: 'KYC-VENDOR-REF-003',
        city: 'Mysuru',
      },
    });

    // 4b. Phase 3 Seed Data: 1 hit, 2 hits, deactivated (3 hits), reactivated
    const js4 = await prisma.jobSeeker.upsert({
      where: { phone: '+919900000004' },
      update: {
        name: 'Kavitha M',
        tradeSkill: 'Tailor',
        minSalary: 1400000,
        maxSalary: 1800000,
        status: 'active',
        hitCount: 1,
        paymentReceivedAt: new Date('2026-06-10T10:00:00.000Z'),
        city: 'Bengaluru',
      },
      create: {
        code: 'JS-00004',
        name: 'Kavitha M',
        phone: '+919900000004',
        phoneVerified: true,
        tradeSkill: 'Tailor',
        minSalary: 1400000,
        maxSalary: 1800000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        hitCount: 1,
        paymentReceivedAt: new Date('2026-06-10T10:00:00.000Z'),
        kycStatus: 'verified',
        kycReference: 'KYC-VENDOR-REF-004',
        city: 'Bengaluru',
      },
    });

    const js5 = await prisma.jobSeeker.upsert({
      where: { phone: '+919900000005' },
      update: {
        name: 'Deepak V',
        tradeSkill: 'Carpenter',
        minSalary: 1600000,
        maxSalary: 2200000,
        status: 'active',
        hitCount: 2,
        paymentReceivedAt: new Date('2026-06-10T10:00:00.000Z'),
        city: 'Bengaluru',
      },
      create: {
        code: 'JS-00005',
        name: 'Deepak V',
        phone: '+919900000005',
        phoneVerified: true,
        tradeSkill: 'Carpenter',
        minSalary: 1600000,
        maxSalary: 2200000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        hitCount: 2,
        paymentReceivedAt: new Date('2026-06-10T10:00:00.000Z'),
        kycStatus: 'verified',
        kycReference: 'KYC-VENDOR-REF-005',
        city: 'Bengaluru',
      },
    });

    const js6 = await prisma.jobSeeker.upsert({
      where: { phone: '+919900000006' },
      update: {
        name: 'Ravi Shankar',
        tradeSkill: 'Mason',
        minSalary: 1500000,
        maxSalary: 2000000,
        status: 'deactivated',
        hitCount: 3,
        paymentReceivedAt: new Date('2026-05-15T10:00:00.000Z'),
        city: 'Bengaluru',
      },
      create: {
        code: 'JS-00006',
        name: 'Ravi Shankar',
        phone: '+919900000006',
        phoneVerified: true,
        tradeSkill: 'Mason',
        minSalary: 1500000,
        maxSalary: 2000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'deactivated',
        hitCount: 3,
        paymentReceivedAt: new Date('2026-05-15T10:00:00.000Z'),
        kycStatus: 'verified',
        kycReference: 'KYC-VENDOR-REF-006',
        city: 'Bengaluru',
      },
    });

    const js7 = await prisma.jobSeeker.upsert({
      where: { phone: '+919900000007' },
      update: {
        name: 'Lakshmi Bai',
        tradeSkill: 'Housekeeper',
        minSalary: 1200000,
        maxSalary: 1600000,
        status: 'active',
        hitCount: 0,
        paymentReceivedAt: new Date('2026-06-28T10:00:00.000Z'),
        city: 'Bengaluru',
      },
      create: {
        code: 'JS-00007',
        name: 'Lakshmi Bai',
        phone: '+919900000007',
        phoneVerified: true,
        tradeSkill: 'Housekeeper',
        minSalary: 1200000,
        maxSalary: 1600000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        hitCount: 0,
        paymentReceivedAt: new Date('2026-06-28T10:00:00.000Z'),
        kycStatus: 'verified',
        kycReference: 'KYC-VENDOR-REF-007',
        city: 'Bengaluru',
      },
    });

    // Idempotent seeding of hits for JS4, JS5, JS6
    await prisma.jobSeekerHit.deleteMany({
      where: { jobSeekerId: { in: [js4.id, js5.id, js6.id] } },
    });

    await prisma.jobSeekerHit.createMany({
      data: [
        // JS4: 1 hit
        {
          jobSeekerId: js4.id,
          reason: 'offer_rejected',
          note: 'Candidate rejected first offer',
          recordedBy: ceo.id,
          recordedAt: new Date('2026-06-12T11:00:00.000Z'),
        },
        // JS5: 2 hits
        {
          jobSeekerId: js5.id,
          reason: 'no_pickup',
          note: 'No pickup AM+PM+SMS',
          recordedBy: 'system',
          recordedAt: new Date('2026-06-11T18:00:00.000Z'),
        },
        {
          jobSeekerId: js5.id,
          reason: 'offer_rejected',
          note: 'Candidate rejected second offer',
          recordedBy: ceo.id,
          recordedAt: new Date('2026-06-12T14:00:00.000Z'),
        },
        // JS6: 3 hits
        {
          jobSeekerId: js6.id,
          reason: 'no_pickup',
          note: 'No pickup AM+PM+SMS',
          recordedBy: 'system',
          recordedAt: new Date('2026-05-18T18:00:00.000Z'),
        },
        {
          jobSeekerId: js6.id,
          reason: 'interview_no_show',
          note: 'No show for interview',
          recordedBy: ceo.id,
          recordedAt: new Date('2026-05-20T11:00:00.000Z'),
        },
        {
          jobSeekerId: js6.id,
          reason: 'offer_rejected',
          note: 'Candidate rejected suitable offer',
          recordedBy: ceo.id,
          recordedAt: new Date('2026-05-22T16:00:00.000Z'),
        },
      ],
    });

    // Seed reactivation payment for JS7
    await prisma.payment.upsert({
      where: { gatewayReference: 'gw_seed_reactivation_js00007' },
      update: {
        status: 'succeeded',
        amount: 49900,
        reactivation: true,
        jobSeekerId: js7.id,
      },
      create: {
        code: 'PAY-00001',
        city: 'Bengaluru',
        type: 'activation',
        amount: 49900,
        status: 'succeeded',
        gatewayReference: 'gw_seed_reactivation_js00007',
        subjectType: 'job_seeker',
        subjectId: js7.id,
        jobSeekerId: js7.id,
        reactivation: true,
      },
    });

    // Seed dropped-out placement for replacement vacancy testing (inside 15-day window)
    const pl1 = await prisma.placement.upsert({
      where: { code: 'PL-00001' },
      update: {
        status: 'dropped_out',
        eligibility: 'employee_left',
        joinedDate: new Date('2026-06-10T10:00:00.000Z'),
        dropoutReportedAt: new Date('2026-06-25T10:00:00.000Z'), // 6 days before 2026-07-01 (<= 15 days)
        agreedSalary: 2200000,
        placementFee: 1100000,
        gstAmount: 198000,
        replacementRejectionCount: 0,
        clockPaused: false,
      },
      create: {
        code: 'PL-00001',
        city: 'Bengaluru',
        vacancyId: vc1.id,
        jobSeekerId: js1.id,
        businessId: bz1.id,
        agreedSalary: 2200000,
        placementFee: 1100000,
        gstAmount: 198000,
        status: 'dropped_out',
        eligibility: 'employee_left',
        joinedDate: new Date('2026-06-10T10:00:00.000Z'),
        dropoutReportedAt: new Date('2026-06-25T10:00:00.000Z'),
        replacementRejectionCount: 0,
        clockPaused: false,
      },
    });

    // VC-00005: Replacement vacancy inside 15-day window (created 4 days ago relative to 2026-07-01)
    await prisma.vacancy.upsert({
      where: { code: 'VC-00005' },
      update: {
        tradeSkill: 'Electrician',
        offeredSalary: 2200000,
        headcount: 1,
        status: 'open',
        replacementForPlacementId: pl1.id,
        createdAt: new Date('2026-06-27T10:00:00.000Z'),
      },
      create: {
        code: 'VC-00005',
        city: bz1.city,
        businessId: bz1.id,
        capturedByStaffId: fieldAgent.id,
        tradeSkill: 'Electrician',
        offeredSalary: 2200000,
        headcount: 1,
        status: 'open',
        replacementForPlacementId: pl1.id,
        createdAt: new Date('2026-06-27T10:00:00.000Z'),
      },
    });

    // Seed PL-00002: Confirmed + joined placement
    const js8 = await prisma.jobSeeker.upsert({
      where: { phone: '+919900000008' },
      update: {
        name: 'Ramesh Placed',
        tradeSkill: 'Plumber',
        minSalary: 1800000,
        maxSalary: 2200000,
        status: 'placed',
        paymentReceivedAt: new Date('2026-05-15T10:00:00.000Z'),
        referredById: referral.id,
        city: 'Bengaluru',
      },
      create: {
        code: 'JS-00008',
        name: 'Ramesh Placed',
        phone: '+919900000008',
        phoneVerified: true,
        tradeSkill: 'Plumber',
        minSalary: 1800000,
        maxSalary: 2200000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'placed',
        paymentReceivedAt: new Date('2026-05-15T10:00:00.000Z'),
        referredById: referral.id,
        city: 'Bengaluru',
      },
    });

    const pl2 = await prisma.placement.upsert({
      where: { code: 'PL-00002' },
      update: {
        status: 'active',
        joinedDate: new Date('2026-06-15T10:00:00.000Z'),
        agreedSalary: 2000000,
        placementFee: 1000000,
        gstAmount: 180000,
        clockPaused: false,
      },
      create: {
        code: 'PL-00002',
        city: 'Bengaluru',
        vacancyId: vc2.id,
        jobSeekerId: js8.id,
        businessId: bz1.id,
        agreedSalary: 2000000,
        placementFee: 1000000,
        gstAmount: 180000,
        status: 'active',
        joinedDate: new Date('2026-06-15T10:00:00.000Z'),
        clockPaused: false,
      },
    });

    // Seed referral payout payment for PL-00002 (completed, joined, paid-out placement)
    await prisma.payment.upsert({
      where: { gatewayReference: 'gw_seed_payout_pl00002' },
      update: {
        status: 'succeeded',
        amount: 20000,
        type: 'referral_payout',
        subjectType: 'referral',
        subjectId: referral.id,
        referralId: referral.id,
        placementId: pl2.id,
        jobSeekerId: js8.id,
        businessId: bz1.id,
      },
      create: {
        code: 'PAY-00002',
        city: 'Bengaluru',
        type: 'referral_payout',
        amount: 20000,
        status: 'succeeded',
        gatewayReference: 'gw_seed_payout_pl00002',
        subjectType: 'referral',
        subjectId: referral.id,
        referralId: referral.id,
        placementId: pl2.id,
        jobSeekerId: js8.id,
        businessId: bz1.id,
      },
    });

    // Seed PL-00003: Dropped placement past day 60
    const js9 = await prisma.jobSeeker.upsert({
      where: { phone: '+919900000009' },
      update: {
        name: 'Anand PastSixty',
        tradeSkill: 'Painter',
        minSalary: 1600000,
        maxSalary: 2000000,
        status: 'active',
        paymentReceivedAt: new Date('2026-03-01T10:00:00.000Z'),
        city: 'Bengaluru',
      },
      create: {
        code: 'JS-00009',
        name: 'Anand PastSixty',
        phone: '+919900000009',
        phoneVerified: true,
        tradeSkill: 'Painter',
        minSalary: 1600000,
        maxSalary: 2000000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        paymentReceivedAt: new Date('2026-03-01T10:00:00.000Z'),
        city: 'Bengaluru',
      },
    });

    const pl3 = await prisma.placement.upsert({
      where: { code: 'PL-00003' },
      update: {
        status: 'dropped_out',
        eligibility: 'employee_left',
        joinedDate: new Date('2026-03-10T10:00:00.000Z'),
        dropoutReportedAt: new Date('2026-04-10T10:00:00.000Z'), // 82 days before 2026-07-01 (>60 days)
        agreedSalary: 1800000,
        placementFee: 900000,
        gstAmount: 162000,
        replacementRejectionCount: 0,
        clockPaused: false,
      },
      create: {
        code: 'PL-00003',
        city: 'Bengaluru',
        vacancyId: vc3.id,
        jobSeekerId: js9.id,
        businessId: bz2.id,
        agreedSalary: 1800000,
        placementFee: 900000,
        gstAmount: 162000,
        status: 'dropped_out',
        eligibility: 'employee_left',
        joinedDate: new Date('2026-03-10T10:00:00.000Z'),
        dropoutReportedAt: new Date('2026-04-10T10:00:00.000Z'),
        replacementRejectionCount: 0,
        clockPaused: false,
      },
    });

    // VC-00006: Replacement vacancy outside 15-day window (created 26 days ago relative to 2026-07-01)
    await prisma.vacancy.upsert({
      where: { code: 'VC-00006' },
      update: {
        tradeSkill: 'Electrician',
        offeredSalary: 2200000,
        headcount: 1,
        status: 'open',
        replacementForPlacementId: pl1.id,
        createdAt: new Date('2026-06-05T10:00:00.000Z'),
      },
      create: {
        code: 'VC-00006',
        city: bz1.city,
        businessId: bz1.id,
        capturedByStaffId: fieldAgent.id,
        tradeSkill: 'Electrician',
        offeredSalary: 2200000,
        headcount: 1,
        status: 'open',
        replacementForPlacementId: pl1.id,
        createdAt: new Date('2026-06-05T10:00:00.000Z'),
      },
    });

    // Seed PL-00004: Dropped placement with 3 replacement rejections (clock paused)
    const js10 = await prisma.jobSeeker.upsert({
      where: { phone: '+919900000010' },
      update: {
        name: 'Karthik Paused',
        tradeSkill: 'Welder',
        minSalary: 2200000,
        maxSalary: 2600000,
        status: 'active',
        paymentReceivedAt: new Date('2026-04-20T10:00:00.000Z'),
        city: 'Bengaluru',
      },
      create: {
        code: 'JS-00010',
        name: 'Karthik Paused',
        phone: '+919900000010',
        phoneVerified: true,
        tradeSkill: 'Welder',
        minSalary: 2200000,
        maxSalary: 2600000,
        preferredCallWindowStart: '09:00',
        preferredCallWindowEnd: '18:00',
        status: 'active',
        paymentReceivedAt: new Date('2026-04-20T10:00:00.000Z'),
        city: 'Bengaluru',
      },
    });

    const pl4 = await prisma.placement.upsert({
      where: { code: 'PL-00004' },
      update: {
        status: 'dropped_out',
        eligibility: 'employee_left',
        joinedDate: new Date('2026-05-01T10:00:00.000Z'),
        dropoutReportedAt: new Date('2026-05-15T10:00:00.000Z'),
        replacementRejectionCount: 3,
        clockPaused: true,
        clockPausedAt: new Date('2026-05-25T10:00:00.000Z'),
        agreedSalary: 2400000,
        placementFee: 1200000,
        gstAmount: 216000,
      },
      create: {
        code: 'PL-00004',
        city: 'Bengaluru',
        vacancyId: vc4.id,
        jobSeekerId: js10.id,
        businessId: bz3.id,
        agreedSalary: 2400000,
        placementFee: 1200000,
        gstAmount: 216000,
        status: 'dropped_out',
        eligibility: 'employee_left',
        joinedDate: new Date('2026-05-01T10:00:00.000Z'),
        dropoutReportedAt: new Date('2026-05-15T10:00:00.000Z'),
        replacementRejectionCount: 3,
        clockPaused: true,
        clockPausedAt: new Date('2026-05-25T10:00:00.000Z'),
      },
    });

    // Idempotent 3 rejected replacement candidates for PL-00004
    await prisma.replacementCandidate.deleteMany({
      where: { placementId: pl4.id },
    });
    await prisma.replacementCandidate.createMany({
      data: [
        {
          placementId: pl4.id,
          jobSeekerId: js1.id,
          status: 'rejected',
          rejectionReason: 'Not available immediately',
          rejectedAt: new Date('2026-05-18T10:00:00.000Z'),
        },
        {
          placementId: pl4.id,
          jobSeekerId: js3.id,
          status: 'rejected',
          rejectionReason: 'Shift timing conflict',
          rejectedAt: new Date('2026-05-21T10:00:00.000Z'),
        },
        {
          placementId: pl4.id,
          jobSeekerId: js4.id,
          status: 'rejected',
          rejectionReason: 'Third rejection - paused clock',
          rejectedAt: new Date('2026-05-25T10:00:00.000Z'),
        },
      ],
    });

    // 4.5. Phase 7 Mock Provider Records
    // Seeded examples of each provider's records: OTP, WhatsApp, Telephony, DPDP Consent, KYC
    await prisma.callbackTask.upsert({
      where: { callId: 'call_seed_tollfree_00001' },
      update: {},
      create: {
        callId: 'call_seed_tollfree_00001',
        phone: '+919876543210',
        callerName: 'Sunita Rao (Seeded)',
        jobSeekerId: js1.id,
        virtualNumber: '18001234567',
        status: 'completed',
        recordingUrl:
          'https://telephony-storage.laboura.in/recordings/call_seed_tollfree_00001.mp3',
        recordingConsent: true,
        assignedToStaffId: callAgent.id,
      },
    });

    await prisma.auditLog.upsert({
      where: { code: 'AUD-00070' },
      update: {
        actorId: ceo.id,
        action: 'dpdp_consent.recorded',
        entityType: 'telephony_call',
        entityCode: 'call_seed_tollfree_00001',
        after: {
          consented: true,
          noticeGiven: true,
          announcement:
            'This call is recorded for quality, training and compliance under the Digital Personal Data Protection Act. By continuing, you consent to this recording.',
          recordingUrl:
            'https://telephony-storage.laboura.in/recordings/call_seed_tollfree_00001.mp3',
          callerPhone: '+919876543210',
          virtualNumber: '18001234567',
          timestamp: new Date('2026-06-01T10:00:00.000Z'),
        },
        city: 'Bengaluru',
      },
      create: {
        code: 'AUD-00070',
        actorId: ceo.id,
        action: 'dpdp_consent.recorded',
        entityType: 'telephony_call',
        entityCode: 'call_seed_tollfree_00001',
        after: {
          consented: true,
          noticeGiven: true,
          announcement:
            'This call is recorded for quality, training and compliance under the Digital Personal Data Protection Act. By continuing, you consent to this recording.',
          recordingUrl:
            'https://telephony-storage.laboura.in/recordings/call_seed_tollfree_00001.mp3',
          callerPhone: '+919876543210',
          virtualNumber: '18001234567',
          timestamp: new Date('2026-06-01T10:00:00.000Z'),
        },
        city: 'Bengaluru',
      },
    });

    await prisma.auditLog.upsert({
      where: { code: 'AUD-00071' },
      update: {
        actorId: callAgent.id,
        action: 'whatsapp.send_attempt',
        entityType: 'whatsapp_message',
        entityCode: 'wamid_seed_00001',
        after: {
          phone: '+919876543210',
          templateName: 'call_attempt_notice',
          status: 'sent',
          timestamp: new Date('2026-06-01T10:05:00.000Z'),
        },
        city: 'Bengaluru',
      },
      create: {
        code: 'AUD-00071',
        actorId: callAgent.id,
        action: 'whatsapp.send_attempt',
        entityType: 'whatsapp_message',
        entityCode: 'wamid_seed_00001',
        after: {
          phone: '+919876543210',
          templateName: 'call_attempt_notice',
          status: 'sent',
          timestamp: new Date('2026-06-01T10:05:00.000Z'),
        },
        city: 'Bengaluru',
      },
    });

    await prisma.auditLog.upsert({
      where: { code: 'AUD-00072' },
      update: {
        actorId: callAgent.id,
        action: 'otp.send_attempt',
        entityType: 'otp_request',
        entityCode: 'otp_seed_req_00001',
        after: {
          phone: '+919876543210',
          requestId: 'otp_seed_req_00001',
          timestamp: new Date('2026-06-01T09:30:00.000Z'),
        },
        city: 'Bengaluru',
      },
      create: {
        code: 'AUD-00072',
        actorId: callAgent.id,
        action: 'otp.send_attempt',
        entityType: 'otp_request',
        entityCode: 'otp_seed_req_00001',
        after: {
          phone: '+919876543210',
          requestId: 'otp_seed_req_00001',
          timestamp: new Date('2026-06-01T09:30:00.000Z'),
        },
        city: 'Bengaluru',
      },
    });

    await prisma.jobSeeker.update({
      where: { id: js1.id },
      data: {
        kycStatus: 'verified',
        kycReference: 'ovse_seed_kyc_ref_998877',
      },
    });

    await prisma.auditLog.upsert({
      where: { code: 'AUD-00073' },
      update: {
        actorId: ceo.id,
        action: 'kyc.verified',
        entityType: 'job_seeker',
        entityCode: js1.code,
        after: {
          status: 'verified',
          vendorReference: 'ovse_seed_kyc_ref_998877',
          vendor: 'surepass-ovse',
          timestamp: new Date('2026-06-01T09:35:00.000Z'),
        },
        city: 'Bengaluru',
      },
      create: {
        code: 'AUD-00073',
        actorId: ceo.id,
        action: 'kyc.verified',
        entityType: 'job_seeker',
        entityCode: js1.code,
        after: {
          status: 'verified',
          vendorReference: 'ovse_seed_kyc_ref_998877',
          vendor: 'surepass-ovse',
          timestamp: new Date('2026-06-01T09:35:00.000Z'),
        },
        city: 'Bengaluru',
      },
    });

    // 5. Synchronize sequences past seeded codes so IdService will never collide
    const mapping: Record<string, string> = {
      BZ: 'Business',
      JS: 'JobSeeker',
      RF: 'Referral',
      VC: 'Vacancy',
      PL: 'Placement',
      PAY: 'Payment',
      AUD: 'AuditLog',
    };

    for (const [prefix, tableName] of Object.entries(mapping)) {
      const clean = prefix.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const seqName = `seq_id_${clean}`;
      await prisma.$executeRawUnsafe(
        `CREATE SEQUENCE IF NOT EXISTS "${seqName}" START WITH 1;`
      );
      await prisma.$executeRawUnsafe(`
        DO $$
        DECLARE
          max_val integer;
        BEGIN
          SELECT COALESCE(MAX(SUBSTRING(code FROM ${prefix.length + 2})::int), 0)
          INTO max_val
          FROM "${tableName}"
          WHERE code ~ '^${prefix}-[0-9]+$';

          IF max_val > 0 THEN
            PERFORM setval('"${seqName}"', max_val, true);
          END IF;
        END $$;
      `);
    }

    return { success: true };
  } finally {
    if (!prismaClient) {
      await prisma.$disconnect();
    }
  }
}

if (require.main === module) {
  seed()
    .then(() => {
      console.log('Database seeded successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Error seeding database:', err);
      process.exit(1);
    });
}
