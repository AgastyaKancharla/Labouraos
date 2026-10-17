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
    await prisma.staff.upsert({
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
    await prisma.staff.upsert({
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
    await prisma.business.upsert({
      where: { phone: '+918011110001' },
      update: {
        name: 'Metro Facility Solutions',
        area: 'Koramangala',
        city: 'Bengaluru',
      },
      create: {
        code: 'BZ-00001',
        name: 'Metro Facility Solutions',
        contactName: 'Sunil Verma',
        phone: '+918011110001',
        area: 'Koramangala',
        city: 'Bengaluru',
      },
    });

    await prisma.business.upsert({
      where: { phone: '+918011110002' },
      update: {
        name: 'Indira Retail Mart',
        area: 'Indiranagar',
        city: 'Bengaluru',
      },
      create: {
        code: 'BZ-00002',
        name: 'Indira Retail Mart',
        contactName: 'Rohit Shenoy',
        phone: '+918011110002',
        area: 'Indiranagar',
        city: 'Bengaluru',
      },
    });

    await prisma.business.upsert({
      where: { phone: '+918211110003' },
      update: {
        name: 'Mysuru Industrial Fabrications',
        area: 'Hebbal Industrial',
        city: 'Mysuru',
      },
      create: {
        code: 'BZ-00003',
        name: 'Mysuru Industrial Fabrications',
        contactName: 'Raghavendra K',
        phone: '+918211110003',
        area: 'Hebbal Industrial',
        city: 'Mysuru',
      },
    });

    // 3. Referral Partners
    const referral = await prisma.referral.upsert({
      where: { phone: '+919800000001' },
      update: {
        name: 'Rajesh Sharma',
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
    await prisma.jobSeeker.upsert({
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

    await prisma.jobSeeker.upsert({
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
