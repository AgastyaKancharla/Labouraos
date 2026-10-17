import {
  Controller,
  INestApplication,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaModule } from '../prisma/prisma.module';
import { IdModule } from '../id/id.module';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../rbac/rbac.guard';
import { RequirePermission } from '../rbac/permissions.decorator';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audit.interceptor';
import { AuditAction } from './audit.decorator';
import { AuditModule } from './audit.module';
import { JwtService } from '@nestjs/jwt';

@Controller('test-sensitive')
@UseGuards(JwtAuthGuard, RbacGuard)
@UseInterceptors(AuditInterceptor)
class TestSensitiveController {
  @Post('placement')
  @RequirePermission('placement', 'write')
  @AuditAction('placement_created', 'Placement')
  createPlacement(
    @Body() body: { code: string; placementFee: number; before?: Record<string, unknown> },
  ) {
    return {
      code: body.code,
      placementFee: body.placementFee,
      status: 'active',
    };
  }
}

describe('Audit Logging', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auditService: AuditService;
  let ceoToken: string;
  let actorId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    // Create staff member to satisfy Foreign Key on actorId
    const ceoStaff = await prisma.staff.create({
      data: {
        code: `CEO-AUD-${Date.now()}`,
        name: 'CEO Auditor',
        email: `ceo_audit_${Date.now()}@laboura.local`,
        passwordHash: 'hash',
        role: 'ceo',
        city: 'Bengaluru',
      },
    });
    actorId = ceoStaff.id;

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule, IdModule, AuthModule, AuditModule],
      controllers: [TestSensitiveController],
      providers: [RbacGuard, AuditInterceptor],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    auditService = moduleRef.get<AuditService>(AuditService);
    const jwt = moduleRef.get<JwtService>(JwtService);

    ceoToken = await jwt.signAsync({
      sub: actorId,
      role: 'ceo',
      email: ceoStaff.email,
      code: ceoStaff.code,
    });
  });

  afterAll(async () => {
    if (actorId) {
      await prisma.staff.delete({ where: { id: actorId } });
    }
    if (app) {
      await app.close();
    }
    await prisma.$disconnect();
  });

  it('perform a sensitive write, assert exactly one audit row with correct before/after', async () => {
    const testCode = `PL-TEST-${Date.now()}`;
    const beforeVal = { status: 'pending', placementFee: 0 };

    const res = await request(app.getHttpServer())
      .post('/test-sensitive/placement')
      .set('Authorization', `Bearer ${ceoToken}`)
      .send({
        code: testCode,
        placementFee: 1500000,
        before: beforeVal,
      });

    expect(res.status).toBe(201);

    // Give a short grace period for the interceptor async log to finish
    await new Promise((r) => setTimeout(r, 100));

    // Assert exactly one audit row exists for this entityCode
    const auditRows = await prisma.auditLog.findMany({
      where: { entityCode: testCode },
    });

    expect(auditRows).toHaveLength(1);
    const row = auditRows[0];

    expect(row.actorId).toBe(actorId);
    expect(row.action).toBe('placement_created');
    expect(row.entityType).toBe('Placement');
    expect(row.entityCode).toBe(testCode);
    expect(row.before).toEqual(beforeVal);
    expect(row.after).toMatchObject({
      code: testCode,
      placementFee: 1500000,
      status: 'active',
    });
    expect(row.createdAt).toBeInstanceOf(Date);

    // Clean up
    await prisma.auditLog.delete({ where: { id: row.id } });
  });

  it('service wrapper logs audit records directly', async () => {
    const testCode = `JS-DEACT-${Date.now()}`;
    const log = await auditService.log({
      actorId,
      action: 'deactivation',
      entityType: 'JobSeeker',
      entityCode: testCode,
      before: { status: 'active', hitCount: 2 },
      after: { status: 'deactivated', hitCount: 3 },
    });

    expect(log).toBeDefined();
    expect(log.code).toMatch(/^AUD-\d{5,}$/);
    expect(log.action).toBe('deactivation');
    expect(log.entityType).toBe('JobSeeker');
    expect(log.entityCode).toBe(testCode);

    // Clean up
    await prisma.auditLog.delete({ where: { id: log.id } });
  });

  it('asserts there is no route that mutates an existing audit row', async () => {
    const server = app.getHttpServer();

    // Attempt PUT on audit logs
    const putRes = await request(server).put('/audit-logs/sample-id').send({ action: 'tampered' });
    expect(putRes.status).toBe(404);

    // Attempt PATCH on audit logs
    const patchRes = await request(server).patch('/audit-logs/sample-id').send({ action: 'tampered' });
    expect(patchRes.status).toBe(404);

    // Attempt DELETE on audit logs
    const deleteRes = await request(server).delete('/audit-logs/sample-id');
    expect(deleteRes.status).toBe(404);
  });
});
