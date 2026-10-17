import {
  Controller,
  Get,
  INestApplication,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RbacGuard } from './rbac.guard';
import { PiiMaskingInterceptor } from './pii-masking.interceptor';
import { RequirePermission } from './permissions.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtService } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { JwtStrategy } from '../auth/jwt.strategy';

@Controller('test-rbac')
@UseGuards(JwtAuthGuard, RbacGuard)
class TestRbacController {
  @Get('finance')
  @RequirePermission('payment', 'read')
  getFinanceData() {
    return { status: 'ok', data: 'finance ledger' };
  }

  @Get('business/:id')
  @RequirePermission('business', 'read')
  getBusiness(@Param('id') id: string) {
    return { id, name: 'Sample Business' };
  }

  @Get('staff/:id')
  @RequirePermission('staff', 'read')
  getStaff(@Param('id') id: string) {
    return { id, name: 'Sample Staff' };
  }

  @Get('job-seeker')
  @RequirePermission('job_seeker', 'read')
  getJobSeeker() {
    return {
      id: 'JS-04821',
      code: 'JS-04821',
      name: 'Ramesh Kumar',
      phone: '+919876543210',
      kycReference: 'KYC-VENDOR-REF-9988',
      minSalary: 1800000,
      tradeSkill: 'Electrician',
    };
  }

  @Post('pricing')
  @RequirePermission('pricing', 'write')
  updatePricing() {
    return { status: 'pricing updated' };
  }
}

describe('RBAC Guard and PII Masking', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ceoToken: string;
  let managerToken: string;
  let callAgentToken: string;
  let fieldAgentToken: string;
  let financeToken: string;
  let teamLead1Token: string;

  let teamLead1Id: string;
  let teamLead2Id: string;
  let agentUnderLead1Id: string;
  let agentUnderLead2Id: string;
  let whitefieldBusinessId: string;
  let koramangalaBusinessId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const timestamp = Date.now();

    // 1. Create team leads
    const lead1 = await prisma.staff.create({
      data: {
        code: `TL-${timestamp}-1`,
        name: 'Team Lead 1',
        email: `lead1_${timestamp}@laboura.local`,
        passwordHash: 'hash',
        role: 'team_lead',
        city: 'Bengaluru',
      },
    });
    teamLead1Id = lead1.id;

    const lead2 = await prisma.staff.create({
      data: {
        code: `TL-${timestamp}-2`,
        name: 'Team Lead 2',
        email: `lead2_${timestamp}@laboura.local`,
        passwordHash: 'hash',
        role: 'team_lead',
        city: 'Bengaluru',
      },
    });
    teamLead2Id = lead2.id;

    // 2. Create agents under leads
    const agent1 = await prisma.staff.create({
      data: {
        code: `CA-${timestamp}-1`,
        name: 'Agent Under Lead 1',
        email: `agent1_${timestamp}@laboura.local`,
        passwordHash: 'hash',
        role: 'call_agent',
        teamLeadId: lead1.id,
        city: 'Bengaluru',
      },
    });
    agentUnderLead1Id = agent1.id;

    const agent2 = await prisma.staff.create({
      data: {
        code: `CA-${timestamp}-2`,
        name: 'Agent Under Lead 2',
        email: `agent2_${timestamp}@laboura.local`,
        passwordHash: 'hash',
        role: 'call_agent',
        teamLeadId: lead2.id,
        city: 'Bengaluru',
      },
    });
    agentUnderLead2Id = agent2.id;

    // 3. Create businesses in different areas
    const bWhitefield = await prisma.business.create({
      data: {
        code: `BZ-${timestamp}-WF`,
        name: 'Whitefield Tech',
        phone: `+9180${String(timestamp).slice(-7)}1`,
        area: 'Whitefield',
        city: 'Bengaluru',
      },
    });
    whitefieldBusinessId = bWhitefield.id;

    const bKoramangala = await prisma.business.create({
      data: {
        code: `BZ-${timestamp}-KM`,
        name: 'Koramangala Tech',
        phone: `+9180${String(timestamp).slice(-7)}2`,
        area: 'Koramangala',
        city: 'Bengaluru',
      },
    });
    koramangalaBusinessId = bKoramangala.id;

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule, AuthModule],
      controllers: [TestRbacController],
      providers: [
        RbacGuard,
        PiiMaskingInterceptor,
        JwtStrategy,
        {
          provide: APP_INTERCEPTOR,
          useClass: PiiMaskingInterceptor,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const jwt = moduleRef.get<JwtService>(JwtService);

    ceoToken = await jwt.signAsync({ sub: 'ceo-1', role: 'ceo', email: 'ceo@laboura.local', code: 'CEO-01' });
    managerToken = await jwt.signAsync({ sub: 'mgr-1', role: 'manager', email: 'mgr@laboura.local', code: 'MGR-01' });
    callAgentToken = await jwt.signAsync({ sub: agent1.id, role: 'call_agent', email: agent1.email, code: agent1.code });
    fieldAgentToken = await jwt.signAsync({
      sub: 'fa-1',
      role: 'field_agent',
      email: 'fa@laboura.local',
      code: 'FA-01',
      area: 'Koramangala',
    });
    financeToken = await jwt.signAsync({ sub: 'fin-1', role: 'finance', email: 'fin@laboura.local', code: 'FIN-01' });
    teamLead1Token = await jwt.signAsync({ sub: lead1.id, role: 'team_lead', email: lead1.email, code: lead1.code });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.business.deleteMany({
      where: { id: { in: [whitefieldBusinessId, koramangalaBusinessId] } },
    });
    await prisma.staff.deleteMany({
      where: { id: { in: [agentUnderLead1Id, agentUnderLead2Id, teamLead1Id, teamLead2Id] } },
    });
    if (app) {
      await app.close();
    }
    await prisma.$disconnect();
  });

  it('a call_agent token on a finance endpoint → 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/test-rbac/finance')
      .set('Authorization', `Bearer ${callAgentToken}`);

    expect(res.status).toBe(403);
  });

  it('a field_agent requesting another area business → 403', async () => {
    // field agent is in Koramangala; requesting Whitefield business
    const res = await request(app.getHttpServer())
      .get(`/test-rbac/business/${whitefieldBusinessId}`)
      .set('Authorization', `Bearer ${fieldAgentToken}`);

    expect(res.status).toBe(403);
  });

  it('a field_agent requesting their own area business → 200', async () => {
    // field agent is in Koramangala; requesting Koramangala business
    const res = await request(app.getHttpServer())
      .get(`/test-rbac/business/${koramangalaBusinessId}`)
      .set('Authorization', `Bearer ${fieldAgentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(koramangalaBusinessId);
  });

  it('a team_lead requesting another team agent → 403', async () => {
    // teamLead1 requesting agentUnderLead2
    const res = await request(app.getHttpServer())
      .get(`/test-rbac/staff/${agentUnderLead2Id}`)
      .set('Authorization', `Bearer ${teamLead1Token}`);

    expect(res.status).toBe(403);
  });

  it('a team_lead requesting own team agent → 200', async () => {
    // teamLead1 requesting agentUnderLead1
    const res = await request(app.getHttpServer())
      .get(`/test-rbac/staff/${agentUnderLead1Id}`)
      .set('Authorization', `Bearer ${teamLead1Token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(agentUnderLead1Id);
  });

  it('a finance token reading a job seeker → 200, but phone is masked', async () => {
    const res = await request(app.getHttpServer())
      .get('/test-rbac/job-seeker')
      .set('Authorization', `Bearer ${financeToken}`);

    expect(res.status).toBe(200);
    expect(res.body.code).toBe('JS-04821');
    expect(res.body.minSalary).toBe(1800000);
    expect(res.body.tradeSkill).toBe('Electrician');
    // PII masked:
    expect(res.body.phone).toBe('********');
    expect(res.body.kycReference).toBe('********');
    expect(res.body.phone).not.toContain('9876543210');
  });

  it('a non-finance token reading a job seeker receives unmasked phone', async () => {
    const res = await request(app.getHttpServer())
      .get('/test-rbac/job-seeker')
      .set('Authorization', `Bearer ${ceoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.phone).toBe('+919876543210');
    expect(res.body.kycReference).toBe('KYC-VENDOR-REF-9988');
  });

  it('a ceo token on a pricing endpoint → 200; a manager token → 403', async () => {
    // CEO can write to pricing
    const ceoRes = await request(app.getHttpServer())
      .post('/test-rbac/pricing')
      .set('Authorization', `Bearer ${ceoToken}`);

    expect(ceoRes.status).toBe(201); // default POST status

    // Manager is denied write to pricing
    const managerRes = await request(app.getHttpServer())
      .post('/test-rbac/pricing')
      .set('Authorization', `Bearer ${managerToken}`);

    expect(managerRes.status).toBe(403);
  });
});
