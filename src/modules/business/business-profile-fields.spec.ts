import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OtpService } from '../../common/otp/otp.service';
import { MockOtpProvider } from '../../common/otp/mock-otp.provider';
import { BUSINESS_PHOTO_STORAGE, MemoryBusinessPhotoStorage } from './storefront-photo.storage';
import { GST_LOOKUP_PROVIDER } from './gst-lookup.provider';

describe('Phase 13 Task 2 — business profile and documents', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let otp: OtpService;
  let agentToken: string;
  let agentId: string;
  const photoStorage = new MemoryBusinessPhotoStorage();
  const businessIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GST_LOOKUP_PROVIDER)
      .useValue({ lookup: async () => { throw new Error('mock lookup unavailable'); } })
      .overrideProvider(BUSINESS_PHOTO_STORAGE)
      .useValue(photoStorage)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    otp = app.get(OtpService);
    const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
    const agent = await prisma.staff.create({ data: {
      code: `BP-${suffix}`, name: 'Business Profile Agent', email: `bp-${suffix}@laboura.local`,
      passwordHash: await bcrypt.hash('Business-Password-1', 4), role: 'call_agent', status: 'active',
    } });
    agentId = agent.id;
    agentToken = jwt.sign({ sub: agent.id, role: agent.role, code: agent.code, email: agent.email });
  }, 120000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.reviewFlag.deleteMany({ where: { subjectId: { in: businessIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: agentId } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.staff.deleteMany({ where: { id: agentId } });
    await app.close();
  });

  async function createBusiness(input: Record<string, unknown>) {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
    const phone = `+9197${suffix.replace(/\D/g, '').slice(0, 8).padEnd(8, '0')}`;
    const otpRequest = await otp.sendOtp(phone);
    const code = (otp.getProvider() as MockOtpProvider).getCode(otpRequest.requestId)!;
    await otp.verifyOtp(otpRequest.requestId, code);
    const response = await request(app.getHttpServer()).post('/businesses')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ locality: 'Koramangala',
        name: `Business ${suffix}`, phone, otpRequestId: otpRequest.requestId,
        contactPersonName: 'Account contact', contactPersonRole: 'owner', heardFrom: 'field_visit', ...input,
      });
    if (response.body.id) businessIds.push(response.body.id as string);
    return response;
  }

  it('creates a business without area, documents only what is supplied, and keeps legacy fields unwritten', async () => {
    const response = await createBusiness({
      name: 'Udyam Bakery', businessType: 'retail', udyamNumber: 'UDYAM-KA-01-0001234',
      locality: 'Basavanagudi', latitude: 12.94, longitude: 77.56,
      contactPerson: 'Account contact', ownerName: 'Business Owner',
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      businessType: 'retail', documentsStatus: 'documented', verificationStatus: 'lead',
      locality: 'Basavanagudi',
      additionalContactName: 'Account contact', ownerName: 'Business Owner',
    });
    const stored = await prisma.business.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(stored.locality).toBe('Basavanagudi');
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityCode: response.body.code, action: 'business.created' },
    });
    expect(JSON.stringify(audit.after)).not.toContain('Business Owner');
  });

  it('allows a household with no registration numbers and stores no_documents', async () => {
    const response = await createBusiness({
      name: 'Household Employer', businessType: 'household', familyName: 'Employer Family', locality: 'Jayanagar',
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ businessType: 'household', documentsStatus: 'no_documents' });
    expect(response.body.gstNumber).toBeNull();
    expect(response.body.licenceNumber).toBeNull();
    expect(response.body.udyamNumber).toBeNull();
  });

  it('rejects business types outside the closed list', async () => {
    const response = await createBusiness({ name: 'Unknown Business Type', businessType: 'unlisted_type' });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('businessType');
  });

  it('keeps the business when GST lookup fails and records the failed lookup', async () => {
    const response = await createBusiness({ name: 'GST Lookup Offline', gstNumber: '29GSTLOOKUP0001Z5' });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ documentsStatus: 'documented', gstVerified: false, gstStatus: 'lookup_failed' });
    expect(response.body.gstCheckedAt).toBeTruthy();
  });

  // Master Guide: the same GST or licence number shows "Already registered — open it"
  // instead of creating a second record. Earlier this test let the duplicates be created
  // and only flagged; now they are refused before saving. A nearby similar name is still
  // only flagged for the Team Lead.
  it('refuses repeated GST and licence numbers with the existing code, and flags nearby similar names only', async () => {
    const tag = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const gst = `29DUP${tag}Z5`;
    const licence = `LIC-DUP-${tag}`;
    const fssai = `FSSAI-${tag}`;
    const source = await createBusiness({ name: `Acme Coffee Shop ${tag}`, gstNumber: gst, licenceNumber: licence, fssaiNumber: fssai, latitude: 12.95, longitude: 77.60 });
    expect(source.status).toBe(201);
    const before = await prisma.business.count();

    const gstMatch = await createBusiness({ name: 'Other Shop', gstNumber: ` ${gst.toLowerCase()} ` });
    expect(gstMatch.status).toBe(409);
    expect(gstMatch.body).toMatchObject({ existingBusinessCode: source.body.code, matchedOn: ['gst_number'] });
    expect(gstMatch.body.message).toContain('Already registered');

    const licenceMatch = await createBusiness({ name: 'Another Shop', licenceNumber: licence });
    expect(licenceMatch.status).toBe(409);
    expect(licenceMatch.body).toMatchObject({ existingBusinessCode: source.body.code, matchedOn: ['licence_number'] });

    const fssaiMatch = await createBusiness({ name: 'Food Shop', fssaiNumber: fssai });
    expect(fssaiMatch.status).toBe(409);
    expect(fssaiMatch.body.existingBusinessCode).toBe(source.body.code);
    expect(await prisma.business.count()).toBe(before);

    const nearbyNameMatch = await createBusiness({ name: `ACME coffee shop ${tag} central`, latitude: 12.95, longitude: 77.60 });
    const distantNameMatch = await createBusiness({ name: `Acme coffee shop ${tag} east`, latitude: 12.952, longitude: 77.60 });
    expect([nearbyNameMatch, distantNameMatch].every((row) => row.status === 201)).toBe(true);

    const flags = await prisma.reviewFlag.findMany({
      where: { kind: 'duplicate_business', subjectId: { in: [nearbyNameMatch.body.id, distantNameMatch.body.id] } },
    });
    expect(flags.map((flag) => flag.subjectId)).toEqual([nearbyNameMatch.body.id]);
  });

  it('answers a repeated mobile number with the existing business code', async () => {
    const phone = `+9198${String(Date.now()).slice(-8)}`;
    const register = async (name: string) => {
      const otpRequest = await otp.sendOtp(phone);
      const code = (otp.getProvider() as MockOtpProvider).getCode(otpRequest.requestId)!;
      await otp.verifyOtp(otpRequest.requestId, code);
      const response = await request(app.getHttpServer()).post('/businesses')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ locality: 'Koramangala', name, phone, otpRequestId: otpRequest.requestId, contactPersonName: 'Contact', contactPersonRole: 'owner', heardFrom: 'field_visit' });
      if (response.body.id) businessIds.push(response.body.id as string);
      return response;
    };
    const first = await register('Phone Owner Shop');
    expect(first.status).toBe(201);
    const again = await register('Same Phone Shop');
    expect(again.status).toBe(409);
    expect(again.body.existingBusinessCode).toBe(first.body.code);
    expect(again.body.message).toContain('Already registered');
  });

  it('accepts only live camera storefront photos, stores them privately, hashes them, and flags reused photos', async () => {
    const first = await createBusiness({ name: 'Photo Shop One' });
    const second = await createBusiness({ name: 'Photo Shop Two' });
    const photo = Buffer.from('same-private-photo-bytes');
    // A file picked from the gallery (or sent with no source) is refused.
    await request(app.getHttpServer()).post(`/businesses/${first.body.id}/storefront-photo`)
      .set('Authorization', `Bearer ${agentToken}`)
      .attach('photo', photo, { filename: 'storefront.jpg', contentType: 'image/jpeg' })
      .expect(400);
    await request(app.getHttpServer()).post(`/businesses/${first.body.id}/storefront-photo`)
      .set('Authorization', `Bearer ${agentToken}`)
      .field('source', 'gallery')
      .attach('photo', photo, { filename: 'storefront.jpg', contentType: 'image/jpeg' })
      .expect(400);
    for (const id of [first.body.id, second.body.id]) {
      await request(app.getHttpServer()).post(`/businesses/${id}/storefront-photo`)
        .set('Authorization', `Bearer ${agentToken}`)
        .field('source', 'live_camera')
        .attach('photo', photo, { filename: 'storefront.jpg', contentType: 'image/jpeg' })
        .expect(201);
    }
    const [firstRow, secondRow] = await Promise.all([
      prisma.business.findUniqueOrThrow({ where: { id: first.body.id } }),
      prisma.business.findUniqueOrThrow({ where: { id: second.body.id } }),
    ]);
    expect(firstRow.storefrontPhotoPath).toBeTruthy();
    expect(firstRow.storefrontPhotoHash).toBe(secondRow.storefrontPhotoHash);
    expect(firstRow.storefrontPhotoLive).toBe(true);
    expect(photoStorage.has(firstRow.storefrontPhotoPath!)).toBe(true);
    expect(await prisma.reviewFlag.count({ where: { kind: 'duplicate_business', subjectId: second.body.id } })).toBeGreaterThan(0);
  });
});
