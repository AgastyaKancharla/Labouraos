import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';

import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { enrolledLogin } from '../../test-support/enrolled-login-spec';
import { maskPhoneLast4 } from '../../common/rbac/pii-masking.interceptor';

describe('Phase 4 Task 1: Business Onboarding', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let otpService: OtpService;

  let fieldAgentKoramangalaToken: string;
  let fieldAgentIndiranagarToken: string;
  let callAgentToken: string;
  let managerToken: string;

  let faKoramangalaId: string;
  let faIndiranagarId: string;
  let callAgentId: string;
  let managerId: string;

  const timestamp = Date.now();
  const password = 'Password123!Secure';

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
        code: `FA-KORA-${timestamp}`,
        name: 'Field Agent Koramangala',
        email: `fa_kora_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        city: 'Bengaluru',
      },
    });
    faKoramangalaId = faKora.id;

    const faIndi = await prisma.staff.create({
      data: {
        code: `FA-INDI-${timestamp}`,
        name: 'Field Agent Indiranagar',
        email: `fa_indi_${timestamp}@laboura.local`,
        passwordHash,
        role: 'field_agent',
        city: 'Bengaluru',
      },
    });
    faIndiranagarId = faIndi.id;

    const ca = await prisma.staff.create({
      data: {
        code: `CA-BIZ-${timestamp}`,
        name: 'Call Agent Biz',
        email: `ca_biz_${timestamp}@laboura.local`,
        passwordHash,
        role: 'call_agent',
        city: 'Bengaluru',
      },
    });
    callAgentId = ca.id;

    const mgr = await prisma.staff.create({
      data: {
        code: `MG-BIZ-${timestamp}`,
        name: 'Manager Biz',
        email: `mgr_biz_${timestamp}@laboura.local`,
        passwordHash,
        role: 'manager',
        city: 'Bengaluru',
      },
    });
    managerId = mgr.id;

    const server = app.getHttpServer();
    const login = async (email: string | null) => {
      const res = await enrolledLogin(server, { email, password });
      return res.body.accessToken;
    };

    fieldAgentKoramangalaToken = await login(faKora.email);
    fieldAgentIndiranagarToken = await login(faIndi.email);
    callAgentToken = await login(ca.email);
    managerToken = await login(mgr.email);
  });

  afterAll(async () => {
    if (prisma) {
      // Numbers are saved as +91 and 10 digits; clean up both spellings.
      const typedPhones = [
        `91${timestamp.toString().slice(-8)}`,
        `92${timestamp.toString().slice(-8)}`,
        `93${timestamp.toString().slice(-8)}`,
        `94${timestamp.toString().slice(-8)}`,
        `95${timestamp.toString().slice(-8)}`,
        `96${timestamp.toString().slice(-8)}`,
        `97${timestamp.toString().slice(-8)}`,
        `98${timestamp.toString().slice(-8)}`,
        `99${timestamp.toString().slice(-8)}`,
        `90${timestamp.toString().slice(-8)}`,
        `89${timestamp.toString().slice(-8)}`,
        `75${timestamp.toString().slice(-8)}`,
        `72${timestamp.toString().slice(-8)}`,
        `71${timestamp.toString().slice(-8)}`,
        `73${timestamp.toString().slice(-8)}`,
      ];
      await prisma.area.deleteMany({ where: { nameKey: { startsWith: `gps area ${timestamp}` } } });
      await prisma.business.deleteMany({
        where: { phone: { in: [...typedPhones, ...typedPhones.map((phone) => `+91${phone}`)] } },
      });
      await prisma.auditLog.deleteMany({
        where: {
          actorId: { in: [faKoramangalaId, faIndiranagarId, callAgentId, managerId] },
        },
      });
      await prisma.staff.deleteMany({
        where: {
          id: { in: [faKoramangalaId, faIndiranagarId, callAgentId, managerId] },
        },
      });
    }
    if (app) {
      await app.close();
    }
  });

  const getVerifiedOtp = async (phone: string) => {
    const sendRes = await otpService.sendOtp(phone);
    const mockProvider = otpService.getProvider() as MockOtpProvider;
    const code = mockProvider.getCode(sendRes.requestId)!;
    await otpService.verifyOtp(sendRes.requestId, code);
    return sendRes.requestId;
  };

  it('rejects business registration if OTP is missing or unverified', async () => {
    const phone = `91${timestamp.toString().slice(-8)}`;

    const resNoOtp = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'No OTP Cafe',
        phone,
        locality: 'Koramangala',
        contactPersonName: 'Asha Rao',
        contactPersonRole: 'owner', heardFrom: 'field_visit',
      });
    expect(resNoOtp.status).toBe(400);

    const resUnverifiedOtp = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Unverified Cafe',
        phone,
        otpRequestId: 'random_unverified_request_id',
        locality: 'Koramangala',
        contactPersonName: 'Asha Rao',
        contactPersonRole: 'owner', heardFrom: 'field_visit',
      });
    expect(resUnverifiedOtp.status).toBe(400);
  });

  it('requires how they heard about Laboura', async () => {
    const phone = `71${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);
    const response = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ name: 'No Source Cafe', phone, otpRequestId, locality: 'Koramangala', contactPersonName: 'Asha Rao', contactPersonRole: 'owner' });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('heardFrom is required');
    const bad = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ name: 'Bad Source Cafe', phone, otpRequestId, locality: 'Koramangala', contactPersonName: 'Asha Rao', contactPersonRole: 'owner', heardFrom: 'telepathy' });
    expect(bad.status).toBe(400);
  });

  it('fills the area from the map pin (nearest area) when none was picked', async () => {
    const lat = 12.0123;
    const lng = 76.0123;
    await prisma.area.create({ data: { name: `GPS Area ${timestamp}`, nameKey: `gps area ${timestamp}`, latitude: lat, longitude: lng, active: true } });
    await prisma.area.create({ data: { name: `GPS Area ${timestamp} Far`, nameKey: `gps area ${timestamp} far`, latitude: lat + 0.05, longitude: lng + 0.05, active: true } });
    const phone = `73${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);
    const response = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ name: 'Pin Only Cafe', phone, otpRequestId, contactPersonName: 'Asha Rao', contactPersonRole: 'owner', heardFrom: 'ad', businessLatitude: lat + 0.001, businessLongitude: lng + 0.001 });
    expect(response.status).toBe(201);
    const saved = await prisma.business.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(saved.locality).toBe(`GPS Area ${timestamp}`);
  });

  it('requires a contact person role for a new business registration', async () => {
    const response = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ name: 'Contact Role Required', phone: `96${timestamp.toString().slice(-8)}`, contactPersonName: 'Asha Rao' });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Contact person role');
  });

  it('creates OTP-verified branch contacts and draft vacancies from staff-needed rows', async () => {
    const phone = `97${timestamp.toString().slice(-8)}`;
    const branchPhone = `98${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);
    const branchOtpRequestId = await getVerifiedOtp(branchPhone);
    const response = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        name: 'Branch Test Cafe', phone, otpRequestId,
        contactPersonName: 'Asha Rao', contactPersonRole: 'owner', heardFrom: 'field_visit',
        businessType: 'restaurant_hotel', locality: 'Koramangala',
        branches: [{
          name: 'Whitefield outlet', locality: 'Whitefield', contactPersonName: 'Ravi Rao',
          contactPersonRole: 'manager', contactPersonPhone: branchPhone, otpRequestId: branchOtpRequestId,
        }],
        staffNeededRows: [
          { trade: 'Cook', headcount: 2, salaryMinPaise: 1800000, salaryMaxPaise: 2500000, shift: 'day', startDate: '2026-12-01' },
          { trade: `Banner tailor ${timestamp}`, branchName: 'Whitefield outlet', headcount: 1, salaryMinPaise: 1500000, salaryMaxPaise: 1800000, shift: 'day', startDate: '2026-12-02' },
        ],
      }).expect(201);

    expect(response.body.branches).toHaveLength(1);
    expect(response.body.vacancies).toHaveLength(2);
    const cook = response.body.vacancies.find((row: { tradeSkill: string }) => row.tradeSkill === 'Cook');
    const other = response.body.vacancies.find((row: { tradeSkill: string }) => row.tradeSkill.startsWith('Banner tailor'));
    expect(cook).toMatchObject({ status: 'draft', headcount: 2, branchId: null });
    const storedBranch = await prisma.businessBranch.findFirst({ where: { businessId: response.body.id } });
    expect(other).toMatchObject({ status: 'draft', branchId: storedBranch?.id });
    expect(await prisma.tradeSuggestionSubject.count({ where: { subjectId: cook.id } })).toBe(0);
    expect(await prisma.tradeSuggestionSubject.count({ where: { subjectId: other.id } })).toBe(1);
    await prisma.tradeSuggestionSubject.deleteMany({ where: { subjectId: other.id } });
    await prisma.tradeSuggestion.deleteMany({ where: { typedName: `Banner tailor ${timestamp}` } });
    expect(storedBranch?.contactPersonPhone).toBe(`+91${branchPhone}`);
    const duplicateOtp = await otpService.sendOtp(branchPhone, 'branch_contact', faKoramangalaId, 'field_agent');
    expect(duplicateOtp).toMatchObject({ alreadyRegistered: true, type: 'business', code: response.body.code });
  });

  it('stores household family name without legal or licensing documents', async () => {
    const phone = `99${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);
    const response = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        name: 'Rao Household', businessType: 'household', familyName: 'Rao', phone, otpRequestId,
        contactPersonName: 'Asha Rao', contactPersonRole: 'owner', heardFrom: 'field_visit', gstNumber: '29ABCDE1234F1Z5',
      });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('cannot provide GST or licence');

    const cleanPhone = `90${timestamp.toString().slice(-8)}`;
    const cleanOtpRequestId = await getVerifiedOtp(cleanPhone);
    const valid = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        name: 'Rao Household', businessType: 'household', familyName: 'Rao', phone: cleanPhone, otpRequestId: cleanOtpRequestId,
        contactPersonName: 'Asha Rao', contactPersonRole: 'owner', heardFrom: 'field_visit',
      }).expect(201);
    expect(valid.body.familyName).toBe('Rao');
    expect(valid.body.legalName).toBeNull();
    expect(valid.body.gstNumber).toBeNull();
    expect(valid.body.licenceNumber).toBeNull();
    expect(valid.body.pan).toBeNull();
    expect(valid.body.fssaiNumber).toBeNull();
    expect(valid.body.documentsStatus).toBe('no_documents');
  });

  it('requires a contact person name and stores a no-documents business without licence numbers', async () => {
    const missingName = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({ name: 'No Contact Name', phone: `89${timestamp.toString().slice(-8)}`, contactPersonRole: 'owner', heardFrom: 'field_visit' });
    expect(missingName.status).toBe(400);
    expect(missingName.body.message).toContain('Contact person name');

    const phone = `96${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);
    const refused = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Documents Refused', phone, otpRequestId, contactPersonName: 'Asha Rao', contactPersonRole: 'owner', heardFrom: 'field_visit',
        noDocuments: true, gstNumber: '29ABCDE1234F1Z5',
      });
    expect(refused.status).toBe(400);

    const cleanPhone = `89${timestamp.toString().slice(-8)}`;
    const cleanOtp = await getVerifiedOtp(cleanPhone);
    const saved = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'No Papers Cafe', phone: cleanPhone, otpRequestId: cleanOtp,
        contactPersonName: 'Asha Rao', contactPersonRole: 'manager',
        contactWhatsAppPhone: cleanPhone, contactLanguage: 'en',
        businessType: 'bakery', legalName: 'No Papers Cafe LLP',
        employeeCountBand: '6-20', yearsInOperationBand: '3_10', hiringFrequency: 'every_month',
        openingTime: '09:00', closingTime: '21:00', workingDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
        shopNumber: '12', street: '100 Feet Road', landmark: 'Near the metro', locality: 'Indiranagar', pincode: '560038',
        billingEmail: 'accounts@nopapers.example', heardFrom: 'walk_in', noDocuments: true,
      }).expect(201);
    expect(saved.body).toMatchObject({
      documentsStatus: 'no_documents', gstNumber: null, fssaiNumber: null, pan: null,
      legalName: 'No Papers Cafe LLP', employeeCountBand: '6-20', yearsInOperationBand: '3_10', hiringFrequency: 'every_month',
      openingTime: '09:00', closingTime: '21:00', pincode: '560038', billingEmail: 'accounts@nopapers.example',
      heardFrom: 'walk_in', contactLanguage: 'en', contactPersonRole: 'manager',
    });
    expect(saved.body.workingDays).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
  });

  it('rejects years-running and hiring-frequency values outside the design lists', async () => {
    for (const [field, value] of [['yearsInOperationBand', '3-5'], ['hiringFrequency', 'monthly']] as const) {
      const phone = `87${(timestamp + value.length).toString().slice(-8)}`;
      const otpRequestId = await getVerifiedOtp(phone);
      const res = await request(app.getHttpServer())
        .post('/businesses')
        .set('Authorization', `Bearer ${callAgentToken}`)
        .send({
          name: `Band Check ${field}`, phone, otpRequestId, contactPersonName: 'Asha Rao', contactPersonRole: 'owner', heardFrom: 'field_visit',
          locality: 'Indiranagar', [field]: value,
        });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain(field);
    }
  });

  it('field agent creates a business without writing the deprecated area or contact fields', async () => {
    const phone = `92${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        name: 'Koramangala Bakers',
        address: '80 Feet Road, 4th Block',
        contactPerson: 'Ramesh Patel',
        contactPersonRole: 'owner', heardFrom: 'field_visit',
        locality: 'Koramangala',
        phone,
        otpRequestId,
        gstNumber: '29ABCDE1234F1Z5',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.code).toMatch(/^BZ-\d{5}$/);
    expect(res.body.name).toBe('Koramangala Bakers');
    expect(res.body.locality).toBe('Koramangala');
    expect(res.body.phone).toBe(maskPhoneLast4(phone));
    const storedBusiness = await prisma.business.findUnique({ where: { id: res.body.id } });
    expect(storedBusiness?.phone).toBe(`+91${phone}`);
    expect(res.body.additionalContactName).toBe('Ramesh Patel');
    expect(res.body.gstNumber).toBe('29ABCDE1234F1Z5');
    expect(res.body.phoneVerified).toBe(true);

    // Assert audit log
    const audit = await prisma.auditLog.findFirst({
      where: {
        entityCode: res.body.code,
        action: 'business.created',
      },
    });
    expect(audit).toBeDefined();
    expect(audit?.actorId).toBe(faKoramangalaId);
  });

  it('field agent can create a lead in any locality without writing a legacy area', async () => {
    const phone = `93${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        name: 'Indiranagar Boutique',
        address: '100 Feet Road',
        contactPerson: 'Sunita Rao',
        contactPersonRole: 'manager', heardFrom: 'field_visit',
        phone,
        otpRequestId,
        locality: 'Indiranagar',
      });

    expect(res.status).toBe(201);
    expect(res.body.locality).toBe('Indiranagar');
    expect(res.body.area).toBeFalsy();
    expect(res.body.leadCreatedByStaffId).toBe(faKoramangalaId);
  });

  it('field agents can read any business regardless of locality, as can call agents and managers', async () => {
    // 1. Create a business in Indiranagar by Indiranagar field agent
    const phoneIndi = `94${timestamp.toString().slice(-8)}`;
    const otpIndi = await getVerifiedOtp(phoneIndi);

    const createRes = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentIndiranagarToken}`)
      .send({
        name: 'Indiranagar Tech Labs',
        address: '12th Main Indiranagar',
        contactPerson: 'Deepak Verma',
        contactPersonRole: 'hr', heardFrom: 'field_visit',
        phone: phoneIndi,
        otpRequestId: otpIndi,
      });

    expect(createRes.status).toBe(201);
    const indiranagarBusinessId = createRes.body.id;

    // 2. A field agent can read the business regardless of locality.
    const koraAgentReadRes = await request(app.getHttpServer())
      .get(`/businesses/${indiranagarBusinessId}`)
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`);
    expect(koraAgentReadRes.status).toBe(200);
    expect(koraAgentReadRes.body.id).toBe(indiranagarBusinessId);

    // 3. Field agents can read the city-wide business list.
    const koraListRes = await request(app.getHttpServer())
      .get('/businesses')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`);
    expect(koraListRes.status).toBe(200);
    const found = koraListRes.body.find((b: { id: string }) => b.id === indiranagarBusinessId);
    expect(found).toBeDefined();

    // 4. Call agent can read any business regardless of area
    const caReadRes = await request(app.getHttpServer())
      .get(`/businesses/${indiranagarBusinessId}`)
      .set('Authorization', `Bearer ${callAgentToken}`);
    expect(caReadRes.status).toBe(200);
    expect(caReadRes.body.name).toBe('Indiranagar Tech Labs');

    // 5. Manager can read any business
    const mgrReadRes = await request(app.getHttpServer())
      .get(`/businesses/${indiranagarBusinessId}`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(mgrReadRes.status).toBe(200);
    expect(mgrReadRes.body.name).toBe('Indiranagar Tech Labs');
  });

  it('call agent can create a business in any area', async () => {
    const phone = `95${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);

    const res = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Whitefield Logistics Hub',
        address: 'ITPL Main Road',
        contactPerson: 'Anil Deshmukh',
        contactPersonRole: 'supervisor', heardFrom: 'field_visit',
        phone,
        otpRequestId,
        locality: 'Whitefield',
      });

    expect(res.status).toBe(201);
    expect(res.body.area).toBeFalsy();
    expect(res.body.locality).toBe('Whitefield');
    expect(res.body.code).toMatch(/^BZ-\d{5}$/);
  });

  it('loads an old business with the contact filled from the owner fields', async () => {
    const created = await prisma.business.create({
      data: {
        code: `BZ-OLD-${timestamp}`,
        name: 'Old Owner Cafe',
        phone: `91${timestamp.toString().slice(-8)}`,
        ownerName: 'Old Owner',
        city: 'Bengaluru',
      },
    });
    const response = await request(app.getHttpServer())
      .get(`/businesses/${created.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    expect(response.body.contactPersonName).toBe('Old Owner');
    expect(response.body.contactPersonRole).toBe('owner');
    expect(response.body.additionalContactName).toBe('Old Owner');
    // Only the CEO sees full numbers; a Manager gets the last 4 digits.
    expect(response.body.additionalContactPhone).toBe(`******${timestamp.toString().slice(-4)}`);
  });

  it('makes the registering field agent the account agent, copies draft pins, and lets them complete the draft', async () => {
    const phone = `75${timestamp.toString().slice(-8)}`;
    const branchPhone = `74${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);
    const branchOtpRequestId = await getVerifiedOtp(branchPhone);
    const shop = { latitude: 12.9716, longitude: 77.5946 };
    const branchPin = { latitude: 12.9254, longitude: 77.5938 };
    const response = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({
        name: 'Account Agent Bakery', phone, otpRequestId,
        contactPersonName: 'Ravi Rao', contactPersonRole: 'owner', heardFrom: 'field_visit',
        businessType: 'bakery', locality: 'Indiranagar',
        latitude: shop.latitude, longitude: shop.longitude,
        branches: [{
          name: 'Jayanagar counter', locality: 'Jayanagar',
          latitude: branchPin.latitude, longitude: branchPin.longitude,
          contactPersonName: 'Lakshmi Rao', contactPersonRole: 'manager',
          contactPersonPhone: branchPhone, otpRequestId: branchOtpRequestId,
        }],
        staffNeededRows: [
          {
            trade: 'Housekeeping', branchName: 'Jayanagar counter', headcount: 1,
            salaryMinPaise: 2000000, salaryMaxPaise: 2500000, shift: 'day', startDate: '2026-12-01',
          },
          {
            trade: 'Cook', headcount: 1,
            salaryMinPaise: 2500000, salaryMaxPaise: 3000000, shift: 'day', startDate: '2026-12-01',
          },
        ],
      })
      .expect(201);

    expect(response.body.accountAgentId).toBe(faKoramangalaId);
    const stored = await prisma.business.findUnique({ where: { id: response.body.id } });
    expect(stored?.accountAgentId).toBe(faKoramangalaId);
    expect(stored?.accountAgentAssignedAt).toBeInstanceOf(Date);
    const branchDraft = response.body.vacancies.find((row: { tradeSkill: string }) => row.tradeSkill === 'Housekeeping');
    const shopDraft = response.body.vacancies.find((row: { tradeSkill: string }) => row.tradeSkill === 'Cook');
    expect(branchDraft).toMatchObject({ branchId: response.body.branches[0].id, ...branchPin });
    expect(shopDraft).toMatchObject({ branchId: null, ...shop });

    const completed = await request(app.getHttpServer())
      .post(`/vacancies/${shopDraft.id}/submit-for-confirmation`)
      .set('Authorization', `Bearer ${fieldAgentKoramangalaToken}`)
      .send({})
      .expect(201);
    expect(completed.body.status).toBe('awaiting_confirmation');
  });

  it('leaves a call agent registration without an account agent', async () => {
    const phone = `72${timestamp.toString().slice(-8)}`;
    const otpRequestId = await getVerifiedOtp(phone);
    const response = await request(app.getHttpServer())
      .post('/businesses')
      .set('Authorization', `Bearer ${callAgentToken}`)
      .send({
        name: 'Call Agent Lead Cafe', phone, otpRequestId,
        contactPersonName: 'Asha Rao', contactPersonRole: 'owner', heardFrom: 'field_visit',
        locality: 'Koramangala',
      })
      .expect(201);
    expect(response.body.accountAgentId).toBeNull();
    expect(response.body.accountAgentAssignedAt).toBeNull();
  });
});
