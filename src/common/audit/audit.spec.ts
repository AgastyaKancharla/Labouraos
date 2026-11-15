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
      await prisma.auditLog.deleteMany({ where: { actorId } });
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
    expect(log.before).toEqual({ status: 'active', hitCount: 2 });
    expect(log.after).toEqual({ status: 'deactivated', hitCount: 3 });
    expect(log.changedFields).toEqual(expect.arrayContaining(['status', 'hitCount']));

    // Clean up
    await prisma.auditLog.delete({ where: { id: log.id } });
  });

  it('ordinary status change keeps before/after status and records reason', async () => {
    const testCode = `JS-STATUS-${Date.now()}`;
    const log = await auditService.log({
      actorId,
      action: 'status_update',
      entityType: 'JobSeeker',
      entityCode: testCode,
      reason: 'Candidate completed verification',
      before: { status: 'pending_verification', feePaise: 49900 },
      after: { status: 'active', feePaise: 49900 },
    });

    expect(log.reason).toBe('Candidate completed verification');
    expect(log.before).toEqual({ status: 'pending_verification', feePaise: 49900 });
    expect(log.after).toEqual({ status: 'active', feePaise: 49900 });
    expect(log.changedFields).toEqual(['status']);

    await prisma.auditLog.delete({ where: { id: log.id } });
  });

  it('redacts top-level personal fields and populates changedFields while keeping codes, ids, statuses and amounts', async () => {
    const testCode = `JS-PII-${Date.now()}`;
    const log = await auditService.log({
      actorId,
      action: 'job_seeker.updated',
      entityType: 'JobSeeker',
      entityCode: testCode,
      before: {
        code: testCode,
        id: 'c1234567-0000-0000-0000-000000000001',
        name: 'Ravi Kumar',
        phone: '9876543210',
        whatsappPhone: '9876543210',
        contactPhone: '9876543210',
        email: 'ravi@example.com',
        address: '123 Indiranagar, Bengaluru',
        kycReference: 'KYC-REF-12345',
        kycDetails: { method: 'pan' },
        dateOfBirth: '1995-05-15',
        aadhaarNumber: '123456789012',
        aadhaarLast4: '9012',
        locality: 'Indiranagar',
        pincode: '560038',
        latitude: 12.9784,
        nameMatches: true,
        last4: '4242',
        status: 'active',
        amount: 49900,
      },
      after: {
        code: testCode,
        id: 'c1234567-0000-0000-0000-000000000001',
        name: 'Ravi K',
        phone: '9876543211',
        whatsappPhone: '9876543211',
        contactPhone: '9876543211',
        email: 'ravik@example.com',
        address: '456 Koramangala, Bengaluru',
        kycReference: 'KYC-REF-67890',
        kycDetails: { method: 'offline' },
        dateOfBirth: '1995-05-15',
        aadhaarNumber: '123456789012',
        aadhaarLast4: '9012',
        locality: 'Koramangala',
        pincode: '560034',
        latitude: 12.9352,
        nameMatches: false,
        last4: '5678',
        status: 'active',
        amount: 49900,
      },
    });

    const beforeObj = log.before as Record<string, unknown>;
    const afterObj = log.after as Record<string, unknown>;

    // Non-personal fields kept
    expect(beforeObj.code).toBe(testCode);
    expect(beforeObj.id).toBe('c1234567-0000-0000-0000-000000000001');
    expect(beforeObj.status).toBe('active');
    expect(beforeObj.amount).toBe(49900);
    expect(afterObj.status).toBe('active');
    expect(afterObj.amount).toBe(49900);

    // Personal fields redacted in both before and after
    expect(beforeObj.name).toBe('[changed]');
    expect(beforeObj.phone).toBe('[changed]');
    expect(beforeObj.whatsappPhone).toBe('[changed]');
    expect(beforeObj.contactPhone).toBe('[changed]');
    expect(beforeObj.email).toBe('[changed]');
    expect(beforeObj.address).toBe('[changed]');
    expect(beforeObj.kycReference).toBe('[changed]');
    expect(beforeObj.kycDetails).toBe('[changed]');
    expect(beforeObj.dateOfBirth).toBe('[changed]');
    expect(beforeObj.aadhaarNumber).toBe('[changed]');
    expect(beforeObj.aadhaarLast4).toBe('[changed]');
    expect(beforeObj.locality).toBe('[changed]');
    expect(beforeObj.pincode).toBe('[changed]');
    expect(beforeObj.latitude).toBe('[changed]');
    expect(beforeObj.nameMatches).toBe('[changed]');
    expect(beforeObj.last4).toBe('[changed]');

    expect(afterObj.name).toBe('[changed]');
    expect(afterObj.phone).toBe('[changed]');
    expect(afterObj.whatsappPhone).toBe('[changed]');
    expect(afterObj.contactPhone).toBe('[changed]');
    expect(afterObj.email).toBe('[changed]');
    expect(afterObj.address).toBe('[changed]');
    expect(afterObj.kycReference).toBe('[changed]');
    expect(afterObj.kycDetails).toBe('[changed]');
    expect(afterObj.dateOfBirth).toBe('[changed]');
    expect(afterObj.aadhaarNumber).toBe('[changed]');
    expect(afterObj.aadhaarLast4).toBe('[changed]');
    expect(afterObj.locality).toBe('[changed]');
    expect(afterObj.pincode).toBe('[changed]');
    expect(afterObj.latitude).toBe('[changed]');
    expect(afterObj.nameMatches).toBe('[changed]');
    expect(afterObj.last4).toBe('[changed]');

    // Raw values are nowhere in the row
    const rowJson = JSON.stringify(log);
    expect(rowJson).not.toContain('Ravi Kumar');
    expect(rowJson).not.toContain('9876543210');
    expect(rowJson).not.toContain('ravi@example.com');
    expect(rowJson).not.toContain('123 Indiranagar');
    expect(rowJson).not.toContain('KYC-REF-12345');
    expect(rowJson).not.toContain('123456789012');

    // changedFields populated
    expect(log.changedFields).toEqual(
      expect.arrayContaining([
        'name',
        'phone',
        'whatsappPhone',
        'contactPhone',
        'email',
        'address',
        'kycReference',
        'kycDetails',
        'dateOfBirth',
        'aadhaarNumber',
        'aadhaarLast4',
      ]),
    );

    await prisma.auditLog.delete({ where: { id: log.id } });
  });

  it('redacts nested personal fields at any depth', async () => {
    const testCode = `JS-NESTED-${Date.now()}`;
    const log = await auditService.log({
      actorId,
      action: 'candidate.nested_update',
      entityType: 'JobSeeker',
      entityCode: testCode,
      before: {
        meta: {
          candidate: {
            ownerName: 'Sunita Sharma',
            candidatePhone: '9123456780',
          },
        },
        trade: 'Plumber',
      },
      after: {
        meta: {
          candidate: {
            ownerName: 'Sunita S',
            candidatePhone: '9123456789',
          },
        },
        trade: 'Plumber',
      },
    });

    const beforeObj = log.before as Record<string, unknown>;
    const afterObj = log.after as Record<string, unknown>;

    expect(beforeObj.trade).toBe('Plumber');
    expect(afterObj.trade).toBe('Plumber');

    const beforeMeta = beforeObj.meta as { candidate: { ownerName: string; candidatePhone: string } };
    const afterMeta = afterObj.meta as { candidate: { ownerName: string; candidatePhone: string } };

    expect(beforeMeta.candidate.ownerName).toBe('[changed]');
    expect(beforeMeta.candidate.candidatePhone).toBe('[changed]');
    expect(afterMeta.candidate.ownerName).toBe('[changed]');
    expect(afterMeta.candidate.candidatePhone).toBe('[changed]');

    const rowJson = JSON.stringify(log);
    expect(rowJson).not.toContain('Sunita Sharma');
    expect(rowJson).not.toContain('9123456780');

    expect(log.changedFields).toEqual(
      expect.arrayContaining(['ownerName', 'candidatePhone']),
    );

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
