import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';

describe('Phase 4 Task 4: Anti-Fraud Controls on Business Visits', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otpService: OtpService;

  let fieldAgentKoramangalaToken: string;
  let fieldAgentIndiranagarToken: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';

  // Koramangala coordinates
  const KORA_LAT = 12.9352;
  const KORA_LON = 77.6245;

  // Nearby coordinates (~15m away, well within 500m geofence)
  const KORA_NEAR_LAT = 12.9353;
  const KORA_NEAR_LON = 77.6246;

  // Indiranagar coordinates (~5.1km away, far outside 500m geofence)
  const INDI_FAR_LAT = 12.9784;
  const INDI_FAR_LON = 77.6408;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    otpService = app.get<OtpService>(OtpService);
    const passwordHash = await bcrypt.hash(password, 10);

    const faKora = await prisma.staff.create({
      data: {
        code: `FA-AFKORA-${timestamp}`,
        name: 'Field Agent Kora AntiFraud',
        email: `fa_afkora_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: 'Koramangala',
        city: 'Bengaluru',
      },
    });

    const faIndi = await prisma.staff.create({
      data: {
        code: `FA-AFINDI-${timestamp}`,
        name: 'Field Agent Indi AntiFraud',
        email: `fa_afindi_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        area: 'Indiranagar',
        city: 'Bengaluru',
      },
    });

    const server = app.getHttpServer();
    const login = async (email: string) => {
      const res = await enrolledLogin(server, { email, password });
      return res.body.accessToken;
    };

    fieldAgentKoramangalaToken = await login(faKora.email);
    fieldAgentIndiranagarToken = await login(faIndi.email);
  });

  afterAll(async () => {
    await app.close();
  });

  async function getVerifiedOtp(phone: string): Promise<string> {
    const otpRes = await otpService.sendOtp(phone);
    const mockProvider = otpService.getProvider() as unknown as MockOtpProvider;
    const code = mockProvider.getCode(otpRes.requestId)!;
    await otpService.verifyOtp(otpRes.requestId, code);
    return otpRes.requestId;
  }

  it('allows business creation within geofence without setting geofenceFlag', async () => {
    const phone = `93${timestamp.toString().slice(-8)}1`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        name: 'Safe Cafe Koramangala',
        address: '100 80ft Road, Koramangala',
        phone,
        otpRequestId,
        latitude: KORA_LAT,
        longitude: KORA_LON,
        visitLatitude: KORA_NEAR_LAT,
        visitLongitude: KORA_NEAR_LON,
        selfieUrl: 'https://cdn.laboura.local/selfies/safe1.jpg',
        selfieHash: `hash-safe-${timestamp}`,
      })
      .expect(201);

    expect(res.body.geofenceFlag).toBe(false);
    expect(res.body.selfieHash).toBe(`hash-safe-${timestamp}`);

    // Verify BusinessVisit was persisted
    const visits = await prisma.businessVisit.findMany({
      where: { businessId: res.body.id },
    });
    expect(visits.length).toBe(1);
    expect(visits[0].geofenceFlag).toBe(false);
  });

  it('flags rather than blocks business creation when visit is outside geofence radius', async () => {
    const phone = `93${timestamp.toString().slice(-8)}2`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        name: 'Mismatched Geofence Retail',
        address: '50 4th Block, Koramangala',
        phone,
        otpRequestId,
        latitude: KORA_LAT,
        longitude: KORA_LON,
        visitLatitude: INDI_FAR_LAT,
        visitLongitude: INDI_FAR_LON,
        selfieUrl: 'https://cdn.laboura.local/selfies/mismatch1.jpg',
        selfieHash: `hash-mismatch-${timestamp}`,
      })
      .expect(201); // Created, not blocked!

    expect(res.body.geofenceFlag).toBe(true);

    // Verify BusinessVisit has geofenceFlag = true
    const visits = await prisma.businessVisit.findMany({
      where: { businessId: res.body.id },
    });
    expect(visits.length).toBe(1);
    expect(visits[0].geofenceFlag).toBe(true);

    // Check audit log for flags
    const auditLogs = await prisma.auditLog.findMany({
      where: { entityCode: res.body.code, action: 'business.created' },
    });
    expect(auditLogs.length).toBeGreaterThan(0);
    const afterData = auditLogs[0].after as { flags?: string[] };
    expect(afterData.flags).toContain('GEOFENCE_MISMATCH');
  });

  it('catches and rejects duplicate selfie image hash across businesses', async () => {
    const reusedHash = `hash-reused-${timestamp}`;

    // First business created with reusedHash
    const phone1 = `93${timestamp.toString().slice(-8)}3`;
    const otp1 = await getVerifiedOtp(phone1);

    await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        name: 'Original Selfie Business',
        phone: phone1,
        otpRequestId: otp1,
        selfieUrl: 'https://cdn.laboura.local/selfies/orig.jpg',
        selfieHash: reusedHash,
      })
      .expect(201);

    // Second business attempted with the SAME selfieHash -> rejected
    const phone2 = `93${timestamp.toString().slice(-8)}4`;
    const otp2 = await getVerifiedOtp(phone2);

    const res = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        name: 'Fraudulent Duplicate Selfie Business',
        phone: phone2,
        otpRequestId: otp2,
        selfieUrl: 'https://cdn.laboura.local/selfies/duplicate.jpg',
        selfieHash: reusedHash,
      })
      .expect(400);

    expect(res.body.message).toMatch(/duplicate selfie/i);
  });

  it('handles post-creation visit recording with geofence check and duplicate detection', async () => {
    const phone = `93${timestamp.toString().slice(-8)}5`;
    const otpRequestId = await getVerifiedOtp(phone);

    // Create business without visit
    const createRes = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        name: 'Follow-up Visit Business',
        phone,
        otpRequestId,
        latitude: KORA_LAT,
        longitude: KORA_LON,
      })
      .expect(201);

    const businessId = createRes.body.id;

    // Record visit outside geofence -> flags, not blocks
    const visitRes = await request(app.getHttpServer())
      .post(`/businesses/${businessId}/visits`)
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        latitude: INDI_FAR_LAT,
        longitude: INDI_FAR_LON,
        selfieUrl: 'https://cdn.laboura.local/selfies/visit1.jpg',
        selfieHash: `hash-visit-${timestamp}`,
      })
      .expect(201);

    expect(visitRes.body.geofenceFlag).toBe(true);

    // Reusing the same selfie on a different business visit -> rejected
    const phoneOther = `93${timestamp.toString().slice(-8)}6`;
    const otpOther = await getVerifiedOtp(phoneOther);

    const otherBizRes = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        name: 'Other Business For Visit Test',
        phone: phoneOther,
        otpRequestId: otpOther,
        latitude: KORA_LAT,
        longitude: KORA_LON,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/businesses/${otherBizRes.body.id}/visits`)
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        latitude: KORA_LAT,
        longitude: KORA_LON,
        selfieHash: `hash-visit-${timestamp}`, // Reused!
      })
      .expect(400);
  });

  it('rejects field agent recording a visit on a business in another area (403)', async () => {
    const phone = `93${timestamp.toString().slice(-8)}7`;
    const otpRequestId = await getVerifiedOtp(phone);

    const bizRes = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        name: 'Kora Area Business',
        phone,
        otpRequestId,
      })
      .expect(201);

    // Indiranagar field agent attempts to record visit on Koramangala business -> 403
    await request(app.getHttpServer())
      .post(`/businesses/${bizRes.body.id}/visits`)
      .set('Authorization', `Bearer ${fieldAgentIndiranagarToken}`)
      .send({
        latitude: INDI_FAR_LAT,
        longitude: INDI_FAR_LON,
      })
      .expect(403);
  });
});
